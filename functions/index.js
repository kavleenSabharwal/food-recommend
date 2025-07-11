// whatsappMealBot.js

const admin=require('firebase-admin');
const axios=require('axios');
const {setGlobalOptions}=require('firebase-functions/v2');
const {GoogleGenerativeAI}=require('@google/generative-ai');
const express=require('express');
require('dotenv').config();
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {onRequest}=require('firebase-functions/v2/https');
const {intentType}=require('./constants');

setGlobalOptions({region: 'us-central1',memory: '512MiB',timeoutSeconds: 60});

admin.initializeApp();
const db=admin.firestore();
const app=express();
const VERIFY_TOKEN=process.env.WEBHOOK_VERIFICATION_TOKEN;
const WHATSAPP_TOKEN=process.env.CLOUD_API_ACCESS_TOKEN;
const PHONE_NUMBER_ID=process.env.WA_PHONE_NUMBER_ID;
const GEMINI_API_KEY=process.env.GEMINI_API_KEY;

const genAI=new GoogleGenerativeAI(GEMINI_API_KEY);
app.use(express.json());

// ====== ♻️ Generic Gemini Request with Retry & Fallback ======
async function generateWithGemini({prompt,models=['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-pro'],retries=3}) {
  async function withRetry(fn,delay=1000) {
    for(let i=0;i<retries;i++) {
      try {
        return await fn();
      } catch(err) {
        console.warn(`⚠️ [Retry ${i+1}] ${err.message}`);
        if(i===retries-1) throw err;
        await new Promise(res => setTimeout(res,delay*(i+1)));
      }
    }
  }

  for(const modelName of models) {
    try {
      console.log(`🤖 [Gemini] Trying: ${modelName}`);
      const model=genAI.getGenerativeModel({model: modelName});
      const result=await withRetry(() =>
        model.generateContent({contents: [{role: 'user',parts: [{text: prompt}]}]})
      );
      const text=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if(text) {
        console.log(`✅ [Gemini] Success: ${modelName}`);
        return text;
      }
    } catch(err) {
      console.error(`❌ [Gemini] ${modelName} failed: ${err.message}`);
    }
  }

  console.warn(`⚠️ [Gemini] All models failed. Using fallback.`);
  return null;
}

// ====== 🔮 AI RECOMMENDATION LOGIC ======
async function getAIRecommendation(userPhone,mealType) {
  console.log(`🤔 [Recommend] ${mealType} for ${userPhone}`);
  const weekAgo=new Date();
  weekAgo.setDate(weekAgo.getDate()-7);

  const snapshot=await db.collection('user-messages')
    .where('phone','==',userPhone)
    .where('mealType','==',mealType)
    .where('timestamp','>=',weekAgo)
    .orderBy('timestamp','desc')
    .limit(10)
    .get();

  const history=snapshot.docs.map(doc => doc.data().recommendation||doc.data().message);
  console.log(`🔎 [History] ${history.length? history.join(', '):'None'}`);

  const prompt=`You are a helpful meal assistant bot. Based on the user's recent ${mealType} choices:\n${history.length>0? history.join(', '):'No history'}\nSuggest 3 healthy and diverse Indian ${mealType} options that haven't been repeated recently. Only return the name of the dish, no explanation.`;

  const text=await generateWithGemini({prompt});
  return text||'poha';
}

// ====== 🧠 CLASSIFICATION LOGIC ======
async function classifyUserMessage(message) {
  console.log(`🔍 [Intent] Message: "${message}"`);
  const prompt=`You are an intelligent classification assistant trained to understand subtle human intent...\n\nGiven the message:\n"${message}"\n\nRespond with only one of: recipe_request, meal_log, meal_selection_with_query, other.`;
  const text=await generateWithGemini({prompt,models: ['gemini-2.5-flash']});
  console.log(`🌟 [Intent] Classified as: ${text}`);
  return text?.toLowerCase()||'other';
}

// ====== 📋 RECIPE GENERATION ======
async function getReplyFromAI(query) {
  console.log(`🍲 [Recipe] For: "${query}"`);
  const prompt=`You are food assistant. Keep it short and friendly. Reply for: ${query}`;
  const text=await generateWithGemini({prompt});
  console.log(`🌟 [Reply] ${text}`);
  return text||'Sorry, I couldn’t find the response.';
}

// ====== 💬 EXTRACT MEAL LOG ======
async function extractMealLog(userMessage) {
  console.log(`🌍 [MealLog] Extracting from: "${userMessage}"`);
  const prompt=`You are food assistant. Please extract food item selected in this message. Reply with just the food item: ${userMessage}`;
  const text=await generateWithGemini({prompt});
  return text;
}

// ====== 📢 SEND WHATSAPP MESSAGE ======
async function sendWhatsAppMessage(phone,body) {
  console.log(`📞 [WhatsApp] → ${phone}`);
  await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,{
    messaging_product: 'whatsapp',to: phone,text: {body}
  },{
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  console.log(`✉️ [WhatsApp] Sent to ${phone}`);
}

// ====== 🌐 WEBHOOK VERIFICATION ======
app.get('/',(req,res) => {
  const mode=req.query['hub.mode'];
  const token=req.query['hub.verify_token'];
  const challenge=req.query['hub.challenge'];

  console.log(`🔐 [Webhook] Mode: ${mode}, Token: ${token}`);
  if(mode==='subscribe'&&token===VERIFY_TOKEN) {
    console.log('🚀 [Webhook] Verified!');
    return res.status(200).send(challenge);
  }
  console.warn('⚠️ [Webhook] Verification failed');
  res.sendStatus(403);
});

// ====== 📬 WEBHOOK HANDLER ======
app.post('/',async (req,res) => {
  try {
    const entry=req.body.entry?.[0];
    const changes=entry?.changes?.[0];
    const messages=changes?.value?.messages;

    if(messages?.length>0) {
      for(const msg of messages) {
        const messageId=msg.id;
        const from=msg.from;
        const userMessage=msg.text?.body;
        console.log(`💬 [Receive] From: ${from} → "${userMessage}"`);

        if(!userMessage) continue;

        const alreadyProcessed=await db.collection('processed-messages').doc(messageId).get();
        if(alreadyProcessed.exists) {
          console.log(`⏹ [Skip] ${messageId} already processed.`);
          continue;
        }

        await db.collection('processed-messages').doc(messageId).set({phone: from,timestamp: new Date()});

        const intent=await classifyUserMessage(userMessage);

        if(intent===intentType.MEAL_LOG) {
          const foodItem=await extractMealLog(userMessage);
          await db.collection('user-meals').add({phone: from,meal: foodItem,timestamp: new Date()});
          await sendWhatsAppMessage(from,`Yum! Logged: "${foodItem}" 🍜`);

        } else if(intent===intentType.MEAL_SELECTION_WITH_QUERY) {
          const foodItem=await extractMealLog(userMessage);
          const queryReply=await getReplyFromAI(userMessage);
          await sendWhatsAppMessage(from,queryReply);
          await db.collection('user-meals').add({phone: from,meal: foodItem,timestamp: new Date()});
          await db.collection('user-messages').add({phone: from,message: userMessage,timestamp: new Date()});

        } else {
          const reply=await getReplyFromAI(userMessage);
          await sendWhatsAppMessage(from,reply);
          await db.collection('user-messages').add({phone: from,message: userMessage,timestamp: new Date()});
        }

        console.log(`✅ [Done] Handled message from ${from}`);
      }
    }

    res.sendStatus(200);
  } catch(error) {
    console.error('❌ [Webhook Error]',error?.response?.data||error.message);
    res.sendStatus(500);
  }
});

// ====== 🔄 CRON JOBS ======
exports.whatsappWebhook=onRequest({region: 'us-central1',invoker: 'public'},app);

exports.sendMeals=onSchedule('every day 08:00',() => {
  console.log('🚀 [Cron] Sending Breakfast');
  return sendMealToAll('Breakfast');
});

exports.sendLunch=onSchedule('every day 13:00',() => {
  console.log('🚀 [Cron] Sending Lunch');
  return sendMealToAll('Lunch');
});

exports.sendDinner=onSchedule('every day 19:00',() => {
  console.log('🚀 [Cron] Sending Dinner');
  return sendMealToAll('Dinner');
});

// ====== 🍽️ SEND MEAL BROADCAST ======
async function sendMealToAll(mealType) {
  console.log(`📣 [Broadcast] ${mealType} for all users`);
  const snapshot=await db.collection('user').get();
  const now=new Date();

  for(const doc of snapshot.docs) {
    const user=doc.data();
    const phone=user.phone;
    const name=user.name?.trim()||'there';

    try {
      console.log(`💡 [User] ${phone} - preparing ${mealType}`);
      const recommendation=await getAIRecommendation(phone,mealType);
      const dishes=recommendation.split(/\n|,/).map(d => d.trim()).filter(Boolean);
      const formattedList=dishes.map((dish,idx) => `${idx+1}. ${dish}`).join('\n');

      const message=`👋 Hi *${name}*,\n🍽️ *${mealType} Time!*\nHere are some tasty picks for you:\n\n${formattedList}\n\nReply with your choice! 😊`;

      await db.collection('user-messages').add({
        phone,
        message: '',
        mealType,
        recommendation,
        timestamp: now
      });

      await sendWhatsAppMessage(phone,message);
      console.log(`✅ [Success] Sent ${mealType} to ${phone}`);
    } catch(err) {
      console.error(`❌ [Error] Sending to ${phone}:`,err.message);
    }
  }
}

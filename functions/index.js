const admin=require('firebase-admin');
const axios=require('axios');
const {setGlobalOptions}=require("firebase-functions/v2");
const {GoogleGenerativeAI}=require('@google/generative-ai');
const express=require('express');
require('dotenv').config();
const {onSchedule}=require("firebase-functions/v2/scheduler");
const {onRequest}=require('firebase-functions/v2/https');

setGlobalOptions({region: "us-central1",memory: "512MiB",timeoutSeconds: 60});

admin.initializeApp();
const db=admin.firestore();
const app=express();
const VERIFY_TOKEN=process.env.WEBHOOK_VERIFICATION_TOKEN;
const WHATSAPP_TOKEN=process.env.CLOUD_API_ACCESS_TOKEN;
const PHONE_NUMBER_ID=process.env.WA_PHONE_NUMBER_ID;
const GEMINI_API_KEY=process.env.GEMINI_API_KEY;

const genAI=new GoogleGenerativeAI(GEMINI_API_KEY);
app.use(express.json());

// ====== 🔮 AI RECOMMENDATION LOGIC ======
async function getAIRecommendation(userPhone,mealType) {
  console.log(`[AI] Fetching recommendation for ${mealType} for ${userPhone}`);
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
  console.log(`[AI] History used: ${history.join(', ')||'No history'}`);

  const prompt=`You are a helpful meal assistant bot. Based on the user's recent ${mealType} choices:
${history.length>0? history.join(', '):'No history'}
Suggest 3 healthy and diverse Indian ${mealType} options that haven't been repeated recently. Only return the name of the dish, no explanation.`;

  async function withRetry(fn,retries=3,delay=1000) {
    for(let i=0;i<retries;i++) {
      try {
        return await fn();
      } catch(err) {
        console.warn(`[Retry] Attempt ${i+1} failed: ${err.message}`);
        if(i===retries-1) throw err;
        await new Promise(res => setTimeout(res,delay*(i+1)));
      }
    }
  }

  const modelsToTry=['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-2.0-pro'];

  for(const modelName of modelsToTry) {
    try {
      console.log(`[AI] Trying model: ${modelName}`);
      const model=genAI.getGenerativeModel({model: modelName});
      const result=await withRetry(() =>
        model.generateContent({
          contents: [{role: 'user',parts: [{text: prompt}]}]
        })
      );
      const text=result.response.candidates?.[0]?.content?.parts?.[0]?.text;
      if(text) {
        console.log(`[AI] ${modelName} succeeded. Recommendation: ${text.trim()}`);
        return text.trim();
      }
    } catch(err) {
      console.error(`[AI Error] ${modelName} failed:`,err.message||err);
    }
  }

  console.warn(`[AI] Falling back to default recommendation.`);
  return 'poha';
}

// ====== 🧠 CLASSIFICATION LOGIC ======
async function classifyUserMessage(message) {
  console.log(`[Classify] Classifying message: "${message}"`);
  const prompt=`You are a smart classification assistant. Decide what kind of message this is: "${message}"
Possible categories:
1. recipe_request
2. meal_log
3. other
Respond with only the category.`;

  const model=genAI.getGenerativeModel({model: 'gemini-2.5-flash'});
  const result=await model.generateContent({
    contents: [{role: 'user',parts: [{text: prompt}]}]
  });
  const category=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
  console.log(`[Classify] Result: ${category}`);
  return category;
}

// ====== 📋 RECIPE GENERATION ======
async function getReplyFromAI(query) {
  console.log(`[Recipe] Getting reply for query: "${query}"`);
  const model=genAI.getGenerativeModel({model: 'gemini-2.5-pro'});
  const result=await model.generateContent({
    contents: [{role: 'user',parts: [{text: `You are food assistant. Please reply for: ${query}`}]}]
  });
  const reply=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  console.log(`[Recipe] Reply: ${reply}`);
  return reply||'Sorry, I couldn’t find the response.';
}

// ====== 💬 SEND WHATSAPP MESSAGE ======
async function sendWhatsAppMessage(phone,body) {
  console.log(`[WhatsApp] Sending to ${phone}: ${body}`);
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      text: {body}
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  console.log(`[WhatsApp] Sent successfully to ${phone}`);
}

// ====== 🌐 WEBHOOK VERIFICATION ======
app.get('/',(req,res) => {
  const mode=req.query['hub.mode'];
  const token=req.query['hub.verify_token'];
  const challenge=req.query['hub.challenge'];

  console.log(`[Webhook] Verification request: mode=${mode}, token=${token}`);
  if(mode==='subscribe'&&token===VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed');
  res.sendStatus(403);
});

// ====== 📥 WEBHOOK HANDLER ======
app.post('/',async (req,res) => {
  try {
    console.log("💬 Incoming message:",JSON.stringify(req.body,null,2));

    const entry=req.body.entry?.[0];
    const changes=entry?.changes?.[0];
    const messages=changes?.value?.messages;

    if(messages?.length>0) {
      for(const msg of messages) {
        const messageId=msg.id;
        const from=msg.from;
        const userMessage=msg.text?.body;
        console.log(`[Receive] Message from ${from} (ID: ${messageId}): "${userMessage}"`);

        if(!userMessage) continue;

        const alreadyProcessed=await db.collection('processed-messages').doc(messageId).get();
        if(alreadyProcessed.exists) {
          console.log(`[Skip] Message ${messageId} already processed.`);
          continue;
        }

        await db.collection('processed-messages').doc(messageId).set({phone: from,timestamp: new Date()});

        const intent=await classifyUserMessage(userMessage);

        if(intent==='meal_log') {
          await db.collection('user-meals').add({phone: from,meal: userMessage,timestamp: new Date()});
          await sendWhatsAppMessage(from,`Yum! Logged: "${userMessage}" 🍜`);
        } else {
          const reply=await getReplyFromAI(userMessage);
          await sendWhatsAppMessage(from,reply);
          await db.collection('user-messages').add({phone: from,message: userMessage,timestamp: new Date()});
        }

        console.log(`[Responded] Message from ${from} handled.`);
      }
    }

    res.sendStatus(200);
  } catch(error) {
    console.error('[Webhook Error]',error?.response?.data||error.message);
    res.sendStatus(500);
  }
});

// ====== 🔁 CRON JOBS ======
exports.whatsappWebhook=onRequest(
  {
    region: "us-central1",
    invoker: "public" // 👈 allows Facebook access
  },app
);

exports.sendMeals=onSchedule("*/10 * * * *",() => {
  console.log("[CRON] sendMeals triggered");
  return sendMealToAll('Breakfast');
});

exports.sendLunch=onSchedule('every day 13:00',() => {
  console.log("[CRON] sendLunch triggered");
  return sendMealToAll('Lunch');
});

exports.sendDinner=onSchedule('every day 19:00',() => {
  console.log("[CRON] sendDinner triggered");
  return sendMealToAll('Dinner');
});

// ====== 🍽️ SEND MEAL BROADCAST ======
async function sendMealToAll(mealType) {
  console.log(`📣 Sending ${mealType} recommendations to all users`);
  const snapshot=await db.collection('user').get();
  const now=new Date();

  for(const doc of snapshot.docs) {
    const user=doc.data();
    const phone=user.phone;
    const name=user.name?.trim()||'there';

    try {
      console.log(`[Prepare] Getting ${mealType} for ${phone}`);
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
      console.log(`[Success] Sent ${mealType} to ${phone}`);
    } catch(err) {
      console.error(`[Send Error] Failed to send to ${phone}:`,err.message||err);
    }
  }
}

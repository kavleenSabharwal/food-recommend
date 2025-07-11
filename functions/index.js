const functions=require('firebase-functions');
const admin=require('firebase-admin');
const axios=require('axios');
const {GoogleGenerativeAI}=require('@google/generative-ai');
const express=require('express');
require('dotenv').config();
const {onSchedule}=require("firebase-functions/v2/scheduler");

admin.initializeApp();
const db=admin.firestore();
const app=express();
const VERIFY_TOKEN=process.env.WEBHOOK_VERIFICATION_TOKEN;
const WHATSAPP_TOKEN=process.env.CLOUD_API_ACCESS_TOKEN;
const PHONE_NUMBER_ID=process.env.WA_PHONE_NUMBER_ID;
const GEMINI_API_KEY=process.env.GEMINI_API_KEY;

const genAI=new GoogleGenerativeAI(GEMINI_API_KEY);
app.use(express.json());

// ======== 🔮 AI Recommendation Logic ========
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

  const prompt=`
You are a helpful meal assistant bot. Based on the user's recent ${mealType} choices:
${history.length>0? history.join(', '):'No history'}

Suggest 3 healthy and diverse Indian ${mealType} options that haven't been repeated recently.
Only return the name of the dish, no explanation.
  `.trim();

  async function withRetry(fn,retries=3,delay=1000) {
    for(let i=0;i<retries;i++) {
      try {
        return await fn();
      } catch(err) {
        const isLastTry=i===retries-1;
        console.warn(`[Retry] Attempt ${i+1} failed: ${err.message||err}`);
        if(isLastTry) throw err;
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
        console.log(`[AI] ${modelName} succeeded. Suggestion: ${text.trim()}`);
        return text.trim();
      }
    } catch(err) {
      console.error(`[AI Error] Model ${modelName} failed:`,err.message||err);
    }
  }

  console.warn(`[AI] Falling back to default recommendation.`);
  return 'poha';
}

// ======== 🧠 Message Classification ========
async function classifyUserMessage(message) {
  console.log(`[Classify] Classifying message: "${message}"`);
  const prompt=`
You are a smart classification assistant.

Decide what kind of message this is:

"${message}"

Possible categories:
1. recipe_request - User is asking how to cook or prepare something.
2. meal_log - User is telling what they are eating or planning to eat.
3. other - Anything else.

Respond with only the category: recipe_request, meal_log, or other.
`.trim();

  const model=genAI.getGenerativeModel({model: 'gemini-2.5-flash'});
  const result=await model.generateContent({
    contents: [{role: 'user',parts: [{text: prompt}]}]
  });

  const category=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
  console.log(`[Classify] Result: ${category}`);
  return category;
}

// ======== 🧾 Recipe Fetching ========
async function getReplyFromAI(query) {
  console.log(`[Recipe] Fetching reply for: "${query}"`);
  const model=genAI.getGenerativeModel({model: 'gemini-2.5-pro'});
  const result=await model.generateContent({
    contents: [{role: 'user',parts: [{text: `You are food assitant agent who replies to all kinds of queries. Please give a suitable reply for: ${query}`}]}]
  });

  const recipe=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return recipe||'Sorry, I couldn’t find the response.';
}

// ======== 📩 WhatsApp Sender ========
async function sendWhatsAppMessage(phone,body) {
  console.log(`[WhatsApp] Sending message to ${phone}: "${body}"`);
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
  console.log(`[WhatsApp] Message sent to ${phone}`);
}

// ======== 🌐 Webhook Verification ========
app.get('/',(req,res) => {
  const mode=req.query['hub.mode'];
  const token=req.query['hub.verify_token'];
  const challenge=req.query['hub.challenge'];

  console.log(`[Webhook] Verification mode: ${mode}, token: ${token}`);
  if(mode==='subscribe'&&token===VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully');
    return res.status(200).send(challenge);
  }

  console.error('[Webhook] Verification failed');
  res.sendStatus(403);
});

// ======== 📥 WhatsApp Webhook Receiver ========
app.post('/',async (req,res) => {
  try {
    console.log("💬 Received message:",JSON.stringify(req.body,null,2));

    const entry=req.body.entry?.[0];
    const changes=entry?.changes?.[0];
    const messages=changes?.value?.messages;

    if(messages&&messages.length>0) {
      for(const msg of messages) {
        const messageId=msg.id;
        const from=msg.from;
        const userMessage=msg.text?.body;

        // ✅ Skip if no text content
        if(!userMessage) continue;

        console.log(`[Receive] Message from ${from} (ID: ${messageId}): "${userMessage}"`);

        // ✅ Check if message has already been processed
        const alreadyProcessed=await db.collection('processed-messages').doc(messageId).get();
        if(alreadyProcessed.exists) {
          console.log(`[Duplicate] Message ${messageId} already handled. Skipping.`);
          continue;
        }

        // ✅ Mark this message as processed
        console.log("🔍 Checking FieldValue:",admin.firestore?.FieldValue?.serverTimestamp);

        await db.collection('processed-messages').doc(messageId).set({
          phone: from,
          timestamp: new Date()
        });

        // ✅ Classify the message
        const intent=await classifyUserMessage(userMessage);
        console.log(`[Intent] Classified as: ${intent}`);

        if(intent==='meal_log') {
          await db.collection('user-meals').add({
            phone: from,
            meal: userMessage,
            timestamp: new Date()
          });
          console.log(`[DB] Logged meal for ${from}: ${userMessage}`);
          await sendWhatsAppMessage(from,`Yum! Logged: "${userMessage}" 🍜`);
        } else {
          const reply=await getReplyFromAI(userMessage);

          await sendWhatsAppMessage(from,reply);

          await db.collection('user-messages').add({
            phone: from,
            message: userMessage,
            timestamp: new Date()
          });
        }

        console.log(`[Responded] Handled message from ${from}`);
      }
    }

    res.sendStatus(200);
  } catch(error) {
    console.error('[Webhook Error]',error?.response?.data||error.message);
    res.sendStatus(500);
  }
});

// ======== ⏰ Scheduled Meal Broadcasts ========
exports.whatsappWebhook=functions.https.onRequest(app);

exports.sendMeals=onSchedule("*/10 * * * *",(event) => {
  console.log("[CRON] Triggered sendMeals");
  return sendMealToAll('Breakfast');
});

exports.sendLunch=onSchedule('every day 13:00',(event) => {
  return sendMealToAll('Lunch');
});
exports.sendDinner=onSchedule('every day 19:00',(event) => {
  return sendMealToAll('Dinner');
});

// ======== 🍽️ Meal Broadcast Logic ========
async function sendMealToAll(mealType) {
  console.log(`\n[CRON] Triggered meal send for: ${mealType}`);
  const snapshot=await db.collection('user').get();
  const now=new Date()

  for(const doc of snapshot.docs) {
    const user=doc.data();
    const phone=user.phone;
    const name=user.name?.trim()||'there';

    try {
      console.log(`[Send] Preparing ${mealType} for ${phone}`);
      const recommendation=await getAIRecommendation(phone,mealType);
      const dishes=recommendation
        .split(/\n|,/)
        .map(d => d.trim())
        .filter(Boolean);
      const formattedList=dishes.map((dish,idx) => `${idx+1}. ${dish}`).join('\n');

      const message=`👋 Hi *${name}*,\n🍽️ *${mealType} Time!*\nHere are some tasty picks for you:\n\n${formattedList}\n\nReply with your choice! 😊`;

      await db.collection('user-messages').add({
        phone,
        message: '',
        mealType,
        recommendation,
        timestamp: now
      });

      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phone,
          text: {body: message}
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Send Success] Sent to ${phone}`);
    } catch(err) {
      console.error(`[Send Error] Could not send to ${phone}:`,err.message||err);
    }
  }
}

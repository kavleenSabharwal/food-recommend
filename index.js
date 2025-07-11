const functions=require('firebase-functions');
const admin=require('firebase-admin');
const axios=require('axios');
const {GoogleGenerativeAI}=require('@google/generative-ai');
const express=require('express');

admin.initializeApp();
const db=admin.firestore();
const app=express();

const genAI=new GoogleGenerativeAI(functions.config().gemini.key);

const WHATSAPP_TOKEN=functions.config().whatsapp.token;
const PHONE_NUMBER_ID=functions.config().whatsapp.phone;
const VERIFY_TOKEN=functions.config().whatsapp.verify;

app.use(express.json());

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

  const history=snapshot.docs.map(doc =>
    doc.data().recommendation||doc.data().message
  );

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

// Webhook verification
app.get('/webhook',(req,res) => {
  const mode=req.query['hub.mode'];
  const token=req.query['hub.verify_token'];
  const challenge=req.query['hub.challenge'];

  if(mode==='subscribe'&&token===VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully');
    return res.status(200).send(challenge);
  }
  console.error('[Webhook] Verification failed');
  res.sendStatus(403);
});

// Receive messages from users
app.post('/webhook',async (req,res) => {
  try {
    const entry=req.body.entry?.[0];
    const changes=entry?.changes?.[0];
    const messages=changes?.value?.messages;

    if(messages&&messages.length>0) {
      const msg=messages[0];
      const from=msg.from;
      const userMessage=msg.text?.body;

      console.log(`[Receive] Message from ${from}: "${userMessage}"`);

      await db.collection('user-messages').add({
        phone: from,
        message: userMessage,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: from,
          text: {body: `Got it! You selected: "${userMessage}" 🍴`}
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Responded] Acknowledgment sent to ${from}`);
    }

    res.sendStatus(200);
  } catch(error) {
    console.error('[Webhook Error]',error?.response?.data||error.message);
    res.sendStatus(500);
  }
});

exports.webhook=functions.https.onRequest(app);

// Scheduled meal sender
exports.sendMeals=functions.pubsub.schedule('every day 08:00').timeZone('Asia/Kolkata').onRun(() => sendMealToAll('Breakfast'));
exports.sendLunch=functions.pubsub.schedule('every day 13:00').timeZone('Asia/Kolkata').onRun(() => sendMealToAll('Lunch'));
exports.sendDinner=functions.pubsub.schedule('every day 19:00').timeZone('Asia/Kolkata').onRun(() => sendMealToAll('Dinner'));

async function sendMealToAll(mealType) {
  console.log(`\n[CRON] Triggered meal send for: ${mealType}`);
  const snapshot=await db.collection('user').get();
  const now=admin.firestore.FieldValue.serverTimestamp();

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

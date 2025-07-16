const express=require('express');
const {onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {db}=require('./utils/firestore');
const {sendMealToAll}=require('./cron/sendMealToAll');
const {classifyUserMessage,extractMealLog,getReplyFromAI}=require('./services/aiService');
const {sendWhatsAppMessage}=require('./services/whatsappService');
const {VERIFY_TOKEN}=require('./config');

const app=express();
app.use(express.json());

app.get('/',(req,res) => {
  const {'hub.mode': mode,'hub.verify_token': token,'hub.challenge': challenge}=req.query;
  if(mode==='subscribe'&&token===VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});
app.post('/',async (req,res) => {
  try {
    const messages=req.body.entry?.[0]?.changes?.[0]?.value?.messages;
    if(!messages) return res.sendStatus(200);

    for(const msg of messages) {
      const {id: messageId,from,text}=msg;
      const userMessage=text?.body;
      if(!userMessage) continue;

      const exists=await db.collection('processed-messages').doc(messageId).get();
      if(exists.exists) continue;

      await db.collection('processed-messages').doc(messageId).set({
        phone: from,
        timestamp: new Date()
      });

      // Save user message with direction: 'in'
      await db.collection('user-messages').add({
        phone: from,
        message: userMessage,
        timestamp: new Date(),
        source: 'user_input',
        direction: 'in'
      });

      // 🔁 Fetch last 5 messages to build context
      const contextSnap=await db.collection('user-messages')
        .where('phone','==',from)
        .orderBy('timestamp','desc')
        .limit(5)
        .get();

      const context=contextSnap.docs
        .reverse()
        .map(doc => {
          const data=doc.data();
          return `${data.direction==='in'? 'User':'Bot'}: ${data.message}`;
        })
        .join('\n');

      const intent=await classifyUserMessage(userMessage);

      if(intent==='meal_log') {
        const food=await extractMealLog(userMessage);
        const reply=`Yum! Logged: "${food}" 🍜`;

        await db.collection('user-meals').add({
          phone: from,
          meal: food,
          timestamp: new Date()
        });

        await sendWhatsAppMessage(from,reply);
        await db.collection('user-messages').add({
          phone: from,
          message: reply,
          timestamp: new Date(),
          source: 'system',
          direction: 'out'
        });

      } else if(intent==='meal_selection_with_query') {
        const food=await extractMealLog(userMessage);
        const reply=await getReplyFromAI(userMessage,context);

        await sendWhatsAppMessage(from,reply);

        await db.collection('user-meals').add({
          phone: from,
          meal: food,
          timestamp: new Date()
        });

        await db.collection('user-messages').add({
          phone: from,
          message: reply,
          timestamp: new Date(),
          source: 'system',
          direction: 'out'
        });

      } else {
        const reply=await getReplyFromAI(userMessage,context);

        await sendWhatsAppMessage(from,reply);
        await db.collection('user-messages').add({
          phone: from,
          message: reply,
          timestamp: new Date(),
          source: 'system',
          direction: 'out'
        });
      }
    }

    res.sendStatus(200);
  } catch(err) {
    console.error('[Webhook Error]',err.message);
    res.sendStatus(500);
  }
});


exports.whatsappWebhook=onRequest({region: 'us-central1',invoker: 'public'},app);
exports.sendMeals=onSchedule('every day 02:30',() => sendMealToAll('Breakfast'));
exports.sendLunch=onSchedule('every day 07:30',() => sendMealToAll('Lunch'));
exports.sendDinner=onSchedule('every day 13:30',() => sendMealToAll('Dinner'));

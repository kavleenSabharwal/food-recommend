const express=require('express');
const {onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {sendMealToAll}=require('./cron/sendMealToAll');
const {VERIFY_TOKEN}=require('./config');
const {sendOnboardingMessages,startUserDietaryOnboarding}=require('./cron/onboarding');
const {incomingMsgHandler}=require('./handlers/incomingMsgHandler');
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
    console.log(".>>>",messages,`📥 Received ${messages.length} message(s)`,);
    await incomingMsgHandler(messages);
    res.sendStatus(200);
  } catch(err) {
    console.error('[Webhook Error] ❌',err);
    res.sendStatus(500);
  }
});



exports.whatsappWebhook=onRequest({region: 'us-central1',invoker: 'public'},app);
exports.dietaryOnboarding=onSchedule('every 30 minutes',() => startUserDietaryOnboarding());
exports.sendMeals=onSchedule('every day 02:30',() => sendMealToAll('Breakfast'));
exports.sendLunch=onSchedule('every day 07:30',() => sendMealToAll('Lunch'));
exports.sendDinner=onSchedule('every day 13:30',() => sendMealToAll('Dinner'));
exports.sendOnboarding=onSchedule('every 30 minutes',sendOnboardingMessages);

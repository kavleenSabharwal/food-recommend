const express=require('express');
const {onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {db}=require('./utils/firestore');
const {sendMealToAll}=require('./cron/sendMealToAll');
const {classifyUserMessage,extractMealLog,getReplyFromAI,extractMealType}=require('./services/aiService');
const {sendWhatsAppMessage}=require('./services/whatsappService');
const {VERIFY_TOKEN}=require('./config');
const {sendOnboardingMessages}=require('./cron/onboarding');
const {intentType}=require('./constants');
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
    console.log('📥 Incoming messages:',JSON.stringify(messages,null,2));
    if(!messages) return res.sendStatus(200);

    for(const msg of messages) {
      const {id: messageId,from,text}=msg;

      // 🛑 Skip if no text (e.g., buttons, delivery receipts, etc.)
      if(!text?.body?.trim()) continue;
      if(text.body.includes("I'm your personal meal assistant")) {
        console.log(`⚠️ Onboarding message echoed back to webhook for ${from}`);
      }
      const userMessage=text.body.trim();

      // 🛑 [KEY FIX] Ignore messages sent by the bot itself
      if(!msg.type||msg.type!=='text'||!text?.body?.trim()) {
        console.log(`⏭️ Skipping non-text or system message from ${from}:`,msg.type);
        continue;
      }

      console.log(`📨 Received from ${from}:`,userMessage);


      if(!userMessage) continue;

      const now=new Date();
      const istOffset=5.5*60*60000;
      const istTime=new Date(now.getTime()+istOffset);
      console.log('🕒 IST time:',istTime.toISOString());

      let alreadyProcessed=false;

      await db.runTransaction(async t => {
        const ref=db.collection('processed-messages').doc(messageId);
        const doc=await t.get(ref);
        if(doc.exists) {
          alreadyProcessed=true;
          return;
        }
        t.set(ref,{phone: from,timestamp: now});
      });

      if(alreadyProcessed) {
        console.log(`⚠️ Message ${messageId} already processed. Skipping.`);
        continue;
      }

      await db.collection('user-messages').add({
        phone: from,
        message: userMessage,
        timestamp: now,
        source: 'user_input',
        direction: 'in'
      });

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

      console.log('🧠 Context:\n'+context);

      const mealTypeOnly=userMessage.toLowerCase();
      if(['breakfast','lunch','dinner'].includes(mealTypeOnly)) {
        const pendingSnap=await db.collection('pending-meal-log').doc(from).get();
        if(pendingSnap.exists) {
          const {meal}=pendingSnap.data();
          await db.collection('user-meals').add({
            phone: from,
            meal,
            mealType: mealTypeOnly.charAt(0).toUpperCase()+mealTypeOnly.slice(1),
            timestamp: now
          });

          const confirmMsg=`Perfect! Logged "${meal}" as your ${mealTypeOnly}. ✅`;
          await sendWhatsAppMessage(from,confirmMsg);
          console.log('✅ Meal logged via keyword reply:',confirmMsg);

          await db.collection('pending-meal-log').doc(from).delete();
          continue;
        }
      }

      const intent=await classifyUserMessage(userMessage);
      console.log('🎯 Intent classified as:',intent);

      if(intent===intentType.MEAL_LOG||intent===intentType.MEAL_SELECTION_WITH_QUERY) {
        const food=await extractMealLog(userMessage);
        let mealType=await extractMealType(userMessage);
        console.log(`🍲 Extracted food: "${food}", mealType: ${mealType}`);

        if(!mealType) {
          const hour=istTime.getHours();
          if(hour>=6&&hour<=10) mealType='Breakfast';
          else if(hour>=11&&hour<=15) mealType='Lunch';
          else if(hour>=18&&hour<=22) mealType='Dinner';
          console.log(`🕰️ Guessed mealType based on time: ${mealType}`);
        }

        if(mealType) {
          if(food!=="none") {
            await db.collection('user-meals').add({
              phone: from,
              meal: food,
              mealType,
              timestamp: now
            });
          }
          const reply=intent===intentType.MEAL_LOG
            ? `Yum! Logged: "${food}" for ${mealType} 🍽️`
            :await getReplyFromAI(userMessage,context);

          await sendWhatsAppMessage(from,reply);
          console.log('✅ Meal logged:',reply);

        } else {
          await db.collection('pending-meal-log').doc(from).set({
            phone: from,
            meal: food,
            timestamp: now
          });

          const prompt=`Got it! Was this for *breakfast*, *lunch*, or *dinner*?`;
          await sendWhatsAppMessage(from,prompt);
          console.log('🤔 Meal type unclear. Prompting user:',prompt);
          console.log("Saving twice..!!.")
        }

      } else {
        const reply=await getReplyFromAI(userMessage,context);
        await sendWhatsAppMessage(from,reply);
        console.log('💬 Default AI reply sent:',reply);
      }
    }

    res.sendStatus(200);
  } catch(err) {
    console.error('[Webhook Error] ❌',err);
    res.sendStatus(500);
  }
});



exports.whatsappWebhook=onRequest({region: 'us-central1',invoker: 'public'},app);
exports.sendMeals=onSchedule('every day 02:30',() => sendMealToAll('Breakfast'));
exports.sendLunch=onSchedule('every day 07:30',() => sendMealToAll('Lunch'));
exports.sendDinner=onSchedule('every day 13:30',() => sendMealToAll('Dinner'));
exports.sendOnboarding=onSchedule('every 30 minutes',sendOnboardingMessages);

const {db}=require('../utils/firestore');
const {classifyAndRouteUserIntent,extractMealLog,getReplyFromAI,extractMealType}=require('../services/aiService');
const {sendWhatsAppMessage}=require('../services/whatsappService');
const {intentType}=require('../constants');
const {timeNow,istTime,guessMealTypeFromTime}=require('../utils/time');
const {capitalize}=require('../utils/helper');
const {startUserDietaryOnboarding}=require('../cron/onboarding');
const {aiParseDietaryPreference,aiGenerateNextQuestion,aiIsOnboardingComplete}=require('../utils/gemini');

async function incomingMsgHandler(messages) {
  for(const msg of messages) {
    const {id: messageId,from,text}=msg;
    const userMessage=text?.body?.trim();

    if(!userMessage||messageSanity(text,msg,from)===false) {
      console.log(`⏭️ Skipping invalid or non-text message from ${from}`);
      continue;
    }

    console.log(`📨 Received message from ${from}: "${userMessage}"`);

    const isDuplicate=await checkForDuplicateAndLogIt(messageId,from,userMessage);
    console.log(`🔍 Duplicate check for ${from} (${messageId}): ${isDuplicate}`);
    if(!isDuplicate) return;
    // const onboardingUser=await handleUserOnboardingReply(from,userMessage);
    // console.log(`👤 Onboarding status for ${from}: ${onboardingUser}`);
    // if(onboardingUser==true) {
    //   return;
    // }
    const context=await getUserMessageContext(from);
    console.log(`🧠 Context for ${from}:\n${context}`);

    const mealLogged=await tryLogPendingMeal(from,userMessage);
    if(mealLogged) {
      console.log(`⛔ Message "${userMessage}" handled as pending meal confirmation. Skipping further logic.`);
      continue;
    }

    const intent=await classifyAndRouteUserIntent(userMessage,context);
    console.log(`🎯 Intent for "${userMessage}" is "${intent}"`);

    switch(intent) {
      case 'log_meal':
        await handleMealLogIntent({from,userMessage,intent,context});
        break;
      case 'start_onboarding':
        await handleUserOnboardingReply(from,userMessage,);
        break;
      case 'get_meal_suggestions':
        const reply=await getReplyFromAI(userMessage,context); // or build suggestion logic
        await sendWhatsAppMessage(from,reply);
        break;
      case 'general_chat':
      default:
        const fallback=await getReplyFromAI(userMessage,context);
        await sendWhatsAppMessage(from,fallback);
        break;
    }

  }
}
async function getUserMessageContext(phone) {
  const snap=await db.collection('user-messages')
    .where('phone','==',phone)
    .orderBy('timestamp','desc')
    .limit(5)
    .get();

  console.log(`📚 Fetched last ${snap.size} messages for context for ${phone}`);

  return snap.docs
    .reverse()
    .map(doc => {
      const data=doc.data();
      return `${data.direction==='in'? 'User':'Bot'}: ${data.message}`;
    })
    .join('\n');
}
async function tryLogPendingMeal(phone,userMessage) {
  const mealTypeOnly=userMessage.toLowerCase();
  if(!['breakfast','lunch','dinner'].includes(mealTypeOnly)) return false;

  const pendingSnap=await db.collection('pending-meal-log').doc(phone).get();
  if(!pendingSnap.exists) {
    console.log(`📭 No pending meal log found for ${phone}`);
    return false;
  }

  const {meal}=pendingSnap.data();
  console.log(`📌 Found pending meal "${meal}" for ${phone}. Logging as ${mealTypeOnly}...`);

  await db.collection('user-meals').add({
    phone,
    meal,
    mealType: capitalize(mealTypeOnly),
    timestamp: timeNow()
  });

  const confirmMsg=`Perfect! Logged "${meal}" as your ${mealTypeOnly}. ✅`;
  await sendWhatsAppMessage(phone,confirmMsg);
  console.log('✅ Meal logged via keyword reply:',confirmMsg);

  await db.collection('pending-meal-log').doc(phone).delete();
  console.log(`🧹 Pending log cleared for ${phone}`);
  return true;
}
async function handleMealLogIntent({from,userMessage,intent,context}) {
  const food=await extractMealLog(userMessage);
  let mealType=await extractMealType(userMessage);

  console.log(`🍲 Extracted food: "${food}", extracted mealType: ${mealType}`);

  if(!mealType) {
    const hour=istTime().getHours();
    mealType=guessMealTypeFromTime(hour);
    console.log(`🕰️ Guessed mealType from time (${hour}h): ${mealType}`);
  }

  if(mealType) {
    if(food!=="none") {
      await db.collection('user-meals').add({
        phone: from,
        meal: food,
        mealType,
        timestamp: timeNow()
      });
      console.log(`✅ Meal entry stored for ${from}: "${food}" (${mealType})`);
    }

    const reply=intent===intentType.MEAL_LOG
      ? `Yum! Logged: "${food}" for ${mealType} 🍽️`
      :await getReplyFromAI(userMessage,context);

    await sendWhatsAppMessage(from,reply);
    console.log('✅ Meal logged reply sent:',reply);

  } else {
    await db.collection('pending-meal-log').doc(from).set({
      phone: from,
      meal: food,
      timestamp: timeNow()
    });

    const prompt=`Got it! Was this for *breakfast*, *lunch*, or *dinner*?`;
    await sendWhatsAppMessage(from,prompt);
    console.log('🤔 Meal type unclear. Prompted user:',prompt);
  }
}
function messageSanity(text,msg,from) {
  const userMessage=text?.body?.trim();

  if(!userMessage) return false;

  if(text.body.includes("I'm your personal meal assistant")) {
    console.log(`⚠️ Onboarding message echoed back to webhook for ${from}`);
    return false;
  }

  if(!msg.type||msg.type!=='text') {
    console.log(`⏭️ Non-text or unsupported message type from ${from}:`,msg.type);
    return false;
  }

  return true;
}
async function checkForDuplicateAndLogIt(messageId,from,userMessage) {
  let alreadyProcessed=false;

  await db.runTransaction(async t => {
    const ref=db.collection('processed-messages').doc(messageId);
    const doc=await t.get(ref);
    if(doc.exists) {
      alreadyProcessed=true;
      return;
    }
    t.set(ref,{phone: from,timestamp: timeNow()});
  });

  if(alreadyProcessed) {
    console.log(`⚠️ Duplicate message ${messageId} detected from ${from}. Skipping.`);
    return false;
  }

  await db.collection('user-messages').add({
    phone: from,
    message: userMessage,
    timestamp: timeNow(),
    source: 'user_input',
    direction: 'in'
  });

  console.log(`📥 Message from ${from} logged to user-messages`);
  return true;
}
// async function handleUserOnboardingReply(phone,message) {
//   const onboardingRef=db.collection('user-onboarding-state').doc(phone);
//   const onboardingSnap=await onboardingRef.get();

//   if(!onboardingSnap.exists) return false; // Not in onboarding flow

//   const {currentIndex=0,questionKey}=onboardingSnap.data();
//   const trimmedAnswer=message.trim();

//   if(!trimmedAnswer) {
//     console.log(`⚠️ Empty reply from ${phone}, skipping.`);
//     return false;
//   }

//   try {
//     // Extract and merge inferred preferences
//     const preferenceUpdate=await extractPreferenceFromAnswer(questionKey,trimmedAnswer);
//     if(preferenceUpdate&&typeof preferenceUpdate==='object') {
//       await db.collection('user').doc(phone).set({
//         preferences: preferenceUpdate,
//       },{merge: true});
//       console.log(`✅ Merged structured preference from ${questionKey} for ${phone}`);
//     } else {
//       console.log(`⚠️ No structured preference returned for ${questionKey}`);
//     }

//     // Advance onboarding
//     await onboardingRef.set({currentIndex: currentIndex+1},{merge: true});
//     await startUserDietaryOnboarding(phone); // Trigger next question

//     return true;

//   } catch(err) {
//     console.error(`❌ Error in onboarding reply for ${phone}:`,err);
//     return false;
//   }
// }

async function handleUserOnboardingReply(phone,userMessage) {
  const trimmedAnswer=userMessage.trim();
  const userRef=db.collection('user').doc(phone);
  const onboardingRef=db.collection('user-onboarding-state').doc(phone);

  const userDoc=await userRef.get();
  const onboardingDoc=await onboardingRef.get();

  if(!userDoc.exists) {
    console.log(`❌ No user found with phone: ${phone}`);
    return;
  }

  const userData=userDoc.data();
  const onboardingState=onboardingDoc.exists? onboardingDoc.data():{};

  // 👇 1. Parse user reply into structured dietary preferences
  const parsedPreferences=await aiParseDietaryPreference(trimmedAnswer,userData.preferences||{}, context);
  console.log(`🧠 Parsed Preferences:`,parsedPreferences);

  // 👇 2. Merge into Firestore under preferences
  await userRef.set({
    preferences: {
      ...(userData.preferences||{}),
      ...parsedPreferences,
    },
    lastUpdated: istTime(),
  },{merge: true});

  // 👇 3. Determine if onboarding should continue or finish
  const isComplete=await aiIsOnboardingComplete(parsedPreferences,userData.preferences);

  if(isComplete) {
    const confirmMsg=`✅ I’ve noted down your preferences.\nWould you like to add anything else about your diet or food choices?`;
    await sendWhatsAppMessage(phone,confirmMsg);
    await onboardingRef.set({
      phone,
      phase: 'confirmation', // Awaiting user "no" to finish
      timestamp: istTime(),
    },{merge: true});
    return;
  }

  // 👇 4. If not complete, ask next question based on current preferences
  const nextQuestion=await aiGenerateNextQuestion(userData.preferences,parsedPreferences);
  await sendWhatsAppMessage(phone,nextQuestion);

  await onboardingRef.set({
    phone,
    phase: 'asking',
    lastQuestion: nextQuestion,
    timestamp: istTime(),
  },{merge: true});
}

async function extractPreferenceFromAnswer(questionKey,answer) {
  const prompt=`Given the following user response: "${answer}", infer a structured dietary preference based on the question "${questionKey}". Return a JSON object representing the inferred data to be merged into a user's "preferences" object.`;

  const structuredPref=await foodRecommendByGemini({prompt,json: true});
  return structuredPref||null;
}



module.exports={incomingMsgHandler};

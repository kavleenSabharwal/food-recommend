const {db}=require('../utils/firestore');
const {sendWhatsAppMessage}=require('../services/whatsappService');
const {timeNow}=require('../utils/time');
const {getFollowUpFromAI}=require('../utils/gemini');
const {preferencesMap}=require('../constants');

function isValidPhoneNumber(phone) {
  // Accepts numbers like '919876543210', '14155552671', etc.
  return typeof phone==='string'&&/^[1-9]\d{10,14}$/.test(phone);
}

async function sendOnboardingMessages() {
  console.log('🚀 [Cron] Checking for users with no messages...');

  const usersSnap=await db.collection('user').get();


  if(usersSnap.empty) {
    console.log('⚠️ No users found in user collection.');
    return;
  }

  await Promise.allSettled(usersSnap.docs.map(async doc => {
    const {phone,name='there'}=doc.data();

    if(!phone) {
      console.log('❌ Skipping: User has no phone number.');
      return;
    }

    if(!isValidPhoneNumber(phone)) {
      console.log(`❌ Skipping: Invalid phone format "${phone}"`);
      return;
    }

    console.log(`👤 Checking user: ${phone}`);

    const messagesSnap=await db.collection('user-messages')
      .where('phone','==',phone)
      .limit(1)
      .get();

    console.log(`📨 Messages found for ${phone}: ${messagesSnap.size}`);

    if(messagesSnap.empty) {
      console.log(`📞 [Onboarding] Sending welcome message to ${phone}...`);

      const message=`👋 Hi *${name}*! I'm your personal meal assistant.\nI'll send you meal ideas every day 🍽️. Just reply with what you ate, and I’ll log it for you!\n\nLet’s get started! 💬`;
      const onboardingMessageId=`onboarding-${phone}`;

      const alreadySent=await db.runTransaction(async (t) => {
        const ref=db.collection('processed-messages').doc(onboardingMessageId);
        const snap=await t.get(ref);
        if(snap.exists) {
          return true;
        }

        t.set(ref,{
          phone,
          timestamp: timeNow(),
          source: 'onboarding',
        });

        return false;
      });

      if(alreadySent) {
        console.log(`⏭️ Already sent onboarding to ${phone}`);
        return;
      }

      await sendWhatsAppMessage(phone,message);
      console.log(`✅ [Onboarded] ${phone}`);
    } else {
      console.log(`ℹ️ [Already active] ${phone}`);
    }
  }));

  console.log('🏁 [Cron] Onboarding check complete.');
}



async function startUserDietaryOnboarding(phone=null) {
  console.log('🚀 [Onboarding] Starting dietary onboarding...');

  const users=[];

  if(phone) {
    const userDoc=await db.collection('user').doc(phone).get();
    if(!userDoc.exists) {
      console.log(`❌ No user found for phone: ${phone}`);
      return;
    }
    users.push(userDoc);
  } else {
    const usersSnap=await db.collection('user').get();
    if(usersSnap.empty) {
      console.log('⚠️ No users found.');
      return;
    }
    users.push(...usersSnap.docs);
  }

  for(const doc of users) {
    const {phone,name="there"}=doc.data();
    if(!phone||!isValidPhoneNumber(phone)) continue;

    const userRef=db.collection('user').doc(phone);
    const onboardingRef=db.collection('user-onboarding-state').doc(phone);
    const userSnap=await userRef.get();
    const userData=userSnap.exists? userSnap.data():{};

    // 🧠 Ask AI to pick next question
    const aiPrompt=`
We are collecting dietary preferences of a user. Here's what we already know:

${JSON.stringify(userData,null,2)}

We still want to know the following:

${preferencesMap.join('\n')}

Based on the above, which single question should we ask the user next? 
Return a JSON object with:
{
  "questionKey": "...",
  "question": "..."
}`;

    const aiResponse=await getFollowUpFromAI(aiPrompt);

    if(!aiResponse||!aiResponse.question||!aiResponse.questionKey) {
      console.warn(`⚠️ No valid question returned by AI for ${phone}`);
      continue;
    }

    console.log(`📨 Asking ${phone}: ${aiResponse.question}`);

    await sendWhatsAppMessage(phone,aiResponse.question);

    await onboardingRef.set({
      phone,
      questionKey: aiResponse.questionKey,
      timestamp: timeNow(),
    },{merge: true});
  }

  console.log('🏁 [Onboarding] Loop done.');
}



module.exports={sendOnboardingMessages,startUserDietaryOnboarding};

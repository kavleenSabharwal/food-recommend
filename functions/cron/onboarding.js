const {db}=require('../utils/firestore');
const {sendWhatsAppMessage}=require('../services/whatsappService');

function isValidPhoneNumber(phone) {
  // Accepts numbers like '919876543210', '14155552671', etc.
  return typeof phone==='string'&&/^[1-9]\d{10,14}$/.test(phone);
}

async function sendOnboardingMessages() {
  console.log('🚀 [Cron] Checking for users with no messages...');

  const usersSnap=await db.collection('user').get();
  const now=new Date();

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
          timestamp: now,
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

module.exports={sendOnboardingMessages};

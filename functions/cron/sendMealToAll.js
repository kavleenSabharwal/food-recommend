const {db}=require('../utils/firestore');
const {getAIRecommendation}=require('../services/aiService');
const {sendWhatsAppMessage}=require('../services/whatsappService');

async function sendMealToAll(mealType) {
  const snapshot = await db.collection('user').get();
  const now = new Date();

  await Promise.allSettled(snapshot.docs.map(async doc => {
    const { phone, name = 'there' } = doc.data();
    try {
      // 1. Fetch meal history
      const mealHistoryData=await getMealHistoryByType(phone,mealType);

      const fullHistoryMeals=mealHistoryData.map(item => item.meal);
      const recentCutoff=new Date();
      recentCutoff.setDate(recentCutoff.getDate()-3);

      const recentMeals=mealHistoryData
        .filter(item => item.timestamp>recentCutoff)
        .map(item => item.meal);

      console.log(`📖 Meal history for ${phone} (${mealType}):`,fullHistoryMeals,{recentMeals});
      // 2. Get AI recommendation using context and exclusion list
      const recommendation=await getAIRecommendation(
        phone,
        mealType,
        fullHistoryMeals,
        recentMeals
      );

      const dishes = recommendation.split(/\n|,/).map(d => d.trim()).filter(Boolean);
      const list = dishes.map((dish, i) => `${i + 1}. ${dish}`).join('\n');

      // 3. Log the recommendation
      await db.collection('user-messages').add({
        phone,
        message: '',
        mealType,
        recommendation,
        timestamp: now,
        source: 'broadcast'
      });

      // 4. Send WhatsApp message
      await sendWhatsAppMessage(phone, `👋 Hi *${name}*,\n🍽️ *${mealType} Time!*\nHere are some tasty picks:\n\n${list}\n\nReply with your choice! 😊`);
    } catch (err) {
      console.error(`Error sending to ${phone}:`, err.message);
    }
  }));
}



async function getMealHistoryByType(phone,mealType) {
  const snapshot=await db.collection('user-meals')
    .where('phone','==',phone)
    .where('mealType','==',mealType)
    .orderBy('timestamp','desc')
    .get();

  const history=snapshot.docs.map(doc => ({
    meal: doc.data().meal,
    timestamp: doc.data().timestamp.toDate(), // Firestore Timestamp → JS Date
  }));

  return history;
}

module.exports = { sendMealToAll };
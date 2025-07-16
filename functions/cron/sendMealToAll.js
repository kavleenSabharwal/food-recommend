const { db } = require('../utils/firestore');
const { getAIRecommendation } = require('../services/aiService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

async function sendMealToAll(mealType) {
  const snapshot = await db.collection('user').get();
  const now = new Date();

  await Promise.allSettled(snapshot.docs.map(async doc => {
    const { phone, name = 'there' } = doc.data();
    try {
      const historySnap = await db.collection('user-messages')
        .where('phone', '==', phone)
        .where('mealType', '==', mealType)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();
      const history = historySnap.docs.map(d => d.data().recommendation || d.data().message);

      const recommendation = await getAIRecommendation(phone, mealType, history);
      const dishes = recommendation.split(/\n|,/).map(d => d.trim()).filter(Boolean);
      const list = dishes.map((dish, i) => `${i + 1}. ${dish}`).join('\n');

      await db.collection('user-messages').add({
        phone,
        message: '',
        mealType,
        recommendation,
        timestamp: now,
        source: 'broadcast'
      });

      await sendWhatsAppMessage(phone, `👋 Hi *${name}*,\n🍽️ *${mealType} Time!*\nHere are some tasty picks:\n\n${list}\n\nReply with your choice! 😊`);
    } catch (err) {
      console.error(`Error sending to ${phone}:`, err.message);
    }
  }));
}

module.exports = { sendMealToAll };
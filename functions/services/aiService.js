const {generateWithGemini}=require('../utils/gemini');

async function classifyUserMessage(message) {
  const prompt=`Classify this WhatsApp message: "${message}"\nRespond with one of: recipe_request, meal_log, meal_selection_with_query, other.`;
  const result=await generateWithGemini({prompt});
  return result?.toLowerCase()||'other';
}

async function getReplyFromAI(query,context='') {
  const prompt=`
You are a friendly, conversational Indian food assistant. Continue the conversation based on this chat history:

${context}

User: ${query}
Bot:
  `.trim();

  return await generateWithGemini({prompt});
}


async function extractMealLog(message) {
  const prompt=`Extract the meal name from this message: ${message}. Only return the name.`;
  return await generateWithGemini({prompt});
}

async function getAIRecommendation(userPhone,mealType,history=[]) {
  const historyText=history.length>0? history.join(', '):'No history';
  const prompt=`Suggest 3 healthy Indian ${mealType} dishes based on: ${historyText}. Don't repeat recent items.`;
  const text=await generateWithGemini({prompt});
  return text||'poha';
}

module.exports={classifyUserMessage,getReplyFromAI,extractMealLog,getAIRecommendation};

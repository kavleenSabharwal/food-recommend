const {generateWithGemini,generate1wordFromGemini}=require('../utils/gemini');

async function classifyUserMessage(message) {
  const prompt=`You are an intelligent classification assistant trained to understand subtle human intent...\n\nGiven the message:\n"${message}"\n\nRespond with only one of: recipe_request, meal_log, meal_selection_with_query, other.\n\nDo not add any extra text or explanation. Just return the classification.`;
  const result=await generate1wordFromGemini({prompt});
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
  const prompt=`Extract the meal/food item name from this message: ${message}. Only return the name. If not found, return "none".`;
  return generate1wordFromGemini({prompt});
}

async function extractMealType(userMessage) {
  const prompt=`
You are a helpful assistant. From the message below, extract the meal type mentioned, if any. Respond with exactly one word: "breakfast", "lunch", "dinner", or "none".

Message: "${userMessage}"
`;

  const result=await generate1wordFromGemini({prompt});
  const type=result?.toLowerCase().trim();
  if(['breakfast','lunch','dinner'].includes(type)) return type.charAt(0).toUpperCase()+type.slice(1);
  return null;
}

async function getAIRecommendation(userPhone,mealType,history=[]) {
  const historyText=history.length>0? history.join(', '):'No history';
  const prompt=`Suggest 3 healthy Indian ${mealType} dishes based on: ${historyText}. Don't repeat recent items. Just return the dish names, separated by commas.`;
  const text=await generateWithGemini({prompt});
  return text||'poha';
}

module.exports={classifyUserMessage,getReplyFromAI,extractMealLog,getAIRecommendation,extractMealType};

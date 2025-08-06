const {generateWithGemini,generate1wordFromGemini,foodRecommendByGemini}=require('../utils/gemini');

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

async function getAIRecommendation(userPhone,mealType,history=[],recentMeals=[]) {
  console.log(`🔍 Fetching AI recommendation for ${userPhone} (${mealType})...`);
  const historyText=history.length>0? "reference/inspired by: "+history.join(', '):'';
  const prompt=`Suggest 3 healthy Indian ${mealType}  dishes that form a balanced meal—each should contain a good mix of protein, complex carbs, and fiber ${historyText}. Don't repeat these recent items ${recentMeals}. Just return the dish names, separated by commas.`;
  const text=await foodRecommendByGemini({prompt});
  return text||'poha';
}
// Example function in aiService.js
async function classifyAndRouteUserIntent(message,context) {
  const prompt=`
You are an assistant that helps route user messages to backend functions based on intent.
Here are some possible functions you can call:

- "log_meal": User mentions a meal or dish (e.g., "I had poha for lunch")
- "start_onboarding": User wants to set preferences or is answering some onboarding questions
- "get_meal_suggestions": User wants food suggestions or asks "what should I eat?"
- "general_chat": Any other small talk or non-specific queries

Message history:
${context}

Latest user message: "${message}"

Reply with ONLY one of: log_meal, start_onboarding, get_meal_suggestions, general_chat
`;

  const intent=await generate1wordFromGemini({prompt}); // replace with actual Gemini API
  return intent.trim().toLowerCase();
}


module.exports={classifyUserMessage,getReplyFromAI,extractMealLog,getAIRecommendation,extractMealType,classifyAndRouteUserIntent};

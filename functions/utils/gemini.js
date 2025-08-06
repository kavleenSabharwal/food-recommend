const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('../config');
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const {log}=require('./logger');
const {preferencesMap}=require('../constants');
/**
 * Extract meaningful dietary preferences from user's freeform reply.
 */

async function aiParseDietaryPreference(message,existingPrefs,context) {
  const prompt=`
You're an intelligent food assistant helping a user set their dietary preferences. Here's the user's latest message:
"${message}". Context on the chat:
${context}

Their current preferences so far:
${JSON.stringify(existingPrefs)}

Your task:
- Update the preferences object by adding or modifying any relevant dietary information.
- This includes: diet type, restrictions, likes, dislikes, allergies, comfort with non-veg, preferred proteins, etc.
- ✅ VERY IMPORTANT: If the user gives a negative or empty response like "none", "no allergies", or "I eat everything", capture that **explicitly** as:
  - "allergies": "none"
  - "disliked_ingredients": "none"
  - or similar structured fields.

Return ONLY a clean JSON object of updated fields (no explanation, no markdown, no extra text).
`;

  const response=await sendToGemini({prompt});
  try {
    const cleanedResponse=response
      .trim()
      .replace(/^```(?:json)?/,'')  // remove ``` or ```json at the start
      .replace(/```$/,'')           // remove closing ```
      .trim();

    return JSON.parse(cleanedResponse);
  } catch(e) {
    console.warn('❌ Could not parse preferences:',response);
    return {};
  }
}

/**
 * Generate the next meaningful dietary question based on existing preferences.
 */
async function aiGenerateNextQuestion(currentPrefs,parsedPreferences) {
  const prompt=`
Based on this user's current dietary preferences:
${JSON.stringify(currentPrefs)}
${JSON.stringify(parsedPreferences)}
We still want to know the following:

${preferencesMap.join('\n')}

Suggest the next question to understand their food habits or preferences better. 
Keep it conversational, not robotic. Just respond with one clear question.
`;

  const response=await sendToGemini({prompt});
  return response.trim();
}

/**
 * Determine if the AI has enough information to stop onboarding.
 */
async function aiIsOnboardingComplete(currentPrefs,parsedPreferences) {
  const prompt=`
These are the current dietary preferences we have:
${JSON.stringify(currentPrefs)}
We still want to know the following:
${preferencesMap.join('\n')}
${JSON.stringify(parsedPreferences)}
Have we gathered enough meaningful dietary information to personalize their meals? 
Respond with either: true or false.
`;

  const response=await sendToGemini({prompt});
  return response.toLowerCase().includes('true');
}


async function sendToGemini({prompt,models=['gemini-2.5-flash','gemini-2.5-pro'],retries=3}) {
  async function withRetry(fn,delay=1000) {
    for(let i=0;i<retries;i++) {
      try {
        return await fn();
      } catch(err) {
        log('warn',`Retry ${i+1} failed: ${err.message}`);
        if(i===retries-1) throw err;
        await new Promise(res => setTimeout(res,delay*(i+1)));
      }
    }
  }

  // 🧠 Force Gemini to be casual, short and conversational
  const enhancedPrompt=prompt

  for(const modelName of models) {
    try {
      log('info',`Trying Gemini model: ${modelName}`);
      const model=genAI.getGenerativeModel({model: modelName});
      const result=await withRetry(() =>
        model.generateContent({
          contents: [{role: 'user',parts: [{text: enhancedPrompt}]}]
        })
      );
      console.log('Gemini result:',JSON.stringify(result,null,2));
      const text=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if(text) return text;
    } catch(err) {
      log('error',`Gemini ${modelName} failed: ${err.message}`);
    }
  }

  return null;
}

async function generateWithGemini({ prompt, models = ['gemini-2.5-flash', 'gemini-2.5-pro'], retries = 3 }) {
  async function withRetry(fn, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        log('warn', `Retry ${i + 1} failed: ${err.message}`);
        if (i === retries - 1) throw err;
        await new Promise(res => setTimeout(res, delay * (i + 1)));
      }
    }
  }

  // 🧠 Force Gemini to be casual, short and conversational
  const enhancedPrompt=`You are a helpful Indian food assistant on WhatsApp.
Reply in a warm, natural tone — not too formal, not too dramatic. Just helpful, friendly, and to the point.
If the user asks for a recipe, give the full recipe directly without asking questions unless necessary.
Prompt:
${prompt}
`;

  for (const modelName of models) {
    try {
      log('info', `Trying Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result=await withRetry(() =>
        model.generateContent({
          contents: [{role: 'user',parts: [{text: enhancedPrompt}]}]
        })
      );
      console.log('Gemini result:',JSON.stringify(result,null,2));
      const text=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if(text) return text;
    } catch(err) {
      log('error',`Gemini ${modelName} failed: ${err.message}`);
    }
  }

  return null;
}

async function foodRecommendByGemini({prompt,models=['gemini-2.5-flash','gemini-2.5-pro'],retries=3}) {
  async function withRetry(fn,delay=1000) {
    for(let i=0;i<retries;i++) {
      try {
        return await fn();
      } catch(err) {
        log('warn',`Retry ${i+1} failed: ${err.message}`);
        if(i===retries-1) throw err;
        await new Promise(res => setTimeout(res,delay*(i+1)));
      }
    }
  }

  // 🧠 Force Gemini to be casual, short and conversational
  const enhancedPrompt=`You are a helpful Indian food assistant on WhatsApp. Prompt:
${prompt}
`;

  for(const modelName of models) {
    try {
      log('info',`Trying Gemini model: ${modelName}`);
      const model=genAI.getGenerativeModel({model: modelName});
      const result=await withRetry(() =>
        model.generateContent({
          contents: [{role: 'user',parts: [{text: enhancedPrompt}]}]
        })
      );
      console.log('Gemini result:',JSON.stringify(result,null,2));
      const text=result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if(text) return text;
    } catch(err) {
      log('error',`Gemini ${modelName} failed: ${err.message}`);
    }
  }

  return null;
}

async function generate1wordFromGemini({prompt,models=['gemini-2.5-flash','gemini-2.5-pro'],retries=3}) {
  async function withRetry(fn,delay=1000) {
    for(let i=0;i<retries;i++) {
      try {
        return await fn();
      } catch(err) {
        log('warn',`Retry ${i+1} failed: ${err.message}`);
        if(i===retries-1) throw err;
        await new Promise(res => setTimeout(res,delay*(i+1)));
      }
    }
  }


  for(const modelName of models) {
    try {
      log('info',`Trying Gemini model: ${modelName}`);
      const model=genAI.getGenerativeModel({model: modelName});
      const result=await withRetry(() =>
        model.generateContent({
          contents: [{role: 'user',parts: [{text: prompt}]}]
        })
      );
      const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
    } catch (err) {
      log('error', `Gemini ${modelName} failed: ${err.message}`);
    }
  }

  return null;
}

async function getFollowUpFromAI(prompt) {
  try {
    const result=await sendToGemini({
      prompt,
    });

    const text=result?.text||result?.output||result;
    const match=text.match(/\{[\s\S]*?\}/);
    return match? JSON.parse(match[0]):null;
  } catch(err) {
    console.error('AI error in getFollowUpFromAI:',err);
    return null;
  }
}


module.exports={
  generateWithGemini,
  generate1wordFromGemini,
  getFollowUpFromAI,
  foodRecommendByGemini,
  aiParseDietaryPreference,
  aiGenerateNextQuestion,
  aiIsOnboardingComplete,
};
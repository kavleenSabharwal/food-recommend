const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY } = require('../config');
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const { log } = require('./logger');

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

  for (const modelName of models) {
    try {
      log('info', `Trying Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await withRetry(() => model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      }));
      const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
    } catch (err) {
      log('error', `Gemini ${modelName} failed: ${err.message}`);
    }
  }
  return null;
}

module.exports = { generateWithGemini };
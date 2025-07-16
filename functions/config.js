require('dotenv').config();

module.exports={
  VERIFY_TOKEN: process.env.WEBHOOK_VERIFICATION_TOKEN,
  WHATSAPP_TOKEN: process.env.CLOUD_API_ACCESS_TOKEN,
  PHONE_NUMBER_ID: process.env.WA_PHONE_NUMBER_ID,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY
};
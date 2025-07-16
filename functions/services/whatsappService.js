const axios=require('axios');
const {WHATSAPP_TOKEN,PHONE_NUMBER_ID}=require('../config');
const {log}=require('../utils/logger');

async function sendWhatsAppMessage(phone,body) {
  log('info',`Sending WhatsApp to ${phone}`);
  await axios.post(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,{
    messaging_product: 'whatsapp',to: phone,text: {body}
  },{
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  await db.collection('user-messages').add({
    phone,
    message: body,
    timestamp: new Date(),
    direction: 'out',
    source: 'system'
  });

  log('info',`Sent message to ${phone}`);
}

module.exports={sendWhatsAppMessage};

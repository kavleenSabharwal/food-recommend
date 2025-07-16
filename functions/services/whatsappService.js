const axios=require('axios');
const {WHATSAPP_TOKEN,PHONE_NUMBER_ID}=require('../config');
const {log}=require('../utils/logger');
const {db}=require('../utils/firestore');

async function sendWhatsAppMessage(phone,body) {
  log('info',`Sending WhatsApp to ${phone}`);

  // WhatsApp text limit is 4096 characters per message
  const chunkSize=4096;
  const chunks=[];

  for(let i=0;i<body.length;i+=chunkSize) {
    chunks.push(body.substring(i,i+chunkSize));
  }

  for(let index=0;index<chunks.length;index++) {
    const chunk=chunks[index];
    log('debug',`Sending chunk ${index+1}/${chunks.length} to ${phone}`);

    await axios.post(
      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        text: {body: chunk}
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    log('debug',`Storing chunk ${index+1} in Firestore as outbound system message`);
    await db.collection('user-messages').add({
      phone,
      message: chunk,
      chunkIndex: index+1,
      totalChunks: chunks.length,
      timestamp: new Date(),
      direction: 'out',
      source: 'system'
    });
  }

  log('info',`Sent ${chunks.length} message chunk(s) to ${phone}`);
}

module.exports={sendWhatsAppMessage};

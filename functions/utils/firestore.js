const admin = require('firebase-admin');

let db;

try {
  delete process.env.FIRESTORE_EMULATOR_HOST;

  if(!admin.apps.length) {
    admin.initializeApp();
    console.log('✅ Firebase initialized');
  }

  db=admin.firestore();
  console.log('✅ Firestore initialized');
} catch(err) {
  console.error('❌ Error initializing Firebase/Firestore:',err.message);
}

module.exports = { db };

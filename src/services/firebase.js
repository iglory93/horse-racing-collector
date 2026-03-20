const admin = require('firebase-admin');
const env = require('../config/env');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: env.firebasePrivateKey
    })
  });
}

module.exports = {
  admin,
  db: admin.firestore()
};

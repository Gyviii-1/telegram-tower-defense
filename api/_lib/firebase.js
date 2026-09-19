// Firebase Admin для серверных функций. Ключ сервисного аккаунта лежит
// в переменной окружения Vercel (base64 от JSON) — в репозиторий не попадает.
const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length) return;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');

  const serviceAccount = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

function getDb() {
  initFirebase();
  return admin.firestore();
}

module.exports = { initFirebase, getDb };

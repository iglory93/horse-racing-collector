require('dotenv').config();

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  firebasePrivateKey: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  ttingId: process.env.TTING_ID,
  ttingPassword: process.env.TTING_PWD,
  nodeEnv: process.env.NODE_ENV || 'production',
  logLevel: process.env.LOG_LEVEL || 'info',
  syncIntervalMs: toInt(process.env.SYNC_INTERVAL_MS, 45000),
  streamDetailConcurrency: toInt(process.env.STREAM_DETAIL_CONCURRENCY, 8),
  socketConnectConcurrency: toInt(process.env.SOCKET_CONNECT_CONCURRENCY, 6),
  eventFlushIntervalMs: toInt(process.env.EVENT_FLUSH_INTERVAL_MS, 30000)
};

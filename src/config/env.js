const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
  override: false,
  quiet: true
});

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  mongoUri: process.env.MONGO_URI,
  mongoDbName: process.env.MONGO_DB_NAME,
  ttingId: process.env.TTING_ID,
  ttingPassword: process.env.TTING_PWD,
  nodeEnv: process.env.NODE_ENV || 'production',
  logLevel: process.env.LOG_LEVEL || 'info',
  syncIntervalMs: toInt(process.env.SYNC_INTERVAL_MS, 60000),
  streamDetailConcurrency: toInt(process.env.STREAM_DETAIL_CONCURRENCY, 8),
  socketConnectConcurrency: toInt(process.env.SOCKET_CONNECT_CONCURRENCY, 6),
  eventFlushIntervalMs: toInt(process.env.EVENT_FLUSH_INTERVAL_MS, 1800000),

  leaderLockKey: process.env.LEADER_LOCK_KEY || 'horse-racing-collector',
  leaderLeaseMs: toInt(process.env.LEADER_LEASE_MS, 45000),
  leaderRenewIntervalMs: toInt(process.env.LEADER_RENEW_INTERVAL_MS, 15000)
};

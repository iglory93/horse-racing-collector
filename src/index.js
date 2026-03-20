const env = require('./config/env');
const logger = require('./utils/logger');
const { AggregationStore } = require('./stores/aggregationStore');
const { FirestoreWriter } = require('./services/firestoreWriter');
const { ChannelManager } = require('./services/channelManager');

const aggregationStore = new AggregationStore();
const writer = new FirestoreWriter();

const channelManager = new ChannelManager({
  onRoundStart: (channelId, payload) => aggregationStore.onRoundStart(channelId, payload),
  onBet: (channelId, payload) => aggregationStore.onBet(channelId, payload),
  onResult: (channelId, payload) => aggregationStore.onResult(channelId, payload),
  writer
});

let syncTimer = null;
let flushTimer = null;
let shuttingDown = false;

async function flushNow() {
  const snapshot = aggregationStore.drainSnapshot();
  await writer.flush(snapshot);
}

async function start() {
  logger.info('horse racing collector start');
  await channelManager.sync();

  syncTimer = setInterval(() => {
    channelManager.sync().catch((error) => {
      logger.error('sync failed', error.message);
    });
  }, env.syncIntervalMs);

  flushTimer = setInterval(() => {
    flushNow().catch((error) => {
      logger.error('flush failed', error.message);
    });
  }, env.eventFlushIntervalMs);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn('shutdown', signal);

  if (syncTimer) clearInterval(syncTimer);
  if (flushTimer) clearInterval(flushTimer);

  channelManager.stopAll();

  try {
    await flushNow();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('uncaughtException', error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.error('unhandledRejection', error);
  shutdown('unhandledRejection');
});

start().catch((error) => {
  logger.error('startup failed', error);
  process.exit(1);
});

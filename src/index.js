const express = require('express');
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
let startedAt = new Date();

const app = express();
const port = Number(process.env.PORT || 10000);

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'horse-racing-collector',
    uptimeSec: Math.floor(process.uptime()),
    startedAt: startedAt.toISOString(),
    now: new Date().toISOString(),
    shuttingDown
  });
});

app.get('/', (_req, res) => {
  res.status(200).send('horse-racing-collector is running');
});

async function flushNow() {
  const snapshot = aggregationStore.drainSnapshot();
  await writer.flush(snapshot);
}

async function startCollector() {
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
  } catch (error) {
    logger.error('final flush failed', error);
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

app.listen(port, '0.0.0.0', async () => {
  logger.info(`http server listening on ${port}`);

  try {
    await startCollector();
  } catch (error) {
    logger.error('startup failed', error);
    process.exit(1);
  }
});
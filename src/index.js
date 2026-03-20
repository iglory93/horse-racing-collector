const express = require('express');
const env = require('./config/env');
const logger = require('./utils/logger');
const { AggregationStore } = require('./stores/aggregationStore');
const { FirestoreWriter } = require('./services/firestoreWriter');
const { ChannelManager } = require('./services/channelManager');
const { FirestoreLeaderLock } = require('./services/leaderLock');

const aggregationStore = new AggregationStore();
const writer = new FirestoreWriter();
const leaderLock = new FirestoreLeaderLock();

const channelManager = new ChannelManager({
  onRoundStart: (channelId, payload) => aggregationStore.onRoundStart(channelId, payload),
  onBet: (channelId, payload) => aggregationStore.onBet(channelId, payload),
  onResult: (channelId, payload) => aggregationStore.onResult(channelId, payload),
  aggregationStore
});

let syncTimer = null;
let flushTimer = null;
let shuttingDown = false;
let startedAt = new Date();
let collectorStarted = false;

const app = express();
const port = Number(process.env.PORT || 10000);

let lastSyncOkAt = Date.now();

function markSyncOk() {
  lastSyncOkAt = Date.now();
}

let healthHitCount = 0;

app.get('/healthz', (req, res) => {
  healthHitCount += 1;

  const staleMs = Date.now() - lastSyncOkAt;
  const unhealthy = staleMs > 2 * env.syncIntervalMs + 30000;

  if (unhealthy) {
    logger.warn('health check failed', { staleMs });
    return res.status(500).json({ ok: false, staleMs });
  }

  if (healthHitCount % 20 === 0) {
    logger.info('health check ok', { staleMs });
  }

  return res.status(200).json({ ok: true, staleMs });
});

app.get('/', (_req, res) => {
  res.status(200).send('horse-racing-collector is running');
});

async function flushNow() {
  const snapshot = aggregationStore.drainSnapshot();
  await writer.flush(snapshot);
}

function stopCollector() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }

  channelManager.stopAll();
  collectorStarted = false;
}

async function startCollector() {
  if (collectorStarted) return;

  logger.info('horse racing collector start');
  await channelManager.sync();
  markSyncOk();

  // syncTimer = setInterval(() => {
  //   channelManager.sync().catch((error) => {
  //     logger.error('sync failed', error.message);
  //   });
  // }, env.syncIntervalMs);
  syncTimer = setInterval(() => {
    channelManager.sync()
      .then(() => markSyncOk())
      .catch((error) => {
        logger.error('sync failed', error.message);
      });
  }, env.syncIntervalMs);

  flushTimer = setInterval(() => {
    flushNow().catch((error) => {
      logger.error('flush failed', error.message);
    });
  }, env.eventFlushIntervalMs);

  collectorStarted = true;
}

async function startLeaderOnlyCollector() {
  const acquired = await leaderLock.tryAcquire();

  if (!acquired) {
    logger.warn('leader lock not acquired, standby mode', {
      key: env.leaderLockKey
    });

    setInterval(async () => {
      if (shuttingDown || leaderLock.isLeader || collectorStarted) return;

      const ok = await leaderLock.tryAcquire();
      if (!ok) return;

      await startCollector();
      leaderLock.startRenewLoop({
        onLost: async () => {
          logger.warn('leader lost, collector stopping');
          stopCollector();
        }
      });
    }, env.leaderRenewIntervalMs);

    return;
  }

  await startCollector();

  leaderLock.startRenewLoop({
    onLost: async () => {
      logger.warn('leader lost, collector stopping');
      stopCollector();
    }
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn('shutdown', signal);

  stopCollector();

  try {
    await flushNow();
  } catch (error) {
    logger.error('final flush failed', error);
  }

  try {
    await leaderLock.release();
  } catch (error) {
    logger.error('leader release failed', error);
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
    await startLeaderOnlyCollector();
  } catch (error) {
    logger.error('startup failed', error);
    process.exit(1);
  }
});
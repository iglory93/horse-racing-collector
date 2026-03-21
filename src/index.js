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
let flushStartTimer = null;
let shuttingDown = false;
let startedAt = new Date();
let collectorStarted = false;
let flushPromise = null;

const app = express();
const port = Number(process.env.PORT || 10000);

let lastSyncOkAt = Date.now();
let healthHitCount = 0;

function markSyncOk() {
  lastSyncOkAt = Date.now();
}

app.get('/keepalive', (_req, res) => {
  console.log('keep alive ! ');
  res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    leader: leaderLock.isLeader
  });
});

app.get('/healthz', (_req, res) => {
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
  if (flushPromise) {
    logger.warn('flush skipped: previous flush still running');
    return flushPromise;
  }

  flushPromise = (async () => {
    const snapshot = aggregationStore.drainSnapshot();
    await writer.flush(snapshot);
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

function getMsUntilNextHour() {
  const now = new Date();
  const nextHour = new Date(now);

  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  return nextHour.getTime() - now.getTime();
}

function scheduleNextHourlyFlush() {
  if (shuttingDown || !collectorStarted) return;

  const delay = getMsUntilNextHour();

  logger.info('next hourly flush scheduled', {
    delayMs: delay,
    nextFlushAt: new Date(Date.now() + delay).toISOString()
  });

  flushStartTimer = setTimeout(async () => {
    flushStartTimer = null;

    try {
      await flushNow();
    } catch (error) {
      logger.error('flush failed', error.message);
    } finally {
      if (!shuttingDown && collectorStarted) {
        scheduleNextHourlyFlush();
      }
    }
  }, delay);
}

function startHourlyFlushScheduler() {
  scheduleNextHourlyFlush();
}

function stopCollector() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  if (flushStartTimer) {
    clearTimeout(flushStartTimer);
    flushStartTimer = null;
  }

  channelManager.stopAll();
  collectorStarted = false;
}

async function startCollector() {
  if (collectorStarted) return;

  logger.info('horse racing collector start', {
    startedAt: startedAt.toISOString()
  });

  await channelManager.sync();
  markSyncOk();

  syncTimer = setInterval(() => {
    channelManager.sync()
      .then(() => markSyncOk())
      .catch((error) => {
        logger.error('sync failed', error.message);
      });
  }, env.syncIntervalMs);

  collectorStarted = true;
  startHourlyFlushScheduler();
}

async function startLeaderOnlyCollector() {
  const acquired = await leaderLock.tryAcquire();

  if (!acquired) {
    logger.warn('leader lock not acquired, standby mode', {
      key: env.leaderLockKey
    });

    setInterval(async () => {
      if (shuttingDown || leaderLock.isLeader || collectorStarted) return;

      try {
        const ok = await leaderLock.tryAcquire();
        if (!ok) return;

        await startCollector();
        leaderLock.startRenewLoop({
          onLost: async () => {
            logger.warn('leader lost, collector stopping');
            stopCollector();
          }
        });
      } catch (error) {
        logger.error('leader reacquire/start failed', error);
      }
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
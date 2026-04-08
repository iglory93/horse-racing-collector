const crypto = require('crypto');
const { connectToMongo } = require('./mongo');
const env = require('../config/env');
const logger = require('../utils/logger');

class MongoLeaderLock {
  constructor() {
    this.instanceId = `${process.env.RENDER_INSTANCE_ID || process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    this.lockId = env.leaderLockKey;
    this.renewTimer = null;
    this.isLeader = false;
  }

  nowMs() {
    return Date.now();
  }

  buildPayload(expiresAtMs) {
    return {
      key: env.leaderLockKey,
      ownerId: this.instanceId,
      leaseMs: env.leaderLeaseMs,
      expiresAtMs,
      updatedAt: new Date()
    };
  }

  async tryAcquire() {
    const now = this.nowMs();
    const nextExpiresAtMs = now + env.leaderLeaseMs;
    const collection = (await connectToMongo()).collection('_locks');

    try {
      try {
        await collection.insertOne({
          _id: this.lockId,
          createdAt: new Date(),
          ...this.buildPayload(nextExpiresAtMs)
        });

        this.isLeader = true;
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }

        const result = await collection.updateOne(
          {
            _id: this.lockId,
            $or: [
              { expiresAtMs: { $lte: now } },
              { ownerId: this.instanceId }
            ]
          },
          {
            $set: this.buildPayload(nextExpiresAtMs)
          }
        );

        this.isLeader = result.matchedCount === 1;
      }

      if (this.isLeader) {
        logger.info('leader lock acquired', {
          key: env.leaderLockKey,
          instanceId: this.instanceId,
          leaseMs: env.leaderLeaseMs
        });
      }

      return this.isLeader;
    } catch (error) {
      this.isLeader = false;
      logger.error('leader lock acquire failed', error.message);
      return false;
    }
  }

  async renew() {
    if (!this.isLeader) return false;

    const nextExpiresAtMs = this.nowMs() + env.leaderLeaseMs;
    const collection = (await connectToMongo()).collection('_locks');

    try {
      const result = await collection.updateOne(
        {
          _id: this.lockId,
          ownerId: this.instanceId
        },
        {
          $set: this.buildPayload(nextExpiresAtMs)
        }
      );

      if (result.matchedCount !== 1) {
        this.isLeader = false;
        logger.warn('leader lock lost', {
          key: env.leaderLockKey,
          instanceId: this.instanceId
        });
        return false;
      }

      logger.info('leader lock renewed', {
        key: env.leaderLockKey,
        instanceId: this.instanceId
      });

      return true;
    } catch (error) {
      logger.error('leader lock renew failed', error.message);
      return false;
    }
  }

  startRenewLoop({ onLost } = {}) {
    if (this.renewTimer) clearInterval(this.renewTimer);

    this.renewTimer = setInterval(async () => {
      const ok = await this.renew();
      if (!ok && typeof onLost === 'function') {
        await onLost();
      }
    }, env.leaderRenewIntervalMs);
  }

  stopRenewLoop() {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  async release() {
    this.stopRenewLoop();

    try {
      const collection = (await connectToMongo()).collection('_locks');

      await collection.updateOne(
        {
          _id: this.lockId,
          ownerId: this.instanceId
        },
        {
          $set: {
            ownerId: null,
            expiresAtMs: 0,
            releasedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );

      logger.info('leader lock released', {
        key: env.leaderLockKey,
        instanceId: this.instanceId
      });
    } catch (error) {
      logger.error('leader lock release failed', error.message);
    } finally {
      this.isLeader = false;
    }
  }
}

module.exports = { MongoLeaderLock };

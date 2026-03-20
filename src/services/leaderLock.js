const crypto = require('crypto');
const { db, admin } = require('./firebase');
const env = require('../config/env');
const logger = require('../utils/logger');

class FirestoreLeaderLock {
  constructor() {
    this.instanceId = `${process.env.RENDER_INSTANCE_ID || process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    this.docRef = db.collection('_locks').doc(env.leaderLockKey);
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
  }

  async tryAcquire() {
    const now = this.nowMs();
    const nextExpiresAtMs = now + env.leaderLeaseMs;

    try {
      const acquired = await db.runTransaction(async (tx) => {
        const snap = await tx.get(this.docRef);

        if (!snap.exists) {
          tx.set(this.docRef, this.buildPayload(nextExpiresAtMs), { merge: true });
          return true;
        }

        const data = snap.data() || {};
        const ownerId = String(data.ownerId || '');
        const expiresAtMs = Number(data.expiresAtMs || 0);

        const expired = !expiresAtMs || expiresAtMs <= now;
        const mine = ownerId === this.instanceId;

        if (expired || mine) {
          tx.set(this.docRef, this.buildPayload(nextExpiresAtMs), { merge: true });
          return true;
        }

        return false;
      });

      this.isLeader = acquired;

      if (acquired) {
        logger.info('leader lock acquired', {
          key: env.leaderLockKey,
          instanceId: this.instanceId,
          leaseMs: env.leaderLeaseMs
        });
      }

      return acquired;
    } catch (error) {
      logger.error('leader lock acquire failed', error.message);
      return false;
    }
  }

  async renew() {
    if (!this.isLeader) return false;

    const now = this.nowMs();
    const nextExpiresAtMs = now + env.leaderLeaseMs;

    try {
      const renewed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(this.docRef);
        if (!snap.exists) return false;

        const data = snap.data() || {};
        const ownerId = String(data.ownerId || '');

        if (ownerId !== this.instanceId) {
          return false;
        }

        tx.set(this.docRef, this.buildPayload(nextExpiresAtMs), { merge: true });
        return true;
      });

      if (!renewed) {
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
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(this.docRef);
        if (!snap.exists) return;

        const data = snap.data() || {};
        if (String(data.ownerId || '') !== this.instanceId) return;

        tx.set(this.docRef, {
          releasedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAtMs: 0,
          ownerId: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });

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

module.exports = { FirestoreLeaderLock };
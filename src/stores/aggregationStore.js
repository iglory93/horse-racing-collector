const crypto = require('crypto');

function todayKey(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function safeNicknameKey(nickname) {
  return crypto.createHash('sha1').update(String(nickname || '')).digest('hex').slice(0, 20);
}

class AggregationStore {
  constructor() {
    this.channels = new Map();
    this.roundResults = new Map();
    this.dirtyChannels = new Set();
  }

  ensureChannel(channelId) {
    const key = String(channelId);
    if (!this.channels.has(key)) {
      this.channels.set(key, {
        channelId: key,
        currentRoundId: null,
        startedRounds: 0,
        betsByUser: new Map(),
        horseStats: new Map(),
        updatedAt: null
      });
    }
    return this.channels.get(key);
  }

  onRoundStart(channelId, payload) {
    const channel = this.ensureChannel(channelId);
    channel.currentRoundId = Number(payload?.roundId || 0) || null;
    channel.startedRounds += 1;
    channel.updatedAt = new Date().toISOString();
    this.dirtyChannels.add(String(channelId));
  }

  onBet(channelId, payload) {
    const channel = this.ensureChannel(channelId);
    const nickname = String(payload?.nickname || '').trim();
    if (!nickname) return;

    const amount = Number(payload?.amount || 0) || 0;
    const userKey = safeNicknameKey(nickname);
    const current = channel.betsByUser.get(userKey) || {
      nickname,
      totalAmount: 0,
      betCount: 0,
      lastRoundId: null,
      updatedAt: null
    };

    current.nickname = nickname;
    current.totalAmount += amount;
    current.betCount += 1;
    current.lastRoundId = Number(payload?.roundId || channel.currentRoundId || 0) || null;
    current.updatedAt = new Date().toISOString();
    channel.betsByUser.set(userKey, current);
    channel.updatedAt = current.updatedAt;
    this.dirtyChannels.add(String(channelId));
  }

  onResult(channelId, payload) {
    const channel = this.ensureChannel(channelId);
    const roundId = Number(payload?.roundId || 0) || null;
    const options = Array.isArray(payload?.options) ? payload.options : [];
    const results = [];

    for (const option of options) {
      const horseId = Number(option?.id || 0) || 0;
      const horseName = String(option?.name || '').trim();
      const rank = Number(option?.rank || 0) || 0;
      if (!horseId || !horseName || !rank) continue;

      const horse = channel.horseStats.get(String(horseId)) || {
        horseId,
        horseName,
        firstCount: 0,
        secondCount: 0,
        thirdCount: 0,
        raceCount: 0,
        updatedAt: null
      };

      horse.horseName = horseName;
      horse.raceCount += 1;
      if (rank === 1) horse.firstCount += 1;
      if (rank === 2) horse.secondCount += 1;
      if (rank === 3) horse.thirdCount += 1;
      horse.updatedAt = new Date().toISOString();
      channel.horseStats.set(String(horseId), horse);

      results.push({ horseId, horseName, rank });
    }

    if (roundId) {
      this.roundResults.set(`${channelId}:${roundId}`, {
        channelId: String(channelId),
        roundId,
        gameTypeKey: payload?.gameTypeKey || 'horse-racing',
        startAt: payload?.startAt || null,
        results,
        collectedAt: new Date().toISOString()
      });
    }

    channel.currentRoundId = null;
    channel.updatedAt = new Date().toISOString();
    this.dirtyChannels.add(String(channelId));
  }

  drainSnapshot() {
    const day = todayKey();
    const channels = [];

    for (const channelId of this.dirtyChannels) {
      const channel = this.channels.get(channelId);
      if (!channel) continue;

      channels.push({
        channelId,
        day,
        startedRounds: channel.startedRounds,
        updatedAt: channel.updatedAt,
        betsByUser: Array.from(channel.betsByUser.entries()).map(([userKey, value]) => ({ userKey, ...value })),
        horseStats: Array.from(channel.horseStats.values())
      });
    }

    const rounds = Array.from(this.roundResults.values());
    this.dirtyChannels.clear();
    this.roundResults.clear();

    return { day, channels, rounds };
  }
}

module.exports = { AggregationStore, todayKey };

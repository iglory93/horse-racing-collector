const { db, admin } = require('./firebase');
const logger = require('../utils/logger');

class FirestoreWriter {
  async flush(snapshot) {
    const { channels, rounds, day, activeChannels } = snapshot;

    if (!channels.length && !rounds.length && !activeChannels.length) {
      return;
    }

    const writer = db.bulkWriter();

    writer.onWriteError((error) => {
      logger.error('bulkWriter error', error.documentRef?.path, error.message);
      return false;
    });

    for (const active of activeChannels) {
      const ref = db.collection('horseRaceChannels').doc(String(active.channelId));
      writer.set(ref, {
        channelId: String(active.channelId),
        title: active.title || '',
        nickname: active.nickname || '',
        isAdult: !!active.isAdult,
        playerCount: Number(active.playerCount || 0),
        startedAt: active.startedAt || null,
        updatedAt: active.updatedAt || admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    for (const channel of channels) {
      const channelRef = db.collection('horseRaceDaily').doc(day).collection('channels').doc(String(channel.channelId));

      writer.set(channelRef, {
        channelId: String(channel.channelId),
        day,
        startedRounds: channel.startedRounds,
        updatedAt: channel.updatedAt,
        userCount: channel.betsByUser.length,
        horseCount: channel.horseStats.length
      }, { merge: true });

      for (const user of channel.betsByUser) {
        const userRef = channelRef.collection('betUsers').doc(user.userKey);
        writer.set(userRef, {
          nickname: user.nickname,
          totalAmount: user.totalAmount,
          betCount: user.betCount,
          lastRoundId: user.lastRoundId,
          updatedAt: user.updatedAt
        }, { merge: true });
      }

      for (const horse of channel.horseStats) {
        const ratioBase = Math.max(horse.raceCount, 1);
        const horseRef = channelRef.collection('horseStats').doc(String(horse.horseId));
        writer.set(horseRef, {
          horseId: horse.horseId,
          horseName: horse.horseName,
          raceCount: horse.raceCount,
          firstCount: horse.firstCount,
          secondCount: horse.secondCount,
          thirdCount: horse.thirdCount,
          firstRatio: horse.firstCount / ratioBase,
          secondRatio: horse.secondCount / ratioBase,
          thirdRatio: horse.thirdCount / ratioBase,
          updatedAt: horse.updatedAt
        }, { merge: true });
      }
    }

    for (const round of rounds) {
      const roundRef = db.collection('horseRaceRounds').doc(`${round.channelId}_${round.roundId}`);
      writer.set(roundRef, round, { merge: true });
    }

    await writer.close();

    logger.info('firestore flush complete', {
      activeChannelCount: activeChannels.length,
      channelCount: channels.length,
      roundCount: rounds.length
    });
  }
}

module.exports = { FirestoreWriter };
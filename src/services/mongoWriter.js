const { connectToMongo } = require('./mongo');
const logger = require('../utils/logger');

class MongoWriter {
  async flush(snapshot) {
    const { channels, rounds, day, activeChannels } = snapshot;

    if (!channels.length && !rounds.length && !activeChannels.length) {
      return;
    }

    const db = await connectToMongo();
    const jobs = [];

    if (activeChannels.length) {
      jobs.push(
        db.collection('horseRaceChannels').bulkWrite(
          activeChannels.map((active) => ({
            updateOne: {
              filter: { _id: String(active.channelId) },
              update: {
                $set: {
                  channelId: String(active.channelId),
                  title: active.title || '',
                  nickname: active.nickname || '',
                  isAdult: !!active.isAdult,
                  playerCount: Number(active.playerCount || 0),
                  startedAt: active.startedAt || null,
                  updatedAt: active.updatedAt || new Date().toISOString()
                }
              },
              upsert: true
            }
          })),
          { ordered: false }
        )
      );
    }

    if (channels.length) {
      jobs.push(
        db.collection('horseRaceDailyChannels').bulkWrite(
          channels.map((channel) => ({
            updateOne: {
              filter: { _id: `${day}:${channel.channelId}` },
              update: {
                $set: {
                  day,
                  channelId: String(channel.channelId),
                  startedRounds: Number(channel.startedRounds || 0),
                  updatedAt: channel.updatedAt || new Date().toISOString(),
                  userCount: channel.betsByUser.length,
                  horseCount: channel.horseStats.length
                }
              },
              upsert: true
            }
          })),
          { ordered: false }
        )
      );

      const betUserOps = [];
      const horseStatOps = [];

      for (const channel of channels) {
        for (const user of channel.betsByUser) {
          betUserOps.push({
            updateOne: {
              filter: { _id: `${day}:${channel.channelId}:${user.userKey}` },
              update: {
                $set: {
                  day,
                  channelId: String(channel.channelId),
                  userKey: user.userKey,
                  nickname: user.nickname,
                  totalAmount: Number(user.totalAmount || 0),
                  betCount: Number(user.betCount || 0),
                  lastRoundId: user.lastRoundId || null,
                  updatedAt: user.updatedAt || new Date().toISOString()
                }
              },
              upsert: true
            }
          });
        }

        for (const horse of channel.horseStats) {
          const ratioBase = Math.max(Number(horse.raceCount || 0), 1);

          horseStatOps.push({
            updateOne: {
              filter: { _id: `${day}:${channel.channelId}:${horse.horseId}` },
              update: {
                $set: {
                  day,
                  channelId: String(channel.channelId),
                  horseId: Number(horse.horseId || 0),
                  horseName: horse.horseName,
                  raceCount: Number(horse.raceCount || 0),
                  firstCount: Number(horse.firstCount || 0),
                  secondCount: Number(horse.secondCount || 0),
                  thirdCount: Number(horse.thirdCount || 0),
                  firstRatio: Number(horse.firstCount || 0) / ratioBase,
                  secondRatio: Number(horse.secondCount || 0) / ratioBase,
                  thirdRatio: Number(horse.thirdCount || 0) / ratioBase,
                  updatedAt: horse.updatedAt || new Date().toISOString()
                }
              },
              upsert: true
            }
          });
        }
      }

      if (betUserOps.length) {
        jobs.push(db.collection('horseRaceDailyBetUsers').bulkWrite(betUserOps, { ordered: false }));
      }

      if (horseStatOps.length) {
        jobs.push(db.collection('horseRaceDailyHorseStats').bulkWrite(horseStatOps, { ordered: false }));
      }
    }

    if (rounds.length) {
      jobs.push(
        db.collection('horseRaceRounds').bulkWrite(
          rounds.map((round) => ({
            updateOne: {
              filter: { _id: `${round.channelId}_${round.roundId}` },
              update: {
                $set: {
                  channelId: String(round.channelId),
                  roundId: Number(round.roundId || 0),
                  gameTypeKey: round.gameTypeKey || 'horse-racing',
                  startAt: round.startAt || null,
                  results: Array.isArray(round.results) ? round.results : [],
                  collectedAt: round.collectedAt || new Date().toISOString()
                }
              },
              upsert: true
            }
          })),
          { ordered: false }
        )
      );
    }

    await Promise.all(jobs);

    logger.info('mongo flush complete', {
      activeChannelCount: activeChannels.length,
      channelCount: channels.length,
      roundCount: rounds.length
    });
  }
}

module.exports = { MongoWriter };

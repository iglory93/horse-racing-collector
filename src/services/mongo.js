const { MongoClient } = require('mongodb');
const env = require('../config/env');
const logger = require('../utils/logger');

let clientPromise = null;
let dbPromise = null;

async function ensureIndexes(db) {
  await Promise.all([
    db.collection('horseRaceChannels').createIndex({ updatedAt: -1 }),
    db.collection('horseRaceDailyChannels').createIndex({ day: 1, channelId: 1 }, { unique: true }),
    db.collection('horseRaceDailyBetUsers').createIndex({ day: 1, channelId: 1, userKey: 1 }, { unique: true }),
    db.collection('horseRaceDailyHorseStats').createIndex({ day: 1, channelId: 1, horseId: 1 }, { unique: true }),
    db.collection('horseRaceRounds').createIndex({ channelId: 1, roundId: 1 }, { unique: true }),
    db.collection('_locks').createIndex({ expiresAtMs: 1 })
  ]);
}

async function connectToMongo() {
  if (!env.mongoUri || !env.mongoDbName) {
    throw new Error('MONGO_URI and MONGO_DB_NAME are required');
  }

  if (!dbPromise) {
    clientPromise = new MongoClient(env.mongoUri, {
      maxPoolSize: 20
    }).connect();

    dbPromise = clientPromise
      .then(async (client) => {
        const db = client.db(env.mongoDbName);
        await ensureIndexes(db);
        logger.info('mongo connected', { dbName: env.mongoDbName });
        return db;
      })
      .catch((error) => {
        clientPromise = null;
        dbPromise = null;
        throw error;
      });
  }

  return dbPromise;
}

async function closeMongoConnection() {
  if (!clientPromise) return;

  const client = await clientPromise;
  await client.close();
  clientPromise = null;
  dbPromise = null;
}

module.exports = {
  connectToMongo,
  closeMongoConnection
};

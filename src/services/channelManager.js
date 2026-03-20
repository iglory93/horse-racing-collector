const { fetchLiveChannels, fetchStreamDetail } = require('./ttingApi');
const { runWithConcurrency } = require('../utils/async');
const { ChannelSocket } = require('../collectors/channelSocket');
const logger = require('../utils/logger');
const env = require('../config/env');

class ChannelManager {
  constructor({ onRoundStart, onBet, onResult, aggregationStore }) {
    this.onRoundStart = onRoundStart;
    this.onBet = onBet;
    this.onResult = onResult;
    this.aggregationStore = aggregationStore;
    this.channels = new Map();
  }

  async sync() {
    const liveChannels = await fetchLiveChannels();
    logger.info('live channels fetched', liveChannels.length);

    const details = [];
    await runWithConcurrency(liveChannels, env.streamDetailConcurrency, async (channel) => {
      const detail = await fetchStreamDetail(channel.channelId);
      if (!detail?.stream?.id) return;
      details.push({ channel, detail });
    });

    const nextIds = new Set(details.map(({ channel }) => String(channel.channelId)));

    for (const [channelId, socket] of this.channels.entries()) {
      if (nextIds.has(channelId)) continue;
      socket.stop();
      this.channels.delete(channelId);
      logger.info('channel removed', channelId);
    }

    await runWithConcurrency(details, env.socketConnectConcurrency, async ({ channel, detail }) => {
      const channelId = String(channel.channelId);

      if (this.aggregationStore?.upsertActiveChannel) {
        this.aggregationStore.upsertActiveChannel(channel);
      }

      if (this.channels.has(channelId)) {
        return;
      }

      const socket = new ChannelSocket({
        channelId,
        streamId: detail.stream.id,
        onRoundStart: this.onRoundStart,
        onBet: this.onBet,
        onResult: this.onResult
      });

      socket.start();
      this.channels.set(channelId, socket);
      logger.info('channel added', channelId, detail.stream.id);
    });
  }

  stopAll() {
    for (const socket of this.channels.values()) {
      socket.stop();
    }
    this.channels.clear();
  }
}

module.exports = { ChannelManager };
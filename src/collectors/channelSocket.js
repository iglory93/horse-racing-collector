const io = require('socket.io-client');
const logger = require('../utils/logger');

class ChannelSocket {
  constructor({ channelId, streamId, onRoundStart, onBet, onResult }) {
    this.channelId = String(channelId);
    this.streamId = streamId;
    this.onRoundStart = onRoundStart;
    this.onBet = onBet;
    this.onResult = onResult;
    this.socket = null;
  }

  start() {
    if (this.socket) return;

    this.socket = io('wss://io.flextv.co.kr', {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      timeout: 10000,
      extraHeaders: {
        origin: 'https://www.ttinglive.com'
      }
    });

    this.socket.on('connect', () => {
      logger.info('socket connected', this.channelId, this.streamId);
      this.socket.emit('join', {
        room: this.channelId,
        streamId: this.streamId,
        source: 'web'
      });
    });

    this.socket.on('event', (payload) => {
      if (payload?.event !== 'LOTTERY_ROUND_START') return;
      if (payload?.data?.gameTypeKey !== 'horse-racing') return;
      this.onRoundStart(this.channelId, payload.data);
    });

    this.socket.on('message', (payload) => {
      if (!payload) return;

      if (payload?.message === 'FX_LOTTERY_GAME_BET' && payload?.args?.gameTypeKey === 'horse-racing') {
        this.onBet(this.channelId, payload.args);
        return;
      }

      if (payload?.message === 'FX_LOTTERY_GAME_RESULT' && payload?.args?.gameTypeKey === 'horse-racing') {
        this.onResult(this.channelId, payload.args);
      }
    });

    this.socket.on('disconnect', (reason) => {
      logger.warn('socket disconnected', this.channelId, reason);
    });

    this.socket.on('connect_error', (error) => {
      logger.error('socket connect error', this.channelId, error.message);
    });
  }

  stop() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
  }
}

module.exports = { ChannelSocket };

const axios = require('axios');
const { withRelogin } = require('./ttingAuth');

function buildHeaders(cookie) {
  return {
    'x-site-code': 'ttinglive',
    cookie,
    accept: 'application/json, text/plain, */*',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36',
    origin: 'https://www.ttinglive.com',
    referer: 'https://www.ttinglive.com/'
  };
}

async function fetchLiveChannels() {
  const response = await withRelogin((cookie) => axios.get(
    'https://api.ttinglive.com/api/channels/live-list-main',
    {
      params: { includeAdult: 'false', liveOption: '' },
      headers: buildHeaders(cookie),
      timeout: 10000
    }
  ));

  return Array.isArray(response.data?.data) ? response.data.data : [];
}

async function fetchStreamDetail(channelId) {
  try {
    const response = await withRelogin((cookie) => axios.get(
      `https://api.ttinglive.com/api/channels/${channelId}/stream`,
      {
        params: { option: 'all' },
        headers: buildHeaders(cookie),
        timeout: 10000
      }
    ));

    return response.data || null;
  } catch (error) {
    if (error.response?.status === 400 || error.response?.status === 404) {
      return null;
    }

    throw error;
  }
}

module.exports = {
  fetchLiveChannels,
  fetchStreamDetail
};

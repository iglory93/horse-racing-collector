const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

let cookieCache = null;
let cookieExpireAt = 0;

async function login(force = false) {
  const now = Date.now();

  if (!force && cookieCache && now < cookieExpireAt) {
    return cookieCache;
  }

  logger.info(force ? '팅라이브 재로그인' : '팅라이브 로그인');

  const init = await axios.get('https://www.ttinglive.com', {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36'
    },
    timeout: 10000
  });

  const initCookies = init.headers['set-cookie'] || [];
  const cookieJar = initCookies.map((value) => value.split(';')[0]).join('; ');

  const client = axios.create({
    baseURL: 'https://api.ttinglive.com',
    headers: {
      'x-site-code': 'ttinglive',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36',
      'content-type': 'application/json;charset=UTF-8',
      accept: 'application/json',
      origin: 'https://www.ttinglive.com',
      referer: 'https://www.ttinglive.com/'
    },
    timeout: 10000
  });

  const response = await client.post('/v2/api/auth/signin', {
    loginId: env.ttingId,
    password: env.ttingPassword,
    device: 'PCWEB'
  }, {
    headers: { cookie: cookieJar }
  });

  const loginCookies = response.headers['set-cookie'] || [];
  const mergedCookie = [...initCookies, ...loginCookies].map((value) => value.split(';')[0]).join('; ');

  cookieCache = mergedCookie;
  cookieExpireAt = now + 55 * 60 * 1000;

  return mergedCookie;
}

async function withRelogin(requestFn) {
  try {
    const cookie = await login(false);
    return await requestFn(cookie);
  } catch (error) {
    if (error.response?.status !== 401) {
      throw error;
    }

    const cookie = await login(true);
    return requestFn(cookie);
  }
}

module.exports = { login, withRelogin };

/**
 * GWP CRYPTO — commands.js (Telegram command handler)
 * Thin wrapper — all command logic lives in ../../shared/run-commands.js
 * (shared with Forex/Stocks). Run every 5 minutes via GitHub Actions
 * (.github/workflows/crypto-commands.yml).
 */
const axios = require('axios');
const config = require('./config');
const createTelegram = require('../../shared/telegram');
const runCommands = require('../../shared/run-commands');

const healthCheck = async () => {
  const res = await axios.get(`${config.BASE_URL}/timestamp`, { timeout: 8000 });
  return !!(res.data && res.data.code === '200000');
};

runCommands({
  config,
  telegram: createTelegram(config),
  healthCheck,
  botLabel: 'GWP Crypto',
  version: '1.0.0',
  exchangeName: 'KuCoin',
  sourceUrl: '',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Crypto commands.js:', err);
  process.exit(1);
});

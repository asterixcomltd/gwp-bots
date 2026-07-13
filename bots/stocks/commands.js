/**
 * GWP STOCKS — commands.js (Telegram command handler)
 * Thin wrapper — all command logic lives in ../../shared/run-commands.js
 * (shared with Crypto/Forex). Run every 5 minutes via GitHub Actions
 * (.github/workflows/stocks-commands.yml).
 */
const axios = require('axios');
const config = require('./config');
const createTelegram = require('../../shared/telegram');
const runCommands = require('../../shared/run-commands');

const healthCheck = async () => {
  if (!config.TWELVE_DATA_KEY) return false;
  const res = await axios.get('https://api.twelvedata.com/api_usage', { params: { apikey: config.TWELVE_DATA_KEY }, timeout: 8000 });
  return !!(res.data && res.data.status !== 'error');
};

runCommands({
  config,
  telegram: createTelegram(config),
  healthCheck,
  botLabel: 'GWP Stocks',
  version: '1.0.0',
  exchangeName: 'Twelve Data',
  sourceUrl: '',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Stocks commands.js:', err);
  process.exit(1);
});

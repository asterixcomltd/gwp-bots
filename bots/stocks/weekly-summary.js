/**
 * GWP STOCKS — weekly-summary.js
 * Thin wrapper — all logic lives in ../../shared/run-weekly-summary.js
 * (shared with the other two sub-bots). Triggered every Monday 07:00 UTC.
 */
const config = require('./config');
const createTelegram = require('../../shared/telegram');
const runWeeklySummary = require('../../shared/run-weekly-summary');

runWeeklySummary({
  config,
  telegram: createTelegram(config),
  botLabel: 'GWP Stocks',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Stocks weekly-summary.js:', err);
  process.exit(1);
});

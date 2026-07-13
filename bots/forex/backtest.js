/**
 * GWP FOREX — backtest.js
 * Thin wrapper — all replay/report logic lives in ../../shared/backtest-engine.js
 * and ../../shared/run-backtest.js (shared with Crypto/Stocks).
 * Usage: node backtest.js | node backtest.js EUR/USD | node backtest.js EUR/USD 180
 */
const config = require('./config');
const createTwelveDataClient = require('../../shared/twelvedata');
const runBacktest = require('../../shared/run-backtest');

runBacktest({
  config,
  dataClient: createTwelveDataClient(config),
  botLabel: 'GWP Forex',
  version: '1.0.0',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Forex backtest.js:', err);
  process.exit(1);
});

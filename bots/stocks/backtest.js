/**
 * GWP STOCKS — backtest.js
 * Thin wrapper — all replay/report logic lives in ../../shared/backtest-engine.js
 * and ../../shared/run-backtest.js (shared with Crypto/Forex).
 * Usage: node backtest.js | node backtest.js AAPL | node backtest.js AAPL 180
 */
const config = require('./config');
const createTwelveDataClient = require('../../shared/twelvedata');
const runBacktest = require('../../shared/run-backtest');

runBacktest({
  config,
  dataClient: createTwelveDataClient(config),
  botLabel: 'GWP Stocks',
  version: '1.0.0',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Stocks backtest.js:', err);
  process.exit(1);
});

/**
 * GWP CRYPTO — backtest.js
 * Thin wrapper — all replay/report logic lives in ../../shared/backtest-engine.js
 * and ../../shared/run-backtest.js (shared with Forex/Stocks).
 * Usage: node backtest.js | node backtest.js BTC-USDT | node backtest.js BTC-USDT 180
 */
const config = require('./config');
const createKucoinClient = require('../../shared/kucoin');
const runBacktest = require('../../shared/run-backtest');

runBacktest({
  config,
  dataClient: createKucoinClient(config),
  botLabel: 'GWP Crypto',
  version: '1.0.0',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Crypto backtest.js:', err);
  process.exit(1);
});

/**
 * GWP FOREX — strategy.js (LIVE RUNNER)  v1.0.0
 * All decision logic lives in ../../shared/core.js and ../../shared/engine.js
 * (shared with the Crypto and Stocks sub-bots — see those files' headers).
 * This file only wires up the Twelve Data client and hands off to the
 * shared live runner. Run every 15 minutes via GitHub Actions
 * (.github/workflows/forex-scan.yml).
 */
const config = require('./config');
const createTwelveDataClient = require('../../shared/twelvedata');
const runLive = require('../../shared/run-live');

runLive({
  config,
  dataClient: createTwelveDataClient(config),
  botLabel: 'GWP Forex',
  version: '1.0.0',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Forex strategy.js:', err);
  process.exit(1);
});

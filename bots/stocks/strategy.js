/**
 * GWP STOCKS — strategy.js (LIVE RUNNER)  v1.0.0
 * All decision logic lives in ../../shared/core.js and ../../shared/engine.js
 * (shared with the Crypto and Forex sub-bots — see those files' headers).
 * This file only wires up the Twelve Data client and hands off to the
 * shared live runner. Run every 15 minutes via GitHub Actions
 * (.github/workflows/stocks-scan.yml) — note US market hours mean many
 * scans outside 9:30am-4pm ET will simply find no fresh candle to act on.
 */
const config = require('./config');
const createTwelveDataClient = require('../../shared/twelvedata');
const runLive = require('../../shared/run-live');

runLive({
  config,
  dataClient: createTwelveDataClient(config),
  botLabel: 'GWP Stocks',
  version: '1.0.0',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Stocks strategy.js:', err);
  process.exit(1);
});

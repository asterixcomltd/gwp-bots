/**
 * GWP CRYPTO — strategy.js (LIVE RUNNER)  v1.0.0
 * All decision logic lives in ../../shared/core.js and ../../shared/engine.js
 * (shared with the Forex and Stocks sub-bots — see those files' headers).
 * This file only wires up the KuCoin data client and hands off to the
 * shared live runner. Run every 15 minutes via GitHub Actions
 * (.github/workflows/crypto-scan.yml).
 */
const config = require('./config');
const createKucoinClient = require('../../shared/kucoin');
const runLive = require('../../shared/run-live');

runLive({
  config,
  dataClient: createKucoinClient(config),
  botLabel: 'GWP Crypto',
  version: '1.0.0',
  dir: __dirname,
}).catch(err => {
  console.error('❌ Fatal error in GWP Crypto strategy.js:', err);
  process.exit(1);
});

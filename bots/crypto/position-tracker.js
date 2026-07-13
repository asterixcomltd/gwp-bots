/**
 * GWP CRYPTO — position-tracker.js
 * Runnable standalone (`node position-tracker.js`) for manual checks —
 * strategy.js also calls this automatically at the start of every scan
 * via ../../shared/run-live.js. All logic lives in
 * ../../shared/position-tracker.js (shared with Forex/Stocks).
 */
const config = require('./config');
const core = require('../../shared/core');
const createKucoinClient = require('../../shared/kucoin');
const createTelegram = require('../../shared/telegram');
const createPersistence = require('../../shared/persistence');
const createPositionTracker = require('../../shared/position-tracker');

const tracker = createPositionTracker({
  config, core,
  dataClient: createKucoinClient(config),
  telegram: createTelegram(config),
  persistence: createPersistence(__dirname),
});

if (require.main === module) {
  tracker.checkOpenPositions().then(() => process.exit(0)).catch(e => {
    console.error('Fatal error in position-tracker:', e);
    process.exit(1);
  });
}

module.exports = tracker;

/**
 * GWP STOCKS — setup-bot.js
 * Run ONCE: `node setup-bot.js` (or via GitHub Actions manual dispatch).
 */
const config = require('./config');
const runSetupBot = require('../../shared/run-setup-bot');

runSetupBot({
  config,
  botLabel: 'GWP Stocks',
  botShortName: 'GWP Stocks Bot',
  shortDescription: '🎯 US equity signals, Twelve Data. POC/VAH/VAL + Fib, 2H/30M/15M 2-of-3 vote.',
  symbolsLabel: `${config.SYMBOLS.length} US equities. Auto-alerts here.`,
  sourceUrl: '',
}).then(() => process.exit(0)).catch(err => {
  console.error('❌ Fatal error in GWP Stocks setup-bot.js:', err);
  process.exit(1);
});

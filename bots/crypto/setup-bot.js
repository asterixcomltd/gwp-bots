/**
 * GWP CRYPTO — setup-bot.js
 * Run ONCE: `node setup-bot.js` (or via GitHub Actions manual dispatch).
 */
const config = require('./config');
const runSetupBot = require('../../shared/run-setup-bot');

runSetupBot({
  config,
  botLabel: 'GWP Crypto',
  botShortName: 'GWP Crypto Bot',
  shortDescription: '🎯 Crypto signals, KuCoin. POC/VAH/VAL + Fib, 2H/30M/15M 2-of-3 vote.',
  symbolsLabel: `${config.SYMBOLS.length} KuCoin pairs. Auto-alerts here.`,
  sourceUrl: '',
}).then(() => process.exit(0)).catch(err => {
  console.error('❌ Fatal error in GWP Crypto setup-bot.js:', err);
  process.exit(1);
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED BACKTEST CLI RUNNER (shared/run-backtest.js)
 *
 *  Ported directly from MVS-bot's backtest.js MAIN section. Each sub-bot's
 *  own backtest.js just builds its data client and hands off here.
 *
 *  USAGE (from inside a bot folder, e.g. bots/crypto):
 *    node backtest.js                       ← all symbols, config.BACKTEST_DAYS
 *    node backtest.js SOL-USDT              ← single symbol
 *    node backtest.js SOL-USDT 180          ← single symbol, 180 days
 *    node backtest.js SOL-USDT,BTC-USDT 360 ← explicit multi-symbol
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const createBacktestEngine = require('./backtest-engine');

const isNumeric = (s) => /^\d+$/.test(s);

module.exports = async function runBacktest({ config, dataClient, botLabel, version, dir }) {
  const rawArgs = process.argv.slice(2);
  const symbols = rawArgs[0] && !isNumeric(rawArgs[0])
    ? rawArgs[0].toUpperCase().split(',').map(s => s.trim())
    : config.SYMBOLS;
  const days = parseInt(rawArgs[1] || rawArgs[0], 10) || config.BACKTEST_DAYS;

  const { fetchHistory } = dataClient;
  const { backtestSymbol, generateReport, WARMUP_BUFFER_DAYS } = createBacktestEngine({ config, core, version, botLabel });

  console.log(`\n🔬 ${botLabel} v${version} Backtest — ${symbols.length} symbol(s), ${days} days\n`);

  const allTrades = [];
  const funnelsBySymbol = {};
  // Fetch days+WARMUP_BUFFER_DAYS so short windows still have enough
  // history to warm up the 2H volume profile before the requested
  // evaluation window starts. evalWindowStartTime tells backtestSymbol()
  // where the real "start counting" line is.
  const fetchDays = days + WARMUP_BUFFER_DAYS;
  const evalWindowStartTime = Math.floor(Date.now() / 1000) - days * 86400;

  for (const symbol of symbols) {
    const data2h  = await fetchHistory(symbol, config.BIAS_TIMEFRAME,   fetchDays);
    const data30m = await fetchHistory(symbol, config.STRUCT_TIMEFRAME, fetchDays);
    const data15m = await fetchHistory(symbol, config.TRIGGER_TIMEFRAME, fetchDays);

    // 2H is treated as optional/best-effort, same tolerance engine.js
    // gives it live. 30M and 15M remain the two REQUIRED timeframes,
    // since 30M supplies the structural zone and 15M the trigger.
    if (data30m.length < 50 || data15m.length < 50) {
      console.log(`  ⚠️ ${symbol}: insufficient 30M/15M data, skipping.`);
      funnelsBySymbol[symbol] = null;
      continue;
    }

    const { trades, funnel } = await backtestSymbol(symbol, data15m, data30m, data2h, evalWindowStartTime);
    allTrades.push(...trades);
    funnelsBySymbol[symbol] = funnel;
  }

  const { lines } = generateReport(allTrades, days, funnelsBySymbol);
  const report = lines.join('\n');
  console.log('\n' + report);

  fs.writeFileSync(path.join(dir, 'backtest-report.txt'), report);
  fs.writeFileSync(path.join(dir, 'backtest-report.json'), JSON.stringify(allTrades, null, 2));
  console.log('\n📄 Saved backtest-report.txt and backtest-report.json');
};

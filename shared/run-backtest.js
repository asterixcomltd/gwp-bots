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
const createTelegram = require('./telegram');

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
  const dataFetchFailures = [];
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
      console.log(`  ⚠️ ${symbol}: insufficient 30M/15M data (30M=${data30m.length} bars, 15M=${data15m.length} bars), skipping.`);
      funnelsBySymbol[symbol] = null;
      dataFetchFailures.push(symbol);
      continue;
    }

    const { trades, funnel } = await backtestSymbol(symbol, data15m, data30m, data2h, evalWindowStartTime);
    allTrades.push(...trades);
    funnelsBySymbol[symbol] = funnel;
  }

  const { lines } = generateReport(allTrades, days, funnelsBySymbol);

  // If EVERY symbol failed to fetch data, this isn't "0 signals found" —
  // it's a broken data connection (missing/invalid API key, exhausted
  // rate limit, unsupported plan tier, etc.). Say so loudly, right at the
  // top, in both the file and the Telegram summary — not just buried in
  // per-symbol log lines above, which the scheduled workflow's Telegram
  // notification never shows (it only sends the first ~24 report lines).
  if (dataFetchFailures.length === symbols.length && symbols.length > 0) {
    lines.splice(0, 0,
      '🚨🚨🚨 DATA FETCH FAILED FOR EVERY SYMBOL — THIS IS NOT "0 SIGNALS FOUND" 🚨🚨🚨',
      `All ${symbols.length} symbol(s) returned insufficient/zero candle data.`,
      'Most likely cause: missing/invalid API key, or the data source is rate-limited/blocking this request.',
      'Check the full GitHub Actions log for this run (the "run backtest.js" step) for the exact error line.',
      ''
    );
  }
  const report = lines.join('\n');
  console.log('\n' + report);

  fs.writeFileSync(path.join(dir, 'backtest-report.txt'), report);
  fs.writeFileSync(path.join(dir, 'backtest-report.json'), JSON.stringify(allTrades, null, 2));
  console.log('\n📄 Saved backtest-report.txt and backtest-report.json');

  // Optional Telegram summary — used by the *-backtest.yml scheduled
  // workflow (BACKTEST_NOTIFY=true) so a fresh, honest number lands in
  // the chat weekly without anyone needing to run this by hand. Silently
  // skipped for local/manual runs unless the env var is set.
  if (process.env.BACKTEST_NOTIFY === 'true' && config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    try {
      const { sendSafe } = createTelegram(config);
      const summaryLines = lines.slice(0, 24).join('\n'); // header + summary block only — full report lives in the repo file
      await sendSafe(config.TELEGRAM_CHAT_ID,
        `📊 *${botLabel} — Scheduled Backtest*\n\n\`\`\`\n${summaryLines}\n\`\`\`\n\nFull report committed to \`bots/${path.basename(dir)}/backtest-report.txt\` in the repo.`,
        { parse_mode: 'Markdown' }
      );
      console.log('📨 Telegram summary sent.');
    } catch (e) {
      console.error('  ⚠️ Failed to send Telegram backtest summary (non-fatal):', e.message);
    }
  }
};

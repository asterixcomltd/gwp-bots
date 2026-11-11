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
const { buildPlan, derivePlanBars } = require('./tf-plan');

const isNumeric = (s) => /^\d+$/.test(s);

module.exports = async function runBacktest({ config, dataClient, botLabel, version, dir }) {
  const rawArgs = process.argv.slice(2);
  const symbols = rawArgs[0] && !isNumeric(rawArgs[0])
    ? rawArgs[0].toUpperCase().split(',').map(s => s.trim())
    : config.SYMBOLS;
  const days = parseInt(rawArgs[1] || rawArgs[0], 10) || config.BACKTEST_DAYS;

  const { fetchHistory } = dataClient;
  const plan = buildPlan(config);
  const SWEEP = process.env.GWP_SWEEP === '1' || process.env.GWP_SWEEP === 'true';
  const { backtestSymbol, generateReport, WARMUP_BUFFER_DAYS } = createBacktestEngine({ config, core, version, botLabel, plan });

  console.log(`\n🔬 ${botLabel} v${version} Backtest — ${symbols.length} symbol(s), ${days} days${SWEEP ? '  [ROLE SWEEP]' : ''}`);
  console.log(`   Timeframes: ${plan.describe()}\n`);

  const allTrades = [];
  const funnelsBySymbol = {};
  const dataFetchFailures = [];
  const warmupFailures = [];
  // Fetch days+WARMUP_BUFFER_DAYS so short windows still have enough
  // history to warm up the 2H structure volume profile before the
  // requested evaluation window starts. evalWindowStartTime tells
  // backtestSymbol() where the real "start counting" line is.
  const fetchDays = days + WARMUP_BUFFER_DAYS;

  // v1.1.4 FIX (stocks backtest returning 0 trades / scanned=0 for every
  // symbol): D1 warmup needs `DAILY_VP_LOOKBACK + 5` (=205) actual daily
  // BARS before backtestSymbol() will even start its replay loop — but
  // it was being fetched with the SAME `fetchDays` budget as the intraday
  // timeframes. For stocks (BACKTEST_DAYS=90, deliberately short because
  // Twelve Data's intraday history for equities only goes back a few
  // months), fetchDays=90+60=150 CALENDAR days only yields ~107 trading-
  // day D1 bars (equities trade ~5/7 days, and D1 isn't restricted to
  // the "few months" intraday window the way 2H/30M/15M are) — nowhere
  // near the 205 needed, so the warmup pointer never advances far enough
  // and backtestSymbol() returns immediately with an empty funnel every
  // time. Crypto (24/7) and forex (24/5) didn't hit this because their
  // much longer BACKTEST_DAYS (360) happens to fetch enough D1 bars
  // anyway — it was pure coincidence, not a fix. Give D1 its own,
  // separate, generously long fetch window so this can't happen for any
  // symbol/asset class regardless of how short BACKTEST_DAYS is.
  const dailyFetchDays = Math.max(fetchDays, config.DAILY_VP_LOOKBACK * 2 + 60);

  const evalWindowStartTime = Math.floor(Date.now() / 1000) - days * 86400;

  // Sweep mode also needs D1 (for the LEGACY baseline row) — fetched once, reused by every variant.
  const baseMinAgree = config.MIN_TF_AGREE;
  const basePrefilter = config.FIB_EXCLUDE_BEFORE_SCORING;
  const sweepRows = [];
  const sweepVariants = [];
  const legacyPlan = SWEEP ? (() => { const prev = process.env.GWP_TF_PROFILE; process.env.GWP_TF_PROFILE = 'LEGACY'; const p = buildPlan(config); if (prev === undefined) delete process.env.GWP_TF_PROFILE; else process.env.GWP_TF_PROFILE = prev; return p; })() : null;
  if (SWEEP) {
    sweepVariants.push({ name: 'LEGACY D1+30M+2H+15M (3-of-4, look-ahead fixed, Fib prefilter OFF)', plan: legacyPlan, legacy: true, fibPrefilter: false });
    // v1.3.2 — every row is labelled with the profile it REALLY runs (v1.3.1's "H6" rows silently ran the GROUPS
    // plan once GROUPS became the default, so 3-vs-4-of-6 looked identical). Explicit profile on every row.
    const h6 = buildPlan(config, { profile: 'H6' });
    for (const minAgree of [3, 4]) sweepVariants.push({ minAgree, name: `H6 six-way vote>=${minAgree}  (v1.3.0 design, Fib prefilter ON)`, plan: h6, fibPrefilter: true });
    sweepVariants.push({ minAgree: 3, name: 'H6 six-way vote>=3  (v1.3.0 design, Fib prefilter OFF = what v1.3.0 ran)', plan: h6, fibPrefilter: false });
    // GROUPS profile: triggers (M15,M30) + structures (H1,H2) + bias (H3,H4), one positive member per group.
    for (const [biasMin, noOppose] of [[1, 'bias'], [1, 'none'], [1, 'structure,bias'], [2, 'bias'], [2, 'none']]) {
      const gp = buildPlan(config, { profile: 'GROUPS', biasMin, noOppose });
      sweepVariants.push({ minAgree: baseMinAgree, name: `GROUPS trig>=1 struct>=1 bias>=${biasMin}  no-oppose:${noOppose}  (Fib prefilter ON)`, plan: gp, fibPrefilter: true });
    }
    sweepVariants.push({ minAgree: baseMinAgree, name: 'GROUPS bias>=1 no-oppose:bias  (Fib prefilter OFF)', plan: buildPlan(config, { profile: 'GROUPS' }), fibPrefilter: false });
    for (const v of sweepVariants) v.trades = [];
  }

  for (const symbol of symbols) {
    // Fetch only the provider-native ("base") series the plan needs; H1/H3/H4 are built from them.
    const needBases = new Set(Object.keys(plan.baseNeeds));
    if (SWEEP) needBases.add('D1');
    const baseBars = {};
    for (const b of needBases) {
      const tf = plan.baseName[b];
      baseBars[b] = await fetchHistory(symbol, tf, b === 'D1' ? dailyFetchDays : fetchDays);
    }

    const planBars = derivePlanBars(plan, baseBars);
    const sBars = planBars[plan.struct.label] || [], cBars = planBars[plan.clock.label] || [], tBars = planBars[plan.trigger.label] || [];
    // Structure and the clock/trigger timeframes are REQUIRED; the other voters are best-effort
    // (they abstain until they have enough history, same as live).
    if (sBars.length < 50 || cBars.length < 50 || tBars.length < 50) {
      console.log(`  ⚠️ ${symbol}: insufficient ${plan.struct.label}/${plan.clock.label}/${plan.trigger.label} data (${sBars.length}/${cBars.length}/${tBars.length} bars), skipping.`);
      funnelsBySymbol[symbol] = null;
      dataFetchFailures.push(symbol);
      continue;
    }

    if (SWEEP) {
      for (const v of sweepVariants) {
        const pb = v.legacy ? derivePlanBars(v.plan, baseBars) : derivePlanBars(v.plan, baseBars);
        config.MIN_TF_AGREE = v.minAgree || baseMinAgree;
        config.FIB_EXCLUDE_BEFORE_SCORING = v.fibPrefilter !== undefined ? v.fibPrefilter : basePrefilter;
        const r = await backtestSymbol(symbol, pb, evalWindowStartTime, v.plan);
        v.trades.push(...r.trades);
      }
      continue;
    }

    const result = await backtestSymbol(symbol, planBars, evalWindowStartTime, plan);
    allTrades.push(...result.trades);
    funnelsBySymbol[symbol] = result.funnel;
    if (result.warmupFailed) warmupFailures.push({ symbol, reason: result.warmupFailReason });
  }

  if (SWEEP) {
    const wilson = (w, n) => { if (!n) return [0, 0]; const z = 1.96, p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; };
    config.MIN_TF_AGREE = baseMinAgree;
    config.FIB_EXCLUDE_BEFORE_SCORING = basePrefilter;
    const rows = sweepVariants.map(v => {
      const closed = v.trades.filter(t => t.result !== 'OPEN');
      const wins = closed.filter(t => t.rr > 0), losses = closed.filter(t => t.rr <= 0);
      const totalR = closed.reduce((a, t) => a + t.rr, 0);
      const gw = wins.reduce((a, t) => a + t.rr, 0), gl = Math.abs(losses.reduce((a, t) => a + t.rr, 0));
      const [lo, hi] = wilson(wins.length, closed.length);
      return { name: v.name, n: closed.length, wr: closed.length ? wins.length / closed.length * 100 : 0, lo: lo * 100, hi: hi * 100, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), totalR, avgR: closed.length ? totalR / closed.length : 0, sl: closed.filter(t => t.result === 'SL').length };
    });
    const out = [];
    out.push('═══════════════════════════════════════════════════════════════════');
    out.push(` ${botLabel} v${version} — TIMEFRAME-ROLE SWEEP  (${days} days, ${symbols.length} symbols)`);
    out.push(' Same data, same gates, same exits — only the roles of M15 / H1 / H3 and the vote strictness (3 vs 4 of 6) change.');
    out.push(' WR 95% = Wilson confidence interval: if two rows overlap, the difference is NOISE.');
    out.push('═══════════════════════════════════════════════════════════════════');
    out.push('');
    out.push('trades  WR%   (95% range)   PF     totalR  avgR   SL   variant');
    for (const r of rows.sort((a, b) => b.totalR - a.totalR)) {
      out.push(`${String(r.n).padStart(5)}  ${r.wr.toFixed(1).padStart(5)}  (${r.lo.toFixed(0)}–${r.hi.toFixed(0)})`.padEnd(30) + `${(r.pf === Infinity ? '∞' : r.pf.toFixed(2)).padStart(5)}  ${r.totalR.toFixed(1).padStart(7)}  ${r.avgR.toFixed(2).padStart(5)}  ${String(r.sl).padStart(3)}  ${r.name}`);
    }
    out.push('');
    out.push('How to read: prefer the row with the best totalR/PF whose trade count is large enough that its');
    out.push('WR range is narrow. A row that wins by a few trades inside overlapping ranges is not a real winner.');
    const txt = out.join('\n');
    console.log('\n' + txt);
    fs.writeFileSync(path.join(dir, 'backtest-sweep.txt'), txt);
    fs.writeFileSync(path.join(dir, 'backtest-sweep.json'), JSON.stringify(rows, null, 2));
    console.log('\n📄 Saved backtest-sweep.txt and backtest-sweep.json');
    return;
  }

  const { lines } = generateReport(allTrades, days, funnelsBySymbol, plan);

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
  // v1.1.5 FIX: same loud-banner treatment for the OTHER way a backtest
  // can silently show 0 signals — data fetched fine, but not enough of
  // it to clear warmup (this is exactly what caused stocks to sit at
  // scanned=0 for every symbol, twice, with no explanation anywhere in
  // the report). Only symbols that fetched data but never started their
  // replay loop land here — a genuine "0 signals, here's the math"
  // banner instead of a silent, unexplained zero.
  else if (warmupFailures.length === symbols.length - dataFetchFailures.length && warmupFailures.length > 0) {
    lines.splice(0, 0,
      '⚠️⚠️⚠️ EVERY SYMBOL FAILED WARMUP — THIS IS NOT "0 SIGNALS FOUND" ⚠️⚠️⚠️',
      'Data fetched fine, but not enough of it to warm up before the replay loop could start:',
      ...warmupFailures.slice(0, 5).map(w => `  • ${w.symbol}: ${w.reason}`),
      warmupFailures.length > 5 ? `  ...and ${warmupFailures.length - 5} more.` : '',
      'Fix: reduce the affected timeframe\'s lookback (STRUCT_VP_LOOKBACK/BIAS_VP_LOOKBACK/DAILY_VP_LOOKBACK) for this asset class, or reduce BACKTEST_DAYS.',
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

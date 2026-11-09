/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED BACKTEST ENGINE (shared/backtest-engine.js)  v1.1.4
 *
 *  Ported directly from MVS-bot's backtest.js (v10.15.5): walks the 15M
 *  clock tick-by-tick (no lookahead — every check only sees bars up to
 *  "now"), two-pointer synced against the 30M/2H arrays. Uses core.js —
 *  the EXACT same decision logic every sub-bot's engine.js (live) uses,
 *  so a backtest report actually means something about live behavior.
 *
 *  Adapted from MVS's 5-timeframe/3-of-5 vote down to GWP's 4-timeframe/
 *  3-of-4 vote (D1 bias / 2H structure / 30M+15M trigger layer, see
 *  shared/config-base.js's RE-ROLE note for the v1.1.4 physical-TF
 *  swap), plus a dual multi-TF POC+Fib confirmation gate — see shared/
 *  engine.js header for the full architecture rationale. Every gate
 *  below fires in the same order engine.js uses, so backtest and live
 *  can never drift on WHAT is being tested, only on which historical
 *  window it's tested against.
 * ═══════════════════════════════════════════════════════════════════════
 */
// v1.1.4: bumped 40→60 to safely cover the new 2H STRUCT warmup, which
// (at STRUCT_VP_LOOKBACK=500 bars × 2h = ~41.7 calendar days, +ATR_PERIOD
// +5 bars margin, ≈43.3 days) now needs materially more runway than the
// old 30M-structure design did (~10.4 days). See run-backtest.js for the
// separate, even-longer D1 warmup fix (that one can't share this buffer
// because D1's own required history, at DAILY_VP_LOOKBACK=200 trading
// days, is far larger still — especially for equities, which only trade
// ~5/7 days).
// v1.1.5: bumped 60→75 — extra safety margin for the stocks bot's tight
// equities-hours warmup math (see bots/stocks/config.js's v1.1.5 note):
// even with STRUCT_VP_LOOKBACK trimmed to 120 for that bot specifically,
// equities' ~3-4 2H-bars/trading-day accumulation rate leaves the
// calendar-day math for warmup+eval closer to the fetch budget than
// crypto/forex ever get, so a slightly larger buffer here costs nothing
// for the 24/7 and 24/5 assets and removes the risk of shaving this too
// close again.
const WARMUP_BUFFER_DAYS = 75; // covers the 2H structure warmup with margin

const createSetupEvaluator = require('./setup-eval');
const { buildPlan } = require('./tf-plan');

module.exports = function createBacktestEngine({ config, core, version, botLabel, plan: defaultPlanIn }) {
  const defaultPlan = defaultPlanIn || buildPlan(config);

  // ─────────────────────────────────────────────────────────────────────
  //  REPLAY ENGINE — walks the CLOCK timeframe (M15) tick by tick.
  //
  //  planBars = { [label]: closed bars } for every timeframe in the plan
  //  (see tf-plan.js derivePlanBars). Decisions come from the SAME
  //  evaluator the live engine uses (setup-eval.js).
  //
  //  NO LOOK-AHEAD (v1.3.0 FIX): at the close of clock bar i (evalTime =
  //  open + clock seconds) a higher-timeframe candle is visible only if it
  //  had already CLOSED (avail <= evalTime). The old loops advanced while
  //  `next.time <= bar.time` — i.e. as soon as a candle OPENED — so every
  //  H2/30M/D1 vote and the structure price used a candle whose high/low/
  //  close were still in the future (up to 24h ahead for D1). Live can't
  //  see that, so the old backtest numbers were optimistic.
  //  opts.legacyPointers=true reproduces the old (look-ahead) pointers and
  //  exists ONLY for the regression test that proves the refactor itself
  //  changed nothing.
  // ─────────────────────────────────────────────────────────────────────
  const backtestSymbol = async (symbol, planBars, evalWindowStartTime = 0, planIn = null, opts = {}) => {
    const plan = planIn || defaultPlan;
    const { evaluate, tfState } = createSetupEvaluator({ config, core, plan });
    const clock = plan.clock;
    const clockBars = planBars[clock.label] || [];
    const trigBars = planBars[plan.trigger.label] || [];
    const legacyPointers = !!opts.legacyPointers;

    const trades = [];
    const cooldownMap = {};
    let openTrade = null;

    const funnel = {
      scanned: 0, voteOk: 0, bullVote: 0, bearVote: 0, volatilityOk: 0, structureOk: 0, notOverExtended: 0,
      nearZone: 0, prominenceOk: 0, confluenceOk: 0, htf2hAligned: 0, dualMultiTFOk: 0, notInvalidated: 0,
      cooldownOk: 0, triggerOk: 0, timingOk: 0, driftOk: 0, tp2RangeOk: 0, opened: 0,
    };

    const others = plan.entries.filter(e => e !== clock);          // every timeframe the clock does not own
    const warmupOf = (e) => e.vp + (e.roles.includes('struct') ? config.ATR_PERIOD + 5 : 5);
    const warmupClock = clock.vp + 5;

    // A bar is visible at `evalTime` once it has closed.
    const availOf = (b, e) => (b.avail !== undefined ? b.avail : b.time + e.seconds);
    const visible = (b, e, evalTime, barTime) => (legacyPointers ? b.time <= barTime : availOf(b, e) <= evalTime);
    const evalTimeOf = (bar) => bar.time + clock.seconds;

    const ptr = {};
    for (const e of others) ptr[e.label] = 0;
    const advance = (e, bar) => {
      const arr = planBars[e.label] || [];
      const et = evalTimeOf(bar);
      let moved = false;
      while (ptr[e.label] < arr.length - 1 && visible(arr[ptr[e.label] + 1], e, et, bar.time)) { ptr[e.label]++; moved = true; }
      return moved;
    };
    // A timeframe is "ready" only if its first bar is itself visible (otherwise ptr 0 would mean "nothing yet").
    const hasAny = (e, bar) => { const arr = planBars[e.label] || []; return arr.length > 0 && visible(arr[0], e, evalTimeOf(bar), bar.time); };

    // Position the pointers at the start of the clock series.
    if (clockBars.length) for (const e of others) advance(e, clockBars[0]);

    let startIdx = warmupClock;
    while (startIdx < clockBars.length) {
      const bar = clockBars[startIdx];
      let ready = bar.time >= evalWindowStartTime;
      for (const e of others) {
        if (!ready) break;
        advance(e, bar);
        if (!(hasAny(e, bar) && ptr[e.label] >= warmupOf(e))) ready = false;
      }
      if (ready) break;
      startIdx++;
    }
    if (startIdx >= clockBars.length) {
      const shortfalls = [];
      for (const e of others) {
        const mx = (planBars[e.label] || []).length ? planBars[e.label].length - 1 : 0;
        if (mx < warmupOf(e)) shortfalls.push(`${e.label}${e.roles.includes('struct') ? '(structure)' : ''} has ${mx}/${warmupOf(e)} bars needed`);
      }
      const reason = shortfalls.length
        ? `insufficient history for warmup — ${shortfalls.join(', ')} (likely a vendor intraday-history depth limit, not a code bug — see bots/*/config.js for the affected timeframe's lookback)`
        : `insufficient history for warmup (evalWindowStartTime never reached — check BACKTEST_DAYS/WARMUP_BUFFER_DAYS)`;
      console.log(`  [WARMUP] ${symbol}: ${reason}`);
      return { trades: [], funnel, warmupFailed: true, warmupFailReason: reason };
    }

    console.log(`\n  Replaying ${clockBars.length - startIdx} × ${clock.label} bars for ${symbol}...`);

    for (const e of others) ptr[e.label] = 0;
    if (clockBars.length) for (const e of others) advance(e, clockBars[0]);
    const states = {};
    // BUG FIXED (v1.3.0): the old loop only recomputed a timeframe's bias/ATR when it advanced
    // on THIS tick — but ticks spent inside an open trade `continue` before the recompute, so a
    // bar that closed during a trade was never picked up and the next scan ran on a stale
    // swing/bias (up to a full 2H / 24h) until that timeframe advanced again. `dirty` persists
    // until the recompute actually happens. (legacyPointers reproduces the old behaviour for the
    // regression test only.)
    const dirty = {};

    for (let i = startIdx; i < clockBars.length; i++) {
      const bar = clockBars[i];

      const advanced = {};
      for (const e of others) { advanced[e.label] = advance(e, bar); if (advanced[e.label]) dirty[e.label] = true; }

      // ── OPEN TRADE MANAGEMENT (every clock tick) ──────────────────────
      if (openTrade) {
        const { closed, trade, outcome } = core.evaluateOpenTrade(openTrade, bar, config);
        openTrade = trade;
        if (closed) {
          trades.push({ ...openTrade, ...outcome });
          openTrade = null;
        }
        continue; // in-trade: don't scan for new entries
      }

      funnel.scanned++;

      // Recompute a timeframe's bias/ATR only when a new bar of it became visible.
      for (const e of others) {
        const needs = legacyPointers ? advanced[e.label] : dirty[e.label];
        if (needs || !states[e.label]) {
          dirty[e.label] = false;
          const arr = planBars[e.label] || [];
          const cap = Math.max(e.vp * 2, e.vp + config.POC_MIGRATION_OFFSET_BARS, e.fib) + config.ATR_PERIOD + 10;
          const upto = ptr[e.label] + 1;
          states[e.label] = tfState(e, arr.slice(Math.max(0, upto - cap), upto));
        }
      }
      // The clock timeframe's window slides every tick.
      {
        const cap = Math.max(clock.vp, clock.fib) + config.ATR_PERIOD + 10;
        states[clock.label] = tfState(clock, clockBars.slice(Math.max(0, i + 1 - cap), i + 1));
      }
      if (legacyPointers) { const sa = planBars[plan.struct.label]; if (states[plan.struct.label]) states[plan.struct.label].last = sa[ptr[plan.struct.label]]; } // old engine read the live pointer's bar even when its swing was stale
      if (!states[plan.struct.label] || !states[plan.struct.label].bias || !states[plan.struct.label].atr) continue;

      // Trigger-timeframe window (closed bars only). For LEGACY the trigger IS the clock.
      let trigWin;
      if (plan.trigger === clock) trigWin = clockBars.slice(Math.max(0, i + 1 - (plan.trigger.vp + 5)), i + 1);
      else {
        const upto = ptr[plan.trigger.label] + 1;
        trigWin = trigBars.slice(Math.max(0, upto - (plan.trigger.vp + 5)), upto);
      }
      const clockWin = clockBars.slice(Math.max(0, i - 4), i + 1);

      const res = evaluate({
        states, trigBars: trigWin, clockBars: clockWin,
        cooldownBlocked: (direction) => {
          const lastSignalBar = cooldownMap[direction] || 0;
          const barsSince = Math.round((bar.time - lastSignalBar) / config.STRUCT_BAR_SECONDS);
          return barsSince < config.SIGNAL_COOLDOWN_BARS;
        },
      });

      for (const s of res.stages) funnel[s] = (funnel[s] || 0) + 1;
      if (res.stages.includes('voteOk')) { if (res.ctx.direction === 'BUY') funnel.bullVote++; else funnel.bearVote++; }
      if (!res.pass) continue;
      funnel.opened++;

      const sg = res.signal;
      cooldownMap[sg.direction] = bar.time;
      openTrade = {
        symbol, direction: sg.direction,
        entryTime: bar.time,
        entryPrice: sg.bestFibLevel, slPrice: sg.levels.slPrice, tp1Price: sg.levels.tp1Price, tp2Price: sg.levels.tp2Price,
        origSlPrice: sg.levels.slPrice,
        rr1: parseFloat(sg.levels.rr1.toFixed(2)), rr2: parseFloat(sg.levels.rr2.toFixed(2)),
        patterns: sg.rejection.patterns, pivot: sg.bestPivot.name, fibPct: sg.fibPct === '70% mid-pocket' ? '70%-mid' : sg.fibPct,
        voteTally: sg.resolved.tally, agreeing: sg.resolved.agreeing, voteTotal: plan.entries.length, structLabel: plan.struct.label,
        confluenceScore: sg.bestScore, td9Confirms: sg.td9Confirms, slAtrMult: sg.slAtrMult,
        prominence: sg.prominence, migration: sg.migration, nakedPOC: sg.nakedPOC, multiTFPOC: sg.multiTFPOC, multiTFFib: sg.multiTFFib,
      };
    }

    if (openTrade) {
      const lastBar = clockBars[clockBars.length - 1];
      const liveLegRR = (lastBar.close - openTrade.entryPrice) / Math.abs(openTrade.entryPrice - openTrade.origSlPrice) * (openTrade.direction === 'BUY' ? 1 : -1);
      const openRR = openTrade.tp1Hit ? (openTrade.halfR * config.PARTIAL_EXIT_PCT + liveLegRR * (1 - config.PARTIAL_EXIT_PCT)) : liveLegRR;
      trades.push({ ...openTrade, exitTime: lastBar.time, exitPrice: lastBar.close, result: 'OPEN',
        rr: parseFloat(openRR.toFixed(2)),
        hoursHeld: Math.round((lastBar.time - openTrade.entryTime) / 3600) });
    }

    console.log(`  [FUNNEL] ${symbol}:`, JSON.stringify(funnel));
    return { trades, funnel };
  };

  // ─────────────────────────────────────────────────────────────────────
  //  REPORT GENERATOR
  // ─────────────────────────────────────────────────────────────────────
  const generateReport = (allTrades, requestedDays, funnelsBySymbol, planIn = null) => {
    const plan = planIn || defaultPlan;
    // Risk tiers are keyed on the physical 2H structure TF ('2H'); the H6 plan calls it 'H2'.
    const normAgree = (t) => (t.agreeing || []).map(l => (l === (t.structLabel || '2H') ? '2H' : l));
    const closed = allTrades.filter(t => t.result !== 'OPEN');
    const wins   = closed.filter(t => t.rr > 0);
    const losses = closed.filter(t => t.rr <= 0);
    const tp1Reached = closed.filter(t => ['TP1+BE', 'TP1+TP2'].includes(t.result));
    const tp2Reached = closed.filter(t => t.result === 'TP1+TP2');
    const partialWins = closed.filter(t => t.result === 'TP1+BE');
    const sls    = closed.filter(t => t.result === 'SL');
    const bes    = closed.filter(t => t.result === 'BE');
    const timeouts = closed.filter(t => t.result === 'TIMEOUT' || t.result === 'EARLY_TIMEOUT');

    const winRate = closed.length ? (wins.length / closed.length * 100).toFixed(1) : '0.0';
    const losingTimeouts = timeouts.filter(t => t.rr <= 0);
    const realLosses = sls.length + losingTimeouts.length;
    const noLossRate = closed.length ? (((closed.length - realLosses) / closed.length) * 100).toFixed(1) : '0.0';
    const avgWinRR  = wins.length   ? (wins.reduce((s, t) => s + t.rr, 0) / wins.length).toFixed(2) : '0.00';
    const avgLossRR = losses.length ? (losses.reduce((s, t) => s + t.rr, 0) / losses.length).toFixed(2) : '0.00';
    const totalRR   = closed.reduce((s, t) => s + t.rr, 0);
    const grossWin  = wins.reduce((s, t) => s + t.rr, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rr, 0));
    const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '∞';

    let capital = config.STARTING_CAPITAL, peak = capital, maxDD = 0;
    for (const t of closed) {
      let riskMult = core.computeRiskMultiplier(t.pivot, normAgree(t), t.patterns, config.RISK_TIER_MATRIX, config.PATTERN_RISK_MATRIX, config.RISK_TIER_DEFAULT, t.td9Confirms, config.TD9_BOOST_MULT, t.slAtrMult, config.SL_ATR_MULT, '2H');
      riskMult *= core.computePOCQualityMultiplier(t.pivot, t.direction, t.prominence, t.migration, t.nakedPOC, t.multiTFPOC, config);
      riskMult *= core.computeVoteStrengthMultiplier(t.agreeing.length, config);
      riskMult = Math.max(0.1, Math.min(1.0, riskMult));
      const riskAmt  = capital * (config.RISK_PER_TRADE_PCT / 100) * riskMult;
      const slipCost = capital * (config.SLIPPAGE_PCT || 0);
      capital += riskAmt * t.rr - slipCost;
      if (capital > peak) peak = capital;
      const dd = (peak - capital) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }
    const finalCapital = capital.toFixed(2);
    const totalReturn = ((capital - config.STARTING_CAPITAL) / config.STARTING_CAPITAL * 100).toFixed(1);

    const patternCount = {};
    allTrades.forEach(t => (t.patterns || []).forEach(p => { patternCount[p] = (patternCount[p] || 0) + 1; }));

    const voteTallyCount = {};
    allTrades.forEach(t => { voteTallyCount[t.voteTally || 'N/A'] = (voteTallyCount[t.voteTally || 'N/A'] || 0) + 1; });

    const bySymbol = {};
    for (const t of closed) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, wins: 0, totalRR: 0 };
      bySymbol[t.symbol].trades++;
      if (t.rr > 0) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].totalRR += t.rr;
    }

    const byDirection = {};
    for (const t of closed) {
      if (!byDirection[t.direction]) byDirection[t.direction] = { trades: 0, wins: 0, totalRR: 0 };
      byDirection[t.direction].trades++;
      if (t.rr > 0) byDirection[t.direction].wins++;
      byDirection[t.direction].totalRR += t.rr;
    }

    // Confidence-tier breakdown — does 2H (structure) confirm the trade
    // direction? (agreeing includes '2H') vs not. See core.js
    // computeRiskMultiplier() for why this split exists.
    const byTier = {};
    for (const t of closed) {
      const tier = normAgree(t).includes('2H') ? '2H-confirmed' : 'no-2H-confirm';
      if (!byTier[tier]) byTier[tier] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
      byTier[tier].trades++;
      if (t.rr > 0) byTier[tier].wins++;
      if (t.result === 'SL') byTier[tier].sl++;
      byTier[tier].totalRR += t.rr;
    }
    const byPivotTier = {};
    for (const t of closed) {
      const key = t.pivot || 'N/A';
      if (!byPivotTier[key]) byPivotTier[key] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
      byPivotTier[key].trades++;
      if (t.rr > 0) byPivotTier[key].wins++;
      if (t.result === 'SL') byPivotTier[key].sl++;
      byPivotTier[key].totalRR += t.rr;
    }

    const byFibLevel = {};
    for (const t of closed) {
      const key = t.fibPct || 'N/A';
      if (!byFibLevel[key]) byFibLevel[key] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
      byFibLevel[key].trades++;
      if (t.rr > 0) byFibLevel[key].wins++;
      if (t.result === 'SL') byFibLevel[key].sl++;
      byFibLevel[key].totalRR += t.rr;
    }

    const byVoteTally = {};
    for (const t of closed) {
      const key = (t.agreeing || []).length ? `${t.agreeing.length}-of-${t.voteTotal || 4}` : 'N/A';
      if (!byVoteTally[key]) byVoteTally[key] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
      byVoteTally[key].trades++;
      if (t.rr > 0) byVoteTally[key].wins++;
      if (t.result === 'SL') byVoteTally[key].sl++;
      byVoteTally[key].totalRR += t.rr;
    }

    const byMultiTFPOC = {};
    for (const t of closed) {
      if (t.pivot !== 'POC') continue;
      const key = t.multiTFPOC && t.multiTFPOC.alignedLabels && t.multiTFPOC.alignedLabels.length
        ? `aligned (${t.multiTFPOC.alignedLabels.join('+')})` : 'not aligned';
      if (!byMultiTFPOC[key]) byMultiTFPOC[key] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
      byMultiTFPOC[key].trades++;
      if (t.rr > 0) byMultiTFPOC[key].wins++;
      if (t.result === 'SL') byMultiTFPOC[key].sl++;
      byMultiTFPOC[key].totalRR += t.rr;
    }

    const byMultiTFFib = {};
    for (const t of closed) {
      const key = t.multiTFFib && t.multiTFFib.alignedLabels && t.multiTFFib.alignedLabels.length
        ? `aligned (${t.multiTFFib.alignedLabels.join('+')})` : 'not aligned';
      if (!byMultiTFFib[key]) byMultiTFFib[key] = { trades: 0, wins: 0, sl: 0, totalRR: 0 };
      byMultiTFFib[key].trades++;
      if (t.rr > 0) byMultiTFFib[key].wins++;
      if (t.result === 'SL') byMultiTFFib[key].sl++;
      byMultiTFFib[key].totalRR += t.rr;
    }

    const avgHoursHeld = closed.length ? (closed.reduce((s, t) => s + (t.hoursHeld || 0), 0) / closed.length).toFixed(0) : '0';
    const signalsPerWeek = closed.length ? (closed.length / (requestedDays / 7)).toFixed(2) : '0.00';
    const requestedSymbols = Object.keys(funnelsBySymbol).length ? Object.keys(funnelsBySymbol) : [...new Set(allTrades.map(t => t.symbol))];

    const lines = [
      '═══════════════════════════════════════════════════════════════════',
      ` ${botLabel} v${version} — BACKTEST REPORT`,
      ` Period: Last ${requestedDays} days  |  Symbols: ${requestedSymbols.join(', ')}`,
      ` ${plan.describe()} — ${config.MIN_TF_AGREE}-of-${plan.entries.length} timeframe vote`,
      ` Timeframe profile: ${plan.profile}${plan.variant ? ' | roles: ' + JSON.stringify(plan.variant) : ''}  (* = built from lower-timeframe candles)`,
      '═══════════════════════════════════════════════════════════════════',
      '',
      '⚠️  This is a backtest, not a live-performance guarantee. No setting',
      '    here was chosen to hit a target win rate — see config.js header.',
      '',
      '── SUMMARY ─────────────────────────────────────────────────────────',
      `  Total signals fired    : ${allTrades.length}  (~${signalsPerWeek}/week across all symbols)`,
      `  Closed trades          : ${closed.length}`,
      `  Open (unrealised)      : ${allTrades.filter(t => t.result === 'OPEN').length}`,
      `  Win rate (all closed)  : ${winRate}%  (${wins.length}W / ${losses.length}L)`,
      `  No-real-loss rate      : ${noLossRate}%  (${closed.length - realLosses} no-loss / ${realLosses} real loss — excludes ${bes.length} breakeven scratches; this is NOT the same as "win rate")`,
      `  Profit factor          : ${profitFactor}`,
      `  Total R accumulated    : ${totalRR.toFixed(2)}R`,
      `  Avg win / avg loss     : +${avgWinRR}R / ${avgLossRR}R`,
      `  Avg hours held         : ${avgHoursHeld}h`,
      '',
      '── OUTCOME BREAKDOWN ───────────────────────────────────────────────',
      `  TP1 reached (partial banked) : ${tp1Reached.length}`,
      `  TP2 reached (full target)    : ${tp2Reached.length}`,
      `    ..of which runner gave back to BE : ${partialWins.length}`,
      `  SL hits                      : ${sls.length}`,
      `  BE hits (never reached TP1)  : ${bes.length}`,
      `  Timeouts                     : ${timeouts.length}`,
      '',
      `── $ P&L SIMULATION (${config.RISK_PER_TRADE_PCT}% risk/trade + ${(config.SLIPPAGE_PCT*100).toFixed(1)}% slippage, $${config.STARTING_CAPITAL} start) ──`,
      `  Final capital : $${finalCapital}  (${totalReturn}% return)  |  Max drawdown: ${maxDD.toFixed(1)}%`,
      '',
      '── TIMEFRAME VOTE BREAKDOWN ────────────────────────────────────────',
      ...Object.entries(voteTallyCount).sort().map(([k, v]) => `  ${k} agreement: ${v} signals`),
      '',
      '── BY SYMBOL ───────────────────────────────────────────────────────',
      ...requestedSymbols.map(sym => {
        const s = bySymbol[sym];
        if (!s) return `  ${sym.padEnd(10)} 0 trades — see funnel diagnostics below`;
        return `  ${sym.padEnd(10)} ${s.trades} trades | ${(s.wins/s.trades*100).toFixed(0)}% WR | ${s.totalRR.toFixed(2)}R total`;
      }),
      '',
      '── BY DIRECTION ────────────────────────────────────────────────────',
      ...(Object.keys(byDirection).length ? Object.keys(byDirection).map(dir => {
        const d = byDirection[dir];
        return `  ${dir.padEnd(6)} ${d.trades} trades | ${(d.wins/d.trades*100).toFixed(0)}% WR | ${d.totalRR.toFixed(2)}R total`;
      }) : ['  No closed trades to break down by direction.']),
      '',
      '── BY CONFIDENCE TIER (drives RISK_TIER_MATRIX) ─────────────────────',
      ...Object.entries(byTier).map(([k, v]) =>
        `  ${k.padEnd(15)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`),
      '',
      '── BY PIVOT (drives RISK_TIER_MATRIX) ───────────────────────────────',
      ...Object.entries(byPivotTier).map(([k, v]) =>
        `  ${k.padEnd(15)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`),
      '',
      '── BY FIB LEVEL ──────────────────────────────────────────────────────',
      ...(Object.keys(byFibLevel).length ? Object.entries(byFibLevel).map(([k, v]) =>
        `  ${k.padEnd(15)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`)
        : ['  No closed trades yet on a run new enough to track this.']),
      '',
      '── BY VOTE TALLY (drives VOTE_STRENGTH_MULT) ────────────────────────',
      ...(Object.keys(byVoteTally).length ? Object.entries(byVoteTally).sort().map(([k, v]) =>
        `  ${k.padEnd(15)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`)
        : ['  No closed trades to break down by vote tally.']),
      '',
      '── BY MULTI-TF POC ALIGNMENT (POC pivot only) ───────────────────────',
      ...(Object.keys(byMultiTFPOC).length ? Object.entries(byMultiTFPOC).map(([k, v]) =>
        `  ${k.padEnd(20)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`)
        : ['  No closed POC-pivot trades yet on a run new enough to track this.']),
      '',
      '── BY MULTI-TF FIB ALIGNMENT (all pivots — DUAL_MULTI_TF_GATE) ──────',
      ...(Object.keys(byMultiTFFib).length ? Object.entries(byMultiTFFib).map(([k, v]) =>
        `  ${k.padEnd(20)} ${v.trades} trades | ${(v.wins/v.trades*100).toFixed(1)}% WR | ${v.sl} SL | ${v.totalRR.toFixed(2)}R total`)
        : ['  No closed trades yet on a run new enough to track this.']),
      '',
      `── FUNNEL DIAGNOSTICS (${plan.clock.label} ticks surviving each gate, per symbol) ───`,
      ...requestedSymbols.flatMap(sym => {
        const f = funnelsBySymbol[sym];
        if (!f) return [`  ${sym}: no funnel data`];
        return [
          `  ${sym}:`,
          `    scanned=${f.scanned}  voteOk=${f.voteOk}(bull=${f.bullVote}/bear=${f.bearVote})  volatilityOk=${f.volatilityOk}  structureOk=${f.structureOk}`,
          `    notOverExtended=${f.notOverExtended}  nearZone=${f.nearZone}  prominenceOk=${f.prominenceOk}  confluenceOk=${f.confluenceOk}  htf2hAligned=${f.htf2hAligned}  dualMultiTFOk=${f.dualMultiTFOk}`,
          `    notInvalidated=${f.notInvalidated}  cooldownOk=${f.cooldownOk}  triggerOk=${f.triggerOk}  timingOk=${f.timingOk || 0}  driftOk=${f.driftOk}  tp2RangeOk=${f.tp2RangeOk}  opened=${f.opened}`,
        ];
      }),
      '',
      '── PATTERN FREQUENCY ───────────────────────────────────────────────',
      ...Object.entries(patternCount).sort(([,a],[,b]) => b - a).map(([p, c]) => `  ${p.padEnd(20)} ${c}x`),
      '',
      '── RECENT TRADES (last 20) ─────────────────────────────────────────',
      ...closed.slice(-20).map(t => {
        const d = new Date(t.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ');
        const icon = t.rr > 0 ? '✅' : '❌';
        return `  ${icon} ${d} | ${t.symbol} ${t.direction} | ${t.result} | ${t.rr > 0 ? '+' : ''}${t.rr}R | ${(t.voteTally||'')} | ${t.patterns.join('+')}`;
      }),
      '',
      '═══════════════════════════════════════════════════════════════════',
    ];

    return { lines, stats: { winRate, profitFactor, totalRR, finalCapital, totalReturn, maxDD, bySymbol, patternCount } };
  };

  return { backtestSymbol, generateReport, WARMUP_BUFFER_DAYS };
};

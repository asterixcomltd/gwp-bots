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

module.exports = function createBacktestEngine({ config, core, version, botLabel }) {

  // ─────────────────────────────────────────────────────────────────────
  //  REPLAY ENGINE — walks the 15M clock, two-pointer sync on 30M/2H
  // ─────────────────────────────────────────────────────────────────────
  const backtestSymbol = async (symbol, data15m, data30m, data2h, dataD1, evalWindowStartTime = 0) => {
    const trades = [];
    const cooldownMap = {};
    let openTrade = null;

    const funnel = {
      scanned: 0, voteOk: 0, bullVote: 0, bearVote: 0, volatilityOk: 0, structureOk: 0, notOverExtended: 0,
      nearZone: 0, prominenceOk: 0, confluenceOk: 0, htf2hAligned: 0, dualMultiTFOk: 0, notInvalidated: 0,
      cooldownOk: 0, triggerOk: 0, driftOk: 0, tp2RangeOk: 0, opened: 0,
    };

    const warmupStruct = config.STRUCT_VP_LOOKBACK + config.ATR_PERIOD + 5;
    const warmupBias    = config.BIAS_VP_LOOKBACK + 5;
    const warmupDaily    = config.DAILY_VP_LOOKBACK + 5;
    const warmupTrigger = config.TRIGGER_VP_LOOKBACK + 5;

    let ptrStruct = 0, ptrBias = 0, ptrDaily = 0;
    while (ptrStruct < data30m.length - 1 && data30m[ptrStruct + 1].time <= data15m[0].time) ptrStruct++;
    while (ptrBias   < data2h.length  - 1 && data2h[ptrBias + 1].time  <= data15m[0].time) ptrBias++;
    while (ptrDaily  < dataD1.length  - 1 && dataD1[ptrDaily + 1].time <= data15m[0].time) ptrDaily++;

    let startIdx = warmupTrigger;
    while (startIdx < data15m.length) {
      const t = data15m[startIdx].time;
      let pS = 0, pB = 0, pD = 0;
      while (pS < data30m.length - 1 && data30m[pS + 1].time <= t) pS++;
      while (pB < data2h.length  - 1 && data2h[pB + 1].time  <= t) pB++;
      while (pD < dataD1.length  - 1 && dataD1[pD + 1].time  <= t) pD++;
      if (pS >= warmupStruct && pB >= warmupBias && pD >= warmupDaily && t >= evalWindowStartTime) break;
      startIdx++;
    }
    if (startIdx >= data15m.length) {
      // v1.1.5 FIX: this used to fail completely silently — a symbol
      // could sit at scanned=0 in the funnel with zero explanation, which
      // is exactly what made the stocks-backtest-returning-0 bug so hard
      // to track down (twice). Report which timeframe(s) actually fell
      // short and by how much, so a data-depth shortfall like that one is
      // obvious from the report itself, not another investigation.
      const maxPS = data30m.length ? data30m.length - 1 : 0;
      const maxPB = data2h.length  ? data2h.length  - 1 : 0;
      const maxPD = dataD1.length  ? dataD1.length  - 1 : 0;
      const shortfalls = [];
      if (maxPS < warmupStruct) shortfalls.push(`STRUCT(2H) has ${maxPS}/${warmupStruct} bars needed`);
      if (maxPB < warmupBias)   shortfalls.push(`BIAS(30M) has ${maxPB}/${warmupBias} bars needed`);
      if (maxPD < warmupDaily)  shortfalls.push(`DAILY(D1) has ${maxPD}/${warmupDaily} bars needed`);
      const reason = shortfalls.length
        ? `insufficient history for warmup — ${shortfalls.join(', ')} (likely a vendor intraday-history depth limit, not a code bug — see bots/*/config.js for the affected timeframe's lookback)`
        : `insufficient history for warmup (evalWindowStartTime never reached — check BACKTEST_DAYS/WARMUP_BUFFER_DAYS)`;
      console.log(`  [WARMUP] ${symbol}: ${reason}`);
      return { trades: [], funnel, warmupFailed: true, warmupFailReason: reason };
    }

    console.log(`\n  Replaying ${data15m.length - startIdx} × 15M bars for ${symbol}...`);

    ptrStruct = 0; ptrBias = 0; ptrDaily = 0;
    let cachedStruct = null, cachedBias = null, cachedDaily = null, cachedAtr2h = null, cachedAtrD1 = null;

    for (let i = startIdx; i < data15m.length; i++) {
      const bar = data15m[i];

      let advancedStruct = false, advancedBias = false, advancedDaily = false;
      while (ptrStruct < data30m.length - 1 && data30m[ptrStruct + 1].time <= bar.time) { ptrStruct++; advancedStruct = true; }
      while (ptrBias   < data2h.length  - 1 && data2h[ptrBias + 1].time  <= bar.time) { ptrBias++;   advancedBias   = true; }
      while (ptrDaily  < dataD1.length  - 1 && dataD1[ptrDaily + 1].time <= bar.time) { ptrDaily++;  advancedDaily  = true; }

      // ── OPEN TRADE MANAGEMENT (every 15M tick, tighter fills) ─────────
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

      // ── Recompute 2H structure only when a new 2H bar closed ──────────
      if (advancedStruct || !cachedStruct) {
        const wStart = Math.max(0, ptrStruct + 1 - (config.STRUCT_VP_LOOKBACK + config.ATR_PERIOD + 5));
        const windowStruct = data30m.slice(wStart, ptrStruct + 1);
        const biasStruct = core.tfBiasVote(windowStruct, config.STRUCT_VP_LOOKBACK, config.STRUCT_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
        const atrStruct = core.calcATR(windowStruct, config.ATR_PERIOD);
        const atrSeriesStruct = config.VOLATILITY_REGIME_ENABLED ? core.calcATRSeries(windowStruct, config.ATR_PERIOD) : [];

        let pocWideWindowStruct = windowStruct;
        if (config.NAKED_POC_ENABLED || config.POC_MIGRATION_ENABLED) {
          let requiredBars = config.STRUCT_VP_LOOKBACK;
          if (config.NAKED_POC_ENABLED) requiredBars = Math.max(requiredBars, config.STRUCT_VP_LOOKBACK * 2);
          if (config.POC_MIGRATION_ENABLED) requiredBars = Math.max(requiredBars, config.STRUCT_VP_LOOKBACK + config.POC_MIGRATION_OFFSET_BARS);
          const wWideStart = Math.max(0, ptrStruct + 1 - requiredBars);
          pocWideWindowStruct = data30m.slice(wWideStart, ptrStruct + 1);
        }
        cachedStruct = biasStruct && atrStruct ? { biasStruct, atrStruct, atrSeriesStruct, windowStruct, pocWideWindowStruct } : null;
      }
      // ── Recompute 30M bias only when a new 30M bar closed ─────────────
      if (advancedBias || !cachedBias) {
        const wBStart = Math.max(0, ptrBias + 1 - (config.BIAS_VP_LOOKBACK + 5));
        const windowBias = data2h.slice(wBStart, ptrBias + 1);
        cachedBias = data2h.length ? core.tfBiasVote(windowBias, config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT) : null;
        cachedAtr2h = windowBias.length >= config.ATR_PERIOD + 5 ? core.calcATR(windowBias, config.ATR_PERIOD) : null;
      }
      // ── Recompute D1 bias only when a new daily bar closed ────────────
      if (advancedDaily || !cachedDaily) {
        const wDStart = Math.max(0, ptrDaily + 1 - (config.DAILY_VP_LOOKBACK + 5));
        const windowDaily = dataD1.slice(wDStart, ptrDaily + 1);
        cachedDaily = dataD1.length ? core.tfBiasVote(windowDaily, config.DAILY_VP_LOOKBACK, config.DAILY_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT) : null;
        cachedAtrD1 = windowDaily.length >= config.ATR_PERIOD + 5 ? core.calcATR(windowDaily, config.ATR_PERIOD) : null;
      }
      if (!cachedStruct) continue;

      // ── 15M bias recomputed every tick (its window slides every bar) ──
      const win15mStart = Math.max(0, i + 1 - (config.TRIGGER_VP_LOOKBACK + 5));
      const window15m = data15m.slice(win15mStart, i + 1);
      const bias15m = core.tfBiasVote(window15m, config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);

      const resolved = core.resolveDirection([
        { tf: 'D1',  result: cachedDaily },
        { tf: '30M', result: cachedBias },
        { tf: '2H',  result: cachedStruct.biasStruct },
        { tf: '15M', result: bias15m },
      ], config.MIN_TF_AGREE);
      if (!resolved) continue;
      funnel.voteOk++;
      if (resolved.direction === 'BUY') funnel.bullVote++; else funnel.bearVote++;

      const direction = resolved.direction;
      const { biasStruct, atrStruct, atrSeriesStruct, windowStruct, pocWideWindowStruct } = cachedStruct;
      const swingStruct = biasStruct.swing;
      const priceStruct = data30m[ptrStruct].close;

      if (config.VOLATILITY_REGIME_ENABLED) {
        const atrPctl = core.calcATRPercentile(atrSeriesStruct, config.VOLATILITY_LOOKBACK_BARS);
        if (atrPctl !== null && (atrPctl < config.VOLATILITY_MIN_PCTL || atrPctl > config.VOLATILITY_MAX_PCTL)) continue;
      }
      funnel.volatilityOk++;

      if (priceStruct > swingStruct.high || priceStruct < swingStruct.low) continue; // remap
      funnel.structureOk++;

      const fib = core.calcFib(swingStruct.high, swingStruct.low, direction, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH);

      if ((direction === 'BUY' && priceStruct < fib.level886) || (direction === 'SELL' && priceStruct > fib.level886)) continue;
      funnel.notOverExtended++;

      if (!core.isNearZone(priceStruct, fib, atrStruct, config.NEAR_ZONE_ATR_MULT)) continue;
      funnel.nearZone++;

      const vpStruct = biasStruct.vp;
      const fibMid = (fib.zoneHigh + fib.zoneLow) / 2;
      const checkLevels = [fib.level618, fib.level786, fibMid];
      const checkPivots = [{ name: 'POC', price: vpStruct.pocPrice }, { name: 'VAH', price: vpStruct.vahPrice }, { name: 'VAL', price: vpStruct.valPrice }];
      let bestScore = 0, bestFibLevel = null, bestPivot = null;
      for (const lvl of checkLevels) for (const pivot of checkPivots) {
        const sc = core.confluenceScore(lvl, pivot.price, atrStruct, config.CONFLUENCE_ATR_MULT);
        if (sc > bestScore) { bestScore = sc; bestFibLevel = lvl; bestPivot = pivot; }
      }
      if (bestScore < 1) continue;
      if (bestPivot.name === 'POC' && bestScore < config.MIN_CONFLUENCE_POC) continue;
      if (bestPivot.name === 'POC' && config.POC_REQUIRE_STRUCT_CONFIRM && !resolved.agreeing.includes('2H')) continue;

      const prominenceForGate = core.computePOCProminence(vpStruct);
      if (!core.isPOCProminenceTrusted(bestPivot.name, prominenceForGate, config)) continue;
      funnel.prominenceOk++;
      funnel.confluenceOk++;

      const htfCheck = core.checkHTFZoneAlignment(bestFibLevel, cachedBias, atrStruct, direction, config.HTFZONE_ATR_MULT);
      if (!htfCheck.aligned) continue;
      funnel.htf2hAligned++;

      // ── DUAL MULTI-TF GATE (requested addition) ─────────────────────
      // Hard gate: BOTH 30M and D1 must independently confirm on BOTH the
      // POC check and the Fib check, all in the trade's direction — not
      // just "any" agreement. Each macro TF's tolerance is measured
      // against ITS OWN ATR (cachedAtr2h/cachedAtrD1, computed once per
      // 30M/D1 bar close alongside the bias vote itself — see above), not
      // 2H's — see core.js computeMultiTFPOCAlignment()/
      // computeMultiTFFibAlignment() v1.1.1 fix notes for why that matters.
      // (variable names still say "2h" for historical continuity — see
      // shared/config-base.js RE-ROLE note: cachedBias/cachedAtr2h now
      // actually hold 30M-sourced data post v1.1.4.)
      const multiTFPOC = core.computeMultiTFPOCAlignment(
        vpStruct.pocPrice,
        [{ label: '30M', poc: cachedBias?.poc, atr: cachedAtr2h }, { label: 'D1', poc: cachedDaily?.poc, atr: cachedAtrD1 }],
        config.MULTI_TF_POC_TOLERANCE_ATR
      );
      const multiTFFib = core.computeMultiTFFibAlignment(
        bestFibLevel, direction,
        [{ label: '30M', swing: cachedBias?.swing, atr: cachedAtr2h }, { label: 'D1', swing: cachedDaily?.swing, atr: cachedAtrD1 }],
        config.MULTI_TF_FIB_TOLERANCE_ATR, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH
      );
      if (config.DUAL_MULTI_TF_GATE_ENABLED) {
        const pocFull = multiTFPOC.alignedLabels.length >= config.DUAL_MULTI_TF_POC_MIN_ALIGNED;
        const fibFull = multiTFFib.alignedLabels.length >= config.DUAL_MULTI_TF_FIB_MIN_ALIGNED;
        if (!pocFull || !fibFull) continue;
      }
      funnel.dualMultiTFOk++;

      if (core.isZoneInvalidated(priceStruct, bestFibLevel, atrStruct, direction, config.ZONE_INVALIDATION_ATR_MULT)) continue;
      funnel.notInvalidated++;

      const lastSignalBar = cooldownMap[direction] || 0;
      const barsSince = Math.round((bar.time - lastSignalBar) / config.STRUCT_BAR_SECONDS);
      if (barsSince < config.SIGNAL_COOLDOWN_BARS) continue;
      funnel.cooldownOk++;

      const entryZoneLow  = fib.zoneLow  - atrStruct * 0.1;
      const entryZoneHigh = fib.zoneHigh + atrStruct * 0.1;
      const rejection = core.detectRejection(window15m, entryZoneLow, entryZoneHigh, direction,
        { poc: vpStruct.pocPrice, vah: vpStruct.vahPrice, val: vpStruct.valPrice },
        config.ABSORPTION_BODY_RATIO, config.REJECTION_MIN_PATTERNS, config.ALLOW_SOLO_TRIGGER,
        config.SOLO_ELIGIBLE_PATTERNS, config.TRIGGER_LOOKBACK_BARS);
      if (!rejection.valid) continue;
      funnel.triggerOk++;

      // ── ENTRY DRIFT / STALENESS GUARD (v1.1.4 FIX, mirrors engine.js) ──
      // In a real backtest tick there's no cron delay — bar.close IS
      // "now" — so this is mostly a no-op here and exists to keep
      // backtest and live using the exact same gate list. It only bites
      // in the (rare, already-anomalous) case where the struct-TF close
      // used above has already drifted from the live 15M tick beyond
      // tolerance within the same bar.
      if (core.isZoneInvalidated(bar.close, bestFibLevel, atrStruct, direction, config.ENTRY_DRIFT_MAX_ATR)) continue;
      funnel.driftOk++;

      const slAtrMult = config.SL_ATR_MULT_MATRIX_ENABLED && config.SL_ATR_MULT_MATRIX[bestPivot.name] != null
        ? config.SL_ATR_MULT_MATRIX[bestPivot.name]
        : config.SL_ATR_MULT;
      const levels = core.computeTradeLevels({
        direction, entryPrice: bestFibLevel, swing: swingStruct, atr: atrStruct, vp: vpStruct,
        slAtrMult, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
        tp2MinExtensionRR: config.TP2_MIN_EXTENSION_RR,
      });
      if (!levels) continue;
      funnel.tp2RangeOk++;
      funnel.opened++;

      const td9 = config.TD9_ENABLED ? core.computeTDSequential(windowStruct) : { buy9: false, sell9: false };
      const td9Confirms = (direction === 'BUY' && td9.buy9) || (direction === 'SELL' && td9.sell9);

      const prominence = prominenceForGate;
      const migration = core.computePOCMigration(
        pocWideWindowStruct, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
        config.POC_MIGRATION_OFFSET_BARS, atrStruct, config.POC_MIGRATION_MIN_ATR
      );
      const nakedPOC = core.computeNakedPOC(
        pocWideWindowStruct, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
        atrStruct, vpStruct.pocPrice, config.NAKED_POC_TOLERANCE_ATR
      );
      const fibPct = bestFibLevel === fib.level618 ? '61.8%' : bestFibLevel === fib.level786 ? '78.6%' : '70%-mid';

      cooldownMap[direction] = bar.time;
      openTrade = {
        symbol, direction,
        entryTime: bar.time,
        entryPrice: bestFibLevel, slPrice: levels.slPrice, tp1Price: levels.tp1Price, tp2Price: levels.tp2Price,
        origSlPrice: levels.slPrice,
        rr1: parseFloat(levels.rr1.toFixed(2)), rr2: parseFloat(levels.rr2.toFixed(2)),
        patterns: rejection.patterns, pivot: bestPivot.name, fibPct,
        voteTally: resolved.tally, agreeing: resolved.agreeing,
        confluenceScore: bestScore, td9Confirms, slAtrMult,
        prominence, migration, nakedPOC, multiTFPOC, multiTFFib,
      };
    }

    if (openTrade) {
      const lastBar = data15m[data15m.length - 1];
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
  const generateReport = (allTrades, requestedDays, funnelsBySymbol) => {
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
      let riskMult = core.computeRiskMultiplier(t.pivot, t.agreeing, t.patterns, config.RISK_TIER_MATRIX, config.PATTERN_RISK_MATRIX, config.RISK_TIER_DEFAULT, t.td9Confirms, config.TD9_BOOST_MULT, t.slAtrMult, config.SL_ATR_MULT, '2H');
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
      const tier = (t.agreeing || []).includes('2H') ? '2H-confirmed' : 'no-2H-confirm';
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
      const key = (t.agreeing || []).length ? `${t.agreeing.length}-of-3` : 'N/A';
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
      ' D1+2H+30M+15M — 3-of-4 timeframe vote (D1 bias, 2H zone, 30M+15M trigger)',
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
      '── FUNNEL DIAGNOSTICS (15M ticks surviving each gate, per symbol) ───',
      ...requestedSymbols.flatMap(sym => {
        const f = funnelsBySymbol[sym];
        if (!f) return [`  ${sym}: no funnel data`];
        return [
          `  ${sym}:`,
          `    scanned=${f.scanned}  voteOk=${f.voteOk}(bull=${f.bullVote}/bear=${f.bearVote})  volatilityOk=${f.volatilityOk}  structureOk=${f.structureOk}`,
          `    notOverExtended=${f.notOverExtended}  nearZone=${f.nearZone}  prominenceOk=${f.prominenceOk}  confluenceOk=${f.confluenceOk}  htf2hAligned=${f.htf2hAligned}  dualMultiTFOk=${f.dualMultiTFOk}`,
          `    notInvalidated=${f.notInvalidated}  cooldownOk=${f.cooldownOk}  triggerOk=${f.triggerOk}  driftOk=${f.driftOk}  tp2RangeOk=${f.tp2RangeOk}  opened=${f.opened}`,
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

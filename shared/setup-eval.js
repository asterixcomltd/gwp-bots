/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED SETUP EVALUATOR (shared/setup-eval.js)   v1.3.1
 *
 *  The ONE place the signal decision pipeline lives. engine.js (live) and
 *  backtest-engine.js (replay) both call evaluate(); they only differ in
 *  where the candles come from and what they do with the result. This ends
 *  the recurring "live and backtest drifted apart" bug class by
 *  construction — there is no second copy of the gate list to drift.
 *
 *  The gate order and every gate's maths are the previous engine's,
 *  unchanged (see git history / README). What changed is that the
 *  timeframe roles are read from the TF plan (shared/tf-plan.js) instead of
 *  being hard-wired to D1/30M/2H/15M.
 * ═══════════════════════════════════════════════════════════════════════
 */
module.exports = function createSetupEvaluator({ config, core, plan }) {
  const S = plan.struct;
  const T = plan.trigger;
  const atrNeed = config.ATR_PERIOD + 5;

  // ── Per-timeframe state (bias vote + ATR) from CLOSED bars ────────────
  // Optional timeframes (D1/30M legacy; H1/H3/H4 in H6) simply abstain
  // (null) when there is not enough history yet, exactly like before.
  const tfState = (entry, bars) => {
    if (entry.roles.includes('struct')) {
      const win = bars.slice(-(entry.vp + config.ATR_PERIOD + 5));
      const bias = core.tfBiasVote(win, entry.vp, entry.fib, config.VP_ROWS, config.VALUE_AREA_PCT);
      const atr = core.calcATR(win, config.ATR_PERIOD);
      const atrSeries = config.VOLATILITY_REGIME_ENABLED ? core.calcATRSeries(win, config.ATR_PERIOD) : [];
      let pocWide = win;
      if (config.NAKED_POC_ENABLED || config.POC_MIGRATION_ENABLED) {
        let req = entry.vp;
        if (config.NAKED_POC_ENABLED) req = Math.max(req, entry.vp * 2);
        if (config.POC_MIGRATION_ENABLED) req = Math.max(req, entry.vp + config.POC_MIGRATION_OFFSET_BARS);
        pocWide = bars.slice(-req);
      }
      return { bias, atr, atrSeries, window: win, pocWide, last: bars[bars.length - 1] };
    }
    if (entry.optional && bars.length < 50) return { bias: null, atr: null };
    const win = bars.slice(-(Math.max(entry.vp, entry.fib) + atrNeed));
    const bias = bars.length ? core.tfBiasVote(win, entry.vp, entry.fib, config.VP_ROWS, config.VALUE_AREA_PCT) : null;
    const atr = win.length >= atrNeed ? core.calcATR(win, config.ATR_PERIOD) : null;
    return { bias, atr };
  };

  const fmtFib = (lvl, fib, fibMid) => (lvl === fib.level618 ? '61.8%' : lvl === fib.level786 ? '78.6%' : '70% mid-pocket');

  // ── evaluate ──────────────────────────────────────────────────────────
  //  states       { [label]: tfState }
  //  trigBars     closed bars of the TRIGGER timeframe (pattern detection)
  //  clockBars    closed bars of the finest (clock) timeframe — freshest close
  //  cooldownBlocked(direction) -> boolean
  //  log(msg)     optional console sink (live only)
  // Returns { pass, reason, stages[], ctx, signal? }.
  const evaluate = ({ states, trigBars, clockBars, cooldownBlocked, log = () => {} }) => {
    const stages = [];
    const ctx = {};
    const fail = (reason, info = {}) => ({ pass: false, reason, stages, ctx, info });

    const st = states[S.label];
    if (!st || !st.bias) return fail(`${S.label}_BIAS_FAILED`);
    if (!st.atr) return fail('ATR_FAILED');
    const biasStruct = st.bias, atrStruct = st.atr;
    const structBars = st.window;

    // ── VOTE ─────────────────────────────────────────────────────────
    const votes = plan.entries.map(e => ({ tf: e.label, result: states[e.label] ? states[e.label].bias : null }));
    const resolved = plan.groups
      ? core.resolveGroupDirection(votes, plan.groups.list, plan.groups.noOppose)
      : core.resolveDirection(votes, config.MIN_TF_AGREE);
    ctx.votes = votes; ctx.resolved = resolved;
    const noAgreeReason = plan.groups ? 'GROUPS_NOT_ALIGNED' : `NO_${config.MIN_TF_AGREE}OF${plan.entries.length}_AGREEMENT`;
    log(`  📡 VOTE: ${votes.map(v => `${v.tf}=${v.result ? v.result.bias : 'N/A'}`).join(' | ')}` +
      (resolved ? ` → ${resolved.direction} (${resolved.tally}: ${resolved.agreeing.join('+')})`
        : plan.groups ? ' → GROUPS NOT ALIGNED (need trigger + structure + bias)' : ` → NO ${config.MIN_TF_AGREE}-OF-${plan.entries.length} AGREEMENT`));
    if (!resolved) return fail(noAgreeReason);
    stages.push('voteOk');
    const direction = resolved.direction;
    ctx.direction = direction;

    const swingStruct = biasStruct.swing;
    const price = st.last.close;
    const barTime = st.last.time;
    ctx.price = price; ctx.barTime = barTime;

    // ── VOLATILITY REGIME ─────────────────────────────────────────────
    if (config.VOLATILITY_REGIME_ENABLED) {
      const atrPctl = core.calcATRPercentile(st.atrSeries, config.VOLATILITY_LOOKBACK_BARS);
      if (atrPctl !== null && (atrPctl < config.VOLATILITY_MIN_PCTL || atrPctl > config.VOLATILITY_MAX_PCTL)) {
        log(`  ⏭️ VOLATILITY REGIME: ATR at ${atrPctl.toFixed(1)}th percentile (need ${config.VOLATILITY_MIN_PCTL}-${config.VOLATILITY_MAX_PCTL}). Skipping.`);
        return fail('VOLATILITY_REGIME_GATED', { atrPctl: parseFloat(atrPctl.toFixed(1)) });
      }
    }
    stages.push('volatilityOk');

    // ── STRUCTURAL REMAP ──────────────────────────────────────────────
    if (price > swingStruct.high || price < swingStruct.low) {
      log(`  🔄 STRUCTURAL REMAP: price broke the ${S.label} swing. Zones void, recalculating next scan.`);
      return fail('REMAP', { swingHigh: swingStruct.high, swingLow: swingStruct.low });
    }
    stages.push('structureOk');

    const fib = core.calcFib(swingStruct.high, swingStruct.low, direction, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH);

    if ((direction === 'BUY' && price < fib.level886) || (direction === 'SELL' && price > fib.level886)) {
      log('  ⏭️ OVER-EXTENDED: price beyond 88.6% structural extreme.');
      return fail('OVER_EXTENDED');
    }
    stages.push('notOverExtended');

    const structCandle = st.last;
    const nearZonePass = config.NEAR_ZONE_USE_WICK
      ? core.isNearZoneWick(structCandle.high, structCandle.low, fib, atrStruct, config.NEAR_ZONE_ATR_MULT)
      : core.isNearZone(price, fib, atrStruct, config.NEAR_ZONE_ATR_MULT);
    if (!nearZonePass) {
      log(`  ⏳ Price not near ${S.label} zone ($${fib.zoneLow.toFixed(4)}–$${fib.zoneHigh.toFixed(4)}). Waiting.`);
      return fail('NOT_NEAR_ZONE', { zoneLow: fib.zoneLow, zoneHigh: fib.zoneHigh });
    }
    stages.push('nearZone');

    const vpStruct = biasStruct.vp;
    ctx.reachedZone = true; ctx.vpStruct = vpStruct; ctx.swingStruct = swingStruct; ctx.atrStruct = atrStruct;
    log(`  📊 ${S.label} POC $${vpStruct.pocPrice.toFixed(4)} | VAH $${vpStruct.vahPrice.toFixed(4)} | VAL $${vpStruct.valPrice.toFixed(4)}`);

    // ── CONFLUENCE (Fib × POC/VAH/VAL/VWAP on the structure TF) ───────
    const fibMid = (fib.zoneHigh + fib.zoneLow) / 2;
    const checkLevels = [fib.level618, fib.level786, fibMid];
    const checkPivots = [
      { name: 'POC', price: vpStruct.pocPrice },
      { name: 'VAH', price: vpStruct.vahPrice },
      { name: 'VAL', price: vpStruct.valPrice },
    ];
    if (config.VWAP_CONFLUENCE_ENABLED) {
      const vwapAnchor = core.calcAnchoredVWAP(structBars.slice(-config.STRUCT_FIB_LOOKBACK), direction);
      if (vwapAnchor != null) checkPivots.push({ name: 'VWAP', price: vwapAnchor });
    }
    // v1.3.1 TIE-BREAK FIX: the 61.8% / mid-pocket exclusions used to run AFTER the best level was
    // picked (first-best wins, 61.8% is checked first), so a setup whose 61.8% scored the same as a
    // perfectly good 78.6% was thrown away although an eligible level existed. Excluded levels are now
    // removed BEFORE scoring, so the best ELIGIBLE level wins; a setup is rejected for an exclusion only
    // when no eligible level has confluence. OFF by default until the real-data sweep proves it (GWP_FIB_PREFILTER=true).
    const prefilter = config.FIB_EXCLUDE_BEFORE_SCORING === true;
    const excludedLevel = (lvl) => (lvl === fibMid && config.MID_POCKET_EXCLUDE) || (lvl === fib.level618 && config.FIB_618_EXCLUDE);
    const scoreLevels = (levels) => {
      let bs = 0, bl = null, bp = null;
      for (const lvl of levels) for (const pivot of checkPivots) {
        const sc = core.confluenceScore(lvl, pivot.price, atrStruct, config.CONFLUENCE_ATR_MULT);
        if (sc > bs) { bs = sc; bl = lvl; bp = pivot; }
      }
      return { bs, bl, bp };
    };
    let { bs: bestScore, bl: bestFibLevel, bp: bestPivot } = scoreLevels(prefilter ? checkLevels.filter(l => !excludedLevel(l)) : checkLevels);
    if (prefilter && bestScore < 1) {
      const ex = scoreLevels(checkLevels.filter(excludedLevel));
      if (ex.bs >= 1) {
        const mid = ex.bl === fibMid;
        log(mid ? '  ⚠️ Only the mid-pocket Fib has confluence — historically the weakest Fib segment. Skipping.'
                : '  ⚠️ Only the 61.8% Fib pocket has confluence — historically the weaker Fib segment on GWP\'s own data. Skipping.');
        return fail(mid ? 'MID_POCKET_EXCLUDED' : 'FIB_618_EXCLUDED');
      }
    }
    if (bestScore < 1) {
      log('  ❌ No Fib/POC/VAH/VAL confluence at current price. Waiting.');
      return fail('NO_CONFLUENCE');
    }
    if (bestPivot.name === 'POC' && bestScore < config.MIN_CONFLUENCE_POC) {
      log(`  ⚠️ POC confluence too loose (score ${bestScore}, need ${config.MIN_CONFLUENCE_POC}). Skipping.`);
      return fail('POC_CONFLUENCE_TOO_LOOSE');
    }
    if (bestPivot.name === 'POC' && config.POC_REQUIRE_STRUCT_CONFIRM && !resolved.agreeing.includes(S.label)) {
      log(`  ⚠️ POC pivot without ${S.label} confirmation — historically the weakest segment. Skipping.`);
      return fail('POC_NO2H_GATED');
    }
    const prominence = core.computePOCProminence(vpStruct);
    if (!core.isPOCProminenceTrusted(bestPivot.name, prominence, config)) {
      log(`  ⚠️ POC contested (prominence ratio ${prominence.prominenceRatio.toFixed(2)} < ${config.POC_PROMINENCE_MIN_RATIO}) — historically the weaker POC segment. Skipping.`);
      return fail('POC_PROMINENCE_GATED');
    }
    const fibPct = fmtFib(bestFibLevel, fib, fibMid);
    if (bestFibLevel === fibMid && config.MID_POCKET_EXCLUDE) {
      log('  ⚠️ Mid-pocket Fib (neither 61.8% nor 78.6%) — historically the weakest Fib segment. Skipping.');
      return fail('MID_POCKET_EXCLUDED');
    }
    if (bestFibLevel === fib.level618 && config.FIB_618_EXCLUDE) {
      log('  ⚠️ 61.8% Fib pocket — historically the weaker Fib segment on GWP\'s own data. Skipping.');
      return fail('FIB_618_EXCLUDED');
    }
    stages.push('prominenceOk', 'confluenceOk');
    log(`  ✅ CONFLUENCE (score ${bestScore}): Fib ${fibPct} ($${bestFibLevel.toFixed(4)}) ↔ ${bestPivot.name} ($${bestPivot.price.toFixed(4)})`);

    // ── HTF ZONE CROSS-CHECK ──────────────────────────────────────────
    const hz = plan.htfzone ? states[plan.htfzone.label] : null;
    const htfCheck = core.checkHTFZoneAlignment(bestFibLevel, hz ? hz.bias : null, atrStruct, direction, config.HTFZONE_ATR_MULT, plan.htfzone ? plan.htfzone.label : '2H');
    const hzLabel = plan.htfzone ? plan.htfzone.label : 'HTF';
    if (!htfCheck.aligned) {
      log(`  ⛔ ${hzLabel} ZONE MISMATCH: nearest ${htfCheck.nearestLevel} dist $${htfCheck.distance.toFixed(4)}. Waiting.`);
      return fail('CROSS_TF_30M_ZONE_MISMATCH');
    }
    stages.push('htf2hAligned');
    log(`  ✅ ${hzLabel} ZONE ALIGNED: near ${htfCheck.nearestLevel} ($${(htfCheck.nearestPrice || 0).toFixed(4)})`);

    // ── DUAL MULTI-TF GATE ────────────────────────────────────────────
    const gateTFs = plan.gate.map(e => ({ label: e.label, st: states[e.label] || {} }));
    const multiTFPOC = core.computeMultiTFPOCAlignment(
      vpStruct.pocPrice,
      gateTFs.map(g => ({ label: g.label, poc: g.st.bias?.poc, atr: g.st.atr })),
      config.MULTI_TF_POC_TOLERANCE_ATR
    );
    const multiTFFib = core.computeMultiTFFibAlignment(
      bestFibLevel, direction,
      gateTFs.map(g => ({ label: g.label, swing: g.st.bias?.swing, atr: g.st.atr })),
      config.MULTI_TF_FIB_TOLERANCE_ATR, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH
    );
    if (config.DUAL_MULTI_TF_GATE_ENABLED && plan.gate.length) {
      const pocFull = multiTFPOC.alignedLabels.length >= plan.gateMinPoc;
      const fibFull = multiTFFib.alignedLabels.length >= plan.gateMinFib;
      if (!pocFull || !fibFull) {
        log(`  ⏳ DUAL MULTI-TF GATE: POC aligned=[${multiTFPOC.alignedLabels.join(',')}] Fib aligned=[${multiTFFib.alignedLabels.join(',')}] — need ${plan.gateMinPoc}/${plan.gate.length} (POC) and ${plan.gateMinFib}/${plan.gate.length} (Fib) of ${plan.gate.map(g => g.label).join('+')}. Waiting.`);
        return fail('DUAL_MULTI_TF_GATE_FAILED', { pocAligned: multiTFPOC.alignedLabels, fibAligned: multiTFFib.alignedLabels });
      }
      log(`  ✅ DUAL MULTI-TF GATE PASSED: POC [${multiTFPOC.alignedLabels.join('+')}] Fib [${multiTFFib.alignedLabels.join('+')}].`);
    }
    stages.push('dualMultiTFOk');

    // ── ZONE INVALIDATION ─────────────────────────────────────────────
    if (core.isZoneInvalidated(price, bestFibLevel, atrStruct, direction, config.ZONE_INVALIDATION_ATR_MULT)) {
      log(`  ❌ ZONE INVALIDATED: ${S.label} close beyond zone by > ATR×${config.ZONE_INVALIDATION_ATR_MULT}.`);
      return fail('ZONE_INVALIDATED');
    }
    stages.push('notInvalidated');

    // ── COOLDOWN ──────────────────────────────────────────────────────
    if (cooldownBlocked(direction)) {
      log(`  ⏸️ COOLDOWN: ${direction} suppressed (< ${config.SIGNAL_COOLDOWN_BARS} ${S.label} bars since last).`);
      return fail('SIGNAL_COOLDOWN');
    }
    stages.push('cooldownOk');

    // ── TRIGGER (rejection candle on the TRIGGER timeframe) ───────────
    const entryZoneLow  = fib.zoneLow  - atrStruct * 0.1;
    const entryZoneHigh = fib.zoneHigh + atrStruct * 0.1;
    const rejection = core.detectRejection(
      trigBars, entryZoneLow, entryZoneHigh, direction,
      { poc: vpStruct.pocPrice, vah: vpStruct.vahPrice, val: vpStruct.valPrice },
      config.ABSORPTION_BODY_RATIO, config.REJECTION_MIN_PATTERNS, config.ALLOW_SOLO_TRIGGER,
      config.SOLO_ELIGIBLE_PATTERNS, plan.triggerLookbackBars,
      config.LIQUIDITY_SWEEP_ENABLED, plan.sweepLookbackBars
    );
    ctx.rejection = rejection; ctx.patterns = rejection.patterns;
    ctx.confluenceScore = bestScore; ctx.confluenceLevel = fibPct; ctx.confluencePivot = bestPivot.name;
    ctx.htfAligned = htfCheck.aligned;
    if (!rejection.valid) {
      if (rejection.absorptionVeto) log('  ⏳ ABSORPTION VETO: opposing institutional candle at zone. Skip.');
      else log(`  ⏳ WEAK TRIGGER: ${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns on ${T.label}. Waiting.`);
      return fail(rejection.absorptionVeto ? 'ABSORPTION_VETO' : `PATTERNS_${rejection.score}_OF_${config.REJECTION_MIN_PATTERNS}`, {});
    }
    stages.push('triggerOk');

    // ── M15 ENTRY-TIMING CONFIRMATION (H6 role, optional) ─────────────
    const lastClock = clockBars[clockBars.length - 1];
    if (plan.timing) {
      const ok = lastClock && (direction === 'BUY' ? lastClock.close > lastClock.open : lastClock.close < lastClock.open);
      if (!ok) {
        log(`  ⏳ ${plan.timing.label} TIMING: last closed ${plan.timing.label} candle does not close in the ${direction} direction. Waiting.`);
        return fail('M15_TIMING_FAILED');
      }
      stages.push('timingOk');
    }

    // ── ENTRY DRIFT / STALENESS GUARD ─────────────────────────────────
    const freshPrice = lastClock.close;
    if (core.isZoneInvalidated(freshPrice, bestFibLevel, atrStruct, direction, config.ENTRY_DRIFT_MAX_ATR)) {
      log(`  ⏭️ ENTRY DRIFT: freshest ${plan.clock.label} price ($${freshPrice.toFixed(4)}) already past entry ($${bestFibLevel.toFixed(4)}) by > ATR×${config.ENTRY_DRIFT_MAX_ATR}. Suppressed as stale.`);
      return fail('ENTRY_DRIFT_INVALIDATED', { freshPrice, entryLevel: bestFibLevel });
    }
    stages.push('driftOk');

    // ── SL / TP ───────────────────────────────────────────────────────
    const slAtrMult = config.SL_ATR_MULT_MATRIX_ENABLED && config.SL_ATR_MULT_MATRIX[bestPivot.name] != null
      ? config.SL_ATR_MULT_MATRIX[bestPivot.name]
      : config.SL_ATR_MULT;
    const levels = core.computeTradeLevels({
      direction, entryPrice: bestFibLevel, swing: swingStruct, atr: atrStruct, vp: vpStruct,
      slAtrMult, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
      tp2MinExtensionRR: config.TP2_MIN_EXTENSION_RR,
    });
    if (!levels) {
      log(`  ⏭️ Invalid TP structure (TP2 doesn't extend ≥${config.TP2_MIN_EXTENSION_RR}R beyond TP1). Suppressed.`);
      return fail('TP2_EXTENSION_TOO_SHORT');
    }
    stages.push('tp2RangeOk');

    const td9 = config.TD9_ENABLED ? core.computeTDSequential(structBars) : { buy9: false, sell9: false };
    const td9Confirms = (direction === 'BUY' && td9.buy9) || (direction === 'SELL' && td9.sell9);
    const migration = core.computePOCMigration(
      st.pocWide, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
      config.POC_MIGRATION_OFFSET_BARS, atrStruct, config.POC_MIGRATION_MIN_ATR
    );
    const nakedPOC = core.computeNakedPOC(
      st.pocWide, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
      atrStruct, vpStruct.pocPrice, config.NAKED_POC_TOLERANCE_ATR
    );

    return {
      pass: true, reason: 'SIGNAL_FIRED', stages, ctx,
      signal: {
        direction, resolved, price, barTime, structCandle,
        fib, fibMid, fibPct, vpStruct, swingStruct, atrStruct,
        bestScore, bestFibLevel, bestPivot, prominence, htfCheck,
        multiTFPOC, multiTFFib, rejection, entryZoneLow, entryZoneHigh,
        freshPrice, lastClock, slAtrMult, levels, td9, td9Confirms, migration, nakedPOC,
      },
    };
  };

  return { evaluate, tfState };
};

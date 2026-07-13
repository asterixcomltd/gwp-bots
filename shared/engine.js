/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED STRATEGY ENGINE (shared/engine.js)  v1.0.0
 *
 *  This is a faithful, line-for-line port of MVS-bot's strategy.js
 *  runStrategy() pipeline (v10.15.5), generalized into a factory so all
 *  three GWP sub-bots (Crypto / Forex / Stocks) run the EXACT same
 *  pipeline against their own config + data source. Every gate, in the
 *  same order, with the same reasoning MVS-bot's own comments document.
 *
 *  THE ONLY STRUCTURAL CHANGE FROM MVS: three timeframes instead of five,
 *  each with ONE job (per explicit design — "each timeframe playing its
 *  personal role"):
 *    2H  (BIAS_TIMEFRAME)    → BIAS ONLY   — macro POC/VAH/VAL/Fib50 vote
 *    30M (STRUCT_TIMEFRAME)  → STRUCTURE ONLY — swing, Fib golden pocket,
 *                               POC/VAH/VAL zone, ATR, SL anchor
 *    15M (TRIGGER_TIMEFRAME) → ENTRY ONLY  — the actual rejection candle
 *  Direction requires MIN_TF_AGREE (2) of these 3 to agree — see
 *  core.js resolveDirection(). This mirrors MVS-bot's OWN documented
 *  v10.0 architecture (4H bias / 1H structure / 15m trigger, 2-of-3 vote)
 *  before MVS was later expanded to 5 timeframes — GWP keeps that
 *  simpler, original design, just one rung down the clock (2H replaces
 *  4H, 30M replaces 1H). 15M is unchanged in both systems.
 *
 *  Every other gate below — near-zone, confluence, POC-quality factors,
 *  TD Sequential, risk tiering, TP1/TP2 structure, cooldown, structural
 *  remap, absorption veto — is IDENTICAL in mechanics to MVS, just fed by
 *  30M data where MVS fed 1H data, and by 2H where MVS fed 4H data.
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');

module.exports = function createEngine({ config, core, dataClient, telegram, persistence, botLabel, version }) {
  const { getKlines } = dataClient;
  const { mdSafe, sendSafe } = telegram;
  const {
    loadJSON, saveState, saveOpenPosition, logSignal, logDiag,
    queuePendingAlert, isCoolingDown, PENDING_FILE, OPEN_POSITIONS_FILE,
  } = persistence;

  // ── Pending-alert redelivery (v10.10 mechanism, unchanged from MVS) ────
  const flushPendingAlerts = async () => {
    const pending = loadJSON(PENDING_FILE, []);
    if (!pending.length) return;
    console.log(`\n📬 ${pending.length} undelivered alert(s) from a previous run — retrying delivery first...`);
    const stillPending = [];
    for (const item of pending) {
      const result = await sendSafe(config.TELEGRAM_CHAT_ID, item.message, { parse_mode: 'Markdown' });
      if (result.success) {
        console.log(`  ✅ Redelivered queued alert for ${item.symbol} (originally queued ${item.queuedAt}).`);
      } else {
        console.error(`  ❌ Still undelivered: ${item.symbol} (queued ${item.queuedAt}). Will retry again next run.`);
        stillPending.push(item);
      }
    }
    fs.writeFileSync(PENDING_FILE, JSON.stringify(stillPending, null, 2));
  };

  // ─────────────────────────────────────────────────────────────────────
  //  MAIN STRATEGY ENGINE
  // ─────────────────────────────────────────────────────────────────────
  const runStrategy = async (symbol) => {
    const now = new Date().toISOString();
    console.log(`\n[${now}] 🔍 ${botLabel} v${version} scanning ${symbol}...`);
    persistence.touchLastRun();

    try {
      // ── STEP 1: FETCH ALL THREE TIMEFRAMES ──────────────────────────
      // POC_MIGRATION and NAKED_POC both need more 30M structure history
      // than the bot normally fetches — but ONLY when those experimental
      // flags are actually on, so there's zero extra API load otherwise
      // (identical reasoning to MVS's 1H fetch-size scaling).
      let structLimit = config.STRUCT_VP_LOOKBACK;
      if (config.NAKED_POC_ENABLED) structLimit = Math.max(structLimit, config.STRUCT_VP_LOOKBACK * 2);
      if (config.POC_MIGRATION_ENABLED) structLimit = Math.max(structLimit, config.STRUCT_VP_LOOKBACK + config.POC_MIGRATION_OFFSET_BARS);

      const [data2h, data30m, data15m] = await Promise.all([
        getKlines(symbol, config.BIAS_TIMEFRAME,    config.BIAS_VP_LOOKBACK),
        getKlines(symbol, config.STRUCT_TIMEFRAME,  structLimit),
        getKlines(symbol, config.TRIGGER_TIMEFRAME, config.TRIGGER_VP_LOOKBACK),
      ]);

      if (data30m.length < 50) {
        console.log(`  ⚠️ Insufficient 30M data (${data30m.length} bars). Skipping.`);
        logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_30M_DATA', bars: data30m.length });
        return;
      }
      if (data15m.length < 50) {
        console.log(`  ⚠️ Insufficient 15M data (${data15m.length} bars). Skipping.`);
        logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_15M_DATA', bars: data15m.length });
        return;
      }

      // ── STEP 2: THREE-TIMEFRAME BIAS VOTE (2-of-3) ──────────────────
      // 2H is treated as optional (null if not enough history yet) —
      // a short symbol listing shouldn't crash the scan, it just has one
      // fewer possible agreeing vote that scan.
      const bias2h = data2h.length >= 50
        ? core.tfBiasVote(data2h, config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT)
        : null;
      const biasStruct = core.tfBiasVote(data30m, config.STRUCT_VP_LOOKBACK, config.STRUCT_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);
      const bias15m = core.tfBiasVote(data15m, config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK, config.VP_ROWS, config.VALUE_AREA_PCT);

      if (!biasStruct) {
        console.log(`  ⚠️ 30M bias vote failed (volume profile). Skipping.`);
        logDiag({ symbol, fired: false, reason: '30M_BIAS_FAILED' });
        return;
      }

      const resolved = core.resolveDirection([
        { tf: '2H',  result: bias2h },
        { tf: '30M', result: biasStruct },
        { tf: '15M', result: bias15m },
      ], config.MIN_TF_AGREE);

      console.log(
        `  📡 VOTE: 2H=${bias2h ? bias2h.bias : 'N/A'} | 30M=${biasStruct.bias} | 15M=${bias15m ? bias15m.bias : 'N/A'}` +
        (resolved ? ` → ${resolved.direction} (${resolved.tally}: ${resolved.agreeing.join('+')})` : ` → NO ${config.MIN_TF_AGREE}-OF-3 AGREEMENT`)
      );

      if (!resolved) {
        logDiag({
          symbol, bias2h: bias2h?.bias, bias30m: biasStruct.bias, bias15m: bias15m?.bias,
          fired: false, reason: `NO_${config.MIN_TF_AGREE}OF3_AGREEMENT`,
        });
        // Every scan updates state.json with the current bias breakdown
        // even when no signal direction is decided, so /status is never
        // more than one scan stale.
        saveState(symbol, {
          signal: 'NO_AGREEMENT', direction: null, price: data30m[data30m.length - 1]?.close,
          bias2h: bias2h?.bias, bias30m: biasStruct.bias, bias15m: bias15m?.bias,
        });
        return;
      }

      const direction = resolved.direction;

      // ── STEP 3: 30M STRUCTURE — SWING / FIB POCKET ──────────────────
      const swingStruct = biasStruct.swing;
      const price   = data30m[data30m.length - 1].close;
      const barTime = data30m[data30m.length - 1].time;

      const atrStruct = core.calcATR(data30m, config.ATR_PERIOD);
      if (!atrStruct) {
        console.log(`  ⚠️ 30M ATR calculation failed. Skipping.`);
        logDiag({ symbol, fired: false, reason: 'ATR_FAILED' });
        return;
      }

      if (config.VOLATILITY_REGIME_ENABLED) {
        const atrSeriesStruct = core.calcATRSeries(data30m, config.ATR_PERIOD);
        const atrPctl = core.calcATRPercentile(atrSeriesStruct, config.VOLATILITY_LOOKBACK_BARS);
        if (atrPctl !== null && (atrPctl < config.VOLATILITY_MIN_PCTL || atrPctl > config.VOLATILITY_MAX_PCTL)) {
          console.log(`  ⏭️ VOLATILITY REGIME: ATR at ${atrPctl.toFixed(1)}th percentile (need ${config.VOLATILITY_MIN_PCTL}-${config.VOLATILITY_MAX_PCTL}). Skipping.`);
          logDiag({ symbol, barTime, price, fired: false, reason: 'VOLATILITY_REGIME_GATED', atrPctl: parseFloat(atrPctl.toFixed(1)) });
          return;
        }
      }

      // Structural remap — price broke the 30M swing entirely
      if (price > swingStruct.high || price < swingStruct.low) {
        console.log(`  🔄 STRUCTURAL REMAP: ${symbol} broke 30M swing. Zones void, recalculating next scan.`);
        saveState(symbol, { signal: 'REMAP', price, swingHigh: swingStruct.high, swingLow: swingStruct.low });
        logSignal(symbol, { signal: 'REMAP', price });
        return;
      }

      const fib = core.calcFib(swingStruct.high, swingStruct.low, direction, config.FIB_ZONE_LOW, config.FIB_ZONE_HIGH);

      // Over-extension: beyond 88.6% = structural extreme, swing likely invalid
      const overExtended = (direction === 'BUY' && price < fib.level886) || (direction === 'SELL' && price > fib.level886);
      if (overExtended) {
        console.log(`  ⏭️ OVER-EXTENDED: price beyond 88.6% structural extreme.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'OVER_EXTENDED' });
        return;
      }

      // Early zone-proximity skip — shared gate (core.isNearZone)
      if (!core.isNearZone(price, fib, atrStruct, config.NEAR_ZONE_ATR_MULT)) {
        console.log(`  ⏳ Price not near 30M zone ($${fib.zoneLow.toFixed(4)}–$${fib.zoneHigh.toFixed(4)}). Waiting.`);
        return;
      }

      const vpStruct = biasStruct.vp;
      console.log(`  📊 30M POC $${vpStruct.pocPrice.toFixed(4)} | VAH $${vpStruct.vahPrice.toFixed(4)} | VAL $${vpStruct.valPrice.toFixed(4)}`);

      saveState(symbol, {
        signal: 'SCANNED', price, direction,
        voteTally: resolved.tally, agreeing: resolved.agreeing,
        bias2h: bias2h?.bias, bias30m: biasStruct.bias, bias15m: bias15m?.bias,
        poc: vpStruct.pocPrice, vah: vpStruct.vahPrice, val: vpStruct.valPrice,
        swingHigh: swingStruct.high, swingLow: swingStruct.low, atrStruct,
      });

      // ── STEP 4: CONFLUENCE CHECK (Fib × POC/VAH/VAL on 30M) ─────────
      const fibMid = (fib.zoneHigh + fib.zoneLow) / 2;
      const checkLevels = [fib.level618, fib.level786, fibMid];
      const checkPivots = [
        { name: 'POC', price: vpStruct.pocPrice },
        { name: 'VAH', price: vpStruct.vahPrice },
        { name: 'VAL', price: vpStruct.valPrice },
      ];

      let bestScore = 0, bestFibLevel = null, bestPivot = null;
      for (const lvl of checkLevels) {
        for (const pivot of checkPivots) {
          const sc = core.confluenceScore(lvl, pivot.price, atrStruct, config.CONFLUENCE_ATR_MULT);
          if (sc > bestScore) { bestScore = sc; bestFibLevel = lvl; bestPivot = pivot; }
        }
      }

      if (bestScore < 1) {
        console.log(`  ❌ No Fib/POC/VAH/VAL confluence at current price. Waiting.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'NO_CONFLUENCE' });
        return;
      }
      if (bestPivot.name === 'POC' && bestScore < config.MIN_CONFLUENCE_POC) {
        console.log(`  ⚠️ POC confluence too loose (score ${bestScore}, need ${config.MIN_CONFLUENCE_POC}). Skipping.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'POC_CONFLUENCE_TOO_LOOSE' });
        return;
      }

      // POC pivot without 30M (structure TF) in the agreeing vote is the
      // confirmed weak segment (ported directly from MVS's identical
      // POC/1H-confirm finding) — gated out entirely, not just downsized.
      if (bestPivot.name === 'POC' && config.POC_REQUIRE_STRUCT_CONFIRM && !resolved.agreeing.includes('30M')) {
        console.log(`  ⚠️ POC pivot without 30M confirmation — historically the weakest segment. Skipping.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'POC_NO30M_GATED' });
        return;
      }

      const prominence = core.computePOCProminence(vpStruct);
      if (!core.isPOCProminenceTrusted(bestPivot.name, prominence, config)) {
        console.log(`  ⚠️ POC contested (prominence ratio ${prominence.prominenceRatio.toFixed(2)} < ${config.POC_PROMINENCE_MIN_RATIO}) — historically the weaker POC segment. Skipping.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'POC_PROMINENCE_GATED' });
        return;
      }

      const fibPct = bestFibLevel === fib.level618 ? '61.8%' : bestFibLevel === fib.level786 ? '78.6%' : '70% mid-pocket';
      console.log(`  ✅ CONFLUENCE (score ${bestScore}): Fib ${fibPct} ($${bestFibLevel.toFixed(4)}) ↔ ${bestPivot.name} ($${bestPivot.price.toFixed(4)})`);

      // ── STEP 5: 2H ZONE CROSS-CHECK ──────────────────────────────────
      const htfCheck = core.checkHTFZoneAlignment(bestFibLevel, bias2h, atrStruct, direction, config.HTFZONE_ATR_MULT);
      if (!htfCheck.aligned) {
        console.log(`  ⛔ 2H ZONE MISMATCH: nearest ${htfCheck.nearestLevel} dist $${htfCheck.distance.toFixed(4)}. Waiting.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'HTF_2H_ZONE_MISMATCH' });
        return;
      }
      console.log(`  ✅ 2H ZONE ALIGNED: near ${htfCheck.nearestLevel} ($${(htfCheck.nearestPrice || 0).toFixed(4)})`);

      // ── STEP 6: ZONE INVALIDATION ─────────────────────────────────────
      if (core.isZoneInvalidated(price, bestFibLevel, atrStruct, direction, config.ZONE_INVALIDATION_ATR_MULT)) {
        console.log(`  ❌ ZONE INVALIDATED: 30M close beyond zone by > ATR×${config.ZONE_INVALIDATION_ATR_MULT}.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'ZONE_INVALIDATED' });
        return;
      }

      // ── STEP 7: SIGNAL COOLDOWN ───────────────────────────────────────
      if (isCoolingDown(config, symbol, direction, barTime)) {
        console.log(`  ⏸️ COOLDOWN: ${direction} suppressed (< ${config.SIGNAL_COOLDOWN_BARS} 30M bars since last).`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'SIGNAL_COOLDOWN' });
        return;
      }

      // ── STEP 8: 15M TRIGGER CANDLE ────────────────────────────────────
      // The 30M structure defines WHERE the zone is. The 15M candle
      // decides WHEN to actually fire — tighter timing than waiting a
      // full 30M close.
      const entryZoneLow  = fib.zoneLow  - atrStruct * 0.1;
      const entryZoneHigh = fib.zoneHigh + atrStruct * 0.1;

      const rejection = core.detectRejection(
        data15m, entryZoneLow, entryZoneHigh, direction,
        { poc: vpStruct.pocPrice, vah: vpStruct.vahPrice, val: vpStruct.valPrice },
        config.ABSORPTION_BODY_RATIO, config.REJECTION_MIN_PATTERNS, config.ALLOW_SOLO_TRIGGER,
        config.SOLO_ELIGIBLE_PATTERNS
      );

      logDiag({
        symbol, barTime, price,
        bias2h: bias2h?.bias, bias30m: biasStruct.bias, bias15m: bias15m?.bias,
        voteTally: resolved.tally, agreeing: resolved.agreeing,
        htf2hAligned: htfCheck.aligned, confluenceScore: bestScore, confluenceLevel: fibPct, confluencePivot: bestPivot.name,
        patterns: rejection.patterns, absorptionVeto: rejection.absorptionVeto,
        fired: rejection.valid,
        reason: rejection.valid ? 'SIGNAL_FIRED' : rejection.absorptionVeto ? 'ABSORPTION_VETO' : `PATTERNS_${rejection.score}_OF_${config.REJECTION_MIN_PATTERNS}`,
      });

      if (!rejection.valid) {
        if (rejection.absorptionVeto) {
          console.log(`  ⏳ ABSORPTION VETO: opposing institutional candle at zone. Skip.`);
        } else {
          console.log(`  ⏳ WEAK TRIGGER: ${rejection.score}/${config.REJECTION_MIN_PATTERNS} patterns on 15M. Waiting.`);
        }
        return;
      }

      // ── STEP 9: SL / TP CALCULATION ───────────────────────────────────
      const slAtrMult = config.SL_ATR_MULT_MATRIX_ENABLED && config.SL_ATR_MULT_MATRIX[bestPivot.name] != null
        ? config.SL_ATR_MULT_MATRIX[bestPivot.name]
        : config.SL_ATR_MULT;
      const levels = core.computeTradeLevels({
        direction, entryPrice: bestFibLevel, swing: swingStruct, atr: atrStruct, vp: vpStruct,
        slAtrMult, tp1RrFloor: config.TP1_RR_FLOOR, fibLevel500: fib.level500,
        tp2MinExtensionRR: config.TP2_MIN_EXTENSION_RR,
      });
      if (!levels) {
        console.log(`  ⏭️ Invalid TP structure (TP2 doesn't extend ≥${config.TP2_MIN_EXTENSION_RR}R beyond TP1). Suppressed.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'TP2_EXTENSION_TOO_SHORT' });
        return;
      }

      // ── STEP 10: TELEGRAM ALERT ────────────────────────────────────────
      const emoji = direction === 'BUY' ? '🟢' : '🔴';
      const patternStr = rejection.patterns.map(mdSafe).join(' + ');
      const voteLine = `🗳️ *TF Vote (${resolved.tally}):* ${resolved.agreeing.join(' + ')} agree ${direction === 'BUY' ? 'BULLISH' : 'BEARISH'}` +
        (bias2h ? ` | 2H:${bias2h.bias}` : '') + ` 30M:${biasStruct.bias}` + (bias15m ? ` 15M:${bias15m.bias}` : '');

      const td9 = config.TD9_ENABLED ? core.computeTDSequential(data30m) : { buy9: false, sell9: false };
      const td9Confirms = (direction === 'BUY' && td9.buy9) || (direction === 'SELL' && td9.sell9);

      const migration = core.computePOCMigration(
        data30m, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
        config.POC_MIGRATION_OFFSET_BARS, atrStruct, config.POC_MIGRATION_MIN_ATR
      );
      const nakedPOC = core.computeNakedPOC(
        data30m, config.STRUCT_VP_LOOKBACK, config.VP_ROWS,
        atrStruct, vpStruct.pocPrice, config.NAKED_POC_TOLERANCE_ATR
      );
      const multiTFPOC = core.computeMultiTFPOCAlignment(
        vpStruct.pocPrice, bias2h?.poc, atrStruct, config.MULTI_TF_POC_TOLERANCE_ATR
      );

      let riskMult = core.computeRiskMultiplier(
        bestPivot.name, resolved.agreeing, rejection.patterns,
        config.RISK_TIER_MATRIX, config.PATTERN_RISK_MATRIX, config.RISK_TIER_DEFAULT,
        td9Confirms, config.TD9_BOOST_MULT,
        slAtrMult, config.SL_ATR_MULT, '30M'
      );
      riskMult *= core.computePOCQualityMultiplier(bestPivot.name, direction, prominence, migration, nakedPOC, multiTFPOC, config);
      riskMult *= core.computeVoteStrengthMultiplier(resolved.agreeing.length, config);
      riskMult = Math.max(0.1, Math.min(1.0, riskMult));

      const slWidened = slAtrMult !== config.SL_ATR_MULT;
      const weakReasons = [];
      if (!resolved.agreeing.includes('30M')) weakReasons.push('30M not in the confirming vote');
      if (rejection.patterns.includes('POC_RECLAIM')) weakReasons.push('POC RECLAIM pattern');
      const td9Suffix = td9Confirms ? ' | TD9 exhaustion confirms +boost' : '';
      const slWidenSuffix = slWidened ? ` | SL widened ${config.SL_ATR_MULT}→${slAtrMult}×ATR (EXPERIMENTAL, size cut to hold $ risk flat)` : '';

      const pocQualityNotes = [];
      if (config.POC_PROMINENCE_ENABLED && prominence.computed && prominence.prominenceRatio < config.POC_PROMINENCE_MIN_RATIO) {
        pocQualityNotes.push(`contested POC (ratio ${prominence.prominenceRatio.toFixed(2)} < ${config.POC_PROMINENCE_MIN_RATIO})`);
      }
      if (config.POC_MIGRATION_ENABLED && migration.migrating) {
        const confirms = (direction === 'BUY' && migration.direction === 'UP') || (direction === 'SELL' && migration.direction === 'DOWN');
        pocQualityNotes.push(`POC migrating ${migration.direction} (${confirms ? 'confirms' : 'against'} direction)`);
      }
      if (config.NAKED_POC_ENABLED && nakedPOC.aligned) {
        pocQualityNotes.push(`aligned with naked prior POC @ $${nakedPOC.priorPOC.toFixed(4)}`);
      }
      if (config.MULTI_TF_POC_ENABLED && multiTFPOC.anyAligned) {
        pocQualityNotes.push(`POC aligned with 2H`);
      }
      const pocQualitySuffix = pocQualityNotes.length ? ` | ${pocQualityNotes.join(', ')}` : '';
      const sizeLine = riskMult < 1
        ? `⚖️ *Suggested size:* ${Math.round(riskMult * 100)}% of normal (${bestPivot.name} pivot${weakReasons.length ? ', ' + weakReasons.join(' + ') + ' — historically weaker segment, see README' : ''}${td9Suffix}${slWidenSuffix}${pocQualitySuffix})`
        : `⚖️ *Suggested size:* 100% of normal (${bestPivot.name} pivot, 30M confirms — historically strongest segment${td9Suffix}${slWidenSuffix}${pocQualitySuffix})`;
      const td9Line = (td9.buy9 || td9.sell9)
        ? `\n🔢 *TD Sequential:* ${td9.buy9 ? 'Buy 9 just completed' : 'Sell 9 just completed'} (30M)${td9Confirms ? ' ✅ agrees with direction' : ' — opposite direction, informational only'}`
        : '';

      const openPositionsCheck = loadJSON(OPEN_POSITIONS_FILE, {});
      if (openPositionsCheck[symbol]) {
        console.log(`  ⏸️ ${symbol}: signal conditions met but a position is already open (since ${new Date(openPositionsCheck[symbol].entryTime * 1000).toISOString()}) — skipping new fire until it closes.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'POSITION_ALREADY_OPEN' });
        return;
      }

      const entryTime = data15m[data15m.length - 1].time;

      const message = `
${emoji} *${symbol} — GWP Signal*

📊 *Direction:* ${direction}
${voteLine}
🔗 *2H Zone:* near ${htfCheck.nearestLevel} ✅${td9Line}

━━━━━━━━━━━━━━━━━━━━
💵 *Entry:* \`$${bestFibLevel.toFixed(4)}\` (30M Fib ${fibPct} ↔ ${bestPivot.name})
🛑 *SL:* \`$${levels.slPrice.toFixed(4)}\` (30M swing wick ± ${slAtrMult}×ATR)
━━━━━━━━━━━━━━━━━━━━
🎯 *TP1 (exit ${Math.round(config.PARTIAL_EXIT_PCT * 100)}%, move SL to entry):* \`$${levels.tp1Price.toFixed(4)}\`  R:R ${levels.rr1.toFixed(2)}:1
🏁 *TP2 (runner, remaining ${Math.round((1 - config.PARTIAL_EXIT_PCT) * 100)}%, ${direction === 'BUY' ? 'VAH' : 'VAL'}):* \`$${levels.tp2Price.toFixed(4)}\`  R:R ${levels.rr2.toFixed(2)}:1
━━━━━━━━━━━━━━━━━━━━
${sizeLine}
🕯 *15M trigger (${rejection.solo ? 'SOLO' : rejection.score + '/' + config.REJECTION_MIN_PATTERNS}):* ${patternStr}
📐 *ATR(30M):* $${atrStruct.toFixed(4)}

⚠️ Probability-favored setup, not a guarantee. Size so 3-4 consecutive
losses (normal variance) don't meaningfully hurt your account. Never
risk capital you can't afford to lose on a single position.

⏰ *Time:* ${new Date().toUTCString()}
⚡ ${botLabel} v${version}
      `.trim();

      const sendResult = await sendSafe(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
      const alertDelivered = sendResult.success;
      if (alertDelivered) {
        console.log(`  ✅ SIGNAL FIRED: ${symbol} | ${direction} @ $${bestFibLevel.toFixed(4)} | ${patternStr}`);
      } else {
        console.error(`  ⚠️ SIGNAL FIRED but alert NOT delivered: ${symbol} | ${direction} @ $${bestFibLevel.toFixed(4)} | ${patternStr} — queued for retry.`);
        queuePendingAlert(symbol, message);
      }

      saveState(symbol, {
        signal: 'FIRED', direction,
        entryPrice: bestFibLevel, ...levels,
        patterns: rejection.patterns, riskMult,
        voteTally: resolved.tally, agreeing: resolved.agreeing,
        bias2h: bias2h?.bias, bias30m: biasStruct.bias, bias15m: bias15m?.bias,
        lastSignalBar: barTime, lastSignalDir: direction,
        alertDelivered,
      });

      logSignal(symbol, {
        signal: 'FIRED', direction, entryTime,
        entryPrice: bestFibLevel, ...levels,
        confluencePivot: bestPivot.name, fibPct, patterns: rejection.patterns,
        voteTally: resolved.tally, agreeing: resolved.agreeing, riskMult,
        bias2h: bias2h?.bias, bias30m: biasStruct.bias, bias15m: bias15m?.bias,
        td9Confirms, slAtrMult, prominence, migration, nakedPOC, multiTFPOC,
        alertDelivered,
      });

      saveOpenPosition(symbol, {
        symbol, direction, entryTime,
        entryPrice: bestFibLevel,
        slPrice: levels.slPrice, tp1Price: levels.tp1Price, tp2Price: levels.tp2Price,
        origSlPrice: levels.slPrice,
        rr1: parseFloat(levels.rr1.toFixed(2)), rr2: parseFloat(levels.rr2.toFixed(2)),
        pivot: bestPivot.name, patterns: rejection.patterns,
      });

    } catch (err) {
      console.error(`  ❌ Error processing ${symbol}:`, err.message);
      logDiag({ symbol, fired: false, reason: 'EXCEPTION', error: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    }
  };

  return { runStrategy, flushPendingAlerts };
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED STRATEGY ENGINE (shared/engine.js)  v1.3.4
 *
 *  This is a faithful, line-for-line port of MVS-bot's strategy.js
 *  runStrategy() pipeline (v10.15.5), generalized into a factory so all
 *  three GWP sub-bots (Crypto / Forex / Stocks) run the EXACT same
 *  pipeline against their own config + data source. Every gate, in the
 *  same order, with the same reasoning MVS-bot's own comments document.
 *
 *  v1.3.0 — the decision pipeline itself moved to shared/setup-eval.js
 *  (shared with the backtest). This file fetches closed candles, logs,
 *  persists state and sends the alert. Timeframe roles come from
 *  shared/tf-plan.js: H6 (default) = M15 clock/vote, M30 trigger, H1 vote,
 *  H2 structure, H3 + H4 bias, 3-of-6; or GWP_TF_PROFILE=LEGACY for the
 *  v1.1.4 D1/30M/2H/15M 3-of-4 design. Nothing here hardcodes which
 *  physical candle plays which role.
 *
 *  Every other gate below — near-zone, confluence, POC-quality factors,
 *  TD Sequential, risk tiering, TP1/TP2 structure, cooldown, structural
 *  remap, absorption veto — is IDENTICAL in mechanics to MVS, just fed by
 *  whichever physical timeframe currently plays the STRUCT/BIAS role.
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const createSetupEvaluator = require('./setup-eval');
const { buildPlan, loadPlanBars } = require('./tf-plan');

module.exports = function createEngine({ config, core, dataClient, telegram, persistence, botLabel, version }) {
  const { getKlines } = dataClient;
  const plan = buildPlan(config);
  const { evaluate, tfState } = createSetupEvaluator({ config, core, plan });
  const S = plan.struct, T = plan.trigger, CK = plan.clock;
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
  //  MAIN STRATEGY ENGINE (v1.3.0)
  //
  //  The decision pipeline itself now lives in shared/setup-eval.js and is
  //  the SAME function the backtest calls — this file only fetches candles,
  //  logs, persists state and sends the alert. The timeframe roles come
  //  from shared/tf-plan.js (H6: M15 · M30 · H1 · H2 · H3 · H4, 3-of-6).
  // ─────────────────────────────────────────────────────────────────────
  const biasFields = (states) => {
    const g = (l) => (states[l] && states[l].bias ? states[l].bias.bias : undefined);
    const byTF = {};
    for (const e of plan.entries) byTF[e.label] = g(e.label);
    return {
      biasByTF: byTF,
      // legacy keys kept so /status, the Gist publisher and old state.json readers keep working
      biasD1: g('D1'), bias30m: g('30M') ?? g('M30'), bias2h: g('2H') ?? g('H2'), bias15m: g('15M') ?? g('M15'),
    };
  };
  const normAgree = (agreeing) => agreeing.map(l => (l === S.label ? plan.structMatrixLabel : l));

  const runStrategy = async (symbol) => {
    const now = new Date().toISOString();
    console.log(`\n[${now}] 🔍 ${botLabel} v${version} scanning ${symbol}...`);
    persistence.touchLastRun();

    try {
      // ── STEP 1: FETCH (closed candles only) ─────────────────────────────
      const { bars } = await loadPlanBars(plan, getKlines, symbol);
      console.log(`  📦 bars: ${plan.entries.map(e => `${e.label}=${(bars[e.label] || []).length}`).join(' ')}`);
      const structBars = bars[S.label] || [];
      const clockBars = bars[CK.label] || [];
      const trigBars = bars[T.label] || [];

      if (structBars.length < 50) {
        console.log(`  ⚠️ Insufficient ${S.label} data (${structBars.length} bars). Skipping.`);
        logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_2H_DATA', bars: structBars.length });
        return;
      }
      if (clockBars.length < 50 || trigBars.length < 50) {
        console.log(`  ⚠️ Insufficient ${CK.label}/${T.label} data (${clockBars.length}/${trigBars.length} bars). Skipping.`);
        logDiag({ symbol, fired: false, reason: 'INSUFFICIENT_15M_DATA', bars: clockBars.length });
        return;
      }

      // ── STEP 2: per-timeframe bias vote state ───────────────────────────
      const states = {};
      for (const e of plan.entries) states[e.label] = tfState(e, bars[e.label] || []);
      const st = states[S.label];
      if (!st.bias) {
        console.log(`  ⚠️ ${S.label} bias vote failed (volume profile). Skipping.`);
        logDiag({ symbol, fired: false, reason: '2H_BIAS_FAILED' });
        return;
      }
      if (!st.atr) {
        console.log(`  ⚠️ ${S.label} ATR calculation failed. Skipping.`);
        logDiag({ symbol, fired: false, reason: 'ATR_FAILED' });
        return;
      }
      const barTime = st.last.time;
      const price = st.last.close;
      const bf = biasFields(states);

      const res = evaluate({
        states, trigBars, clockBars,
        cooldownBlocked: (direction) => isCoolingDown(config, symbol, direction, barTime),
        log: (m) => console.log(m),
      });
      const resolved = res.ctx.resolved;
      // state.json — always kept fresh so /status is never more than one scan stale
      if (!resolved) {
        saveState(symbol, { signal: 'NO_AGREEMENT', direction: null, price, ...bf });
        logDiag({ symbol, ...bf, fired: false, reason: res.reason });
        return;
      }
      if (res.reason === 'REMAP') {
        saveState(symbol, { signal: 'REMAP', price, swingHigh: res.info.swingHigh, swingLow: res.info.swingLow });
        logSignal(symbol, { signal: 'REMAP', price });
        return;
      }
      if (res.reason === 'NOT_NEAR_ZONE') {
        saveState(symbol, { signal: 'WAITING_FOR_ZONE', direction: res.ctx.direction, price, ...bf, voteTally: resolved.tally, agreeing: resolved.agreeing });
        logDiag({ symbol, barTime, price, fired: false, reason: res.reason, ...res.info });
        return;
      }
      if (res.ctx.reachedZone) {
        const vp = res.ctx.vpStruct;
        saveState(symbol, {
          signal: 'SCANNED', price, direction: res.ctx.direction,
          voteTally: resolved.tally, agreeing: resolved.agreeing, ...bf,
          poc: vp.pocPrice, vah: vp.vahPrice, val: vp.valPrice,
          swingHigh: res.ctx.swingStruct.high, swingLow: res.ctx.swingStruct.low, atrStruct: res.ctx.atrStruct,
        });
      }

      if (!res.pass) {
        const base = { symbol, barTime, price, fired: false, reason: res.reason, ...res.info };
        if (res.ctx.rejection) {
          logDiag({
            ...base, ...bf, voteTally: resolved.tally, agreeing: resolved.agreeing,
            htfAligned: res.ctx.htfAligned, confluenceScore: res.ctx.confluenceScore, confluenceLevel: res.ctx.confluenceLevel, confluencePivot: res.ctx.confluencePivot,
            patterns: res.ctx.rejection ? res.ctx.rejection.patterns : undefined, absorptionVeto: res.ctx.rejection ? res.ctx.rejection.absorptionVeto : undefined,
          });
        } else {
          logDiag(base);
        }
        return;
      }

      // ── SIGNAL ──────────────────────────────────────────────────────────
      const sg = res.signal;
      const {
        direction, fibPct, vpStruct, swingStruct, atrStruct, bestScore, bestFibLevel, bestPivot, prominence, htfCheck,
        multiTFPOC, multiTFFib, rejection, entryZoneLow, entryZoneHigh, freshPrice, slAtrMult, levels, td9, td9Confirms, migration, nakedPOC,
      } = sg;
      const hzLabel = plan.htfzone ? plan.htfzone.label : 'HTF';

      logDiag({
        symbol, barTime, price, ...bf, voteTally: resolved.tally, agreeing: resolved.agreeing,
        htfAligned: htfCheck.aligned, confluenceScore: bestScore, confluenceLevel: fibPct, confluencePivot: bestPivot.name,
        patterns: rejection.patterns, absorptionVeto: rejection.absorptionVeto, fired: true, reason: 'SIGNAL_FIRED',
      });

      const emoji = direction === 'BUY' ? '🟢' : '🔴';
      const patternStr = rejection.patterns.map(mdSafe).join(' + ');
      const voteLine = `🗳️ *TF Vote (${resolved.tally}):* ${resolved.agreeing.join(' + ')} agree ${direction === 'BUY' ? 'BULLISH' : 'BEARISH'}` +
        ' | ' + plan.entries.map(e => (states[e.label] && states[e.label].bias ? `${e.label}:${states[e.label].bias.bias}` : null)).filter(Boolean).join(' ');

      let riskMult = core.computeRiskMultiplier(
        bestPivot.name, normAgree(resolved.agreeing), rejection.patterns,
        config.RISK_TIER_MATRIX, config.PATTERN_RISK_MATRIX, config.RISK_TIER_DEFAULT,
        td9Confirms, config.TD9_BOOST_MULT,
        slAtrMult, config.SL_ATR_MULT, plan.structMatrixLabel
      );
      riskMult *= core.computePOCQualityMultiplier(bestPivot.name, direction, prominence, migration, nakedPOC, multiTFPOC, config);
      riskMult *= core.computeVoteStrengthMultiplier(resolved.agreeing.length, config);
      riskMult = Math.max(0.1, Math.min(1.0, riskMult));

      const slWidened = slAtrMult !== config.SL_ATR_MULT;
      const weakReasons = [];
      if (!resolved.agreeing.includes(S.label)) weakReasons.push(`${S.label} not in the confirming vote`);
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
        pocQualityNotes.push(`POC aligned with ${multiTFPOC.alignedLabels.join('+')}`);
      }
      const pocQualitySuffix = pocQualityNotes.length ? ` | ${pocQualityNotes.join(', ')}` : '';
      const sizeLine = riskMult < 1
        ? `⚖️ *Suggested size:* ${Math.round(riskMult * 100)}% of normal (${bestPivot.name} pivot${weakReasons.length ? ', ' + weakReasons.join(' + ') + ' — historically weaker segment, see README' : ''}${td9Suffix}${slWidenSuffix}${pocQualitySuffix})`
        : `⚖️ *Suggested size:* 100% of normal (${bestPivot.name} pivot, ${S.label} confirms — historically strongest segment${td9Suffix}${slWidenSuffix}${pocQualitySuffix})`;
      const td9Line = (td9.buy9 || td9.sell9)
        ? `\n🔢 *TD Sequential:* ${td9.buy9 ? 'Buy 9 just completed' : 'Sell 9 just completed'} (${S.label})${td9Confirms ? ' ✅ agrees with direction' : ' — opposite direction, informational only'}`
        : '';

      const openPositionsCheck = loadJSON(OPEN_POSITIONS_FILE, {});
      if (openPositionsCheck[symbol]) {
        console.log(`  ⏸️ ${symbol}: signal conditions met but a position is already open (since ${new Date(openPositionsCheck[symbol].entryTime * 1000).toISOString()}) — skipping new fire until it closes.`);
        logDiag({ symbol, barTime, price, fired: false, reason: 'POSITION_ALREADY_OPEN' });
        return;
      }

      const entryTime = clockBars[clockBars.length - 1].time;
      const driftPct = bestFibLevel ? Math.abs(freshPrice - bestFibLevel) / bestFibLevel * 100 : 0;

      const message = `
${emoji} *${symbol} — GWP Signal*

📊 *Direction:* ${direction}
${voteLine}
🔗 *${hzLabel} Zone:* near ${htfCheck.nearestLevel} ✅
${config.DUAL_MULTI_TF_GATE_ENABLED && plan.gate.length ? `🎯 *Dual Multi-TF:* POC✅[${multiTFPOC.alignedLabels.join('+')}] Fib✅[${multiTFFib.alignedLabels.join('+')}]\n` : ''}${td9Line}

━━━━━━━━━━━━━━━━━━━━
💵 *Entry zone:* \`$${entryZoneLow.toFixed(4)} – $${entryZoneHigh.toFixed(4)}\` (${S.label} Fib ${fibPct} ↔ ${bestPivot.name} @ \`$${bestFibLevel.toFixed(4)}\`)
   _Last live check: \`$${freshPrice.toFixed(4)}\` (${driftPct.toFixed(2)}% from level as of the ${CK.label} close used to trigger this)_
🛑 *SL:* \`$${levels.slPrice.toFixed(4)}\` (${S.label} swing wick ± ${slAtrMult}×ATR)
━━━━━━━━━━━━━━━━━━━━
🎯 *TP1 (exit ${Math.round(config.PARTIAL_EXIT_PCT * 100)}%, move SL to entry):* \`$${levels.tp1Price.toFixed(4)}\`  R:R ${levels.rr1.toFixed(2)}:1
🏁 *TP2 (runner, remaining ${Math.round((1 - config.PARTIAL_EXIT_PCT) * 100)}%, ${direction === 'BUY' ? 'VAH' : 'VAL'}):* \`$${levels.tp2Price.toFixed(4)}\`  R:R ${levels.rr2.toFixed(2)}:1
━━━━━━━━━━━━━━━━━━━━
${sizeLine}
🕯 *${T.label} trigger (${rejection.solo ? 'SOLO' : rejection.score + '/' + config.REJECTION_MIN_PATTERNS}${rejection.barsAgo ? `, ${rejection.barsAgo} candle${rejection.barsAgo > 1 ? 's' : ''} ago` : ''}):* ${patternStr}
📐 *ATR(${S.label}):* $${atrStruct.toFixed(4)}

⚠️ Probability-favored setup, not a guarantee. Size so 3-4 consecutive
losses (normal variance) don't meaningfully hurt your account. Never
risk capital you can't afford to lose on a single position. Scheduled
scans can run a few minutes late — always sanity-check live price
against the entry zone above before placing the order.

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
        ...bf,
        lastSignalBar: barTime, lastSignalDir: direction,
        alertDelivered,
      });

      logSignal(symbol, {
        signal: 'FIRED', direction, entryTime,
        entryPrice: bestFibLevel, ...levels,
        confluencePivot: bestPivot.name, fibPct, patterns: rejection.patterns,
        voteTally: resolved.tally, agreeing: resolved.agreeing, riskMult,
        ...bf,
        td9Confirms, slAtrMult, prominence, migration, nakedPOC, multiTFPOC, multiTFFib,
        freshPrice, driftPct: parseFloat(driftPct.toFixed(3)),
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

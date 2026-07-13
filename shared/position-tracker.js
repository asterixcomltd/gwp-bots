/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED LIVE POSITION TRACKER (shared/position-tracker.js)
 *
 *  Ported directly from MVS-bot's position-tracker.js. Runs once at the
 *  start of every scan (before new-signal scanning) — no dedicated
 *  server, no extra hosting cost, same design constraint MVS-bot used.
 *
 *  Every run, for every open position, re-fetches ALL 15M candles from
 *  that position's entryTime up to now and replays them one-by-one
 *  through core.js's evaluateOpenTrade() — the EXACT same function
 *  backtest.js uses. Stateless-by-design: open-positions.json stores
 *  only the ORIGINAL, unmutated trade parameters; every run clones a
 *  fresh copy and replays from entryTime, never persisting tp1Hit/
 *  beMoved between runs.
 * ═══════════════════════════════════════════════════════════════════════
 */
module.exports = function createPositionTracker({ config, core, dataClient, telegram, persistence }) {
  const { getKlines } = dataClient;
  const { mdSafe, sendSafe } = telegram;
  const { loadJSON, OPEN_POSITIONS_FILE, LOG_FILE, STATE_FILE } = persistence;
  const fs = require('fs');
  const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

  const RESULT_EMOJI = {
    'TP1+TP2': '🎯', 'TP1+BE': '🟢', 'SL': '🔴', 'BE': '⚪',
    'EARLY_TIMEOUT': '⏱️', 'TIMEOUT': '⏱️',
  };

  const closeLogEntry = (symbol, entryTime, outcome) => {
    const log = loadJSON(LOG_FILE, []);
    const idx = log.findIndex(e => e.symbol === symbol && e.entryTime === entryTime && e.rr === undefined);
    if (idx === -1) {
      console.error(`  ⚠️ [tracker] Could not find matching signals.log.json entry for ${symbol} @ entryTime=${entryTime} — exit computed but not recorded against the original alert. Equity curve will miss this one trade.`);
      return false;
    }
    log[idx] = { ...log[idx], ...outcome };
    saveJSON(LOG_FILE, log);
    return true;
  };

  const closeStateEntry = (symbol, outcome) => {
    const state = loadJSON(STATE_FILE, {});
    if (!state[symbol]) return;
    state[symbol] = {
      ...state[symbol],
      signal: `CLOSED_${outcome.result}`,
      exitPrice: outcome.exitPrice, rr: outcome.rr, exitTime: outcome.exitTime,
      hoursHeld: outcome.hoursHeld,
      updatedAt: new Date().toISOString(),
    };
    saveJSON(STATE_FILE, state);
  };

  const checkOpenPositions = async () => {
    const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});
    const symbols = Object.keys(openPositions);
    if (!symbols.length) {
      console.log('  ℹ️  [tracker] No open positions to check.');
      return;
    }
    console.log(`  🔎 [tracker] Checking ${symbols.length} open position(s): ${symbols.join(', ')}`);

    for (const symbol of symbols) {
      const original = openPositions[symbol];
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const barsNeeded = Math.ceil((nowSec - original.entryTime) / 900) + 5; // 900s = 15min, +5 buffer
        const limit = Math.min(Math.max(barsNeeded, 10), 1500);
        const candles = await getKlines(symbol, config.TRIGGER_TIMEFRAME, limit);
        const bars = candles.filter(c => c.time > original.entryTime).sort((a, b) => a.time - b.time);

        if (!bars.length) {
          console.log(`  ⏳ [tracker] ${symbol}: no 15M bars yet since entry (${new Date(original.entryTime * 1000).toISOString()}) — too soon to check, or fetch came up short.`);
          continue;
        }

        if (barsNeeded > 1490) {
          console.error(`  ⚠️ [tracker] ${symbol}: position open ${Math.round(barsNeeded * 15 / 60 / 24 * 10) / 10} days — longer than one fetch window can fully cover. Simulating on the most recent ${limit} bars only; may miss an earlier SL/TP touch if scans were paused for a long stretch.`);
        }

        let trade = { ...original };
        let closedOutcome = null;
        for (const bar of bars) {
          const { closed, trade: updatedTrade, outcome } = core.evaluateOpenTrade(trade, bar, config);
          trade = updatedTrade;
          if (closed) { closedOutcome = outcome; break; }
        }

        if (!closedOutcome) {
          console.log(`  📈 [tracker] ${symbol}: still open (${bars.length} bars checked since entry, no exit yet).`);
          continue;
        }

        const emoji = RESULT_EMOJI[closedOutcome.result] || 'ℹ️';
        console.log(`  ${emoji} [tracker] ${symbol}: CLOSED — ${closedOutcome.result} @ $${closedOutcome.exitPrice} (${closedOutcome.rr > 0 ? '+' : ''}${closedOutcome.rr}R, held ${closedOutcome.hoursHeld}h)`);

        const logged = closeLogEntry(symbol, original.entryTime, closedOutcome);
        closeStateEntry(symbol, closedOutcome);

        const rrStr = `${closedOutcome.rr > 0 ? '+' : ''}${closedOutcome.rr}R`;
        await sendSafe(config.TELEGRAM_CHAT_ID,
          `${emoji} *${symbol} — Position Closed*\n\n` +
          `Result: *${mdSafe(closedOutcome.result)}* (${rrStr})\n` +
          `Exit: \`$${closedOutcome.exitPrice}\`\n` +
          `Held: ${closedOutcome.hoursHeld}h\n` +
          (logged ? '' : '\n⚠️ Could not match this to its original alert in signals.log.json — logged here for visibility, but it won\'t appear in the weekly equity curve.'),
          { parse_mode: 'Markdown' }
        );

        delete openPositions[symbol];
        saveJSON(OPEN_POSITIONS_FILE, openPositions);
      } catch (err) {
        console.error(`  ❌ [tracker] Error checking ${symbol}:`, err.message);
        // Deliberately don't delete/mutate this position on error — next
        // run tries again fresh, same stateless-replay reasoning as MVS.
      }
    }
  };

  return { checkOpenPositions };
};

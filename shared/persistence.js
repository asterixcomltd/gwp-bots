/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED PERSISTENCE (shared/persistence.js)
 *
 *  Ported directly from MVS-bot's strategy.js persistence section. Each
 *  GWP sub-bot calls createPersistence(__dirname) once, from ITS OWN
 *  folder — so crypto/state.json, forex/state.json, and stocks/state.json
 *  stay completely independent, while the READ/WRITE logic itself is one
 *  shared, tested implementation (same anti-drift reasoning as core.js).
 *
 *  Logs are NEWEST-FIRST (unshift, not push) — matches MVS v10.9+, so the
 *  most recent activity is at the top of the file, not the bottom.
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');

module.exports = function createPersistence(dir) {
  const STATE_FILE          = path.join(dir, 'state.json');
  const LOG_FILE            = path.join(dir, 'signals.log.json');
  const DIAG_FILE           = path.join(dir, 'diag.log.json');
  const OPEN_POSITIONS_FILE = path.join(dir, 'open-positions.json');
  const PENDING_FILE        = path.join(dir, 'pending-alerts.json');

  const loadJSON = (file, fallback) => {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return fallback; }
  };

  const saveState = (symbol, data) => {
    const state = loadJSON(STATE_FILE, {});
    state[symbol] = { ...data, updatedAt: new Date().toISOString() };
    state._lastRunAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  };

  const touchLastRun = () => {
    const state = loadJSON(STATE_FILE, {});
    state._lastRunAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  };

  const isDuplicateRun = (guardMs = 5 * 60 * 1000) => {
    const state = loadJSON(STATE_FILE, {});
    if (!state._lastRunAt) return false;
    const elapsed = Date.now() - new Date(state._lastRunAt).getTime();
    return elapsed >= 0 && elapsed < guardMs;
  };

  const saveOpenPosition = (symbol, trade) => {
    const open = loadJSON(OPEN_POSITIONS_FILE, {});
    open[symbol] = trade;
    fs.writeFileSync(OPEN_POSITIONS_FILE, JSON.stringify(open, null, 2));
  };

  const logSignal = (symbol, entry) => {
    const log = loadJSON(LOG_FILE, []);
    log.unshift({ symbol, ...entry, time: new Date().toISOString() });
    fs.writeFileSync(LOG_FILE, JSON.stringify(log.slice(0, 500), null, 2));
  };

  const logDiag = (entry) => {
    const log = loadJSON(DIAG_FILE, []);
    log.unshift({ ...entry, ts: new Date().toISOString() });
    fs.writeFileSync(DIAG_FILE, JSON.stringify(log.slice(0, 2000), null, 2));
  };

  const queuePendingAlert = (symbol, message) => {
    const pending = loadJSON(PENDING_FILE, []);
    pending.push({ symbol, message, queuedAt: new Date().toISOString() });
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
  };

  const isCoolingDown = (config, symbol, direction, currentBarTime) => {
    const state = loadJSON(STATE_FILE, {});
    const s = state[symbol];
    if (!s || !s.lastSignalBar || !s.lastSignalDir) return false;
    if (s.lastSignalDir !== direction) return false;
    const barsSince = Math.round((currentBarTime - s.lastSignalBar) / config.STRUCT_BAR_SECONDS);
    return barsSince < config.SIGNAL_COOLDOWN_BARS;
  };

  return {
    STATE_FILE, LOG_FILE, DIAG_FILE, OPEN_POSITIONS_FILE, PENDING_FILE,
    loadJSON, saveState, touchLastRun, isDuplicateRun,
    saveOpenPosition, logSignal, logDiag, queuePendingAlert, isCoolingDown,
  };
};

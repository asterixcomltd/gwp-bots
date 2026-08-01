/**
 * check-telegram.js — GWP equivalent of MVS's execution/check-telegram.js.
 * GWP has no auto-trade component (confirmed: signal/alert only), so
 * there's no separate "real balance" check needed like MVS's
 * check-status.js — this is the only status tool GWP needs.
 *
 * Works for any of the three bots via argument — reads that bot's own
 * state.json / open-positions.json directly, same files Telegram's
 * /status and /positions already read, so this is always in sync with
 * what Telegram would tell you, without needing to open Telegram.
 *
 * Usage:
 *   node tools/check-telegram.js crypto
 *   node tools/check-telegram.js forex
 *   node tools/check-telegram.js stocks
 */

const fs = require('fs');
const path = require('path');

const botName = process.argv[2];
const VALID_BOTS = ['crypto', 'forex', 'stocks'];

if (!VALID_BOTS.includes(botName)) {
  console.error(`Usage: node tools/check-telegram.js <${VALID_BOTS.join('|')}>`);
  process.exit(1);
}

const BOT_DIR = path.join(__dirname, '..', 'bots', botName);
const STATE_FILE = path.join(BOT_DIR, 'state.json');
const OPEN_POSITIONS_FILE = path.join(BOT_DIR, 'open-positions.json');
const config = require(path.join(BOT_DIR, 'config.js'));

const loadJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};

const line = () => console.log('─'.repeat(50));

const state = loadJSON(STATE_FILE, null);
const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});

console.log(`--- GWP ${botName.toUpperCase()} status (read locally) ---\n`);

if (!state) {
  console.log('⚠️  No saved state.json found for this bot yet — run `git pull` first, or wait for the next scan.');
  process.exit(0);
}

console.log(`📊 Last scan: ${state._lastRunAt || 'unknown'}`);
line();

for (const sym of config.SYMBOLS) {
  const s = state[sym];
  const open = openPositions[sym];
  console.log(`${sym}`);
  if (open) {
    console.log(`   🟢 OPEN — ${open.direction} @ $${Number(open.entryPrice).toFixed(4)} (since ${new Date(open.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)`);
  } else if (s && s.signal && s.signal.startsWith('CLOSED_')) {
    const rrStr = s.rr !== undefined ? `${s.rr > 0 ? '+' : ''}${s.rr}R` : '';
    console.log(`   ⚪ Last closed: ${s.signal.replace('CLOSED_', '')} ${rrStr}`);
  } else if (s) {
    console.log(`   Signal: ${s.signal || 'unknown'}${s.direction ? ' (' + s.direction + ')' : ''}${s.price ? ' — price $' + Number(s.price).toFixed(4) : ''}`);
  } else {
    console.log(`   no data yet`);
  }
}
line();
console.log('Reminder: GWP is signal/alert only — this shows what Telegram already');
console.log('alerts on, no real trading account or balance is involved.');

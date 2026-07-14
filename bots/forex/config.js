/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP FOREX — config.js  v1.0.0
 *  Twelve Data API. Majors + Gold — same pairs the earlier GWP forex bot
 *  shipped with, ported onto the MVS-derived 4-TF engine (D1/2H/30M/15M).
 *
 *  VOLUME NOTE: spot FX pairs generally report no real traded volume from
 *  Twelve Data — shared/twelvedata.js automatically substitutes a
 *  true-range proxy in that case (see that file's header for the full
 *  reasoning) and flags it. XAU/USD often DOES carry real volume and is
 *  used as-is.
 *
 *  API KEY ECONOMICS — READ THIS: Twelve Data's free/basic plan caps out
 *  at 800 credits/DAY. Even with the incremental candle cache in
 *  shared/twelvedata.js (which skips a fetch entirely when no new bar is
 *  due yet), scanning 10 symbols × 4 timeframes every 15 minutes needs
 *  roughly 1,500+ credits/day just for live scanning — before backtests.
 *  ONE free key is not enough for this symbol count at this cadence.
 *  TWELVE_DATA_KEYS below accepts a COMMA-SEPARATED list of multiple free
 *  keys (one GitHub secret, e.g. "key1,key2,key3") — each additional key
 *  adds another 800/day to the combined pool. 2-3 keys is realistic for
 *  this symbol list; fewer keys means either fewer SYMBOLS or a paid
 *  plan is the honest alternative.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

const parseKeys = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  ...base,

  TELEGRAM_BOT_TOKEN: process.env.FOREX_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.FOREX_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // Comma-separated pool of Twelve Data API keys — see economics note
  // above. Falls back to a single TWELVE_DATA_KEY if that's all that's
  // set (backward compatible with the original single-key setup).
  TWELVE_DATA_KEYS: parseKeys(process.env.TWELVE_DATA_KEYS),
  TWELVE_DATA_KEY:  process.env.TWELVE_DATA_KEY || '',

  // Where shared/twelvedata.js persists candle-cache.json — this bot's
  // own folder, so it's committed alongside state.json/signals.log.json
  // by the existing `git add bots/forex/*.json` workflow step.
  __cacheDir: __dirname,

  // ── Assets — Twelve Data symbol format ──────────────────────────────────
  SYMBOLS: [
    'XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'GBP/JPY',
    'AUD/USD', 'USD/CAD', 'NZD/USD', 'USD/CHF', 'EUR/JPY',
  ],

  // ── Timeframes — Twelve Data interval strings ───────────────────────────
  DAILY_TIMEFRAME:   '1day',
  BIAS_TIMEFRAME:    '2h',
  STRUCT_TIMEFRAME:  '30min',
  TRIGGER_TIMEFRAME: '15min',
};

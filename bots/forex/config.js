/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP FOREX — config.js  v1.0.0
 *  Twelve Data API. Majors + Gold — same pairs the earlier GWP forex bot
 *  shipped with, ported onto the MVS-derived 3-TF engine.
 *
 *  VOLUME NOTE: spot FX pairs generally report no real traded volume from
 *  Twelve Data — shared/twelvedata.js automatically substitutes a
 *  true-range proxy in that case (see that file's header for the full
 *  reasoning) and flags it. XAU/USD often DOES carry real volume and is
 *  used as-is.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

module.exports = {
  ...base,

  TELEGRAM_BOT_TOKEN: process.env.FOREX_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.FOREX_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',
  TWELVE_DATA_KEY:    process.env.TWELVE_DATA_KEY || '',

  // ── Assets — Twelve Data symbol format ──────────────────────────────────
  SYMBOLS: [
    'XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'GBP/JPY',
    'AUD/USD', 'USD/CAD', 'NZD/USD', 'USD/CHF', 'EUR/JPY',
  ],

  // ── Timeframes — Twelve Data interval strings ───────────────────────────
  BIAS_TIMEFRAME:    '2h',
  STRUCT_TIMEFRAME:  '30min',
  TRIGGER_TIMEFRAME: '15min',
};

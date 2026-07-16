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
 *  roughly 1,570 credits/day just for LIVE scanning — before backtests,
 *  which pull deep history and cost roughly another 1,500/day on the day
 *  they run. One key is nowhere near enough.
 *
 *  v1.1.2 FIX — SEPARATE KEY POOLS PER BOT: earlier this bot and Stocks
 *  shared ONE TWELVE_DATA_KEYS pool. Both bots' weekly backtests were
 *  scheduled on the same day, so on backtest day, combined demand
 *  (~6,500 credits: both bots' live scanning + both bots' backtests) blew
 *  past even a 5-key (4,000/day) shared pool — explaining backtests that
 *  fail completely ("DATA FETCH FAILED FOR EVERY SYMBOL") even though the
 *  keys themselves work fine (proven by a populated candle-cache.json
 *  from successful live scans). FOREX_TWELVE_DATA_KEYS now takes
 *  priority — set a pool DEDICATED to this bot (not shared with Stocks)
 *  and the two bots stop competing for the same budget entirely. Falls
 *  back to the shared TWELVE_DATA_KEYS if the dedicated one isn't set.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

const parseKeys = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  ...base,

  TELEGRAM_BOT_TOKEN: process.env.FOREX_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.FOREX_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // Dedicated pool takes priority; falls back to the shared pool, then a
  // single legacy key, if a dedicated one isn't configured.
  TWELVE_DATA_KEYS: parseKeys(process.env.FOREX_TWELVE_DATA_KEYS).length
    ? parseKeys(process.env.FOREX_TWELVE_DATA_KEYS)
    : parseKeys(process.env.TWELVE_DATA_KEYS),
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

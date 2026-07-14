/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP STOCKS — config.js  v1.0.0
 *  Twelve Data API. Large-cap US equities — real traded volume, so no
 *  synthetic-volume fallback is expected to trigger for this bot (see
 *  shared/twelvedata.js) except possibly on thin pre/post-market prints.
 *  Ported onto the MVS-derived 4-TF engine (D1/2H/30M/15M).
 *
 *  SPCX: SpaceX (Space Exploration Technologies Corp) IPO'd on Nasdaq
 *  under ticker SPCX in June 2026 — a real, current, tradeable symbol,
 *  not a placeholder.
 *
 *  API KEY ECONOMICS — READ THIS: same shared Twelve Data account/budget
 *  reasoning as bots/forex/config.js — see that file's header for the
 *  full math. TWELVE_DATA_KEYS below accepts a comma-separated list of
 *  multiple free keys to raise the combined daily budget.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

const parseKeys = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  ...base,

  TELEGRAM_BOT_TOKEN: process.env.STOCKS_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.STOCKS_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  TWELVE_DATA_KEYS: parseKeys(process.env.TWELVE_DATA_KEYS),
  TWELVE_DATA_KEY:  process.env.TWELVE_DATA_KEY || '',

  __cacheDir: __dirname,

  // ── Assets — Twelve Data equity tickers ─────────────────────────────────
  SYMBOLS: [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL',
    'META', 'TSLA', 'AMD', 'NFLX', 'AVGO', 'SPCX',
  ],

  // ── Timeframes — Twelve Data interval strings ───────────────────────────
  DAILY_TIMEFRAME:   '1day',
  BIAS_TIMEFRAME:    '2h',
  STRUCT_TIMEFRAME:  '30min',
  TRIGGER_TIMEFRAME: '15min',
};

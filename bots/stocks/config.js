/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP STOCKS — config.js  v1.0.0
 *  Twelve Data API. Large-cap US equities — real traded volume, so no
 *  synthetic-volume fallback is expected to trigger for this bot (see
 *  shared/twelvedata.js) except possibly on thin pre/post-market prints.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

module.exports = {
  ...base,

  TELEGRAM_BOT_TOKEN: process.env.STOCKS_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.STOCKS_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',
  TWELVE_DATA_KEY:    process.env.TWELVE_DATA_KEY  || '',

  // ── Assets — Twelve Data equity tickers ─────────────────────────────────
  SYMBOLS: [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL',
    'META', 'TSLA', 'AMD', 'NFLX', 'AVGO',
  ],

  // ── Timeframes — Twelve Data interval strings ───────────────────────────
  BIAS_TIMEFRAME:    '2h',
  STRUCT_TIMEFRAME:  '30min',
  TRIGGER_TIMEFRAME: '15min',
};

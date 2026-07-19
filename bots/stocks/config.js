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
 *  v1.1.2 FIX — SEPARATE KEY POOLS PER BOT: this bot and Forex used to
 *  share ONE TWELVE_DATA_KEYS pool, and both bots' weekly backtests were
 *  scheduled the same day — combined demand blew past even a 5-key
 *  shared pool on backtest day, causing complete backtest failures even
 *  though the keys themselves worked fine for live scanning. See
 *  bots/forex/config.js's header for the full story.
 *  STOCKS_TWELVE_DATA_KEYS takes priority — give this bot its OWN
 *  dedicated pool (not shared with Forex) and the two stop competing.
 *  Falls back to the shared TWELVE_DATA_KEYS if a dedicated one isn't set.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

const parseKeys = (raw) => (raw || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  ...base,

  TELEGRAM_BOT_TOKEN: process.env.STOCKS_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.STOCKS_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  TWELVE_DATA_KEYS: parseKeys(process.env.STOCKS_TWELVE_DATA_KEYS).length
    ? parseKeys(process.env.STOCKS_TWELVE_DATA_KEYS)
    : parseKeys(process.env.TWELVE_DATA_KEYS),
  TWELVE_DATA_KEY:  process.env.TWELVE_DATA_KEY || '',

  __cacheDir: __dirname,

  // v1.1.3 FIX — Twelve Data's own documentation confirms equities'
  // INTRADAY data (15min/30min/2H — everything below daily) is only
  // available for "a few months," unlike forex/crypto which get
  // intraday history going back a year or more. Requesting the default
  // 360 days meant most of that request returned nothing, and warmup
  // (~245 days across D1+STRUCT+ATR requirements) ate nearly all of
  // whatever intraday history WAS available — leaving a backtest
  // window of barely 2-3 weeks after warmup, not the intended 360 days.
  // D1 itself is NOT similarly restricted (equities' daily/higher
  // intervals go back to first trading date) — only the finer
  // intraday timeframes this bot also depends on for structure/trigger.
  BACKTEST_DAYS: 90,

  // ── Assets — Twelve Data equity tickers ─────────────────────────────────
  SYMBOLS: [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL',
    'META', 'TSLA', 'AMD', 'NFLX', 'AVGO', 'SPCX',
  ],

  // ── Timeframes — Twelve Data interval strings ───────────────────────────
  DAILY_TIMEFRAME:   '1day',
  BIAS_TIMEFRAME:    '30min',
  STRUCT_TIMEFRAME:  '2h',
  TRIGGER_TIMEFRAME: '15min',
};

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

  // v1.1.5 FIX — stocks backtest returning 0 trades / scanned=0, STILL,
  // even after the v1.1.4 dedicated-D1-fetch fix: that fix solved D1's
  // warmup shortfall, but the v1.1.4 RE-ROLE (STRUCT moved 30M→2H)
  // introduced a NEW, equities-specific shortfall on STRUCT itself.
  // STRUCT_VP_LOOKBACK=500 (config-base.js default) needs ~519 total 2H
  // bars before backtestSymbol() will even start its replay loop.
  // Crypto/forex accumulate 2H bars ~12/day (trivial, ~43 days). Equities
  // only trade ~6.5h/day → ~3-4 2H bars/day, so 519 bars needs ~150+
  // TRADING days (~210+ calendar days) — and Twelve Data's own docs cap
  // equity INTRADAY history at "a few months" regardless of how many
  // days are requested, so that warmup can never complete no matter how
  // far back we ask. Overriding to a smaller, equities-appropriate
  // lookback (same ~2.2:1 VP:Fib ratio as the global default) — plenty
  // for a usable 2H volume profile, and achievable within a few months
  // of real equity 2H history even after BACKTEST_DAYS' own eval window
  // is added on top. Doesn't affect live scanning (which never needs
  // the full lookback, only whatever's freshly fetched each scan) or
  // the QUALITY of the live structure itself — 2H structure recomputed
  // live each scan still uses config-base.js's normal 50-bar minimum.
  STRUCT_VP_LOOKBACK:  120,
  STRUCT_FIB_LOOKBACK:  55,

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
  //
  // v1.1.5: trimmed 90→60 for extra safety margin now that STRUCT is 2H
  // (see STRUCT_VP_LOOKBACK note above) — 60 days of eval + the reduced
  // ~120-bar STRUCT warmup (~40 trading days ≈ 56 calendar days) fits
  // comfortably inside "a few months" of real vendor history, with room
  // to spare, instead of sitting right at the edge of it.
  BACKTEST_DAYS: 60,

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

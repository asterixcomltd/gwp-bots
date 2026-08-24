/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP CRYPTO — config.js  v1.0.0
 *  KuCoin API. Same asset list MVS-bot ships with.
 * ═══════════════════════════════════════════════════════════════════════
 */
const base = require('../../shared/config-base');

module.exports = {
  ...base,

  // ── Telegram — separate token/chat per sub-bot so Crypto/Forex/Stocks
  // alerts can go to different chats if desired. Falls back to the
  // shared TELEGRAM_* vars if the bot-specific ones aren't set.
  TELEGRAM_BOT_TOKEN: process.env.CRYPTO_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  TELEGRAM_CHAT_ID:   process.env.CRYPTO_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || 'YOUR_CHAT_ID_HERE',

  // ── Assets ──────────────────────────────────────────────────────────────
  SYMBOLS: [
    'ETH-USDT', 'SOL-USDT', 'BTC-USDT', 'XRP-USDT',
    'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT',
    'BNB-USDT', 'DOT-USDT', 'LTC-USDT', 'TRX-USDT', 'POL-USDT',
    'MNT-USDT',
    // v1.1.9 (frequency) — 6 additional liquid, long-established
    // KuCoin-listed pairs. Purely additive to the symbol universe: every
    // gate is per-symbol-independent, so this increases total scan
    // surface without changing per-signal quality on any existing pair.
    'ATOM-USDT', 'NEAR-USDT', 'APT-USDT', 'ARB-USDT', 'OP-USDT', 'SUI-USDT',
  ],

  // ── Timeframes — KuCoin granularity strings ─────────────────────────────
  DAILY_TIMEFRAME:   '1day',
  BIAS_TIMEFRAME:    '30min',
  STRUCT_TIMEFRAME:  '2hour',
  TRIGGER_TIMEFRAME: '15min',

  // ── KuCoin API ──────────────────────────────────────────────────────────
  BASE_URL: 'https://api.kucoin.com/api/v1',

  // Where shared/kucoin.js persists candle-cache.json (v1.2.0) — this
  // bot's existing *-scan.yml already does `git add bots/crypto/*.json`,
  // so the cache file starts getting committed automatically with no
  // workflow change needed. Same pattern as forex/stocks' Twelve Data cache.
  __cacheDir: __dirname,
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — TWELVE DATA CLIENT (shared/twelvedata.js) — used by FOREX + STOCKS
 *
 *  Same {getKlines, fetchHistory} shape as shared/kucoin.js, so
 *  shared/engine.js, shared/backtest-engine.js, and
 *  shared/position-tracker.js never need to know or care which data
 *  source a given bot is actually running on.
 *
 *  ═══ THE CREDIT ECONOMICS PROBLEM AND HOW THIS FILE ADDRESSES IT ═══
 *  Twelve Data's free/basic plans cap usage on TWO separate axes:
 *    - a small number of credits PER MINUTE (seen in production: 8/min)
 *    - a small number of credits PER DAY (seen in production: 800/day)
 *  These need CATEGORICALLY different handling. Per-minute exhaustion is
 *  transient — waiting ~65s (or using a different key) resolves it. Per-
 *  day exhaustion is NOT transient within the same run — no amount of
 *  waiting inside a single workflow execution helps; it only clears at
 *  the vendor's next daily rollover. An earlier version of this file
 *  treated both identically (patient 65s-wait retries for either), which
 *  caused a live scan to retry a daily-exhausted request for ~30 minutes
 *  straight and get force-killed by its own GitHub Actions timeout. This
 *  version fixes that: daily exhaustion on a key fails FAST (no
 *  waiting), and instead:
 *    1. Rotates to the next configured API key, if more than one is
 *       configured (config.TWELVE_DATA_KEYS) — multiple free-tier keys
 *       effectively multiply the combined daily budget.
 *    2. Once ALL configured keys are exhausted for the day, every
 *       further request fails instantly (no network call at all, no
 *       retry loop) for the rest of THIS process — so a symbol that
 *       can't get data doesn't burn the whole workflow's time budget
 *       finding that out over and over.
 *    3. An incremental candle CACHE (candle-cache.json, committed back
 *       to the repo like state.json) means a normal 15-minute live scan
 *       only asks Twelve Data for bars NEWER than what's already cached
 *       — often zero new bars for D1/2H/30M between consecutive scans —
 *       instead of re-fetching the full lookback window from scratch
 *       every single time. This is the single biggest lever on daily
 *       credit consumption.
 *
 *  HONESTY NOTE — SYNTHETIC VOLUME (Forex only, occasionally Stocks
 *  pre/post-market): this bot's entire foundation is POC + VAH + VAL —
 *  a real VOLUME profile. Spot FX has no centralized exchange, so most
 *  data vendors (Twelve Data included) report volume as 0 or omit it
 *  entirely for FX pairs — there is no true "shares traded" number to
 *  report. Rather than silently return a broken, all-in-one-bin volume
 *  profile (which is what calcVolumeProfile() would produce if handed
 *  all-zero volumes — see core.js), this client detects that case per
 *  symbol/timeframe fetch and substitutes each candle's TRUE RANGE
 *  (high − low) as a volume proxy — a well-established substitute known
 *  as a "range profile" when genuine volume is unavailable. This is
 *  clearly DIFFERENT from real traded volume and is flagged
 *  (`syntheticVolume: true`) so strategy.js can log it once, not hide
 *  it. XAU/USD and equities/stocks generally DO report real volume and
 *  are used as-is, un-flagged.
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const todayUTC = () => new Date().toISOString().slice(0, 10);

// ── Process-wide rate limiter (per key) ─────────────────────────────────
// Serializes every request THROUGH A GIVEN KEY so concurrent callers
// within this one process can never burst past that key's per-minute
// cap. NOTE: this cannot see other, separate GitHub Actions jobs running
// concurrently against the same key(s) — see README for that caveat.
const MIN_GAP_MS = 8000; // ~7.5 requests/min per key — safely under an 8/min cap
const keyQueues = new Map(); // key -> { queueTail, lastCallAt }
const throttledForKey = (key, fn) => {
  if (!keyQueues.has(key)) keyQueues.set(key, { queueTail: Promise.resolve(), lastCallAt: 0 });
  const q = keyQueues.get(key);
  const run = q.queueTail.then(async () => {
    const wait = Math.max(0, q.lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    q.lastCallAt = Date.now();
    return fn();
  });
  q.queueTail = run.then(() => {}, () => {});
  return run;
};

// ── Per-key exhaustion state (module-wide, persists for this process) ──
const keyState = new Map(); // key -> { minuteCooldownUntil, dailyExhaustedDate }
const getKeyState = (key) => {
  if (!keyState.has(key)) keyState.set(key, { minuteCooldownUntil: 0, dailyExhaustedDate: null });
  return keyState.get(key);
};

const isDailyExhaustion = (msg) => /run out of api credits.*(current day|today)/i.test(msg || '');
const isMinuteExhaustion = (msg) => /run out of api credits.*(current minute)/i.test(msg || '');

module.exports = function createTwelveDataClient(config) {
  const BASE = 'https://api.twelvedata.com/time_series';
  const BAR_SECONDS = { '15min': 900, '30min': 1800, '45min': 2700, '1h': 3600, '2h': 7200, '4h': 14400, '1day': 86400 };

  const keys = (Array.isArray(config.TWELVE_DATA_KEYS) && config.TWELVE_DATA_KEYS.length)
    ? config.TWELVE_DATA_KEYS
    : (config.TWELVE_DATA_KEY ? [config.TWELVE_DATA_KEY] : []);

  const allKeysDailyExhausted = () => keys.length > 0 && keys.every(k => getKeyState(k).dailyExhaustedDate === todayUTC());

  const toBars = (values) => (values || [])
    .map(v => ({
      time: Math.floor(Date.parse(`${v.datetime}Z`.replace(' ', 'T')) / 1000) || Math.floor(Date.parse(v.datetime) / 1000),
      open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close),
      volume: v.volume != null ? parseFloat(v.volume) : 0,
    }))
    .filter(b => Number.isFinite(b.time) && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time);

  const applyVolumeFallback = (bars) => {
    if (!bars.length) return bars;
    const zeroCount = bars.filter(b => !(b.volume > 0)).length;
    if (zeroCount / bars.length < 0.95) return bars;
    const withProxy = bars.map(b => ({ ...b, volume: Math.max(b.high - b.low, 1e-9) }));
    withProxy.syntheticVolume = true;
    return withProxy;
  };

  // Tries each configured key in rotation for ONE logical request. Fails
  // fast (no waiting at all) the moment every key is daily-exhausted.
  // Per-minute exhaustion on a key just moves on to the next key
  // immediately — with 2+ keys configured this is usually invisible to
  // the caller. With only 1 key, per-minute exhaustion still gets a
  // short, bounded wait (a few x 65s) since that genuinely does clear.
  const request = async (params) => {
    if (!keys.length) {
      console.error(`  ❌ No Twelve Data API key configured (TWELVE_DATA_KEYS or TWELVE_DATA_KEY) — this bot cannot fetch ANY data. Check your repo's Settings → Secrets and variables → Actions.`);
      return { status: 'error', message: 'NO_KEY', __noKey: true };
    }
    if (allKeysDailyExhausted()) {
      // Don't even try — every key already confirmed dead for today.
      return { status: 'error', message: 'ALL_KEYS_DAILY_EXHAUSTED', __dailyExhausted: true };
    }

    const MINUTE_RETRY_ROUNDS = keys.length > 1 ? 1 : 3; // with multiple keys, rotation IS the retry strategy
    for (let round = 0; round < MINUTE_RETRY_ROUNDS; round++) {
      for (const key of keys) {
        const ks = getKeyState(key);
        if (ks.dailyExhaustedDate === todayUTC()) continue; // this key is done for today, skip it
        if (ks.minuteCooldownUntil > Date.now()) continue;  // this key is in a short per-minute cooldown, skip it

        try {
          const res = await throttledForKey(key, () => axios.get(BASE, { params: { ...params, apikey: key, timezone: 'UTC' }, timeout: 20000 }));
          if (res.data && res.data.status === 'error') {
            const msg = res.data.message || 'unknown';
            if (isDailyExhaustion(msg)) {
              ks.dailyExhaustedDate = todayUTC();
              console.error(`  🚫 Key ...${key.slice(-4)} hit its DAILY credit limit — marking it exhausted for the rest of today (${todayUTC()} UTC), moving to next key if any.`);
              continue; // try next key in this same round, no waiting — daily exhaustion never clears by waiting
            }
            if (isMinuteExhaustion(msg)) {
              ks.minuteCooldownUntil = Date.now() + 65000;
              console.error(`  ⏳ Key ...${key.slice(-4)} hit its per-minute limit — cooling down 65s, moving to next key if any.`);
              continue;
            }
            const code = res.data.code;
            const authHint = (code === 401 || code === 403 || /api ?key/i.test(msg))
              ? ' — this looks like an invalid/expired key, not a transient error.'
              : '';
            console.error(`  ❌ Twelve Data error: [${code}] ${msg}${authHint}`);
            return res.data;
          }
          return res.data; // success
        } catch (e) {
          const msg = e.response?.data?.message || e.message;
          console.error(`  ❌ Twelve Data fetch error (key ...${key.slice(-4)}):`, msg);
          // network-level failure isn't this key's fault specifically — don't mark it exhausted, just try the next key/round
        }
      }
      if (allKeysDailyExhausted()) break; // every key just got marked — stop immediately, don't wait
      // Every configured key was either in per-minute cooldown or hit a transient error this round.
      if (round < MINUTE_RETRY_ROUNDS - 1) {
        const soonestCooldown = Math.min(...keys.map(k => getKeyState(k).minuteCooldownUntil));
        const wait = Math.max(1000, Math.min(65000, soonestCooldown - Date.now()));
        await sleep(wait);
      }
    }

    if (allKeysDailyExhausted()) {
      console.error(`  🚫 ALL ${keys.length} configured Twelve Data key(s) are daily-exhausted — no further requests will be attempted until tomorrow (UTC). Add more keys to TWELVE_DATA_KEYS to raise the combined daily budget.`);
      return { status: 'error', message: 'ALL_KEYS_DAILY_EXHAUSTED', __dailyExhausted: true };
    }
    return { status: 'error', message: 'All keys temporarily unavailable (per-minute cooldown or transient errors) after retrying.' };
  };

  // ── Incremental candle cache ────────────────────────────────────────────
  // One JSON file per bot folder, keyed by "SYMBOL|interval". Committed
  // back to the repo by the scan workflow's existing `git add
  // bots/<bot>/*.json` step — no workflow change needed for this to
  // persist between runs.
  const CACHE_FILE = config.__cacheDir ? path.join(config.__cacheDir, 'candle-cache.json') : null;
  let cache = null;
  const loadCache = () => {
    if (cache) return cache;
    try { cache = CACHE_FILE && fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {}; }
    catch { cache = {}; }
    return cache;
  };
  const saveCache = () => {
    if (!CACHE_FILE || !cache) return;
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch (e) { console.error('  ⚠️ Failed to save candle-cache.json (non-fatal):', e.message); }
  };
  const MAX_CACHED_BARS = 2500; // generous ceiling per symbol+interval, trimmed on save

  // ── Live fetch — most recent N candles, cache-aware ─────────────────────
  const getKlines = async (symbol, interval, limit) => {
    const barSeconds = BAR_SECONDS[interval] || 3600;
    const c = loadCache();
    const key = `${symbol}|${interval}`;
    const cached = c[key];
    const nowSec = Math.floor(Date.now() / 1000);

    if (cached && cached.bars && cached.bars.length >= Math.min(limit, 20)) {
      const lastBarTime = cached.bars[cached.bars.length - 1].time;
      const nextBarDue = lastBarTime + barSeconds;
      // Skip the network call entirely if a new bar isn't even due yet —
      // this is the main credit-saving mechanism for D1/2H/30M, whose
      // bars simply don't change between most consecutive 15-min scans.
      if (nowSec < nextBarDue) {
        return applyVolumeFallback(cached.bars.slice(-limit).map(b => ({ ...b })));
      }
      // A new bar (or a few, if this run was delayed) may be available —
      // fetch only the delta since the last cached bar, not full history.
      const startDate = new Date((lastBarTime + 1) * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const data = await request({ symbol, interval, order: 'ASC', start_date: startDate });
      if (data && data.__dailyExhausted) {
        // Can't get fresh data — better to serve slightly-stale cached
        // bars than none at all; core.js's own logic will just see an
        // older "last bar" and proceed or wait as normal.
        console.error(`  ⚠️ ${symbol} ${interval}: serving cached data (possibly stale) — daily credit budget exhausted.`);
        return applyVolumeFallback(cached.bars.slice(-limit).map(b => ({ ...b })));
      }
      if (data && Array.isArray(data.values) && data.values.length) {
        const freshBars = toBars(data.values);
        const merged = [...cached.bars, ...freshBars].filter((b, i, arr) => arr.findIndex(x => x.time === b.time) === i).sort((a, b) => a.time - b.time);
        c[key] = { bars: merged.slice(-MAX_CACHED_BARS) };
        saveCache();
        return applyVolumeFallback(c[key].bars.slice(-limit).map(b => ({ ...b })));
      }
      // No new bars returned (market closed, weekend, etc.) — serve what we have.
      return applyVolumeFallback(cached.bars.slice(-limit).map(b => ({ ...b })));
    }

    // No usable cache yet — full fetch, then seed the cache.
    const safeLimit = Math.min(limit + 20, 5000);
    const data = await request({ symbol, interval, outputsize: safeLimit, order: 'ASC' });
    if (!data || data.status === 'error' || !Array.isArray(data.values)) return [];
    const bars = toBars(data.values);
    c[key] = { bars: bars.slice(-MAX_CACHED_BARS) };
    saveCache();
    return applyVolumeFallback(bars.slice(-limit));
  };

  // ── Paged/ranged history fetch — used by backtest.js (no caching; a
  // deep historical pull is a one-off, not a repeating 15-min cost) ──────
  const fetchHistory = async (symbol, interval, historyDays) => {
    const endDate = new Date();
    const startDate = new Date(Date.now() - historyDays * 86400 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    process.stdout.write(`  Fetching ${interval} history for ${symbol}...`);
    let allBars = [];
    let sawError = null;
    const barSeconds = BAR_SECONDS[interval] || 3600;
    const chunkSeconds = 4500 * barSeconds;
    let cursorEnd = endDate;
    const startSeconds = Math.floor(startDate.getTime() / 1000);

    while (Math.floor(cursorEnd.getTime() / 1000) > startSeconds) {
      const cursorStart = new Date(Math.max(cursorEnd.getTime() - chunkSeconds * 1000, startDate.getTime()));
      const data = await request({
        symbol, interval, order: 'ASC',
        start_date: fmt(cursorStart), end_date: fmt(cursorEnd),
        // Deliberately NOT sending outputsize alongside start_date/end_date
        // — Twelve Data's own docs warn combining them can truncate results.
      });
      if (data && data.__noKey) { sawError = 'NO_API_KEY'; break; }
      if (data && data.__dailyExhausted) { sawError = 'ALL_KEYS_DAILY_EXHAUSTED'; break; }
      if (!data || data.status === 'error') { sawError = data?.message || 'unknown Twelve Data error'; break; }
      if (!Array.isArray(data.values) || !data.values.length) break; // genuine end of history — not an error
      const bars = toBars(data.values);
      allBars = [...bars, ...allBars];
      cursorEnd = new Date(cursorStart.getTime() - 1000);
      process.stdout.write('.');
    }
    const seen = new Set();
    allBars = allBars.filter(b => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
    if (sawError) {
      console.log(` ❌ STOPPED EARLY (${sawError}) — only ${allBars.length} bars fetched before the failure.`);
    } else {
      console.log(` ${allBars.length} bars`);
    }
    return applyVolumeFallback(allBars);
  };

  return { getKlines, fetchHistory, BAR_SECONDS };
};

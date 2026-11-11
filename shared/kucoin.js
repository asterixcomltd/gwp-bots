/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — KUCOIN DATA CLIENT (shared/kucoin.js) — used by the CRYPTO bot
 *
 *  Ported directly from MVS-bot's strategy.js (getKlines) and backtest.js
 *  (fetchKlines/fetchHistory). Real candle volume — no synthetic-volume
 *  handling needed here (see shared/twelvedata.js for why Forex/Stocks
 *  need that).
 *
 *  v1.2.0 — INCREMENTAL CANDLE CACHE. KuCoin has no per-key daily credit
 *  cap the way Twelve Data does, so this bot never had the forcing
 *  function that made shared/twelvedata.js build a cache — but the
 *  underlying waste was identical: every 15-min scan was re-fetching the
 *  FULL lookback window (up to ~520 bars) for all 4 timeframes × every
 *  symbol, even though D1/2H/30M candles almost never change between
 *  consecutive 15-min scans. That's 80 full-window HTTP calls per scan
 *  (20 symbols × 4 TFs) for no reason, all landing on KuCoin from
 *  GitHub's shared runner IP ranges — needless load and needless
 *  exposure to HTTP 429. This port reuses the exact same cache file
 *  design as twelvedata.js (candle-cache.json, keyed "SYMBOL|interval",
 *  committed back to the repo by the scan workflow's existing `git add
 *  bots/crypto/*.json` step — no workflow change needed): skip the
 *  network call entirely when the next bar isn't due yet, otherwise
 *  fetch only the DELTA since the last cached bar (via the same
 *  startAt/endAt ranged endpoint fetchHistory already used) instead of
 *  the full window. fetchHistory() itself is untouched — a deep
 *  historical backtest pull is a one-off, not a repeating 15-min cost,
 *  exactly as twelvedata.js's header notes.
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

module.exports = function createKucoinClient(config) {
  const BASE_URL = config.BASE_URL || 'https://api.kucoin.com/api/v1';
  const BAR_SECONDS = { '15min': 900, '30min': 1800, '1hour': 3600, '2hour': 7200, '4hour': 14400, '1day': 86400 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Surfaces the actual HTTP status + response body instead of just
  // axios's generic "Request failed with status code NNN" message — the
  // difference between "can't tell what's wrong" and "KuCoin returned
  // 451, this IP/region is blocked" in the GitHub Actions log.
  const describeAxiosError = (e) => {
    const status = e.response?.status;
    const body = e.response?.data;
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 300) : '';
    if (status === 451) {
      return `HTTP 451 — KuCoin is refusing this request based on the requester's IP/region (GitHub-hosted runners run from US/EU cloud datacenter IPs, which KuCoin's Terms of Service block from spot trading endpoints in some jurisdictions). This is NOT a bug in this code — it needs a self-hosted runner or a proxy/VPN egress KuCoin doesn't block. Body: ${bodyStr}`;
    }
    if (status === 429 || (body && (body.code === '429000' || body.code === '200002'))) {
      return `HTTP ${status || ''} rate-limited by KuCoin. Body: ${bodyStr}`;
    }
    if (status) return `HTTP ${status}${bodyStr ? ' — ' + bodyStr : ''} (${e.message})`;
    return e.message; // no response at all — DNS failure, timeout, network-level block, etc.
  };

  // ── Raw fetch — most recent N candles (v10.4-style retry) ──────────────
  // Same logic as before, just renamed so getKlines() below can wrap it
  // with the cache layer without shadowing.
  const fetchRecent = async (symbol, interval, limit, maxRetries = 2) => {
    const safeLimit = Math.min(limit + 20, 1500); // buffer for ATR/VP warmup
    const url = `${BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&limit=${safeLimit}`;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
        if (res.data.code !== '200000') {
          console.error(`  ❌ KuCoin API error (${interval}, attempt ${attempt}/${maxRetries}): ${res.data.code} — ${res.data.msg || 'Unknown'}`);
          if (attempt === maxRetries) return [];
          await sleep(800);
          continue;
        }
        const sorted = (res.data.data || []).reverse();
        return sorted.slice(-limit).map(k => ({
          time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]),
          high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]),
        }));
      } catch (e) {
        console.error(`  ❌ KuCoin fetch error for ${symbol} (${interval}, attempt ${attempt}/${maxRetries}): ${describeAxiosError(e)}`);
        if (attempt === maxRetries) return [];
        await sleep(800);
      }
    }
    return [];
  };

  // ── Paged/ranged fetch — used by fetchHistory() AND by getKlines()'s
  // delta-fetch below (a small range counts as "paged" with one page) ────
  const FETCH_MAX_RETRIES = 5;
  const fetchKlinesRange = async (symbol, interval, startAt, endAt, maxRetries = FETCH_MAX_RETRIES) => {
    const url = `${BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&startAt=${startAt}&endAt=${endAt}`;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 20000 });
        if (res.data.code !== '200000') {
          console.error(`\n  ⚠️  KuCoin ${res.data.code} for ${symbol} ${interval} (attempt ${attempt}/${maxRetries}): ${res.data.msg || 'unknown'}`);
          if (attempt === maxRetries) return { ok: false, bars: [] };
          await sleep(500 * attempt);
          continue;
        }
        const bars = (res.data.data || [])
          .map(k => ({ time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]), high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]) }))
          .sort((a, b) => a.time - b.time);
        return { ok: true, bars };
      } catch (e) {
        console.error(`\n  ⚠️  Fetch error for ${symbol} ${interval} (attempt ${attempt}/${maxRetries}): ${describeAxiosError(e)}`);
        if (attempt === maxRetries) return { ok: false, bars: [] };
        await sleep(500 * attempt);
      }
    }
    return { ok: false, bars: [] };
  };

  // ── Incremental candle cache ─────────────────────────────────────────
  // One JSON file per bot folder, keyed by "SYMBOL|interval" — identical
  // shape/behavior to shared/twelvedata.js's cache. config.__cacheDir
  // must be set (bots/crypto/config.js now sets it to __dirname); if
  // it isn't, caching is simply skipped and every call falls through to
  // a full fetchRecent() — same as running with no cache, never a hard
  // failure.
  // v1.2: ONE JSON FILE PER symbol+interval instead of one monolithic
  // candle-cache.json — see shared/twelvedata.js's cache section for the
  // full reasoning (same change, same motivation, applied here too).
  const CACHE_DIR = config.__cacheDir ? path.join(config.__cacheDir, 'cache') : null;
  const cacheFilenameFor = (key) => key.replace(/[\/\\|]/g, '-').replace(/\s+/g, '_') + '.json';
  const cacheMemo = {};
  const loadCacheEntry = (key) => {
    if (cacheMemo[key]) return cacheMemo[key];
    if (!CACHE_DIR) { cacheMemo[key] = { bars: [] }; return cacheMemo[key]; }
    const file = path.join(CACHE_DIR, cacheFilenameFor(key));
    try { cacheMemo[key] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { bars: [] }; }
    catch { cacheMemo[key] = { bars: [] }; }
    return cacheMemo[key];
  };
  const saveCacheEntry = (key, entry) => {
    cacheMemo[key] = entry;
    if (!CACHE_DIR) return;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(CACHE_DIR, cacheFilenameFor(key)), JSON.stringify(entry, null, 2));
    } catch (e) { console.error(`  ⚠️ Failed to save cache for ${key} (non-fatal):`, e.message); }
  };
  const MAX_CACHED_BARS = 2500; // generous ceiling per symbol+interval, trimmed on save

  // ── CLOSED-CANDLE-ONLY CACHE (v2) ─────────────────────────────────────
  // BUG FIXED (GWP v1.3.0): KuCoin returns the still-FORMING candle as the
  // newest bar. The old cache saved it as-is, then only ever fetched bars
  // NEWER than it (`startAt = lastBarTime + 1`) and kept the first copy of
  // any duplicate — so a half-formed candle was frozen into the cache
  // forever. Measured on the committed cache files: ~32% of 2H bars and
  // ~5% of 30M bars had volume far below the sum of their own 15M bars
  // (i.e. saved mid-formation), and nearly all D1 bars. Every volume
  // profile, POC/VAH/VAL, swing and ATR the strategy built was therefore
  // computed on corrupted candles. Now only CLOSED candles are ever
  // returned or stored (time + barSeconds <= now), and cache entries
  // written by the old code (no `v:2` marker) are discarded and reseeded.
  const closedOnly = (bars, barSeconds, nowSec) => bars.filter(b => b.time + barSeconds <= nowSec);
  const CACHE_VERSION = 2;


  // ── DEEP SEED FETCH (v1.3.1) ───────────────────────────────────────────
  // BUG FIXED: KuCoin's un-ranged candle call returns only a SHORT default
  // window (~100 candles; the `limit` parameter is not part of its API and
  // is ignored). The v1.0.0 cache hid that — it was seeded with ~100 bars
  // once and then grew by deltas for weeks. v1.3.0 discarded the old caches
  // (to drop corrupted half-candles) and re-seeded with that short window,
  // so the derived H1/H3/H4 series had too little history and abstained.
  // Seeding now pages BACKWARDS with ranged requests (<=1500 bars each,
  // the documented maximum) until `limit` CLOSED bars are collected.
  const fetchDeep = async (symbol, interval, limit, maxRetries, barSeconds, nowSec) => {
    let all = [];
    let chunkEnd = nowSec;
    for (let page = 0; page < 6; page++) {
      const chunkStart = chunkEnd - 1500 * barSeconds;
      const { ok, bars } = await fetchKlinesRange(symbol, interval, chunkStart, chunkEnd, maxRetries);
      if (!ok || !bars.length) break;
      all = [...bars, ...all];
      const seen = new Set();
      all = all.filter(b => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
      if (closedOnly(all, barSeconds, nowSec).length >= limit) break;
      chunkEnd = bars[0].time - 1;
      await sleep(150);
    }
    if (!all.length) all = await fetchRecent(symbol, interval, limit + 1, maxRetries); // last resort
    return closedOnly(all, barSeconds, nowSec);
  };

  // ── Live fetch — most recent N CLOSED candles, cache-aware ──────────────
  const getKlines = async (symbol, interval, limit, maxRetries = 2) => {
    const barSeconds = BAR_SECONDS[interval] || 3600;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!CACHE_DIR) return (await fetchDeep(symbol, interval, limit, maxRetries, barSeconds, nowSec)).slice(-limit); // no cacheDir — no cache, closed bars only

    const key = `${symbol}|${interval}`;
    const cached = loadCacheEntry(key);

    const usable = cached && cached.v === CACHE_VERSION && Array.isArray(cached.bars) && cached.bars.length > 0
      && (cached.bars.length >= limit || (cached.seededLimit || 0) >= limit)
      && ((nowSec - cached.bars[cached.bars.length - 1].time) / barSeconds) < 1400; // delta must fit one ranged page

    if (usable) {
      const lastBarTime = cached.bars[cached.bars.length - 1].time;
      // The bar after `lastBarTime` only CLOSES at lastBarTime + 2*barSeconds.
      if (nowSec < lastBarTime + 2 * barSeconds) {
        return cached.bars.slice(-limit).map(b => ({ ...b }));
      }
      const { ok, bars: fetched } = await fetchKlinesRange(symbol, interval, lastBarTime + 1, nowSec, maxRetries);
      if (!ok) {
        console.error(`  ⚠️ ${symbol} ${interval}: delta fetch failed — serving cached data (possibly stale) this run.`);
        return cached.bars.slice(-limit).map(b => ({ ...b }));
      }
      const freshBars = closedOnly(fetched, barSeconds, nowSec);
      if (freshBars.length) {
        const byTime = new Map(cached.bars.map(b => [b.time, b]));
        for (const b of freshBars) byTime.set(b.time, b); // newer copy wins
        const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
        const newEntry = { v: CACHE_VERSION, seededLimit: cached.seededLimit || 0, bars: merged.slice(-MAX_CACHED_BARS) };
        saveCacheEntry(key, newEntry);
        return newEntry.bars.slice(-limit).map(b => ({ ...b }));
      }
      return cached.bars.slice(-limit).map(b => ({ ...b }));
    }

    // No usable cache (missing, old pre-v2 format, or seeded for a smaller
    // limit) — full fetch of CLOSED bars, then seed the cache.
    const bars = await fetchDeep(symbol, interval, limit, maxRetries, barSeconds, nowSec);
    if (bars.length) saveCacheEntry(key, { v: CACHE_VERSION, seededLimit: limit, bars: bars.slice(-MAX_CACHED_BARS) });
    return bars.slice(-limit);
  };

  // ── Paged history fetch — used by backtest.js (no caching; a deep
  // historical pull is a one-off, not a repeating 15-min cost) ───────────
  const fetchHistory = async (symbol, interval, historyDays) => {
    const barSeconds = BAR_SECONDS[interval] || 3600;
    const endAt = Math.floor(Date.now() / 1000);
    const startAt = endAt - historyDays * 86400;
    let allBars = [];
    let chunkEnd = endAt;
    const chunkSize = 1500 * barSeconds;
    let hadGap = false;

    process.stdout.write(`  Fetching ${interval} history for ${symbol}...`);
    while (chunkEnd > startAt) {
      const chunkStart = Math.max(chunkEnd - chunkSize, startAt);
      const { ok, bars } = await fetchKlinesRange(symbol, interval, chunkStart, chunkEnd);
      if (!ok) {
        hadGap = true;
        console.error(`  ⚠️  Giving up on ${symbol} ${interval} chunk [${new Date(chunkStart * 1000).toISOString()} – ${new Date(chunkEnd * 1000).toISOString()}] after ${FETCH_MAX_RETRIES} retries — data will have a gap here, continuing further back.`);
        chunkEnd = chunkStart - 1;
        continue;
      }
      if (!bars.length) break; // genuine end of history — safe to stop
      allBars = [...bars, ...allBars];
      chunkEnd = bars[0].time - 1;
      process.stdout.write('.');
      await sleep(250);
    }
    const seen = new Set();
    allBars = allBars.filter(b => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
    allBars = closedOnly(allBars, barSeconds, endAt); // never replay a half-formed newest candle
    console.log(` ${allBars.length} bars${hadGap ? '  ⚠️  INCOMPLETE — see warnings above' : ''}`);
    return allBars;
  };

  return { getKlines, fetchHistory, BAR_SECONDS };
};

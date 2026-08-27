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

  // ── Live fetch — most recent N candles, cache-aware ─────────────────────
  const getKlines = async (symbol, interval, limit, maxRetries = 2) => {
    if (!CACHE_DIR) return fetchRecent(symbol, interval, limit, maxRetries); // no cacheDir configured — old behavior, unchanged

    const barSeconds = BAR_SECONDS[interval] || 3600;
    const key = `${symbol}|${interval}`;
    const cached = loadCacheEntry(key);
    const nowSec = Math.floor(Date.now() / 1000);

    if (cached && cached.bars && cached.bars.length >= Math.min(limit, 20)) {
      const lastBarTime = cached.bars[cached.bars.length - 1].time;
      const nextBarDue = lastBarTime + barSeconds;
      // Skip the network call entirely if a new bar isn't even due yet —
      // this is the main saving for D1/2H/30M, which don't change
      // between most consecutive 15-min scans.
      if (nowSec < nextBarDue) {
        return cached.bars.slice(-limit).map(b => ({ ...b }));
      }
      // A new bar (or a few, if this run was delayed) may be out — fetch
      // only the delta since the last cached bar via the ranged
      // endpoint, not a full-window re-fetch. A small ranged fetch is 1
      // page, so 2 retries is plenty (matches fetchRecent's own budget).
      const { ok, bars: freshBars } = await fetchKlinesRange(symbol, interval, lastBarTime + 1, nowSec, maxRetries);
      if (!ok) {
        // Couldn't get fresh data this round — serve slightly-stale
        // cached bars rather than none; next scan tries again.
        console.error(`  ⚠️ ${symbol} ${interval}: delta fetch failed — serving cached data (possibly stale) this run.`);
        return cached.bars.slice(-limit).map(b => ({ ...b }));
      }
      if (freshBars.length) {
        const merged = [...cached.bars, ...freshBars].filter((b, i, arr) => arr.findIndex(x => x.time === b.time) === i).sort((a, b) => a.time - b.time);
        const newEntry = { bars: merged.slice(-MAX_CACHED_BARS) };
        saveCacheEntry(key, newEntry);
        return newEntry.bars.slice(-limit).map(b => ({ ...b }));
      }
      // No new bars returned yet (KuCoin hasn't closed the next candle) — serve what we have.
      return cached.bars.slice(-limit).map(b => ({ ...b }));
    }

    // No usable cache yet — full fetch, then seed the cache.
    const bars = await fetchRecent(symbol, interval, limit, maxRetries);
    if (bars.length) {
      saveCacheEntry(key, { bars: bars.slice(-MAX_CACHED_BARS) });
    }
    return bars;
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
    console.log(` ${allBars.length} bars${hadGap ? '  ⚠️  INCOMPLETE — see warnings above' : ''}`);
    return allBars;
  };

  return { getKlines, fetchHistory, BAR_SECONDS };
};

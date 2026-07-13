/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — TWELVE DATA CLIENT (shared/twelvedata.js) — used by FOREX + STOCKS
 *
 *  Same {getKlines, fetchHistory} shape as shared/kucoin.js, so
 *  shared/engine.js, shared/backtest-engine.js, and
 *  shared/position-tracker.js never need to know or care which data
 *  source a given bot is actually running on.
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
 *  as a "range profile" when genuine volume is unavailable, taken
 *  because bars with more intra-bar movement plausibly saw more real
 *  trading activity than bars that barely moved. This is clearly
 *  DIFFERENT from real traded volume and is flagged (`syntheticVolume:
 *  true` on the returned array) so strategy.js can log it once per scan,
 *  not hide it. XAU/USD and equities/stocks generally DO report real
 *  volume from Twelve Data and are used as-is, un-flagged.
 * ═══════════════════════════════════════════════════════════════════════
 */
const axios = require('axios');

// ── Process-wide rate limiter ──────────────────────────────────────────
// Twelve Data's free/basic plan caps usage at a small number of API
// credits PER MINUTE (the exact error seen in production: "You have run
// out of API credits for the current minute... current limit being 8").
// Nothing before this fix paced requests at all — engine.js fires 2H/
// 30M/15M concurrently via Promise.all, and fetchHistory's chunked loop
// only waited 1.2s between chunks, so a single symbol could burn 8+
// credits in under 10 seconds. This queue serializes EVERY request made
// through this module (both getKlines and fetchHistory, live scan and
// backtest alike) and enforces a minimum gap between them, so concurrent
// callers can never burst past the plan's per-minute cap.
const MIN_GAP_MS = 8000; // ~7.5 requests/min — safely under an 8/min cap
let queueTail = Promise.resolve();
let lastCallAt = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const throttled = (fn) => {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return fn();
  });
  // Never let one failed call break the queue for everyone after it.
  queueTail = run.then(() => {}, () => {});
  return run;
};

module.exports = function createTwelveDataClient(config) {
  const BASE = 'https://api.twelvedata.com/time_series';
  const BAR_SECONDS = { '15min': 900, '30min': 1800, '45min': 2700, '1h': 3600, '2h': 7200, '4h': 14400, '1day': 86400 };

  const toBars = (values) => (values || [])
    .map(v => ({
      time: Math.floor(Date.parse(`${v.datetime}Z`.replace(' ', 'T')) / 1000) || Math.floor(Date.parse(v.datetime) / 1000),
      open: parseFloat(v.open), high: parseFloat(v.high), low: parseFloat(v.low), close: parseFloat(v.close),
      volume: v.volume != null ? parseFloat(v.volume) : 0,
    }))
    .filter(b => Number.isFinite(b.time) && Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time);

  // Applies the documented synthetic-volume fallback in place when real
  // volume is absent/zero across (almost) the whole set — a handful of
  // genuine zero-volume bars on an otherwise-volumed symbol (e.g. a thin
  // pre-market stock print) should NOT trigger the range-proxy for the
  // whole array, so this only fires when volume is zero across >=95% of
  // bars, not just some.
  const applyVolumeFallback = (bars) => {
    if (!bars.length) return bars;
    const zeroCount = bars.filter(b => !(b.volume > 0)).length;
    if (zeroCount / bars.length < 0.95) return bars; // real volume present — leave untouched
    const withProxy = bars.map(b => ({ ...b, volume: Math.max(b.high - b.low, 1e-9) }));
    withProxy.syntheticVolume = true;
    return withProxy;
  };

  const isCreditExhaustion = (msg) => /run out of api credits/i.test(msg || '');

  const request = async (params, maxRetries = 3) => {
    if (!config.TWELVE_DATA_KEY) {
      console.error(`  ❌ TWELVE_DATA_KEY is missing/empty — this bot cannot fetch ANY data until it's set. Check the TWELVE_DATA_KEY secret in your repo's Settings → Secrets and variables → Actions, and that the workflow passes it through (env: TWELVE_DATA_KEY: \${{ secrets.TWELVE_DATA_KEY }}).`);
      return { status: 'error', message: 'TWELVE_DATA_KEY missing', __noKey: true };
    }
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await throttled(() => axios.get(BASE, { params: { ...params, apikey: config.TWELVE_DATA_KEY, timezone: 'UTC' }, timeout: 20000 }));
        if (res.data && res.data.status === 'error') {
          const code = res.data.code;
          const msg = res.data.message || 'unknown';
          if (isCreditExhaustion(msg)) {
            // The per-minute credit window needs a FULL minute to refill —
            // an 8-second gap (MIN_GAP_MS) isn't enough on its own if
            // multiple bots/workflows share this same key concurrently.
            // Wait out a full window plus buffer rather than retrying
            // into the same exhausted window.
            console.error(`  ⏳ Twelve Data credit limit hit (attempt ${attempt}/${maxRetries}): ${msg} — waiting 65s for the per-minute window to reset.`);
            if (attempt === maxRetries) return res.data;
            await sleep(65000);
            continue;
          }
          const authHint = (code === 401 || code === 403 || /api ?key/i.test(msg))
            ? ' — this looks like an invalid/expired TWELVE_DATA_KEY, not a transient error. Retrying anyway in case it is transient, but check the key if this keeps happening.'
            : '';
          console.error(`  ❌ Twelve Data error (attempt ${attempt}/${maxRetries}): [${code}] ${msg}${authHint}`);
          if (attempt === maxRetries) return res.data;
          await sleep(1200 * attempt);
          continue;
        }
        return res.data;
      } catch (e) {
        const msg = e.response?.data?.message || e.message;
        console.error(`  ❌ Twelve Data fetch error (attempt ${attempt}/${maxRetries}):`, msg);
        if (attempt === maxRetries) return null;
        await sleep(1200 * attempt);
      }
    }
    return null;
  };

  // ── Live fetch — most recent N candles ─────────────────────────────────
  const getKlines = async (symbol, interval, limit) => {
    const safeLimit = Math.min(limit + 20, 5000);
    const data = await request({ symbol, interval, outputsize: safeLimit, order: 'ASC' });
    if (!data || data.status === 'error' || !Array.isArray(data.values)) return [];
    const bars = toBars(data.values).slice(-limit);
    return applyVolumeFallback(bars);
  };

  // ── Paged/ranged history fetch — used by backtest.js ───────────────────
  const fetchHistory = async (symbol, interval, historyDays) => {
    const endDate = new Date();
    const startDate = new Date(Date.now() - historyDays * 86400 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    process.stdout.write(`  Fetching ${interval} history for ${symbol}...`);
    let allBars = [];
    let sawError = null;
    // Twelve Data's time_series accepts start_date/end_date directly and
    // pages internally up to outputsize per call — chunk defensively in
    // ~4500-bar windows (per interval) so a single request never risks
    // hitting the plan's per-call outputsize ceiling. Pacing between
    // chunks is handled centrally by the throttled() queue above, not
    // here — every request, from every symbol/timeframe, shares one
    // clock so the real per-minute cap can never be exceeded regardless
    // of how many chunks or symbols are in flight.
    const barSeconds = BAR_SECONDS[interval] || 3600;
    const chunkSeconds = 4500 * barSeconds;
    let cursorEnd = endDate;
    const startSeconds = Math.floor(startDate.getTime() / 1000);

    while (Math.floor(cursorEnd.getTime() / 1000) > startSeconds) {
      const cursorStart = new Date(Math.max(cursorEnd.getTime() - chunkSeconds * 1000, startDate.getTime()));
      const data = await request({
        symbol, interval, order: 'ASC',
        start_date: fmt(cursorStart), end_date: fmt(cursorEnd),
        // NOTE: deliberately NOT sending outputsize alongside start_date/
        // end_date — Twelve Data's own docs warn that combining them can
        // truncate/restrict the result. The date range alone bounds the
        // request; chunkSeconds above already keeps each window under
        // the 5,000-point per-call ceiling.
      });
      if (data && data.__noKey) { sawError = 'NO_API_KEY'; break; }
      if (data && data.status === 'error' && isCreditExhaustion(data.message)) { sawError = 'credit limit exhausted even after backoff — plan may need a higher tier for this symbol/day count'; break; }
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

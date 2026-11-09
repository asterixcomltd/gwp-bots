/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — CANDLE RESAMPLER (shared/resample.js)
 *
 *  Builds a higher-timeframe candle series from a lower one. Needed for the
 *  H1 / H3 / H4 timeframes: KuCoin has no 3-hour candle and Twelve Data
 *  has none either, so H3 cannot be fetched at all — and building H1/H4
 *  from M30/H2 costs ZERO extra API calls (no extra credits on Twelve Data).
 *
 *  Rules (all unit-tested in tests/test-resample.js):
 *   • Bucket start = open time of the first source slot of that bucket.
 *       origin 'utc'     → floor(t / dst) * dst   (crypto, forex)
 *       origin 'session' → per UTC date, counted from that date's first bar
 *                          (equities: 09:30 ET open, DST-proof)
 *   • A bucket is emitted ONLY when complete: it holds every source bar it
 *     should (count === dst/src), OR a later source bar already exists
 *     past the bucket end (market was closed for the rest of it — weekends,
 *     equity session end). A still-forming bucket is NEVER emitted, so a
 *     half-built candle can never reach the strategy.
 *   • open = first.open, close = last.close, high/low = extremes,
 *     volume = sum.
 * ═══════════════════════════════════════════════════════════════════════
 */
const resample = (bars, srcSec, dstSec, origin = 'utc') => {
  if (!Array.isArray(bars) || !bars.length) return [];
  const n = Math.round(dstSec / srcSec);
  if (n <= 1) return bars.map(b => ({ ...b }));

  const firstOfDate = {};
  if (origin === 'session') {
    for (const b of bars) {
      const d = Math.floor(b.time / 86400);
      if (firstOfDate[d] === undefined || b.time < firstOfDate[d]) firstOfDate[d] = b.time;
    }
  }
  const bucketStartOf = (t) => {
    if (origin === 'session') {
      const d = Math.floor(t / 86400);
      const f = firstOfDate[d];
      return f + Math.floor((t - f) / dstSec) * dstSec;
    }
    return Math.floor(t / dstSec) * dstSec;
  };

  const buckets = [];
  let cur = null;
  for (const b of bars) {
    const s = bucketStartOf(b.time);
    if (!cur || cur.start !== s) { cur = { start: s, bars: [] }; buckets.push(cur); }
    cur.bars.push(b);
  }

  const out = [];
  for (let i = 0; i < buckets.length; i++) {
    const bk = buckets[i];
    const full = bk.bars.length >= n;
    const complete = full || i < buckets.length - 1;
    if (!complete) continue; // forming — never emit
    // `avail` = the moment this candle first becomes visible to a live scan
    // (all its source bars closed; or, for a short bucket, when the next
    // bucket's first source bar closed). The backtest uses it so it never
    // sees a candle earlier than the live bot would.
    const lastSrc = bk.bars[bk.bars.length - 1];
    const avail = full ? lastSrc.time + srcSec : buckets[i + 1].bars[0].time + srcSec;
    const first = bk.bars[0], last = bk.bars[bk.bars.length - 1];
    let hi = -Infinity, lo = Infinity, vol = 0;
    for (const x of bk.bars) { if (x.high > hi) hi = x.high; if (x.low < lo) lo = x.low; vol += (x.volume || 0); }
    out.push({ time: bk.start, open: first.open, high: hi, low: lo, close: last.close, volume: vol, avail });
  }
  return out;
};

module.exports = { resample };

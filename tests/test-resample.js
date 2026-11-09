// Unit tests for shared/resample.js and the closed-candle rules. No network.
const assert = require('assert');
const { resample } = require('../shared/resample');
const mk = (t, o, h, l, c, v = 1) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

// 12 × M30 bars starting 00:00 UTC (day 20000)
const D = 20000 * 86400;
const m30 = Array.from({ length: 12 }, (_, i) => mk(D + i * 1800, 10 + i, 20 + i, 5 + i, 11 + i, 2));

ok('M30→H1 aggregates OHLCV correctly', () => {
  const h1 = resample(m30, 1800, 3600);
  assert.strictEqual(h1.length, 6);
  assert.deepStrictEqual([h1[0].time, h1[0].open, h1[0].close, h1[0].high, h1[0].low, h1[0].volume], [D, 10, 12, 21, 5, 4]);
});
ok('M30→H3 emits only COMPLETE buckets (forming bucket never emitted)', () => {
  const h3 = resample(m30.slice(0, 9), 1800, 10800); // 1 full bucket + 3 bars of the next (forming)
  assert.strictEqual(h3.length, 1);
  assert.strictEqual(h3[0].time, D);
  assert.strictEqual(h3[0].volume, 12);
});
ok('H3 buckets are aligned to UTC 3h boundaries, not to the first bar', () => {
  const shifted = m30.slice(2); // starts 01:00
  const h3 = resample(shifted, 1800, 10800);
  assert.strictEqual(h3.length, 2);           // truncated-history first bucket + the full 03:00–06:00 one
  assert.deepStrictEqual(h3.map(b => b.time), [D, D + 10800]); // both start ON the 3h grid
});
ok('H4 from H2 pairs', () => {
  const h2 = Array.from({ length: 6 }, (_, i) => mk(D + i * 7200, 1, 2 + i, 0, 1, 1));
  const h4 = resample(h2, 7200, 14400);
  assert.strictEqual(h4.length, 3);
  assert.strictEqual(h4[1].time, D + 14400);
});
ok('gap (market closed): a short bucket completes once a later bucket exists', () => {
  const bars = [mk(D, 1, 2, 0, 1), mk(D + 1800, 1, 2, 0, 1), /* gap */ mk(D + 4 * 3600, 1, 2, 0, 1), mk(D + 4 * 3600 + 1800, 1, 2, 0, 1)];
  const h4 = resample(bars, 1800, 14400);
  assert.strictEqual(h4.length, 1);           // 00:00 bucket short (2 of 8) but complete; 04:00 bucket still forming
  assert.strictEqual(h4[0].avail, D + 4 * 3600 + 1800); // visible when the next bucket's first bar closed
});
ok('avail = close of the last source bar for a full bucket', () => {
  const h1 = resample(m30, 1800, 3600);
  assert.strictEqual(h1[0].avail, D + 3600);
});
ok('session origin anchors buckets to each day\'s first bar (09:30-style open)', () => {
  const open = D + 14.5 * 3600; // 14:30 UTC
  const bars = Array.from({ length: 13 }, (_, i) => mk(open + i * 1800, 1, 2, 0, 1));
  const h1 = resample(bars, 1800, 3600, 'session');
  assert.strictEqual(h1[0].time, open);       // NOT floor to the hour (14:00)
  assert.strictEqual(h1.length, 6);           // 13th bar alone is forming
});
console.log(`\n✅ ${n} resample tests passed`);

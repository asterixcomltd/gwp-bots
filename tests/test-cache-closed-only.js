// Mocked-network test of the closed-candle-only cache (KuCoin + Twelve Data share the design).
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const axiosPath = require.resolve('axios');
let NOW = 1_800_000_000; const realNow = Date.now; Date.now = () => NOW * 1000;
const BAR = 1800;
// Exchange simulator: 30m bars, newest one is FORMING (volume grows with time inside the bar).
const exchange = (startAt, endAt, limit) => {
  const out = []; const first = Math.floor(NOW / BAR) * BAR - 2000 * BAR;
  for (let t = first; t <= Math.floor(NOW / BAR) * BAR; t += BAR) {
    if (startAt && t < startAt - BAR + 1 && t + BAR <= startAt) continue;
    if (endAt && t > endAt) continue;
    const elapsed = Math.min(BAR, Math.max(1, NOW - t)); // seconds into the bar
    out.push([String(t), '100', '101', '102', '99', String(elapsed / BAR * 10), '0']);
  }
  return out.reverse().slice(0, limit || 1500);
};
let calls = 0;
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { get: async (url) => {
  calls++; const q = Object.fromEntries(new URL(url).searchParams); 
  return { data: { code: '200000', data: exchange(q.startAt && +q.startAt, q.endAt && +q.endAt, q.limit && +q.limit) } };
} } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-'));
const cfg = { __cacheDir: dir };
const { fetchHistory, getKlines } = require('../shared/kucoin.js')(cfg);
(async () => {
  NOW = Math.floor(1_800_000_000 / BAR) * BAR + 600; // 10 min into a bar
  const a = await getKlines('BTC-USDT', '30min', 300);
  assert.ok(a.length >= 290, 'seeded ' + a.length);
  assert.ok(a.every(b => b.time + BAR <= NOW), 'returned a forming candle');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cache', 'BTC-USDT-30min.json'))).bars;
  assert.strictEqual(saved.length > 0 && saved.every(b => b.time + BAR <= NOW), true, 'cache holds a forming candle');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'cache', 'BTC-USDT-30min.json'))).v, 2);

  // 3 bars later: delta fetch, every stored bar must still be a FULL closed bar with final volume
  NOW += 3 * BAR + 120;
  const b = await getKlines('BTC-USDT', '30min', 300);
  assert.ok(b.every(x => x.time + BAR <= NOW));
  const lastClosed = Math.floor(NOW / BAR) * BAR - BAR;
  assert.strictEqual(b[b.length - 1].time, lastClosed, 'newest returned bar is the last CLOSED one');
  assert.ok(b.every(x => Math.abs(x.volume - 10) < 1e-9), 'a stored bar has partial volume — frozen half-candle');

  // Old-format (pre-v2) cache must be discarded and reseeded
  fs.writeFileSync(path.join(dir, 'cache', 'ETH-USDT-30min.json'), JSON.stringify({ bars: [{ time: NOW - 5 * BAR, open: 1, high: 1, low: 1, close: 1, volume: 0.1 }] }));
  const c = await getKlines('ETH-USDT', '30min', 50);
  assert.ok(c.length >= 40 && c.every(x => Math.abs(x.volume - 10) < 1e-9), 'old-format cache was not reseeded');

  // No new closed bar due -> no network call
  const before = calls; await getKlines('BTC-USDT', '30min', 300); assert.strictEqual(calls, before, 'needless network call');
  Date.now = realNow;
  console.log('✅ closed-candle cache: seeds closed-only, never freezes a partial bar, reseeds old-format caches, skips needless calls');
})().catch(e => { console.error(e); process.exit(1); });

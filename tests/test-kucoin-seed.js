// KuCoin deep seed (v1.3.1): un-ranged candle calls only return ~100 bars, so seeding must page back.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const axios = require('axios');
const now = Math.floor(Date.now() / 1000);
const SECS = { '15min': 900, '30min': 1800, '2hour': 7200 };
const series = {};
for (const iv in SECS) { const s = SECS[iv], end = Math.floor(now / s) * s; series[iv] = []; for (let i = 5000; i >= 0; i--) { const t = end - i * s; series[iv].push([t, 100, 101, 102, 99, 5]); } }
let calls = 0;
axios.get = async (url) => {
  calls++;
  const u = new URL(url), iv = u.searchParams.get('type'), a = u.searchParams.get('startAt'), b = u.searchParams.get('endAt');
  let rows = series[iv];
  if (a) rows = rows.filter(r => r[0] >= +a && r[0] <= +b).slice(-1500); else rows = rows.slice(-100); // real behaviour: short default window
  return { data: { code: '200000', data: rows.slice().reverse().map(r => r.map(String)) } };
};
const createKucoinClient = require('../shared/kucoin');
(async () => {
  for (const withCache of [false, true]) {
    const cfg = { __cacheDir: withCache ? fs.mkdtempSync(path.join(os.tmpdir(), 'gwpk')) : undefined };
    const kc = createKucoinClient(cfg);
    for (const [iv, limit] of [['30min', 1320], ['2hour', 1000], ['15min', 519]]) {
      const bars = await kc.getKlines('ETH-USDT', iv, limit);
      assert.strictEqual(bars.length, limit, `${iv} limit ${limit} got ${bars.length}`);
      assert.ok(bars.every((x, i) => i === 0 || x.time > bars[i - 1].time), 'ascending, no duplicates');
      assert.ok(bars[bars.length - 1].time + SECS[iv] <= now, 'closed bars only');
    }
  }
  console.log('✅ test-kucoin-seed passed');
})().catch(e => { console.error(e); process.exit(1); });

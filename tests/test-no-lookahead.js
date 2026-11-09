// The backtest must never act on a higher-timeframe candle that had not CLOSED yet.
const assert = require('assert'), path = require('path');
const config = require(path.join(__dirname, '../bots/crypto/config.js'));
const core = require('../shared/core.js');
const { buildPlan, derivePlanBars } = require('../shared/tf-plan.js');
const createBT = require('../shared/backtest-engine.js');
const plan = buildPlan(config);
// Spy: record the newest bar of every higher-TF window handed to the vote, with the tick time.
let tick = 0, worst = 0, calls = 0;
const origVote = core.tfBiasVote;
core.tfBiasVote = (data, a, b, c, d) => {
  const last = data[data.length - 1];
  if (last && last.__sec && last.__sec >= 1800) { calls++; const closeAt = last.avail !== undefined ? last.avail : last.time + last.__sec; worst = Math.max(worst, closeAt - tick); }
  return origVote(data, a, b, c, d);
};
let seed = 7; const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const N = 9000, t0 = 1700000000 - (1700000000 % 86400); let p = 100;
const m15 = Array.from({ length: N }, (_, i) => { const o = p, c = o + (rand() - 0.5) * 0.8; p = c; return { time: t0 + i * 900, open: o, close: c, high: Math.max(o, c) + rand() * 0.3, low: Math.min(o, c) - rand() * 0.3, volume: 100 + rand() * 900 }; });
const agg = (bars, sec) => { const n = sec / 900, out = []; for (let i = 0; i + n <= bars.length; i += n) { const ch = bars.slice(i, i + n); out.push({ time: ch[0].time, open: ch[0].open, close: ch[n - 1].close, high: Math.max(...ch.map(b => b.high)), low: Math.min(...ch.map(b => b.low)), volume: ch.reduce((s, b) => s + b.volume, 0) }); } return out; };
const base = { M15: m15, M30: agg(m15, 1800), H2: agg(m15, 7200) };
const pb = derivePlanBars(plan, base);
for (const e of plan.entries) for (const b of pb[e.label]) Object.defineProperty(b, '__sec', { value: e.seconds, enumerable: false });
// tick-time spy via the clock bar: wrap the clock array so the engine's slice tells us the tick
pb[plan.clock.label] = new Proxy(pb[plan.clock.label], { get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof k === 'string' && /^\d+$/.test(k) && v && v.time) tick = v.time + plan.clock.seconds; return v; } });
const E = createBT({ config, core, version: 't', botLabel: 't', plan });
const log = console.log; console.log = () => {};
E.backtestSymbol('X', pb, 0, plan).then(() => { console.log = log; assert.ok(calls > 100, 'spy saw higher-TF votes: ' + calls); assert.ok(worst <= 0, `a higher-TF candle was used before it closed (by ${worst}s)`); console.log(`✅ no look-ahead: ${calls} higher-timeframe votes checked, newest candle always already closed (margin ${-worst}s)`); });

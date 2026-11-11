// GROUPS profile — group enforcement (v1.3.1)
const assert = require('assert');
const core = require('../shared/core');
const v = (o) => Object.entries(o).map(([tf, b]) => ({ tf, result: b ? { bias: b } : null }));
const G = [{ name: 'trigger', labels: ['M15', 'M30'], min: 1 }, { name: 'structure', labels: ['H1', 'H2'], min: 1 }, { name: 'bias', labels: ['H3', 'H4'], min: 1 }];
const Gbias = G.map(g => ({ ...g, noOppose: g.name === 'bias' }));
const B = 'BULLISH', S = 'BEARISH', N = 'NEUTRAL';
const all = (m15, m30, h1, h2, h3, h4) => v({ M15: m15, M30: m30, H1: h1, H2: h2, H3: h3, H4: h4 });
let r;
r = core.resolveGroupDirection(all(B, N, N, B, N, B), G, true); assert.strictEqual(r.direction, 'BUY'); assert.strictEqual(r.tally, '3/6');
// 3 agree but NO bias member -> the old 3-of-6 would pass; groups must reject
r = core.resolveGroupDirection(all(B, B, N, B, N, N), G, true); assert.strictEqual(r, null);
// missing trigger / missing structure
assert.strictEqual(core.resolveGroupDirection(all(N, N, B, B, B, B), G, true), null);
assert.strictEqual(core.resolveGroupDirection(all(B, B, N, N, B, B), G, true), null);
// no-data members abstain
r = core.resolveGroupDirection(all(S, null, null, S, null, S), G, true); assert.strictEqual(r.direction, 'SELL');
// opposition inside a group
assert.strictEqual(core.resolveGroupDirection(all(B, N, B, B, B, S), G, true), null);
r = core.resolveGroupDirection(all(B, N, B, B, B, S), G, false); assert.strictEqual(r.direction, 'BUY'); // allowed when switch is off
// ambiguous: each direction qualifies when opposition is allowed
assert.strictEqual(core.resolveGroupDirection(all(B, S, B, S, B, S), G, false), null);
// bias min 2 (both must agree)
const G2 = G.map(g => g.name === 'bias' ? { ...g, min: 2 } : g);
assert.strictEqual(core.resolveGroupDirection(all(B, N, N, B, B, N), G2, true), null);
r = core.resolveGroupDirection(all(B, N, N, B, B, B), G2, true); assert.strictEqual(r.direction, 'BUY'); assert.strictEqual(r.tally, '4/6');
// plan wiring
const cfg = require('../bots/crypto/config'); const { buildPlan } = require('../shared/tf-plan');
const p = buildPlan(cfg, { profile: 'GROUPS' });
assert.ok(p.groups && p.groups.noOppose === 'bias' && p.groups.list.length === 3);
assert.deepStrictEqual(p.groups.list.map(g => g.noOppose), [false, false, true]);
// trigger disagreement alone (M15 vs M30) must NOT block a fully aligned setup under the default
r = core.resolveGroupDirection(all(B, S, B, B, B, B), Gbias); assert.strictEqual(r.direction, 'BUY');
// ...but a bias conflict does
assert.strictEqual(core.resolveGroupDirection(all(B, B, B, B, B, S), Gbias), null);
assert.strictEqual(p.struct.label, 'H2'); assert.deepStrictEqual(p.gate.map(g => g.label), ['H3', 'H4']);
assert.strictEqual(buildPlan(cfg, { profile: 'GROUPS', biasMin: 2 }).groups.list[2].min, 2);
assert.strictEqual(buildPlan(cfg, { profile: 'H6' }).groups, null); assert.ok(buildPlan(cfg).groups); // GROUPS is the default; H6 stays available
console.log('✅ test-groups passed');

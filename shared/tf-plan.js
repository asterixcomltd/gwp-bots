/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — TIMEFRAME PLAN (shared/tf-plan.js)   v1.3.3
 *
 *  ONE description of "which timeframes exist, which vote, and what job
 *  each one does", read by BOTH the live engine and the backtest engine so
 *  they can never disagree about it.
 *
 *  PROFILES
 *    H6      (default) M15 · M30 · H1 · H2 · H3 · H4 — 3-of-6 vote
 *              M30  = TRIGGER  (rejection-candle pattern is read on M30)
 *              H2   = STRUCTURE (owns the zone: swing / Fib pocket / VP /
 *                      SL anchor — unchanged from before)
 *              H4   = BIAS     (+ the HTF zone cross-check, + gate member)
 *              H3   = BIAS     (+ gate member, configurable)
 *              H1   = vote (+ optional gate member)
 *              M15  = vote + the live clock (+ optional entry-timing check)
 *    LEGACY  the previous D1 · 30M · 2H · 15M 3-of-4 design, byte-for-byte
 *            behaviour — a one-line rollback (GWP_TF_PROFILE=LEGACY).
 *
 *  H1 / H3 / H4 are BUILT from M30 / H2 candles (shared/resample.js): no
 *  provider offers a 3-hour candle, and building the others costs no extra
 *  API calls / Twelve Data credits.
 *
 *  ROLE VARIANT (H6): { m15Timing, h1Gate, h3Gate, gateMin }  — see
 *  ROLE_DEFAULTS below and the README's "Timeframe roles" section.
 * ═══════════════════════════════════════════════════════════════════════
 */
const { resample } = require('./resample');

const SEC = { M15: 900, M30: 1800, H1: 3600, H2: 7200, H3: 10800, H4: 14400, D1: 86400 };

// Chosen defaults for the three roles the owner asked to be "found".
// See README "Timeframe roles" for the evidence and the honest caveats.
const ROLE_DEFAULTS = { m15Timing: false, h1Gate: false, h3Gate: true, gateMin: 'cfg' };

const envBool = (v, d) => (v === undefined || v === '' ? d : v === 'true' || v === '1');

const profileName = (config, variantIn = {}) => String(variantIn.profile || process.env.GWP_TF_PROFILE || config.TF_PROFILE || 'H6').toUpperCase();

const resolveVariant = (config, variant = {}) => {
  const d = { ...ROLE_DEFAULTS, ...(config.TF_ROLES || {}) };
  return {
    m15Timing: variant.m15Timing ?? envBool(process.env.GWP_M15_TIMING, d.m15Timing),
    h1Gate:    variant.h1Gate    ?? envBool(process.env.GWP_H1_GATE,    d.h1Gate),
    h3Gate:    variant.h3Gate    ?? envBool(process.env.GWP_H3_GATE,    d.h3Gate),
    gateMin:   variant.gateMin   ?? (process.env.GWP_GATE_MIN || d.gateMin), // 'cfg' | 'all' | number
  };
};

const buildPlan = (config, variantIn = {}) => {
  const profile = profileName(config, variantIn);
  // Votes needed (H6 / LEGACY profiles). v1.3.3: the six-way vote defaults to 4-of-6 — the real 360-day sweep showed
  // 4-of-6 keeps the win rate high (crypto 66%, forex 78%, stocks 91%) with ~1 stop-out per bot, where 3-of-6 let in
  // 5–18 stop-outs. LEGACY keeps its own 3-of-4. Env GWP_MIN_TF_AGREE overrides; config.H6_MIN_TF_AGREE sets the default.
  if (config.__baseMinAgree === undefined) config.__baseMinAgree = config.MIN_TF_AGREE;
  const envMin = process.env.GWP_MIN_TF_AGREE ? Math.max(2, parseInt(process.env.GWP_MIN_TF_AGREE, 10) || 0) : 0;
  const minAgree = variantIn.minAgree || envMin || (profile === 'H6' ? (config.H6_MIN_TF_AGREE || 4) : config.__baseMinAgree);
  const baseName = { M15: config.TRIGGER_TIMEFRAME, M30: config.BIAS_TIMEFRAME, H2: config.STRUCT_TIMEFRAME, D1: config.DAILY_TIMEFRAME };
  const origin = config.TF_BUCKET_ORIGIN || 'utc';
  const lbOverride = config.TF_LOOKBACKS || {};
  const lb = (key, vp, fib) => (lbOverride[key] ? { vp: lbOverride[key][0], fib: lbOverride[key][1] } : { vp: vp, fib: fib });

  let entries, variant = null;
  if (profile === 'LEGACY') {
    entries = [
      { label: 'D1',  base: 'D1',  n: 1, seconds: 86400, vp: config.DAILY_VP_LOOKBACK,   fib: config.DAILY_FIB_LOOKBACK,   roles: ['gate'],            optional: true },
      { label: '30M', base: 'M30', n: 1, seconds: 1800,  vp: config.BIAS_VP_LOOKBACK,    fib: config.BIAS_FIB_LOOKBACK,    roles: ['gate', 'htfzone'], optional: true },
      { label: '2H',  base: 'H2',  n: 1, seconds: 7200,  vp: config.STRUCT_VP_LOOKBACK,  fib: config.STRUCT_FIB_LOOKBACK,  roles: ['struct'] },
      { label: '15M', base: 'M15', n: 1, seconds: 900,   vp: config.TRIGGER_VP_LOOKBACK, fib: config.TRIGGER_FIB_LOOKBACK, roles: ['trigger'] },
    ];
  } else {
    variant = resolveVariant(config, variantIn);
    const bl = lb('M30', config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK);
    const h1 = lb('H1',  config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK);
    const h3 = lb('H3',  config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK);
    const h4 = lb('H4',  config.BIAS_VP_LOOKBACK, config.BIAS_FIB_LOOKBACK);
    const m15 = lb('M15', config.TRIGGER_VP_LOOKBACK, config.TRIGGER_FIB_LOOKBACK);
    entries = [
      { label: 'M15', base: 'M15', n: 1, seconds: SEC.M15, vp: m15.vp, fib: m15.fib, roles: variant.m15Timing ? ['clock', 'timing'] : ['clock'] },
      { label: 'M30', base: 'M30', n: 1, seconds: SEC.M30, vp: bl.vp,  fib: bl.fib,  roles: ['trigger'] },
      { label: 'H1',  base: 'M30', n: 2, seconds: SEC.H1,  vp: h1.vp,  fib: h1.fib,  roles: variant.h1Gate ? ['gate'] : [], optional: true },
      { label: 'H2',  base: 'H2',  n: 1, seconds: SEC.H2,  vp: config.STRUCT_VP_LOOKBACK, fib: config.STRUCT_FIB_LOOKBACK, roles: ['struct'] },
      { label: 'H3',  base: 'M30', n: 6, seconds: SEC.H3,  vp: h3.vp,  fib: h3.fib,  roles: variant.h3Gate ? ['gate'] : [], optional: true },
      { label: 'H4',  base: 'H2',  n: 2, seconds: SEC.H4,  vp: h4.vp,  fib: h4.fib,  roles: ['gate', 'htfzone'], optional: true },
    ];
  }

  // GROUPS profile (v1.3.1): same six timeframes as H6, but the vote is replaced by three ENFORCED
  // groups — triggers (M15, M30), structures (H1, H2), bias (H3, H4). Direction needs every group
  // positive; a group is positive when at least `min` of its members agree (default 1) and, for the
  // guarded groups (default: bias), none of its members points the other way. One member per group
  // means at least 3 timeframes agree, so a separate "3-of-6" rule is redundant and is not applied.
  let groups = null;
  if (profile === 'GROUPS') {
    const envNum = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));
    const biasMin = variantIn.biasMin ?? envNum(process.env.GWP_GROUP_BIAS_MIN, (config.GROUPS && config.GROUPS.biasMin) || 1);
    // Which groups must ALSO have no member pointing the other way. Default: the BIAS group only — a
    // macro conflict (H3 bullish vs H4 bearish) is a real contradiction, while M15 vs M30 (or H1 vs H2)
    // disagreeing is routine. 'none' | 'bias' | 'structure,bias' | 'all' (env GWP_GROUP_NO_OPPOSE).
    const noOpp = String(variantIn.noOppose ?? process.env.GWP_GROUP_NO_OPPOSE ?? (config.GROUPS && config.GROUPS.noOppose) ?? 'bias').toLowerCase();
    const guarded = (name) => noOpp === 'all' || noOpp.split(',').map(x => x.trim()).includes(name);
    const minTotal = variantIn.minTotal ?? (process.env.GWP_GROUP_MIN_TOTAL ? parseInt(process.env.GWP_GROUP_MIN_TOTAL, 10) : ((config.GROUPS && config.GROUPS.minTotal) || 0));
    groups = {
      noOppose: noOpp,
      minTotal,
      list: [
        { name: 'trigger',   labels: ['M15', 'M30'], min: 1, noOppose: guarded('trigger') },
        { name: 'structure', labels: ['H1', 'H2'],   min: 1, noOppose: guarded('structure') },
        { name: 'bias',      labels: ['H3', 'H4'],   min: biasMin, noOppose: guarded('bias') },
      ],
    };
  }

  for (const e of entries) e.derived = e.n > 1;
  const byRole = (r) => entries.filter(e => e.roles.includes(r));
  const struct = byRole('struct')[0];
  const trigger = byRole('trigger')[0] || byRole('clock')[0];
  const clock = byRole('clock')[0] || trigger; // finest tick the engine walks / the freshest close
  const gate = byRole('gate');
  const htfzone = byRole('htfzone')[0] || null;
  const timing = byRole('timing')[0] || null;

  // How many gate members must be aligned. LEGACY / 'cfg': the existing config values (1).
  const cfgMinPoc = config.DUAL_MULTI_TF_POC_MIN_ALIGNED, cfgMinFib = config.DUAL_MULTI_TF_FIB_MIN_ALIGNED;
  let gateMinPoc = cfgMinPoc, gateMinFib = cfgMinFib;
  if (variant && variant.gateMin === 'all') { gateMinPoc = gate.length; gateMinFib = gate.length; }
  else if (variant && Number.isFinite(Number(variant.gateMin)) && variant.gateMin !== 'cfg') { gateMinPoc = gateMinFib = Number(variant.gateMin); }

  // Trigger-pattern lookbacks are expressed in TRIGGER-TF bars; scale them
  // so the wall-clock look-back stays what it was when the trigger was 15M.
  const scale = (bars) => Math.max(1, Math.round(bars * 900 / trigger.seconds));
  const triggerLookbackBars = profile === 'LEGACY' ? config.TRIGGER_LOOKBACK_BARS : scale(config.TRIGGER_LOOKBACK_BARS);
  const sweepLookbackBars   = profile === 'LEGACY' ? config.LIQUIDITY_SWEEP_LOOKBACK_BARS : scale(config.LIQUIDITY_SWEEP_LOOKBACK_BARS);

  // Provider-fetched ("base") series and how many bars each needs.
  const atrN = config.ATR_PERIOD + 5;
  let structLimit = config.STRUCT_VP_LOOKBACK;
  if (config.NAKED_POC_ENABLED) structLimit = Math.max(structLimit, config.STRUCT_VP_LOOKBACK * 2);
  if (config.POC_MIGRATION_ENABLED) structLimit = Math.max(structLimit, config.STRUCT_VP_LOOKBACK + config.POC_MIGRATION_OFFSET_BARS);
  const baseNeeds = {};
  for (const e of entries) {
    const own = e.roles.includes('struct') ? Math.max(structLimit, e.vp + config.ATR_PERIOD + 5) : Math.max(e.vp, e.fib) + atrN;
    const need = e.n > 1 ? own * e.n + e.n : own;
    baseNeeds[e.base] = Math.max(baseNeeds[e.base] || 0, need);
  }

  return {
    profile, variant, groups, minAgree, entries, struct, trigger, clock, gate, htfzone, timing, origin,
    gateMinPoc, gateMinFib, triggerLookbackBars, sweepLookbackBars,
    baseNeeds, baseName, structLimit,
    // key used by RISK_TIER_MATRIX ("POC_2H" / "POC_NO2H") — always the physical 2H structure TF
    structMatrixLabel: '2H',
    voteLabel: entries.map(e => e.label),
    describe() {
      if (groups) return 'GROUPS ' + groups.list.map(g => `${g.name}[${g.labels.join('/')}]>=${g.min}`).join(' ') + ` no-oppose:${groups.noOppose}` + `  [struct=${struct.label} trigger=${trigger.label} gate=${gate.map(g => g.label).join('+') || '-'}]`;
      return entries.map(e => `${e.label}${e.derived ? '*' : ''}(${e.vp})`).join(' / ') +
        `  [struct=${struct.label} trigger=${trigger.label} gate=${gate.map(g => g.label).join('+') || '-'}${timing ? ' timing=' + timing.label : ''}]`;
    },
  };
};

// Build every plan series from the provider-fetched base series.
// baseBars = { M15:[...], M30:[...], H2:[...], D1:[...] }
const derivePlanBars = (plan, baseBars) => {
  const out = {};
  for (const e of plan.entries) {
    const src = baseBars[e.base] || [];
    if (!e.derived) { out[e.label] = src; continue; }
    const srcSec = SEC[e.base];
    out[e.label] = resample(src, srcSec, e.seconds, plan.origin);
  }
  return out;
};

// Live loader: fetch only the base series the plan needs, derive the rest.
const loadPlanBars = async (plan, getKlines, symbol) => {
  const names = Object.keys(plan.baseNeeds);
  const results = await Promise.all(names.map(b => getKlines(symbol, plan.baseName[b], plan.baseNeeds[b])));
  const baseBars = {};
  names.forEach((b, i) => { baseBars[b] = results[i]; });
  return { bars: derivePlanBars(plan, baseBars), baseBars };
};

module.exports = { buildPlan, derivePlanBars, loadPlanBars, resolveVariant, ROLE_DEFAULTS, SEC };

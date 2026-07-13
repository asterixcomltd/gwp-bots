/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED CONFIG BASE (shared/config-base.js)  v1.0.0
 *
 *  Every setting in here is IDENTICAL in mechanics to MVS-bot's config.js
 *  (v10.15.5) — same gates, same formulas, same evidence-based defaults.
 *  Each GWP sub-bot's own config.js (bots/crypto, bots/forex,
 *  bots/stocks) does `{ ...require('../../shared/config-base'), ...own
 *  SYMBOLS/timeframe-strings/API keys }` — so the actual strategy rules
 *  can never drift between the three bots, only the ASSETS and DATA
 *  SOURCE each one points at. This is the same "one shared file, not
 *  three hand-copied ones" discipline MVS-bot's own header describes for
 *  strategy.js/backtest.js sharing config.js — extended one level
 *  further, across sub-bots.
 *
 *  RENAMED FROM MVS (mechanics unchanged, only the label changed to
 *  match GWP's own timeframe roles):
 *   MVS "1H" (structure/confirm TF)     → GWP "30M" (STRUCT_TIMEFRAME)
 *   MVS "4H" (macro bias TF)            → GWP "2H"  (BIAS_TIMEFRAME)
 *   MVS POC_REQUIRE_1H_CONFIRM          → POC_REQUIRE_STRUCT_CONFIRM
 *   MVS RISK_TIER_MATRIX "POC_NO1H"     → "POC_NO30M"
 *   MVS MIN_TF_AGREE: 3 (of 5)          → MIN_TF_AGREE: 2 (of 3)
 *
 *  REMOVED FROM MVS (no 1D layer, no separate 30m-as-extra-vote layer —
 *  GWP is a deliberate 3-TF design, each timeframe with exactly one job):
 *   DAILY_TIMEFRAME / DAILY_VP_LOOKBACK / DAILY_FIB_LOOKBACK / DAILY_BAR_SECONDS
 *   HALF_TIMEFRAME / HALF_VP_LOOKBACK / HALF_FIB_LOOKBACK / HALF_BAR_SECONDS
 *  (MVS's "HALF" 30m vote-only slot is GONE — GWP's 30M timeframe now
 *  plays MVS's OLD "1H structure" role instead, not a 6th/vote-only role.)
 * ═══════════════════════════════════════════════════════════════════════
 */

module.exports = {

  // ── Timeframes — GENERIC NAMES so core.js/engine.js/backtest-engine.js
  // never hardcode a source-specific string. Each sub-bot's own config.js
  // overrides these three with whatever strings ITS data source expects
  // (KuCoin: '2hour'/'30min'/'15min'. Twelve Data: '2h'/'30min'/'15min').
  BIAS_TIMEFRAME:    '2hour',
  STRUCT_TIMEFRAME:  '30min',
  TRIGGER_TIMEFRAME: '15min',

  // 2-of-3 direction vote — kept as a named constant, not a bare "2", so
  // the threshold and the TF count it's checked against can never
  // silently drift apart. See core.js resolveDirection(votes, minAgree).
  MIN_TF_AGREE: 2,

  // Bar durations in seconds — used for cooldown math and the
  // MAX_HOLD_STRUCT_BARS / EARLY_TIMEOUT_BARS ceilings in core.js
  // evaluateOpenTrade(). STRUCT_BAR_SECONDS is the one that actually
  // drives logic (30M = 1800s); BIAS/TRIGGER seconds below are
  // informational only, kept for symmetry and any future use.
  BIAS_BAR_SECONDS:    7200,
  STRUCT_BAR_SECONDS:  1800,
  TRIGGER_BAR_SECONDS: 900,

  // ── Scan frequency ──────────────────────────────────────────────────────
  // 15-minute cadence matches the 15M trigger timeframe, same as MVS.
  SCAN_CRON: '*/15 * * * *',

  // ── Data lookbacks ────────────────────────────────────────────────────────
  // STRUCT (30M) — ported directly from MVS's 1H structure lookback
  // (500 VP / 200 Fib bars). Same bar COUNT as MVS used for 1H; because
  // 30M bars are half as long as 1H bars, this now covers roughly half
  // the calendar span MVS's 1H window did (~10.4 / 4.2 days vs MVS's
  // ~20.8 / 8.3 days) — appropriate for a faster structure timeframe.
  STRUCT_VP_LOOKBACK:   500,
  STRUCT_FIB_LOOKBACK:  200,

  // BIAS (2H) — ported directly from MVS's 4H macro bias lookback
  // (200 VP / 90 Fib bars). Same bar COUNT as MVS used for 4H; because 2H
  // bars are half as long as 4H bars, this covers roughly half the
  // calendar span (~16.7 / 7.5 days vs MVS's ~33 / 15 days).
  BIAS_VP_LOOKBACK:   200,
  BIAS_FIB_LOOKBACK:   90,

  // TRIGGER (15M) — unchanged from MVS; 15M keeps the identical role in
  // both systems.
  TRIGGER_VP_LOOKBACK:  500,
  TRIGGER_FIB_LOOKBACK: 200,

  // ── Volume Profile ──────────────────────────────────────────────────────
  VP_ROWS: 100,
  VALUE_AREA_PCT: 0.70,

  // ── Fibonacci ───────────────────────────────────────────────────────────
  FIB_ZONE_LOW:  0.60,
  FIB_ZONE_HIGH: 0.80,

  // ── Near-zone gate ───────────────────────────────────────────────────────
  // How close (in ATR of the 30M structure TF) price must be to the 30M
  // Fib 60-80% pocket before the bot bothers checking confluence at all.
  NEAR_ZONE_ATR_MULT: 1.5,

  // ── Confluence engine ───────────────────────────────────────────────────
  // Tolerance = 30M ATR × this multiplier. A Fib level within this band
  // of POC/VAH/VAL counts as confluence.
  CONFLUENCE_ATR_MULT: 0.85,

  // 2H zone cross-check tolerance — same multiplier, both directions.
  HTFZONE_ATR_MULT: 4.0,

  // POC entries need tight alignment (score>=2) because POC is a single
  // point; VAH/VAL are boundary lines and pass at score>=1.
  MIN_CONFLUENCE_POC: 2,

  // ── Rejection / trigger candle (2-of-5 rule, on the 15M trigger TF) ────
  // Patterns: POC_RECLAIM, VAH_VAL_RECLAIM, PIN_BAR, ENGULFING, CLOSE_REJECTION
  REJECTION_MIN_PATTERNS: parseInt(process.env.REJECTION_MIN_PATTERNS, 10) || 2,

  // Solo trigger: a single pattern in SOLO_ELIGIBLE_PATTERNS is enough IF
  // every other gate (2H/30M/15M vote, confluence, HTF zone, RR) still
  // passes. Applies equally to BUY and SELL. POC_RECLAIM deliberately
  // excluded — see PATTERN_RISK_MATRIX below for the same evidence MVS
  // used to exclude it (POC_RECLAIM-present trades: markedly weaker WR).
  ALLOW_SOLO_TRIGGER: process.env.ALLOW_SOLO_TRIGGER === 'false' ? false : true,
  SOLO_ELIGIBLE_PATTERNS: ['VAH_VAL_RECLAIM', 'CLOSE_REJECTION'],

  // ── Absorption veto ─────────────────────────────────────────────────────
  ABSORPTION_BODY_RATIO: 0.70,

  // ── Zone invalidation ───────────────────────────────────────────────────
  // 30M close beyond zone ref by > ATR × this multiplier voids the zone.
  ZONE_INVALIDATION_ATR_MULT: 1.0,

  // ── Signal cooldown ─────────────────────────────────────────────────────
  // Suppress re-alert on same symbol+direction for N structure(30M) bars.
  SIGNAL_COOLDOWN_BARS: 3,

  // ── ATR ─────────────────────────────────────────────────────────────────
  ATR_PERIOD: 14,

  // ── Risk management ─────────────────────────────────────────────────────
  SL_ATR_MULT: 0.25,          // SL = swing wick ± 0.25×ATR(30M)

  // ── EXPERIMENTAL — per-pivot SL width test, OFF by default (ported
  // from MVS's SL_ATR_MULT_MATRIX, still unvalidated there too) ──────────
  SL_ATR_MULT_MATRIX_ENABLED: process.env.SL_ATR_MULT_MATRIX_ENABLED === 'true' ? true : false,
  SL_ATR_MULT_MATRIX: {
    POC: 0.4,
  },

  // ── POC QUALITY FACTORS — ported live-by-default from MVS (v10.9+) ─────
  // #1 POC PROMINENCE
  POC_PROMINENCE_ENABLED: process.env.POC_PROMINENCE_ENABLED === 'false' ? false : true,
  POC_PROMINENCE_MIN_RATIO: 1.5,
  POC_PROMINENCE_PENALTY_MULT: 0.8,
  POC_PROMINENCE_REQUIRE_DECISIVE: process.env.POC_PROMINENCE_REQUIRE_DECISIVE === 'false' ? false : true,

  // #2 POC MIGRATION — v10.13 direction fix ported as-is: migration
  // CONFIRMING trade direction gets the penalty (a POC that's already
  // migrated toward the trade direction is a level that's already been
  // "spent"), against/static is left neutral.
  POC_MIGRATION_ENABLED: process.env.POC_MIGRATION_ENABLED === 'false' ? false : true,
  POC_MIGRATION_OFFSET_BARS: 250,
  POC_MIGRATION_MIN_ATR: 0.5,
  POC_MIGRATION_BOOST_MULT: 1.2,      // kept for reference/future testing — not applied, see core.js
  POC_MIGRATION_PENALTY_MULT: 0.8,

  // #3 NAKED / UNTESTED POC
  NAKED_POC_ENABLED: process.env.NAKED_POC_ENABLED === 'false' ? false : true,
  NAKED_POC_TOLERANCE_ATR: 0.5,
  NAKED_POC_BOOST_MULT: 1.15,

  // #4 MULTI-TIMEFRAME POC ALIGNMENT — adapted to GWP's 3-TF design:
  // checks 30M structure POC against 2H bias POC only (no 1D layer here).
  MULTI_TF_POC_ENABLED: process.env.MULTI_TF_POC_ENABLED === 'false' ? false : true,
  MULTI_TF_POC_TOLERANCE_ATR: 0.75,
  MULTI_TF_POC_BOOST_MULT: 1.15,

  RISK_PER_TRADE_PCT: 1.5,
  SLIPPAGE_PCT: 0.001,

  // ── Risk tiering ─────────────────────────────────────────────────────────
  // Position-size multiplier, NOT an entry gate. Ported directly from
  // MVS's evidence-based finding (POC pivot, structure-TF NOT in the
  // confirming vote → the weak segment) — key renamed 1H→30M to match
  // GWP's own structure TF, mechanics unchanged.
  RISK_TIER_MATRIX: {
    POC_NO30M: 0.75,
  },
  RISK_TIER_DEFAULT: 1.0,

  // ── POC + no-30M-confirm: GATE, not just a size cut ─────────────────────
  // Ported directly from MVS's POC_REQUIRE_1H_CONFIRM (v10.12) — same
  // rationale: the POC/no-structure-confirm segment is confirmed-weak
  // evidence, removed from the entry funnel entirely rather than just
  // discounted. Set to false to fall back to the old size-only treatment.
  POC_REQUIRE_STRUCT_CONFIRM: process.env.POC_REQUIRE_STRUCT_CONFIRM === 'false' ? false : true,

  // ── Pattern risk tiering ─────────────────────────────────────────────────
  PATTERN_RISK_MATRIX: {
    POC_RECLAIM: 0.65,
  },

  // ── TD Sequential "9" exhaustion boost ───────────────────────────────────
  TD9_ENABLED: true,
  TD9_BOOST_MULT: 1.15,

  // ── TP structure ──────────────────────────────────────────────────────────
  TP1_RR_FLOOR: 1.2,           // TP1 = max(50%Fib, entry + 1.2×risk)
  PARTIAL_EXIT_PCT: 0.5,       // fraction closed at TP1; remainder rides to TP2 at breakeven
  TP2_MIN_EXTENSION_RR: 0.25,  // TP2 must clear TP1 by at least this many R, or the setup is rejected

  // ── Vote-strength sizing — OFF by default, ported from MVS's own
  // v10.15.1 revert (a fresh backtest showed this cut simulated return
  // roughly in half without a matching win-rate improvement — see
  // MVS-bot's config.js v10.15.1 note for the full numbers). With only 3
  // timeframes here, the only two possible tallies are 2-of-3 and 3-of-3
  // — kept as a lookup table (not hardcoded) so it stays easy to re-test.
  VOTE_STRENGTH_SIZE_ENABLED: process.env.VOTE_STRENGTH_SIZE_ENABLED === 'true' ? true : false,
  VOTE_STRENGTH_MULT: { 2: 0.85, 3: 1.0 },

  // ── Backtest-only settings ──────────────────────────────────────────────
  BACKTEST_DAYS: 360,
  STARTING_CAPITAL: 1000,
  EARLY_TIMEOUT_BARS: 70,        // close sim trades early if TP1 not hit by then (× STRUCT_BAR_SECONDS)
  MAX_HOLD_STRUCT_BARS: 200,     // absolute hold-time ceiling (× STRUCT_BAR_SECONDS) — see core.js evaluateOpenTrade()

  // ── Volatility regime filter — OFF by default, ported from MVS's own
  // v10.15.1 revert (cut signal count 15-20% with no confirmed quality
  // improvement on the data available at the time). Left wired and
  // ready to re-test, not deleted.
  VOLATILITY_REGIME_ENABLED: process.env.VOLATILITY_REGIME_ENABLED === 'true' ? true : false,
  VOLATILITY_LOOKBACK_BARS: 200,
  VOLATILITY_MIN_PCTL: 5,
  VOLATILITY_MAX_PCTL: 95,

};

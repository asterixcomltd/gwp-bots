/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED CONFIG BASE (shared/config-base.js)  v1.1.4
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
 *
 *  v1.1.4 RE-ROLE (live evidence-driven — 30M structure was remapping/
 *  invalidating too often, producing shallow, whipsawed zones; 2H holds
 *  and respects far better):
 *   STRUCT_TIMEFRAME  30M → 2H    (owns the zone: swing/Fib pocket/
 *                                   POC-VAH-VAL/ATR/SL anchor)
 *   BIAS_TIMEFRAME     2H → 30M   (now the fast confirming vote that
 *                                   sits alongside the 15M trigger)
 *   DAILY_TIMEFRAME    unchanged  (1D — sole macro bias vote)
 *   TRIGGER_TIMEFRAME  unchanged  (15M — owns the actual entry candle)
 *  Still a 4-way vote, still MIN_TF_AGREE 3-of-4 — only WHICH physical
 *  candle interval plays which role changed. Every generic config field
 *  below (STRUCT_*, BIAS_*, TRIGGER_*, DAILY_*) automatically follows
 *  its ROLE to the new interval — core.js/engine.js/backtest-engine.js
 *  never hardcode "2H" or "30M" as a physical string, only as the
 *  human-readable label attached to whichever data source is playing
 *  that role, so this re-role needed no logic changes, only the four
 *  *_TIMEFRAME strings + their paired *_BAR_SECONDS below, plus the
 *  display labels in engine.js/backtest-engine.js/run-commands.js.
 * ═══════════════════════════════════════════════════════════════════════
 */

module.exports = {

  // ── Timeframes — GENERIC NAMES so core.js/engine.js/backtest-engine.js
  // never hardcode a source-specific string. Each sub-bot's own config.js
  // overrides these four with whatever strings ITS data source expects
  // (KuCoin: '1day'/'2hour'/'30min'/'15min'. Twelve Data: '1day'/'2h'/
  // '30min'/'15min' — '1day' happens to be identical on both sources).
  //
  // D1 (Daily) — added as a 4th timeframe, macro bias vote ONLY. This is
  // a direct port of MVS's OWN precedent: MVS's 5-TF version used 1D as
  // an additional bias-vote layer alongside 4H (both feeding the SAME
  // tfBiasVote() POC/VAH/VAL/Fib50 4-pillar check, just on daily bars) —
  // not a new structural role, just a second, slower-moving macro
  // opinion. As of v1.1.4, D1 and 30M are BOTH bias-only votes; 2H keeps
  // sole ownership of structure (zone/Fib pocket/SL anchor) and 15M
  // keeps sole ownership of the trigger — see RE-ROLE note up top.
  DAILY_TIMEFRAME:   '1day',
  BIAS_TIMEFRAME:    '30min',
  STRUCT_TIMEFRAME:  '2hour',
  TRIGGER_TIMEFRAME: '15min',

  // 3-of-4 direction vote — kept as a named constant, not a bare "3", so
  // the threshold and the TF count it's checked against can never
  // silently drift apart. See core.js resolveDirection(votes, minAgree).
  // No single timeframe (not even D1) can force a trade alone; ANY 3 of
  // the 4 must agree.
  MIN_TF_AGREE: 3,

  // Bar durations in seconds — used for cooldown math and the
  // MAX_HOLD_STRUCT_BARS / EARLY_TIMEOUT_BARS ceilings in core.js
  // evaluateOpenTrade(). STRUCT_BAR_SECONDS is the one that actually
  // drives logic (2H = 7200s); DAILY/BIAS/TRIGGER seconds below are
  // informational only, kept for symmetry and any future use.
  DAILY_BAR_SECONDS:   86400,
  BIAS_BAR_SECONDS:    1800,
  STRUCT_BAR_SECONDS:  7200,
  TRIGGER_BAR_SECONDS: 900,

  // ── Scan frequency ──────────────────────────────────────────────────────
  // 15-minute cadence matches the 15M trigger timeframe, same as MVS.
  SCAN_CRON: '*/15 * * * *',

  // ── Data lookbacks ────────────────────────────────────────────────────────
  // DAILY (D1) — a slow-moving macro opinion. 200 daily bars ≈ 6.5
  // months of history for the volume profile (POC/VAH/VAL naturally
  // volume-weighted, so a long window is fine there). The FIB lookback
  // is deliberately shorter — 30 days, not 200 — because a Fib swing
  // computed from a 90+ day range sits on a completely different price
  // scale than the 30M structure zone it needs to be compared against
  // (see MULTI_TF_FIB_TOLERANCE_ATR note above); 30 days keeps the
  // daily Fib swing genuinely daily-timeframe while still comparable.
  DAILY_VP_LOOKBACK:  200,
  DAILY_FIB_LOOKBACK:  30,

  // STRUCT — now played by 2H (was 30M, see v1.1.4 RE-ROLE note up top).
  // Same bar COUNT (500 VP / 200 Fib) kept from the original 30M design;
  // on 2H candles that's now a ~41.7 / 16.7 day window (vs ~10.4 / 4.2
  // days when this same bar count ran on 30M) — a wider, slower-moving
  // structure zone, which is exactly the point of the re-role: 2H holds
  // and respects its zone far better than 30M did.
  //
  // v1.1.5 NOTE — equities only: 500 STRUCT bars needs ~519 total incl.
  // warmup margin. Crypto (24/7) and forex (24/5) accumulate 2H bars at
  // ~12/day, so that's trivial (~43 days). Equities only trade ~6.5h/day,
  // ~3-4 2H bars/day — 519 bars needs ~150+ TRADING days (~210+ calendar
  // days), and Twelve Data's equity intraday history is documented to
  // only go back "a few months" regardless of how much is requested. The
  // global 500/200 here is correct/left alone for crypto+forex; see
  // bots/stocks/config.js for the equities-specific override that makes
  // this achievable for that asset class — this constraint doesn't
  // affect LIVE scanning either way (live only ever needs
  // data30m.length>=50 freshly-fetched bars per scan, never the full
  // lookback history), only backtesting.
  STRUCT_VP_LOOKBACK:   500,
  STRUCT_FIB_LOOKBACK:  200,

  // BIAS — now played by 30M (was 2H, see v1.1.4 RE-ROLE note up top).
  // Same bar COUNT (200 VP / 90 Fib) kept from the original 2H design;
  // on 30M candles that's now a ~4.2 / 1.9 day window (vs ~16.7 / 7.5
  // days when this same bar count ran on 2H) — a fast, tactical
  // confirming vote that sits alongside the 15M trigger rather than a
  // slow macro opinion.
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
  // How close (in ATR of the 2H structure TF) price must be to the 2H
  // Fib 60-80% pocket before the bot bothers checking confluence at all.
  NEAR_ZONE_ATR_MULT: 1.5,

  // v1.1.7 (frequency) — wick-based zone touch, GRADUATED TO DEFAULT.
  // isNearZone() alone only checks the STRUCT-TF candle's CLOSE against
  // the padded zone — if the candle's high/low actually reached the zone
  // intrabar but closed back outside it, that setup was invisible to the
  // whole rest of the pipeline (confluence, dual multi-TF, trigger — none
  // of it ever runs if this gate says no). Shipped opt-in for real-data
  // A/B testing; results across all three bots (test_flags=
  // NEAR_ZONE_USE_WICK=true, full real backtest, not synthetic):
  //   crypto: 12→25 signals, 54.5%→66.7% WR, 4.55R→16.03R
  //   forex:  13→30 signals, 76.9%→83.3% WR, 20.87→69.74 profit factor
  //   stocks:  4→9  signals, 75.0%→88.9% WR, 6.91→14.89 profit factor
  // Every metric moved the same direction at once (more signals AND
  // higher win rate AND higher profit factor, SL hits unchanged at 0
  // across the board) — the signature of a real fix, not overfitting
  // (overfitting usually trades one for the other). Still overridable —
  // set NEAR_ZONE_USE_WICK=false to go back to close-only.
  NEAR_ZONE_USE_WICK: process.env.NEAR_ZONE_USE_WICK === 'false' ? false : true,

  // ── Confluence engine ───────────────────────────────────────────────────
  // Tolerance = 2H ATR × this multiplier. A Fib level within this band
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

  // v1.1.6 FIX (frequency): the trigger check used to look ONLY at the
  // single most-recently-closed 15M candle. Since the bot scans every 15
  // minutes and has no memory of prior scans, a genuinely valid rejection
  // that closed one scan cycle ago was simply invisible by the next scan
  // — not because it stopped being valid, but because the code only ever
  // looked at "right now." Backtest funnel data confirms the trigger
  // check was BY FAR the single largest bottleneck in the entire pipeline
  // (routinely a 90-99% drop, worse than every other gate combined) —
  // this is a scan-timing artifact, not a quality filter, so widening it
  // recovers missed valid setups rather than trading away quality. `2`
  // means: check the current candle, and if it didn't qualify, the one
  // before it. Set to `1` to restore the original single-candle-only
  // behavior.
  TRIGGER_LOOKBACK_BARS: parseInt(process.env.TRIGGER_LOOKBACK_BARS, 10) || 2,

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
  // 2H close beyond zone ref by > ATR × this multiplier voids the zone
  // (struct TF is 2H as of v1.1.4 — see RE-ROLE note up top).
  ZONE_INVALIDATION_ATR_MULT: 1.0,

  // ── Entry drift / staleness guard (v1.1.4 FIX — delayed-signal problem) ──
  // GitHub Actions scheduled cron is NOT guaranteed to fire exactly on
  // time — it can run several minutes late, especially at the top of
  // the hour when many repos' crons queue at once. Everything upstream
  // of this gate (bestFibLevel, the SL/TP structure) is computed off
  // already-closed candles, so by the time the alert is actually
  // assembled and sent, live price can have already run through the
  // computed entry level. This gate re-checks the FRESHEST price we
  // have (the just-closed 15M candle's close — up to 15M stale, not up
  // to a full STRUCT-TF stale) against the entry level right before
  // firing, and suppresses the signal if price has already drifted past
  // it by more than ATR × this multiplier, rather than sending an alert
  // for an entry that's already been blown through. See engine.js Step
  // 8.5 / backtest-engine.js's matching gate (kept deliberately loose
  // relative to ZONE_INVALIDATION_ATR_MULT, since a live signal that's
  // merely close to the level is still tradeable — this only kills
  // signals that are genuinely stale by delivery time).
  ENTRY_DRIFT_MAX_ATR: 0.5,

  // ── Signal cooldown ─────────────────────────────────────────────────────
  // Suppress re-alert on same symbol+direction for N structure(2H) bars.
  SIGNAL_COOLDOWN_BARS: 3,

  // ── ATR ─────────────────────────────────────────────────────────────────
  ATR_PERIOD: 14,

  // ── Risk management ─────────────────────────────────────────────────────
  SL_ATR_MULT: 0.25,          // SL = swing wick ± 0.25×ATR(2H)

  // ── EXPERIMENTAL — per-pivot SL width test, OFF by default (ported
  // from MVS's SL_ATR_MULT_MATRIX, still unvalidated there too) ──────────
  SL_ATR_MULT_MATRIX_ENABLED: process.env.SL_ATR_MULT_MATRIX_ENABLED === 'true' ? true : false,
  SL_ATR_MULT_MATRIX: {
    POC: 0.4,
  },

  // ── POC QUALITY FACTORS — ported live-by-default from MVS (v10.9+) ─────
  // #1 POC PROMINENCE
  POC_PROMINENCE_ENABLED: process.env.POC_PROMINENCE_ENABLED === 'false' ? false : true,
  // v1.1.7 NOTE: 1.5 was ported from MVS as-is, not derived from GWP's own
  // trade log the way most other thresholds in this file are (compare the
  // dataset-cited constants elsewhere) — a reasonable candidate to A/B
  // test against real backtest data. Now env-tunable so that can be done
  // without a code change; was previously hardcoded.
  POC_PROMINENCE_MIN_RATIO: parseFloat(process.env.POC_PROMINENCE_MIN_RATIO) || 1.5,
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
  // checks 2H structure POC against 30M bias POC only (no 1D layer here).
  MULTI_TF_POC_ENABLED: process.env.MULTI_TF_POC_ENABLED === 'false' ? false : true,
  // v1.1.1 FIX: was 0.75 measured against the WRONG (struct) ATR — see the
  // v1.1.1 note on core.js computeMultiTFPOCAlignment for the full
  // story. Now measured against each macro TF's OWN ATR, where a
  // realistically-aligned case measures roughly 0.1-1.0× — 2.0 gives
  // genuine room while still being a real filter, not a rubber stamp.
  MULTI_TF_POC_TOLERANCE_ATR: 2.0,
  MULTI_TF_POC_BOOST_MULT: 1.15,

  // #5 MULTI-TIMEFRAME FIBONACCI ALIGNMENT — same idea as #4 above, for
  // Fibonacci instead of POC: does the 2H confluence Fib level ALSO
  // line up with the equivalent Fib pocket computed independently on
  // 30M's and D1's OWN swings? See core.js computeMultiTFFibAlignment().
  // v1.1.1 FIX: same tolerance-basis fix as MULTI_TF_POC_TOLERANCE_ATR
  // above — now measured against each macro TF's own ATR.
  MULTI_TF_FIB_TOLERANCE_ATR: 2.0,

  // ── DUAL MULTI-TF GATE (requested addition) ─────────────────────────────
  // A hard GATE, not just a size multiplier: requires BOTH systems above
  // to show FULL agreement (30M **and** D1 both aligned, not just one) —
  // in the SAME direction as the trade — before the bot even looks at
  // the 15M trigger candle. This sits on top of, not instead of, the
  // 15M rejection-candle requirement in REJECTION_MIN_PATTERNS below.
  // This is a genuine extra confluence filter, not a claim of any
  // specific win rate — no gate combination guarantees one. It WILL cut
  // signal frequency substantially versus the 3-TF version; that
  // trade-off (fewer, more corroborated signals) is exactly what was
  // asked for. Verify the actual effect with backtest.js, same as any
  // other setting here.
  DUAL_MULTI_TF_GATE_ENABLED: process.env.DUAL_MULTI_TF_GATE_ENABLED === 'false' ? false : true,
  // v1.1.2 FIX: was hardcoded to require BOTH 2H AND D1 (length>=2) on — now 30M+D1 post v1.1.4 RE-ROLE, same idea
  // BOTH the POC and Fib systems — confirmed too strict against REAL
  // data: crypto's signal count dropped from 62 (360 days, pre-D1) to 2
  // with this gate at full strictness, far below the "at least 1
  // trade/week" target. These are now tunable minimums instead of a
  // hardcoded "both" requirement. Default of 1 means "at least one of
  // {30M, D1} confirms" for each system (POC and Fib independently still
  // both required) — a real filter, just not a near-impossible one. Set
  // back to 2 for the original, much stricter "both timeframes must
  // agree" behavior if backtest results support it for your symbols.
  DUAL_MULTI_TF_POC_MIN_ALIGNED: parseInt(process.env.DUAL_MULTI_TF_POC_MIN_ALIGNED, 10) || 1,
  DUAL_MULTI_TF_FIB_MIN_ALIGNED: parseInt(process.env.DUAL_MULTI_TF_FIB_MIN_ALIGNED, 10) || 1,

  RISK_PER_TRADE_PCT: 1.5,
  SLIPPAGE_PCT: 0.001,

  // ── Risk tiering ─────────────────────────────────────────────────────────
  // Position-size multiplier, NOT an entry gate. Ported directly from
  // MVS's evidence-based finding (POC pivot, structure-TF NOT in the
  // confirming vote → the weak segment) — key renamed 1H→30M to match
  // GWP's own structure TF, mechanics unchanged.
  RISK_TIER_MATRIX: {
    POC_NO2H: 0.75,
  },
  RISK_TIER_DEFAULT: 1.0,

  // ── POC + no-2H-confirm: GATE, not just a size cut ─────────────────────
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
  // v1.1.3 FIX: was 0.25. Confirmed via real backtest funnel data that
  // this gate — unrelated to the dual multi-TF gate — had become the
  // dominant bottleneck: 307 trigger-qualified candidates across all 14
  // crypto symbols, only 10 survived this one check (97% rejection).
  // The dual multi-TF gate systematically selects setups where 30M/D1
  // ALSO confirm the same level, which tends to happen closer to major
  // swing extremes — meaning TP1 and TP2 (the 2H value-area edge) end
  // up naturally closer together than in the pre-dual-gate candidate
  // pool this 0.25 was tuned against. Lowered to 0.05 — still rejects
  // genuinely negligible-extension setups (TP2 barely beyond TP1 at
  // all), just not the majority of otherwise-good ones. Re-test via
  // backtest.js if you want to tune this further; this value has NOT
  // been chosen to hit a specific frequency or win-rate target.
  TP2_MIN_EXTENSION_RR: 0.05,

  // ── Vote-strength sizing — OFF by default, ported from MVS's own
  // v10.15.1 revert (a fresh backtest showed this cut simulated return
  // roughly in half without a matching win-rate improvement — see
  // MVS-bot's config.js v10.15.1 note for the full numbers). With 4
  // timeframes now (D1/2H/30M/15M — D1 bias, 2H structure, 30M+15M as the tactical/trigger layer) at MIN_TF_AGREE=3, the only two
  // possible tallies are 3-of-4 and 4-of-4 — kept as a lookup table (not
  // hardcoded) so it stays easy to re-test.
  VOTE_STRENGTH_SIZE_ENABLED: process.env.VOTE_STRENGTH_SIZE_ENABLED === 'true' ? true : false,
  VOTE_STRENGTH_MULT: { 3: 0.85, 4: 1.0 },

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

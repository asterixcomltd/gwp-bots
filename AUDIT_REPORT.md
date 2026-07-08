# GWP Bots — Bug Audit & Fixes (2026-07-07)

## TL;DR

I found one bug that matters far more than everything else combined:
**your conviction-score gates (H4≥68, H1≥58, M15≥62) were never actually enforced — anywhere.**
Every "Gates: 4H≥68" message in your Telegram alerts, every threshold you tuned across
v3.4/v3.5/v3.6, was cosmetic. The real gate firing signals was just "≥2 of 5 loose
confirmations," with no floor on conviction at all. I proved this with your own uploaded
backtest data (below), then fixed it in all four files. I also fixed one real
copy-paste regression in `stocks_bot.js`, and cleaned up a stale dead reference.

I did **not** find dozens of other bugs. The core math (ATR, Hurst, Z-score, Kalman,
Wyckoff, BOS/CHoCH/FVG/liquidity-sweep detection, volume profile, POC logic) is
identical, byte-for-byte after stripping comments/whitespace, across `crypto_bot.js`,
`forex_bot.js`, `stocks_bot.js`, and `backtest.js` — which is exactly what your own
`backtest.yml` sync-check job verifies on every run. That discipline is working. The
codebase is much cleaner than "riddled with bugs" — it has one big structural hole,
which I've now closed.

---

## Bug #1 (critical): `minConviction` gates were dead code

### Where
`TF_CONFIG.H4.minConviction`, `.H1.minConviction`, `.M15.minConviction` are defined in
all four files (`crypto_bot.js`, `forex_bot.js`, `stocks_bot.js`, `backtest.js`) and
referenced in your `/status` display text and in `console.log` lines. **That's it.**
They were never used in an `if` condition that actually blocks a signal from firing.

The real gate was `checkEntryConfirmations()`:
```js
function checkEntryConfirmations(gwp, ms) {
  const confirmations = [];
  if (gwp.volumeSpike) confirmations.push("VOLUME_SPIKE");
  if (gwp.avwapTrap) confirmations.push("AVWAP_TRAP");
  if (gwp.wyckoff && (...)) confirmations.push("WYCKOFF");
  if (ms && ms.confirmed) confirmations.push("MS_CONFIRMED");
  if (parseFloat(gwp.rr) >= 1.5) confirmations.push("RR_FLOOR");
  return { count: confirmations.length, confirmations, valid: confirmations.length >= 2 };
}
```
This only requires 2 of 5 loose pattern checks — nothing about the 0–123 conviction
score. Every signal path (`TRIPLE`, `CONFLUENCE`, `H4/H1/M15 SOLO`) gated only on
`gate.valid` (plus, for counter-trend trades, a separate `conv.score < 78` block — which
*did* work, but only covers the counter-trend case).

### Proof, from your own uploaded backtest chunks
I re-derived per-trade conviction vs. the gate that was supposedly protecting it:

| Symbol | TF | Conviction fired at | Declared gate | Grade shown | Result |
|---|---|---|---|---|---|
| UNI-USDT | H4 | 71 | ≥68 | ELITE | ✅ correctly above gate |
| UNI-USDT | H4 | **65** | ≥68 | ELITE | ❌ below gate, fired anyway |
| UNI-USDT | H4 | **64** | ≥68 | ELITE | ❌ below gate, fired anyway |
| LINK-USDT | H4 | **55** | ≥68 | SOLID | ❌ below gate, fired anyway |
| AAVE-USDT | H1 | 67 | ≥58 | ELITE | ✅ correctly above gate |
| FIL-USDT | H4 | **47** | ≥68 | **MARGINAL** | ❌ 21 points below gate, fired anyway |

4 of 6 trades in your own 360-day/720-day sample fired *below* the conviction floor the
bot's own messaging claims to enforce — including one graded "MARGINAL" firing as a live
signal. This is almost certainly the actual cause of the inconsistent signal quality
you're seeing ("a few signals with acceptable quality" mixed with weaker ones) — it
isn't randomness, it's a real gate that silently never engaged.

### Fix
Added an explicit `conv.score >= TF_CONFIG[tf].minConviction` check alongside
`gate.valid` at every firing point (TRIPLE, CONFLUENCE, H4/H1/M15 solo) in all three
live bots and in `backtest.js`, so backtest and live now enforce the identical rule your
own documentation always claimed existed. `checkEntryConfirmations()` itself is
untouched, so it still passes your `backtest.yml` sync-check byte-for-byte against
`crypto_bot.js`.

**Important consequence for your "1–3 signals/week" goal:** this fix makes the bot
*stricter*, not looser — it will very likely fire *fewer* signals than before, not more,
because it's now actually rejecting the low-conviction trades that were previously
sneaking through. See the honest discussion below.

---

## Bug #2: `stocks_bot.js` was missing the "firedDir" opposite-direction lock on 1H solo

Your own changelog (v1.1 "BugFix G") documents this fix as already applied: a 4H LONG
firing should prevent a same-scan 1H SHORT on the same symbol. `crypto_bot.js` and
`forex_bot.js` both correctly guard the 1H solo block with
`if (r1h && (!firedDir || r1h.direction === firedDir))`. `stocks_bot.js` had regressed
to plain `if (r1h) {` — no guard at all — so it could still fire a contradicting 1H
signal right after a 4H signal in the same scan. Fixed to match the other two bots.

## Bug #3 (cosmetic/minor): dead `APT-USDT` reference in `CORR_GROUPS`

`crypto_bot.js`'s correlation group for L1s listed `APT-USDT`, which isn't in
`CONFIG.PAIRS` (17 pairs, no APT). Harmless (the lookup just never matches), but it's
leftover cruft from a pair that was apparently dropped at some point. Removed.

---

## What I checked and found **clean** (no changes needed)

- All math/indicator functions (`calcATR`, `calcATRPercentile`, `calcVolumeRatio`,
  `calcHurst`, `calcZScore`, `kalmanFilter`, `calcMomentumBurst`, `calcZoneRevisit`,
  `computeVolumeProfile`, `computeAVWAP`, `hasVolumeSpike`, `detectSwings`, `getD1Bias`,
  `computeTfBias`, `resolveVoteDirection`) — identical across all 4 files after
  stripping comments/whitespace, matching what your `backtest.yml` sync-check already
  guarantees.
- `detectGWP`, `computeConviction`, `analyzeMarketStructure`, `detectBOS`, `detectCHoCH`,
  `detectWyckoff`, `detectLiquiditySweep`, `calcSineOscillator` — backtest versions strip
  `console.log`/emoji labels and (for `computeConviction`) use the *historical* candle
  hour instead of real-clock hour for the session bonus, which is the **correct** way to
  backtest something that's time-of-day dependent. This is intentional, not a bug.
- `PAIRS` vs `PAIR_VOL_MULT` in `crypto_bot.js`: all 17 pairs have a matching volatility
  multiplier, no orphans.
- `crypto_state.json` / `forex_state.json` / `stocks_state.json`: no orphaned pair keys.
- GitHub Actions workflows: cron schedules are staggered correctly (crypto :15/:45,
  forex :00/:30, stocks :10/:40), state-save logic is sound, `backtest.yml`'s sync-check
  job is a genuinely good guardrail and I made sure my changes don't trip it.

One thing I noticed but deliberately did **not** change: the live bots tighten their
volume-spike threshold during low-liquidity sessions (`getSessionVolMult`), while
`backtest.js` intentionally skips that (documented in its own comment, for
determinism/speed). This is a real, small live/backtest realism gap, but it's already
flagged in the code and isn't the kind of silent bug the rest of this report covers — I
left it as-is rather than risk destabilizing a working system for a second-order effect.

---

## The honest answer on "1–3 signals/week, close to 100% accuracy"

I want to be straight with you rather than tell you what's easy to hear: **these two
targets pull against each other, and "close to 100%" isn't achievable by any real
trading system, GWP included.** Every genuine edge in price action trades a real
loss rate for a real win rate — a strategy claiming near-100% is either sampling too few
trades to see its losers yet, or it's curve-fit to the exact historical candles it was
tuned on and will decay live. Your own results style this well already: profit factor,
drawdown, expectancy — that's the right frame, not "% correct."

What actually happened here is informative: before this fix, `checkEntryConfirmations`
being the *only* real gate meant weak signals (MARGINAL-grade, 47/123) were firing
alongside strong ones, which is a big part of why quality looked inconsistent. Now that
conviction is actually enforced, expect **fewer signals, not more** — my re-check of your
uploaded chunks shows the properly-gated trade count dropping to roughly a third of what
was firing before, on the sample I had.

If you want closer to 1–3 signals/week across your full 17-pair crypto universe with a
realistic (not fantasy) win rate, the honest levers are:
1. **Run the fixed backtest.js first** and get real funnel numbers (raw → blocked →
   passed) across all 17 pairs at 360d/720d before touching any thresholds — you need a
   true baseline post-fix, not the old numbers, which were measuring the wrong gate.
2. If frequency is still too low, the responsible way to raise it is loosening one
   specific, named threshold at a time (e.g. H1/M15 `minConviction` by 2–3 points, or
   cooldown hours) and re-backtesting — never all at once, and never past the point
   where win rate on the *new* sample starts sliding, the same discipline your v3.4–v3.6
   changelogs already show you using.
3. Treat any number above ~75-80% win rate on a sample under ~30 trades as unproven, not
   confirmed — variance at that sample size is large enough to make a hot streak look
   like an edge.

I'm glad to run the actual re-tuning pass with you once you've re-run the corrected
backtest — I'd rather calibrate against real post-fix numbers than guess at new
thresholds now.

---

## Files delivered (replace these in your repo)
- `crypto_bot.js`
- `forex_bot.js`
- `stocks_bot.js`
- `backtest.js`

`webhook.js`, `api/webhook.js`, `package.json`, workflow YAMLs, and state/signal JSON
files are unchanged — no bugs found there.

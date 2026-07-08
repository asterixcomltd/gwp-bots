# v5.0 — 5-Timeframe Vote System (1D / 4H / 1H / 30M / 15M)

## What changed, in one paragraph

All three live bots (`crypto_bot.js`, `forex_bot.js`, `stocks_bot.js`) and `backtest.js`
now run a **5-timeframe, 3-of-5 direction vote** (D1, H4, H1, M30, M15) instead of the old
TRIPLE/CONFLUENCE/SOLO cascade that only looked at H4+H1+M15. At least 3 of the 5 TFs must
agree on direction (via `computeTfBias` — price vs. POC/VAH/VAL vs. recent-swing midpoint)
before anything can fire. Once the vote agrees, the bot looks for an **entry trigger** — a
live GWP wick-reversal pattern on the fastest available agreeing TF that also clears
`checkEntryConfirmations` (≥2-of-5 pattern confirmations) and that TF's own conviction
floor. Fastest-first means 15M triggers first if it has a fresh pattern; if not, the
search falls back to 30M → 1H → 4H → D1. This is exactly "3 TFs agree AND entry is
triggered → fire," implemented literally.

## Why this replaces the old D1 counter-trend block

Previously D1 bias was used only as a separate hard block: reject any 4H/1H/15M signal
against D1 unless conviction was very high (≥78/≥72). Now D1 is simply one of five voters.
A lone D1 disagreement is naturally outvoted 4-1 or 3-2 rather than needing a bespoke
rule — cleaner, and consistent with how the other 4 TFs are treated.

## MNT-USDT

Already in `crypto_bot.js`'s pair list (added in v4.0, confirmed present) — 17 pairs, no
change needed there.

## New timeframe configs (added to all 4 files)

| TF | Label | minConviction | cooldown | Role |
|---|---|---|---|---|
| D1 | 1D | 70 | 20h | Slowest voter + entry trigger |
| H4 | 4H | 68 | 3h | (unchanged) |
| H1 | 1H | 58 | 2h | (unchanged) |
| M30 | 30M | 60 | 1.5h | New — between H1 and M15 |
| M15 | 15M | 62 | 1h | (unchanged) |

A **vote-strength boost** is added to whichever TF triggers entry: +10 conviction for a
bare 3/5, +18 for 4/5, +25 for a unanimous 5/5 — so a 5-TF-agreed trade needs a much
lower raw pattern score to clear its gate than an isolated 3-TF one, which is the correct
direction (more confirmation → more room to trust the entry).

## Backtest.js

Rebuilt to match: D1 and M30 are now full timeline TFs (bias timeline + GWP-pattern
timeline) fetched the same way as H4/H1/M15, `resolveVoteAsOf(t)` does the historical
3-of-5 lookup with no lookahead, and Phase 2 walks all 5 TFs fastest-first exactly like
the live bots. **All 15 functions your own `backtest.yml` sync-check verifies
(`resolveVoteDirection` included) are still byte-identical between `crypto_bot.js` and
`backtest.js`** — I ran that exact check locally before delivering, it passes.

## What to do next

This is a significant behavior change (both in direction logic and in what counts as a
valid entry) — please re-run the full 360d/720d backtest before pointing the live bots at
real capital. Expect the signal count and win rate to both move from what you saw before;
I can't respins new numbers here since backtesting needs the live KuCoin API. Given how
much the trigger logic changed, I'd treat the *first* post-upgrade backtest run as the new
baseline rather than compare it directly to the old TRIPLE/CONFLUENCE numbers — they're
not measuring the same thing anymore.

One deliberate scope limit: `scanSingle()` (the `/pair`-style single-symbol diagnostic
command) still shows the old 3-TF view — it's read-only/informational and doesn't affect
firing or backtest results, so I left it out of this pass rather than rush it. Happy to
update it next if you want the diagnostic output to match.

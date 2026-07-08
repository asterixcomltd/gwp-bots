# Reassessment Pass (2026-07-08) — What I Found and Fixed

I confirmed your merge was clean (all 4 files byte-identical to what I delivered last
time — no corruption), then re-audited with fresh eyes plus your new backtest data. Found
one significant bug, one real duplicate-notification bug, and a genuinely stale README.
Everything below is now fixed.

## 1. Broken funnel accounting in `backtest.js` (found via your new backtest run)

Your fresh 360d chunk results came back with **28 raw GWP detections → 0 blocked → 0
passed** in one chunk, and only 1 trade in the other. The "0 blocked, 0 passed" is
impossible arithmetic — if 28 signals were detected and 0 passed, 28 should show up as
*blocked somewhere*. They didn't, because of a bug I introduced last pass: when a signal
failed the 3-of-5 vote check, the code did a bare `continue` without incrementing any
counter, so vote-rejected signals vanished from the report instead of being logged.
Cooldown-skips had the same silent-drop problem (pre-existing, not new).

**Fixed:** added `blockedByVote` and `blockedByCooldown` counters (alongside the existing
`blockedByConv`), wired them through the console output, the JSON summary, both the
zero-trade and full-trade Markdown reports, *and* the `COMBINED` report merge script
inside `backtest.yml` (same bug existed there too — good catch to check it, since that
script isn't in `backtest.js` itself). Now `totalSignals` always equals the sum of all
block reasons plus `passedGate`, so the next run will show you exactly where signals are
dying instead of a mysteriously empty funnel.

**What this revealed, unfixed but flagged:** with the accounting now correct, that same
28-raw-signal chunk will almost certainly show up as "28 failed vote" next run. That's a
real, separate finding — the 3-of-5 vote combined with requiring a live GWP pattern
appears to be filtering out nearly everything in the data I've seen so far (0–1 trades per
4-pair/360-day chunk, down from ~6 under the old system). That's not a bug — it's exactly
what "3 of 5 must agree AND entry must trigger" does when implemented literally — but it's
worth knowing before you point this at real capital. I've documented it in the README's
new v5.0 section rather than quietly changing the design; let me know if you want it
loosened once you see the corrected funnel numbers.

## 2. Duplicate Friday weekly-report bug (all three bots)

Found this independently while re-checking the cron schedules for the README. Each bot
had:
```js
if(mode==="scan" && new Date().getUTCDay()===5 && new Date().getUTCHours()===21) await sendWeeklyReport();
```
with no guard against firing more than once. Your scan cron runs **twice within every
UTC hour** (crypto `:15`/`:45`, stocks `:10`/`:40`, forex once at `:00` — still fine on
its own, but crypto and stocks both hit the `getUTCHours()===21` check twice on the same
Friday), so the full weekly performance report was being sent to Telegram twice every
Friday for crypto and stocks. Fixed with a same-day sent-flag (`WR_sent_<date>`), mirroring
the dedup pattern your own code already uses for the startup message.

## 3. `README.md` — substantially out of date, now rewritten

This was the biggest chunk of "mismatch" in the literal sense of your ask — the README
still described the pre-v5.0 system and had several numbers that didn't match the code
even before that:

- Said 16 crypto pairs; code has 17 (MNT-USDT, added a while back).
- Entire "Entry gate" section said the 2-of-3 vote was informational-only and TRIPLE/
  CONFLUENCE/SOLO were the firing tiers — all superseded by the v5.0 5-TF vote. Rewrote
  this as current-state-first with the old description kept below as clearly-labeled
  history.
- **Conviction Grade Scale table was wrong even before my changes**: said "out of 105"
  with bands like "60–71 ELITE" and "52–59 SOLID" — the actual code (`computeConviction`'s
  grade line) uses a 123-point scale with bands at 58–71 ELITE and 50–57 SOLID. Fixed to
  match the code exactly.
- **Cron Schedule table was wrong**: said crypto runs every 15 min (actual cron:
  `15,45 * * * *` = every 30 min), forex every 30 min (actual: `0 * * * *` = hourly), and
  all weekly reports on Friday (actual dedicated weekly-summary cron is Monday ~08:0x
  UTC — that's a *different* report than the Friday one, see below). Rewrote with the
  real cron values and clarified that "Weekly Summary" (Monday, lightweight tally) and
  "Weekly Report" (Friday, full win-rate breakdown) are two intentionally different
  reports, not duplicates of each other — worth spelling out since it looks like a bug at
  a glance.
- "Manual Commands" listed `node crypto_bot.js checkpositions` — not a real mode; position
  checks happen automatically inside every `scan` run. Fixed to show the actual mode list
  and pointed to `/positions` in Telegram for an on-demand check.
- Repo structure listing didn't include `AUDIT_REPORT.md` or `V5_VOTE_SYSTEM_NOTES.md`,
  and the ASCII diagram / signal format example still showed the old TRIPLE ENGINE BOOST
  and pre-vote-tag signal layout. Updated both.

## Confirmed still clean

- Sync-check: ran your `backtest.yml` sync-check script locally against the final files —
  all 15 functions it verifies (including `resolveVoteDirection`) are still byte-identical
  between `crypto_bot.js` and `backtest.js`.
- All 4 JS files pass `node --check`; `backtest.yml` parses as valid YAML.
- State/signal JSON files (`crypto_state.json`, etc.) are valid, no corruption.
- Removed genuinely dead code left over from the v5.0 rewrite (`checkAgreement`/
  `currentStateAsOf` in `backtest.js`, superseded by `resolveVoteAsOf`).

## Files delivered
`crypto_bot.js` · `forex_bot.js` · `stocks_bot.js` · `backtest.js` · `README.md` · and
`backtest.yml` (goes in `.github/workflows/backtest.yml`, not the repo root).

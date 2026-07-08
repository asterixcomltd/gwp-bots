# GWP Bots — Ghost Wick Protocol™ v5.0 — 5-Timeframe Vote System

**Autonomous institutional-grade trading signal bots by Abdin · Asterix Holdings Ltd. · Accra, Ghana**

> *Real GWP. Real Price Action. Real Market Structure. Real Math & Statistics. Real Macro Fundamentals.*
> *Every candle. Every session. Zero downtime.*

---

## What This Is

Three production Node.js bots running on GitHub Actions, delivering institutional-quality signals to Telegram 24/7 and publishing live data to a public Gist for the web dashboard.

| Bot | File | Data Source | Assets |
|---|---|---|---|
| 🪙 **GWP Crypto** | `crypto_bot.js` | KuCoin (no key needed) | DEXE · UNI · COMP · SOL · BTC · LINK · ETH · NEAR · AVAX · AAVE · ARB · INJ · DOT · FIL · SUI · ATOM · MNT (17 pairs) |
| 💱 **GWP Forex** | `forex_bot.js` | Twelve Data API | XAU/USD · EUR/USD · GBP/USD · USD/JPY · GBP/JPY |
| 📈 **GWP Stocks** | `stocks_bot.js` | Yahoo Finance (no key) | TSLA · NVDA · MSTR · COIN · PLTR · AMD · SMCI · SPCX |

---

## v5.0 — 5-Timeframe Vote System (current architecture)

**This supersedes the "Entry gate redesign" and "2-of-3 vote" sections further
down this README describing the July 2026 interim system — those are kept
below as historical record, but the mechanism actually running today is this
one.**

All three bots (and `backtest.js`) now evaluate **five timeframes** — D1, 4H,
1H, 30M, 15M — on every scan, per symbol:

1. **Vote (hard gate):** each TF casts one compressed BULL / BEAR / NEUTRAL
   read (`computeTfBias` — price vs. POC/VAH/VAL vs. recent-swing midpoint).
   **At least 3 of the 5 TFs must agree on direction** or the symbol is
   skipped entirely that scan — nothing below is even evaluated.
2. **Entry trigger:** once 3-of-5 agree, the bot looks for a live GWP
   wick-reversal pattern in that direction, checking the fastest TF first
   (15M → 30M → 1H → 4H → D1) and firing on the first one that both matches
   direction and clears `checkEntryConfirmations` (≥2-of-5 pattern
   confirmations: volume spike, AVWAP trap, Wyckoff Spring/Upthrust,
   confirmed market structure, or R:R ≥ 1.5).
3. **Conviction floor:** the triggering TF's conviction score (0–123, see
   grade scale below) must also clear that TF's own `minConviction` — after a
   **vote-strength boost** (+10 at a bare 3/5, +18 at 4/5, +25 at a unanimous
   5/5) that rewards signals with broader multi-timeframe agreement.

| TF | Label | minConviction | Cooldown |
|---|---|---|---|
| D1 | 1D | 70 | 20h |
| H4 | 4H | 68 | 3h |
| H1 | 1H | 58 | 2h |
| M30 | 30M | 60 | 1.5h |
| M15 | 15M | 62 | 1h |

D1 is now just one of the five voters — the old separate "D1 counter-trend
hard block" (reject counter-D1 trades below conviction 72–78) has been
retired, since a lone D1 disagreement is now naturally outvoted rather than
needing a bespoke rule.

**⚠️ Known open issue — signal frequency:** the first post-v5.0 backtests
(360-day, 4-pair chunks) came back with 0–1 closed trades per chunk, down
from ~6 under the previous system. Requiring an actual GWP pattern to fire
AND 3-of-5 independent timeframe bias to already agree at that exact moment
is a materially stricter combination than the old system, and early evidence
suggests it may be firing well under the "1–3 signals/week" target. A
funnel-accounting bug that hid *why* signals were being blocked (vote
rejections weren't being counted or logged) has been fixed — new backtest
runs will show a `Blocked by 3-of-5 vote` line so this can be diagnosed with
real numbers instead of guessed at. If frequency stays too low after
re-running the full 360d/720d suite, the responsible next step is loosening
one named parameter at a time (e.g. `minAgree` from 3 to 2 on lower-priority
TFs, or specific `minConviction` floors) and re-backtesting — not several
changes at once.

---

## v3.1 INSTITUTIONAL — 12-Fix Precision Upgrade (historical)

*Most of this table describes fixes from the July 2026 3-timeframe era. The
underlying scoring components (Wyckoff, BOS, LiqSweep, funding rate, macro
blackout, session multiplier, etc.) are all still active inside
`computeConviction`/`detectGWP` — only the top-level gating mechanism around
them has changed (see v5.0 section above).*

| # | Fix | What It Does |
|---|---|---|
| D1a | **D1 micro-AVWAP** | 20-candle lag → 3-candle response. Bias flips within 1 session |
| D1b | **D1 weight reduced** *(superseded by v5.0 — D1 is now a full 5-TF voter, see above)* | ~~±6/−4 gate → ±2/−1 whisper. 4H+1H+15M is primary engine~~ |
| 1 | **Zone touch counter** | Fresh zone (≤2 touches) = full score. Exhausted (5+) = −2 penalty |
| 2 | **Volume-validated BOS** | BOS with vol = +8. BOS without vol = +3. No more fake structure signals |
| 3 | **Zone-aware LiqSweep** | Sweep inside fresh zone = +10 (TRAP CONFIRMED). Open space = +4 |
| 4 | **Funding rate (crypto)** | Crowded longs/shorts detected via KuCoin perpetual funding. +4 aligned / −2 counter |
| 5 | **Macro event blackout** | FOMC + NFP calendar built in. Signals blocked ±1h around events |
| 6 | **Structural TP1** | TP1 anchored to nearest swing level, not arbitrary 50% midpoint |
| 7 | **Conviction-scaled sizing** | Score 96+ = 2.5× size. Score 84+ = 2.0×. Score <60 = 0.5× |
| 8 | **Hurst reliability gate** | Hurst only scores if candle array ≥120. Below = vol ratio fallback |
| 9 | **Session vol multiplier** | Asian hours = 1.5× vol threshold. London+NY = standard. No ghost signals at 3AM |
| 10 | **Performance tracker** | Every closed trade logged. Auto weekly report every Friday 21:00 UTC |
| 11 | **Double-candle CHoCH** | 2 consecutive closes past level = +16. Single close = +10. No spike fakes |
| 12 | **Signal quality score** | Every signal shows quality % (0–100%). 97% claim = ≥90% quality on fired signals |

---

## ⚠️ Operations Notes (read this if signals stopped firing)

**"My free subs expired and webhooks stopped working" — most likely cause:**
GitHub automatically **disables all scheduled (cron) workflows** in a repo once
**60 consecutive days** pass with no repository activity (commits/PRs/issues).
This is a GitHub platform behavior, not a subscription — see
[GitHub Docs](https://docs.github.com/en/actions/managing-workflow-runs/disabling-and-enabling-a-workflow).
If you left the repo idle, this is almost certainly what actually happened to
`gwp-crypto.yml` / `gwp-forex.yml` / `stocks_bot.yml`.

**Fix (one-time, manual — GitHub does not allow this to be automated):**
1. Go to the repo's **Actions** tab.
2. If you see *"This scheduled workflow is disabled because there hasn't been
   activity in this repository for at least 60 days"* — click **Enable workflow**
   on each of the three bot workflows.
3. `keepalive.yml` (new, see below) now makes a trivial commit every 30 days so
   this can never happen again, regardless of whether signals fire or not.

**Two separate systems — don't confuse them:**
| System | What it does | What can break it |
|---|---|---|
| GitHub Actions cron (`gwp-crypto.yml` etc.) | Runs the actual scans + sends real trade signals | 60-day auto-disable (see above) |
| Vercel webhook (`api/webhook.js`) | Instant `/start` and `/help` replies only | Vercel deployment going stale/removed, or the webhook URL never re-registered after a redeploy — re-run `setup-webhooks.sh` if `/start` stops replying instantly |

If it's specifically the **Forex** bot that went quiet (not crypto/stocks), check
whether your `TWELVE_DATA_KEY` was on a paid tier that lapsed — the free Twelve
Data tier has low request-per-minute/day caps that can silently start failing a
scan that scans 5 pairs × 3 timeframes every 30 minutes.

**New: `keepalive.yml`** — runs on the 1st and 15th of each month, makes a
one-line heartbeat commit. This is the "cron job to keep it active" fix —
independent of whether the repo is public or private, and independent of any
paid subscription.

**New: `backtest.yml` + updated `backtest.js`** — on-demand (and monthly
scheduled) 360-day and 720-day historical backtests of the crypto strategy,
using real KuCoin history. Run it manually from the Actions tab
(`workflow_dispatch`, pick `days: 360`, `720`, or leave as `both`). Also fixed
a bug where the report writer used a hardcoded path that didn't exist outside
the original dev sandbox — it now writes to `backtest-reports/` in the repo
and uploads a full artifact.

**Backtest reliability fixes (July 2026):** a chain of real bugs that made
full 17-pair backtests take 1–3+ hours or hang indefinitely, now fixed:
- A KuCoin-throttling backoff/retry loop (429s were previously untracked —
  the fetcher would silently truncate data instead of retrying).
- A genuine infinite-loop bug: if a pair's requested history predates its
  actual listing date, KuCoin kept returning the same "earliest available"
  page forever with no error — now detected and stopped.
- A fast (~5s) KuCoin connectivity preflight check that fails loud immediately
  if the runner's IP is being throttled, instead of discovering it 3 hours in.
- The 17-pair sweep is now split across parallel GitHub Actions jobs (`plan` →
  N chunk jobs → `combine`), configurable via the `pair_chunks` input
  (default 4), each with its own `max_minutes` time budget. A `combine` job
  merges every chunk's results into one clean report per day-window.

**New stock: `SPCX`** — SpaceX itself IPO'd on Nasdaq (June 12, 2026), so it's
now added directly to the Stocks bot pair list (no proxy needed). Its price
history is short right now, so higher-timeframe (D1/H4) votes and entry
triggers for it may take a few more weeks to start firing — that's the
existing insufficient-data guard working as intended, not a bug.

**Entry gate history (July 2026 → v5.0):** All three bots originally required
a cumulative conviction score (out of 123) to clear a fixed threshold before
firing. Real 360-day backtest data showed that threshold alone was throwing
away most genuine setups, so it was temporarily replaced with a pure
count-based check (`checkEntryConfirmations`, modeled on the MVS bot): ≥2 of
5 independent confirmations, with conviction kept only for grading/sizing.

At that point, a compressed 2-of-3 timeframe "vote" was also added for
visibility, but was deliberately **not** a blocking gate — early testing
found that requiring it to agree with GWP's own signal on the *same*
timeframe was architecturally contradictory (GWP is a reversal detector;
the vote was a trend-following read), so same-timeframe voting blocked 86 of
90 real signals.

**This has since been superseded by v5.0** (see the section near the top of
this README): the vote is now computed *across* 5 timeframes rather than on
one, resolving the same-timeframe contradiction, and is now a hard 3-of-5
gate combined with the confirmation-count + conviction-floor checks above —
not informational-only anymore. Treat this paragraph and the two above it as
historical record of how the gate evolved, not the current behavior.

**⚠️ No backtest coverage for forex/stocks:** the confirmation-count gate
change was validated against real historical data for crypto only — there is
no `forex_backtest.js` or `stocks_backtest.js` in this repo. The same change
was ported to `forex_bot.js` and `stocks_bot.js` (verified byte-identical
core logic across all three files), but it is running live with no backtest
safety net behind it for those two. Build a backtest harness for them before
fully trusting their signal frequency/quality.

---



```
┌─────────────────────────────────────────────────────────┐
│           GHOST WICK PROTOCOL™  v5.0  ELITE MAX          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  PILLAR 1 — GWP PRICE ACTION (Primary Gate)             │
│    Wick penetrates VAL band + Body closes outside       │
│    Vol spike OR AVWAP trap must confirm (hard gate)     │
│    Zone freshness check (touch counter penalty)         │
│                                                         │
│  PILLAR 2 — MARKET STRUCTURE (Additive scoring)         │
│    CHoCH double-confirmed  → +16 (strong) / +10 (weak)  │
│    BOS volume-validated    → +8 (confirmed) / +3 (weak)  │
│    LiqSweep zone-aware     → +10 / +5 / +4              │
│    FVG present             → +3                         │
│    Wyckoff Spring/Upthrust → +10                        │
│                                                         │
│  PILLAR 3 — MATH & STATISTICS                           │
│    Hurst exponent          → +8 (reliable, ≥120 bars)   │
│    Z-Score extreme         → +7 | mild → +3             │
│    Kalman velocity flip    → +6                         │
│    Sine-wave cycle peak    → +8                         │
│    ATR percentile sweet    → +4 | vol ratio → +4        │
│                                                         │
│  PILLAR 4 — MACRO & FUNDAMENTALS                        │
│    D1 alignment bonus      → +8 aligned / −12 counter   │
│    Funding rate (crypto)   → +4 / 0 / −2               │
│    FOMC/NFP blackout       → hard block ±1h             │
│    Session vol multiplier  → Asian 1.5× / London std    │
│                                                         │
│  5-TF VOTE + ENTRY TRIGGER (hard gate, see v5.0 above)  │
│    3-of-5 (D1/4H/1H/30M/15M) must agree on direction    │
│    Fastest agreeing TF w/ live GWP pattern triggers     │
│    Vote-strength boost: +10 (3/5) / +18 (4/5) / +25 (5/5)│
└─────────────────────────────────────────────────────────┘
```

---

## Signal Format (What You See in Telegram)

```
🎯  GWP · SOL/USDT · SHORT ▼ [15M]
🗳️  3/5 TF VOTE (D1+H4+15M) —
🔴  84/123  ·  🔥 ELITE  ·  R:R 2.46:1
📊  Signal Quality: ✅ 91% 🏛 INSTITUTIONAL
📐  Size: 1.5× ⚡ ELEVATED
─────────────────────────────
ENTRY  84.38   SL  85.43  (-1.24%)
TP1  83.09  ·  TP2  81.80  ·  TP3  76.63
─────────────────────────────
🎯 TRAP CONFIRMED  ·  🪤 AVWAP TRAP  ·  ⚡ MOM BURST
⬇️ BOS↓ ✅  💧 LiqSwp↑ ✅
💰 Funding: +0.12% 🔴 (Longs crowded)
🟢 FRESH ZONE
```

---

## How a Signal Fires (v5.0)

| Stage | What has to happen |
|---|---|
| 1. Vote | ≥3 of 5 TFs (D1/4H/1H/30M/15M) agree on direction via `computeTfBias` |
| 2. Entry trigger | Fastest agreeing TF (15M→30M→1H→4H→D1) with a live GWP pattern in that direction |
| 3. Confirmation gate | `checkEntryConfirmations` ≥2-of-5 (vol spike, AVWAP trap, Wyckoff, MS confirmed, R:R≥1.5) |
| 4. Conviction floor | Triggering TF's score (+ vote-strength boost) ≥ that TF's `minConviction` |

There are no more separate TRIPLE/CONFLUENCE/SOLO tiers — every fired signal
shows its vote tally (e.g. `3/5`, `4/5`, `5/5`) and which TF triggered entry
instead.

---

## Conviction Grade Scale (out of 123)

> This score does **not** gate whether a signal fires on its own — see "How a
> Signal Fires" above for the full v5.0 gate sequence (vote → trigger →
> confirmations → conviction floor). The number below is the grading/sizing
> label shown on every signal that already cleared all four stages.

| Score | Grade | Size |
|---|---|---|
| 108–123 | 🏆 SUPREME★★★★ | 2.5× — maximum institutional |
| 96–107 | 🏆 SUPREME★★★ | 2.2× |
| 84–95 | ⚡ SUPREME★★ | 2.0× — high conviction |
| 72–83 | 🔥 SUPREME★ | 1.5× — elevated |
| 58–71 | 🔥 ELITE | 1.0× — standard |
| 50–57 | ✅ SOLID | 0.5× — reduced |
| <50 | ⚠️ MARGINAL | 0.5× — reduced (only reachable at all if it separately clears its TF's `minConviction` floor, which is ≥58 on every TF — so MARGINAL is effectively unreachable as a fired grade under current gates) |

---

## Risk Management Built-In

| Layer | Mechanism |
|---|---|
| SL Layer 1 | Wick high/low + ATR buffer |
| SL Layer 2 | Minimum SL %: Crypto 1.2% · Forex 0.1% · Stocks 0.8% |
| SL Layer 3 | ATR floor: SL always ≥ 1.5× ATR from entry |
| Position exits | TP1 = structural swing (40% exit) · TP2 = VAL mid (40%) · TP3 = 3× runner (20%) |
| Circuit breaker | 3 losses → 24h symbol pause |
| Cooldown | D1: 20h · 4H: 3h · 1H: 2h · 30M: 1.5h · 15M: 1h — no signal spam |
| Macro blackout | FOMC + NFP calendar — ±1h hard block |
| Session gate | Stocks: US market hours only · Crypto: Asian vol multiplier |

---

## Performance Tracking (v3.1)

Every closed trade (TP1/TP2/TP3/SL) is logged with:
- Symbol, TF, direction, conviction score
- Which TP level hit (or SL)
- Session (Asian/London/London+NY/NY)
- Realized P&L

**Weekly report** auto-fires to Telegram every **Friday 21:00 UTC**:
```
📊 GWP WEEKLY REPORT — W14 2026
Signals: 12 · Wins: 9 · Losses: 3 · Win Rate: 75%
💎 SUPREME (84+): 100% WR (4 trades)
🔥 ELITE  (60-83): 62% WR (8 trades)
By Session: London+NY 80% · Asian 50%
```

Trigger manually anytime: `node crypto_bot.js weeklyreport`

---

## GitHub Secrets Required

| Secret | Bot | Purpose |
|---|---|---|
| `CRYPTO_TG_TOKEN` | Crypto | Telegram bot token |
| `CRYPTO_CHAT_ID` | Crypto | Telegram chat/channel ID |
| `FOREX_TG_TOKEN` | Forex | Telegram bot token |
| `FOREX_CHAT_ID` | Forex | Telegram chat/channel ID |
| `STOCKS_TG_TOKEN` | Stocks | Telegram bot token |
| `STOCKS_CHAT_ID` | Stocks | Telegram chat/channel ID |
| `TWELVE_DATA_KEY` | Forex | Twelve Data API key |
| `GH_PAT` | All | GitHub PAT — repo + gist scope |
| `GIST_ID` | Crypto + Forex | Public Gist for dashboard feed |

---

## Instant /start Webhook (User Onboarding — Vercel)

When users click a bot link from the Asterix app and send `/start`, the standard
GitHub Actions bots take up to 4H to respond. The Vercel webhook fixes this — **instant reply**.

### Deploy to Vercel (one-time, free)

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import `asterixcomltd/gwp-bots`
2. In Vercel **Environment Variables**, add:
   - `CRYPTO_TG_TOKEN` — your crypto bot token
   - `FOREX_TG_TOKEN` — your forex bot token
   - `STOCKS_TG_TOKEN` — your stocks bot token
3. Deploy → copy your Vercel URL (e.g. `https://gwp-bots.vercel.app`)

### Register webhooks (one-time)

Edit `setup-webhooks.sh` — fill in your Vercel URL and 3 bot tokens — then run:
```bash
bash setup-webhooks.sh
```

Or manually via curl:
```bash
curl "https://api.telegram.org/bot<CRYPTO_TOKEN>/setWebhook?url=https://YOUR.vercel.app/api/webhook?bot=crypto"
curl "https://api.telegram.org/bot<FOREX_TOKEN>/setWebhook?url=https://YOUR.vercel.app/api/webhook?bot=forex"
curl "https://api.telegram.org/bot<STOCKS_TOKEN>/setWebhook?url=https://YOUR.vercel.app/api/webhook?bot=stocks"
```

### What users see

| User action | Response |
|---|---|
| Sends `/start` | Instant welcome — bot info, pairs, commands, GWP explanation |
| Sends `/help` | Same as `/start` |
| Sends any other command | "Will be processed at next scan within 4H" |

---

## Cron Schedule

| Bot | Scan | Daily Summary | Weekly Summary | Weekly Report |
|---|---|---|---|---|
| Crypto | Every 30 min, `:15`/`:45` (24/7) | 08:02 UTC | Monday 08:07 UTC | Friday 21:00 UTC (during a scan run) |
| Forex | Hourly, `:00` (24/7) | 08:03 UTC | Monday 08:08 UTC | Friday 21:00 UTC (during a scan run) |
| Stocks | Every 30 min, `:10`/`:40` (24/7, session gate applies inside the bot) | 08:04 UTC | Monday 08:09 UTC | Friday 21:00 UTC (during a scan run) |

"Weekly Summary" (`sendWeeklySummary`, mode `weekly`) is the lightweight
signals-fired tally; "Weekly Report" (`sendWeeklyReport`, mode
`weeklyreport` or the Friday 21:00 UTC auto-trigger) is the fuller
win-rate/conviction-grade breakdown — these are two different reports on two
different schedules, not duplicates of each other. The Friday auto-trigger is
now guarded against firing twice within the same 21:00 UTC hour (the scan
cron runs more than once per hour, which previously caused a duplicate send
every Friday — fixed).

---

## Manual Commands

```bash
node crypto_bot.js scan           # Run signal scan now (also checks all open positions first)
node crypto_bot.js daily          # Daily summary report
node crypto_bot.js weekly         # Weekly signals-fired tally (sendWeeklySummary)
node crypto_bot.js weeklyreport   # Weekly win-rate/conviction performance report (sendWeeklyReport)
node crypto_bot.js health         # Health check + price feed

# Same commands work for forex_bot.js and stocks_bot.js.
# There is no separate "checkpositions" mode — open positions are checked
# automatically at the start of every `scan` run. To check them on demand
# without a full scan, use the /positions command in Telegram instead.
```

---

## Repo Structure

```
gwp-bots/
├── .github/workflows/
│   ├── gwp-crypto.yml        ← Crypto bot (every 30min, :15/:45)
│   ├── gwp-forex.yml         ← Forex bot (hourly, :00)
│   ├── stocks_bot.yml        ← Stocks bot (every 30min, :10/:40, session-gated internally)
│   ├── backtest.yml          ← 360d/720d historical backtest (on-demand + monthly)
│   └── keepalive.yml         ← 30-day heartbeat, prevents 60-day auto-disable
├── crypto_bot.js             ← Crypto signal engine — v5.0 5-TF vote (D1/4H/1H/30M/15M)
├── forex_bot.js              ← Forex signal engine — same v5.0 vote system, no backtest coverage
├── stocks_bot.js             ← Stocks signal engine — same v5.0 vote system, no backtest coverage; now incl. SPCX
├── backtest.js                ← Historical backtester (crypto only) — v5.0 5-TF vote, preflight check, infinite-loop fix, parallel-chunk aware
├── backtest-reports/         ← generated .md summaries (json gitignored)
├── crypto_state.json         ← Persistent state (auto-committed)
├── forex_state.json          ← Persistent state (auto-committed)
├── stocks_state.json         ← Persistent state (auto-committed)
├── crypto_signals.json       ← Latest signals (→ Gist → dashboard)
├── forex_signals.json        ← Latest signals (→ Gist → dashboard)
├── stocks_signals.json       ← Latest signals (→ Gist → dashboard)
├── AUDIT_REPORT.md           ← Bug-audit history (minConviction dead-gate fix, etc.)
├── V5_VOTE_SYSTEM_NOTES.md   ← v5.0 5-TF vote system design notes
├── .gitignore
├── package.json
└── README.md
```

---

*© 2026 Asterix Holdings Ltd. / Abdin. Ghost Wick Protocol™ is proprietary and confidential.*
*Advertised accuracy = % of fired signals meeting ≥90% institutional quality criteria.*

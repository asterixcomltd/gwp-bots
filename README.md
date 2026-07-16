# GWP Bots — Ghost Wick Protocol

Three independent sub-bots — **Crypto**, **Forex**, **Stocks** — built directly
from [MVS-bot](https://github.com/) ("Monthly Value Sniper")'s architecture:
same foundation (Volume Profile POC/VAH/VAL + Fibonacci, zero lagging
indicators), same shared-core discipline, same trade-management mechanics
(2-stage TP1/TP2 exit, risk tiering, POC-quality factors, TD Sequential
sizing boost). The **only** structural change from MVS is the timeframe
architecture itself.

## Timeframe architecture (v1.1.2)

MVS's own codebase documents its *original* v10.0 design as a 3-timeframe,
2-of-3 vote (4H bias / 1H structure / 15m trigger) before it was later
expanded to 5 timeframes, using Daily as a second bias-vote layer. GWP
restores that same 4-timeframe pattern, one rung down the clock:

| Role       | Timeframe | Job                                                          |
|------------|-----------|---------------------------------------------------------------|
| **Bias**   | **D1**    | A second, slower macro POC/VAH/VAL/Fib50 vote                 |
| **Bias**   | **2H**    | Macro POC/VAH/VAL/Fib50 vote                                   |
| **Structure** | **30M** | Swing, Fibonacci golden pocket, POC/VAH/VAL zone, ATR, SL anchor |
| **Entry (trigger)** | **15M** | The actual rejection candle that fires the signal        |

Direction requires **3 of these 4** timeframes to agree before anything can
fire — no single timeframe can force a trade on its own. The bot scans
every 15 minutes, matching the 15M trigger cadence.

**On top of the vote**, a **dual multi-TF gate** requires the 30M zone's
confluence level to also line up with the equivalent level computed
independently on 2H and D1 — checked TWICE, once for POC
(`computeMultiTFPOCAlignment`) and once for Fibonacci
(`computeMultiTFFibAlignment`). `DUAL_MULTI_TF_POC_MIN_ALIGNED` and
`DUAL_MULTI_TF_FIB_MIN_ALIGNED` (both default `1`) control how many of
{2H, D1} must independently confirm each system — default is "at least
one of the two," not "both." An earlier version hardcoded "both required"
and it crushed signal frequency far below a usable rate on real data
(crypto went from ~62 signals/360 days down to 2); these are tunable via
env vars if you want to re-test stricter settings against your own
backtest numbers. This sits on top of, not instead of, the 15M
rejection-candle requirement.

**Important tolerance note:** each multi-TF check measures against that
specific timeframe's *own* ATR, not 30M's. A price gap that looks huge in
30M-ATR terms can be perfectly normal relative to D1's own (much larger)
volatility — comparing against the wrong timeframe's ATR was an earlier
bug that made the dual gate never fire at all (see `core.js`'s v1.1.1 fix
notes on `computeMultiTFPOCAlignment`).

## Repo layout

```
gwp-bots/
├── shared/                 ← ONE copy of every rule — no sub-bot has its own
│   ├── core.js             ← pure decision logic (POC/VAH/VAL/Fib, votes,
│   │                          rejection patterns, TP/SL math, risk sizing)
│   ├── config-base.js      ← every TF-agnostic strategy setting
│   ├── engine.js           ← the full 10-step live scan pipeline
│   ├── backtest-engine.js  ← tick-by-tick replay + report generator
│   ├── position-tracker.js ← replays real candles against open trades
│   ├── run-live.js         ← live-runner bootstrap (used by strategy.js)
│   ├── run-backtest.js     ← backtest CLI bootstrap
│   ├── run-commands.js     ← Telegram command handler
│   ├── run-weekly-summary.js
│   ├── run-setup-bot.js
│   ├── kucoin.js           ← KuCoin data client (Crypto)
│   ├── twelvedata.js       ← Twelve Data client (Forex + Stocks)
│   ├── telegram.js         ← Telegram send/retry helper
│   └── persistence.js      ← state/log/diag JSON read-write
├── bots/
│   ├── crypto/   config.js + thin entrypoints + its own state/log JSON
│   ├── forex/    config.js + thin entrypoints + its own state/log JSON
│   └── stocks/   config.js + thin entrypoints + its own state/log JSON
├── .github/workflows/      ← scan (15min) / commands (5min) / weekly / backtest (weekly) / setup, ×3, + one repo-wide keepalive
└── tests/                  ← synthetic-data smoke tests (no network needed)
```

## Workflows (16 total)

Per bot (×3 — crypto/forex/stocks): `*-scan.yml` (every 15min), `*-commands.yml`
(every 5min), `*-weekly.yml` (Mondays 07:00 UTC), `*-backtest.yml` (Sundays
06:00 UTC + manual dispatch with optional symbol/day overrides — posts a
summary to Telegram and commits the full report to the repo), `*-setup.yml`
(manual, run once). Plus one repo-wide `keepalive.yml` (Mondays) that makes a
trivial commit regardless of bot health, so GitHub never auto-disables the
scheduled workflows after 60 days of apparent inactivity — belt-and-braces on
top of the fact that every scan already commits `state.json` every 15
minutes on its own.

Every commit step (scan/commands/weekly/backtest) does `git pull --rebase`
before `git push`, with retries — three bots' workflows can land on the same
15-minute tick and would otherwise race to push and reject each other.

### If GWP Crypto's scan shows a red ❌ in Actions

Open the failed run → the "run strategy.js" step → read the actual error
line. The most likely cause: **KuCoin returns HTTP 451 for GitHub-hosted
runners** (their default runners are US/EU cloud IPs, and KuCoin's Terms of
Service block spot-market endpoints from some jurisdictions when it detects
cloud-datacenter IPs) — `shared/kucoin.js` now prints the exact HTTP status
and response body when this happens, so the log will say so explicitly
rather than a generic timeout. If that's what you see, the fix isn't a code
bug — it needs either a self-hosted GitHub Actions runner (a small always-on
VM/container you register to your repo) or an egress proxy KuCoin doesn't
block. If the log shows something else entirely, that's a real bug — send me
that log line.

Every sub-bot's `strategy.js`, `backtest.js`, `commands.js`,
`weekly-summary.js`, and `position-tracker.js` is a few lines: build the
right data client (KuCoin or Twelve Data) and hand off to the matching
`shared/run-*.js`. **This means a bug fix in `shared/` fixes all three bots
at once — none of them can silently drift from the others**, the same
anti-drift discipline MVS-bot's own header describes for sharing one
`core.js` between its live bot and backtester, just extended one level
further across sub-bots.

## Setup

1. `npm install` at the repo root.
2. Create three Telegram bots (BotFather) — or reuse one bot with three
   different chats. Set these GitHub Actions secrets:
   - `CRYPTO_TG_TOKEN`, `CRYPTO_CHAT_ID`
   - `FOREX_TG_TOKEN`, `FOREX_CHAT_ID`
   - `STOCKS_TG_TOKEN`, `STOCKS_CHAT_ID`
   - `FOREX_TWELVE_DATA_KEYS` and `STOCKS_TWELVE_DATA_KEYS` — **separate
     pools, not shared** (see "API key economics" below for why this
     matters). Falls back to a shared `TWELVE_DATA_KEYS` secret, then a
     single legacy `TWELVE_DATA_KEY`, if a dedicated one isn't set.
3. Run each bot's `setup-bot.js` once (via the `*-setup.yml` workflow, or
   locally with the right env vars) to configure the Telegram bot profile
   and command menu.
4. The `*-scan.yml` workflows scan every 15 minutes automatically once
   pushed to GitHub (public repos get unlimited free Actions minutes).

### API key economics — read this before setting up Forex/Stocks

Twelve Data's free/basic plan caps out at **800 credits/day per key**.
Even with the incremental candle cache (`shared/twelvedata.js` — skips a
fetch entirely when no new bar is due yet), live scanning alone needs
roughly:

| Bot    | Symbols | Live-scan credits/day (approx) | Backtest credits (one run, approx) |
|--------|---------|-------------------------------|--------------------------------------|
| Forex  | 10      | ~1,570                        | ~1,500                               |
| Stocks | 11      | ~1,730                        | ~1,700                               |

**Give each bot its own dedicated key pool — don't share one pool between
Forex and Stocks.** An earlier setup shared one `TWELVE_DATA_KEYS` pool
between both bots, and because both bots' weekly backtests were scheduled
the same day, combined demand on backtest day (~6,500 credits: both bots'
live scanning + both bots' backtests) blew past even a 5-key (4,000/day)
shared pool — backtests failed completely with "DATA FETCH FAILED FOR
EVERY SYMBOL" even though the keys worked fine for live scanning (proven
by a populated `candle-cache.json`).

**Example: aligning 5 Twelve Data keys for Forex.**
1. Sign up for 5 free API keys at twelvedata.com (different emails if
   needed — one key per signup).
2. In your repo: **Settings → Secrets and variables → Actions → New
   repository secret**.
3. Name it `FOREX_TWELVE_DATA_KEYS`, and paste all 5 keys **comma-
   separated, no spaces**:
   ```
   abc123def456,ghi789jkl012,mno345pqr678,stu901vwx234,yz5678abc901
   ```
   (placeholders — use your real keys). This gives Forex a dedicated
   4,000 credits/day, comfortably covering its ~1,570/day live-scan need
   plus room for its own weekly backtest.
4. Repeat with a **different** set of 5 keys under `STOCKS_TWELVE_DATA_KEYS`
   for Stocks. Do not reuse the same 5 keys for both secrets — that
   recreates the shared-pool problem this section is about.

If you'd rather run fewer keys, reduce `SYMBOLS` in that bot's `config.js`
instead of hoping a small shared pool stretches across both bots.

### Local backtesting

```bash
cd bots/crypto  && TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x node backtest.js
cd bots/forex   && FOREX_TWELVE_DATA_KEYS=key1,key2,key3 node backtest.js EUR/USD 180
cd bots/stocks  && STOCKS_TWELVE_DATA_KEYS=key1,key2,key3 node backtest.js AAPL 90
```

Each run writes `backtest-report.txt` / `backtest-report.json` in that
bot's own folder. **Run this yourself before trusting any number** — no
performance figures are hardcoded anywhere in this repo.

### Local smoke tests (no network, no API keys needed)

```bash
node tests/smoke-test-live.js       # correlated synthetic candles through the live pipeline
node tests/smoke-test-backtest.js   # correlated synthetic candles through the backtest engine
```

Both generate ONE base 15-minute price series and aggregate it UP into
30M/2H/D1 bars (exactly how real exchange data works — a 2H candle IS
eight 15M candles combined), so the multi-TF alignment gates are
genuinely exercised. An earlier version of these tests generated
independent random walks per timeframe, which made the dual multi-TF gate
untestable locally and briefly hid a real bug.

## Assets tracked

- **Crypto** (KuCoin): ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK, BNB, DOT,
  LTC, TRX, POL, MNT — all vs USDT.
- **Forex** (Twelve Data): XAU/USD, EUR/USD, GBP/USD, USD/JPY, GBP/JPY,
  AUD/USD, USD/CAD, NZD/USD, USD/CHF, EUR/JPY.
- **Stocks** (Twelve Data): AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AMD,
  NFLX, AVGO, SPCX (SpaceX — IPO'd on Nasdaq June 2026).

Edit `SYMBOLS` in each bot's `bots/<name>/config.js` to change this list.

## Changelog / mistakes learned

Kept here deliberately, not swept away — same "verify, don't assume"
standard as the rest of this repo.

- **v1.1.3**: Found the REAL post-D1 frequency bottleneck via real
  backtest funnel data — not the dual multi-TF gate (which was passing
  85-95% of candidates by this point, and crypto's win rate had actually
  IMPROVED to 90%), but `TP2_MIN_EXTENSION_RR` (unrelated old MVS-ported
  logic): 307 trigger-qualified candidates across all 14 crypto symbols,
  only 10 survived this one gate. The dual gate selects setups closer to
  their TP2 target already, so the old 0.25R minimum-extension threshold
  — tuned against a different candidate distribution — rejected almost
  all of them. Lowered to 0.05. Also confirmed via Twelve Data's own
  documentation why Stocks kept returning far less usable data than
  Forex even with working keys: equities' INTRADAY data (15min/30min/2H)
  is only available for "a few months" on this plan, unlike forex/crypto
  intraday history which goes back a year or more — D1 itself is NOT
  restricted this way. Requesting the default 360 backtest days meant
  most of that request returned nothing, and warmup ate nearly all of
  what little was available. Stocks' `BACKTEST_DAYS` is now 90, not 360.
- **v1.1.2**: Fixed `/status` never displaying D1 bias (it was tallied in
  the vote but missing from the display line). Made the dual multi-TF
  gate's strictness tunable (`DUAL_MULTI_TF_POC_MIN_ALIGNED` /
  `DUAL_MULTI_TF_FIB_MIN_ALIGNED`, default 1) after confirming the
  hardcoded "both 2H+D1 required" version crushed real signal frequency
  far below a usable rate. Split Forex/Stocks onto separate dedicated
  Twelve Data key pools after confirming a shared pool starved both bots'
  backtests on the day both bots' weekly backtests coincided.
- **v1.1.1**: Fixed the dual multi-TF gate never firing at all — it
  measured alignment against the wrong timeframe's ATR (30M's tiny ATR
  instead of each macro timeframe's own), making genuine alignment cases
  look like enormous mismatches. Also fixed the synthetic smoke tests,
  which generated independent random walks per timeframe instead of one
  correlated series — that made the bug invisible locally.
- **v1.1.0**: Added D1 as a 4th timeframe (3-of-4 vote) and the dual
  multi-TF POC+Fib confirmation gate. Added multi-key Twelve Data
  rotation and an incremental candle cache. Fixed daily-vs-per-minute
  credit exhaustion being treated identically (daily exhaustion isn't
  transient — waiting doesn't help until the vendor's next reset).
- **v1.0.x**: Initial 3-TF (2H/30M/15M) build, KuCoin geo-block
  diagnostics, GitHub Actions race-condition fixes on shared commit
  steps, Telegram long-polling to reduce command response delay.

## Honesty notes (carried over from MVS-bot's own standing rules)

- **No hardcoded win rate anywhere.** This bot does not target or claim a
  specific win rate — no trading system does. Every command that used to
  quote a number instead points to `node backtest.js`.
- **Synthetic volume for FX.** Spot FX has no centralized volume. When a
  Twelve Data fetch comes back with (near-)zero volume on every candle,
  `shared/twelvedata.js` substitutes each candle's true range as a proxy
  and flags it — documented in that file's header. This affects Forex
  only; Stocks and Crypto use real traded volume.
- **Every symbol runs the identical rule set** — no per-symbol or
  per-direction overrides, to avoid overfitting to one backtest window.
- **Probability-favored, not a guarantee.** Every signal message says so.
  Size positions so 3-4 consecutive losses (normal variance) doesn't
  meaningfully damage the account.

## Renaming

Per your note — the name/branding here (GWP / "Ghost Wick Protocol") is a
placeholder for now, per your instruction to focus on content first. The
name lives in exactly these places when you're ready to change it: each
bot's `strategy.js`/`commands.js`/`setup-bot.js` `botLabel` field, each
`config.js` header comment, and this README.

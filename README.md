# GWP Bots — Ghost Wick Protocol

Three independent sub-bots — **Crypto**, **Forex**, **Stocks** — built directly
from [MVS-bot](https://github.com/) ("Monthly Value Sniper")'s architecture:
same foundation (Volume Profile POC/VAH/VAL + Fibonacci, zero lagging
indicators), same shared-core discipline, same trade-management mechanics
(2-stage TP1/TP2 exit, risk tiering, POC-quality factors, TD Sequential
sizing boost). The **only** structural change from MVS is the timeframe
architecture itself.

## Timeframe architecture

MVS's own codebase documents its *original* v10.0 design as a 3-timeframe,
2-of-3 vote (4H bias / 1H structure / 15m trigger) before it was later
expanded to 5 timeframes. GWP deliberately keeps that simpler original
design, shifted one rung down the clock:

| Role       | Timeframe | Job                                                          |
|------------|-----------|---------------------------------------------------------------|
| **Bias**   | **2H**    | Macro POC/VAH/VAL/Fib50 vote only                              |
| **Structure** | **30M** | Swing, Fibonacci golden pocket, POC/VAH/VAL zone, ATR, SL anchor |
| **Entry (trigger)** | **15M** | The actual rejection candle that fires the signal        |

Direction requires **2 of these 3** timeframes to agree before anything can
fire — no single timeframe can force a trade on its own. The bot scans
every 15 minutes, matching the 15M trigger cadence.

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
├── .github/workflows/      ← scan (15min) / commands (5min) / weekly / setup, ×3
└── tests/                  ← synthetic-data smoke tests (no network needed)
```

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
   - `TWELVE_DATA_KEY` (used by both Forex and Stocks)
3. Run each bot's `setup-bot.js` once (via the `*-setup.yml` workflow, or
   locally with the right env vars) to configure the Telegram bot profile
   and command menu.
4. The `*-scan.yml` workflows scan every 15 minutes automatically once
   pushed to GitHub (public repos get unlimited free Actions minutes).

### Local backtesting

```bash
cd bots/crypto  && TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x node backtest.js
cd bots/forex   && TWELVE_DATA_KEY=x node backtest.js EUR/USD 180
cd bots/stocks  && TWELVE_DATA_KEY=x node backtest.js AAPL 90
```

Each run writes `backtest-report.txt` / `backtest-report.json` in that
bot's own folder. **Run this yourself before trusting any number** — no
performance figures are hardcoded anywhere in this repo.

### Local smoke tests (no network, no API keys needed)

```bash
node tests/smoke-test-live.js       # synthetic candles through the live pipeline
node tests/smoke-test-backtest.js   # synthetic candles through the backtest engine
```

## Assets tracked

- **Crypto** (KuCoin): ETH, SOL, BTC, XRP, ADA, DOGE, AVAX, LINK, BNB, DOT,
  LTC, TRX, POL, MNT — all vs USDT.
- **Forex** (Twelve Data): XAU/USD, EUR/USD, GBP/USD, USD/JPY, GBP/JPY,
  AUD/USD, USD/CAD, NZD/USD, USD/CHF, EUR/JPY.
- **Stocks** (Twelve Data): AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AMD,
  NFLX, AVGO.

Edit `SYMBOLS` in each bot's `bots/<name>/config.js` to change this list.

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

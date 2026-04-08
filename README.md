# GWP Bots — Ghost Wick Protocol™ v3.0

**Autonomous trading signal bots by Abdin · Asterix.COM Ltd. · Accra, Ghana**

> *Every candle. Every session. Zero downtime.*

---

## v3.0 Changelog (all three bots)

| # | Fix / Upgrade | Detail |
|---|---|---|
| 1 | **D1 bias was BACKWARDS** | Counter-trend was getting +6 bonus. Fixed: aligned = +6, counter-trend = −4 |
| 2 | **LIQ SWEEP shown twice** | `ms.label` + `msLine()` both showed it. Removed `ms.label` from single signal format |
| 3 | **D1 bias note had no context** | Now shows `D1: BULL ✅` (aligned) or `D1: BEAR ⚠️ CT` (counter) |
| 4 | **Opposite-direction same-scan signals** | `firedDir` lock: SOL BEAR [4H] now blocks SOL BULL [1H] in the same scan |
| 5 | **httpGet had zero timeout** | Added 15s `req.destroy()` timeout — no more KuCoin hangs |
| 6 | **Crypto: 40 sequential API fetches** | `Promise.all()` per symbol — 4 TFs in parallel → ~4× faster scan |
| 7 | **Stocks: Yahoo Finance parallel fetch** | 1H + 15M + D1 now fetched in `Promise.all()` — faster per-symbol |

---

## Overview

Three production-grade Node.js bots running on GitHub Actions. They deliver institutional-quality trade signals to Telegram 24 hours a day, 7 days a week, and publish live signal data to a public GitHub Gist for the web dashboard.

| Bot | File | Exchange | Pairs |
|---|---|---|---|
| GWP Crypto | `crypto_bot.js` | KuCoin (no key) | DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH · LINK · ARB · INJ |
| GWP Forex | `forex_bot.js` | Twelve Data | XAU/USD · EUR/USD · GBP/USD · USD/JPY · GBP/JPY |
| GWP Stocks | `stocks_bot.js` | Yahoo Finance (no key) | TSLA · NVDA · MSTR · COIN · PLTR · AMD · SMCI |

---

## Architecture — "The Winning Combo"

```
Signal Generator (Primary)
  └── GWP™ — VAL band wick penetrates + body closes outside → TRADE FIRES

Conviction Amplifiers (Additive scoring)
  ├── Tier 1 — Structural:  CHoCH (+14) · BOS (+8) · LiqSweep (+5) · FVG (+3)
  │                         Wyckoff Spring / Upthrust (+10)
  ├── Tier 2 — Statistical: Hurst (+8) · Z-Score (+7) · Kalman (+6)
  │                         Sine Cycle contraction (+8)
  └── Tier 3 — Participation: AVWAP Trap (+12) · Vol Spike (+6) · Vol Ratio (+4)

Context Filters (Gate — penalty / block)
  ├── GWP pattern (primary gate — must fire first)
  ├── Vol + AVWAP gate (at least one must pass — no ghost signals)
  ├── D1 AVWAP bias: aligned = +6  |  counter-trend = −4   ← v3.0 FIX
  ├── firedDir lock per symbol per scan                     ← v3.0 FIX
  └── Circuit breaker (3 losses → 24h pause)
```

---

## Signal Tiers

| Tier | Trigger | Boost |
|---|---|---|
| 🔥🔥🔥 TRIPLE | 4H + 1H + 15M aligned | +25 conviction |
| 🔥🔥 CONFLUENCE | 4H + 1H aligned | +18 conviction |
| 📈 SINGLE 4H | Institutional swing | Min R:R 2.0 |
| ⚡ SINGLE 1H | Scalp entry | Min R:R 1.6 |
| 🔬 MICRO 15M | Sniper (only with 4H/1H context) | Min R:R 1.5 |

---

## Speed — v3.0 Fixes

**Why crypto and stocks were slow:**
- `httpGet` had **no timeout** — one slow KuCoin response = entire bot hangs
- 10 crypto pairs × 4 TF calls = **40 sequential awaits**

**v3.0 fix:**
- 15-second `req.destroy()` timeout on all HTTP requests
- All 4 TF fetches per symbol now run in `Promise.all()` — **parallel instead of sequential**
- Result: ~4× faster scan per symbol

**Why forex was always fast:** Twelve Data is a low-latency CDN-backed API. The 1500ms `TD_SLEEP_MS` delay between calls is intentional rate-limiting, not latency. Forex TF fetches kept sequential to respect Twelve Data rate limits.

---

## GitHub Secrets Required

| Secret | Used by | Description |
|---|---|---|
| `CRYPTO_TG_TOKEN` | Crypto | Telegram bot token |
| `CRYPTO_CHAT_ID` | Crypto | Telegram chat/channel ID |
| `FOREX_TG_TOKEN` | Forex | Telegram bot token |
| `FOREX_CHAT_ID` | Forex | Telegram chat/channel ID |
| `STOCKS_TG_TOKEN` | Stocks | Telegram bot token |
| `STOCKS_CHAT_ID` | Stocks | Telegram chat/channel ID |
| `TWELVE_DATA_KEY` | Forex | Twelve Data API key |
| `GH_PAT` | Crypto + Forex | PAT with `gist` + `repo` scope |
| `GIST_ID` | Crypto + Forex | Public Gist ID for dashboard feed |

---

## Cron Schedule

| Bot | Regular scan | Daily summary | Weekly summary |
|---|---|---|---|
| Crypto | `:15` and `:45` every hour | 08:02 UTC | Monday 08:07 UTC |
| Forex | `:00` and `:30` every hour | 08:03 UTC | Monday 08:08 UTC |
| Stocks | `:10` and `:40` every hour (US market hours only) | — | — |

---

## File Reference

**gwp-bots repo (public):**
```
├── .github/workflows/
│   ├── gwp-crypto.yml     ← Crypto bot workflow (v3.0)
│   └── gwp-forex.yml      ← Forex bot workflow (v3.0)
├── crypto_bot.js          ← Crypto signal engine (v3.0)
├── crypto_state.json      ← Persistent state (auto-committed)
├── crypto_signals.json    ← Latest signals (auto-committed + Gist)
├── forex_bot.js           ← Forex signal engine (v3.0)
├── forex_state.json       ← Persistent state (auto-committed)
├── forex_signals.json     ← Latest signals (auto-committed + Gist)
├── index.html             ← Web dashboard
├── package.json
└── README.md
```

**gwp_stocks_bot repo (private):**
```
├── .github/workflows/
│   └── stocks_bot.yml     ← Stocks bot workflow (v3.0)
├── stocks_bot.js          ← Stocks signal engine (v3.0)
├── stocks_state.json      ← Persistent state (auto-committed)
├── stocks_signals.json    ← Latest signals (auto-committed)
├── index.html
├── package.json
└── README.md
```

---

## Strategy — Ghost Wick Protocol™

1. **Volume Profile** — VAL band, POC, mid-band as targets
2. **AVWAP** — anchored VWAP trap detection
3. **Market Structure** — CHoCH → BOS confirmation
4. **Liquidity Sweep** — high/low sweep before reversal
5. **Wyckoff** — Spring / Upthrust phase detection
6. **Kalman Filter + Z-Score** — momentum burst (non-lagging)
7. **Elliott Wave** — Fibonacci projection for TP levels
8. **D1 Bias** — daily directional filter (+6 aligned / −4 counter-trend)

---

*© 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.*
*Every candle. Every session. Zero downtime.*

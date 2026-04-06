# GWP Bots — Ghost Wick Protocol™ v8.0

**Autonomous trading signal bots by Abdin · Asterix.COM Ltd. · Accra, Ghana**

> *Every candle. Every session. Zero downtime.*

---

## Overview

Two production-grade Node.js bots running on GitHub Actions. They deliver institutional-quality trade signals to Telegram 24 hours a day, 7 days a week, and publish live signal data to a public GitHub Gist for the web dashboard.

| Bot | File | Exchange | Pairs |
|---|---|---|---|
| GWP Altcoin | `altcoin_bot.js` | KuCoin | DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH · LINK · ARB · INJ |
| GWP Forex | `forex_bot.js` | Twelve Data + KuCoin | XAUUSD · EURUSD · GBPUSD · USDJPY · GBPJPY · BTC |

---

## Architecture

```
GitHub Actions (cron)
       │
       ▼
  Node.js 22 Bot
  ┌─────────────────────────────────────┐
  │  Triple Timeframe Engine            │
  │  4H → 1H → 15M confluence          │
  │                                     │
  │  • KuCoin / Twelve Data REST API   │
  │  • Volume Profile (24 rows)        │
  │  • AVWAP (anchored VWAP)           │
  │  • Wyckoff Phase Detection         │
  │  • Kalman Filter + Z-Score         │
  │  • Elliott Wave (Fib projections)  │
  │  • Market Structure (CHoCH/BOS)    │
  │  • Liquidity Sweep detection       │
  │  • D1 Bias filter                  │
  │  • Circuit Breaker (3L / 24h)      │
  └─────────────────────────────────────┘
       │                      │
       ▼                      ▼
  Telegram Signal        GitHub Gist
  (compact card)         (JSON → Dashboard)
       │
       ▼
  altcoin_state.json / forex_state.json
  (committed to repo — persistent memory)
```

---

## Signal Format (v8.0 — Compact)

```
🎯  GWP · ETH/USDT · SHORT ▼ [4H]
🔴  86/105  ·  A SOLID  ·  R:R 2.94:1
─────────────────────────────
ENTRY  2135.61   SL  2171.30  (-1.69%)
TP1  2083.08  ·  TP2  2030.56  ·  TP3  1820.45
─────────────────────────────
🔑  🪤 AVWAP TRAP  ·  ⚡ MOM BURST  ·  📊 VOL SPIKE
  BOS BEAR ↓   💧 LiqSwp↑ ✅
⏰  Mon, 07 Apr 2026 08:15:00 GMT
GWP Altcoin v8.0 | Elite Max™ | 24/7 | Asterix.COM | Abdin
```

Confluence and Triple-TF signals retain full extended format with all sections.

---

## Key v8.0 Changes

**Bot fixes (on top of v7.0):**
- `CRYPTO_MIN_SL_PCT` raised `0.35 → 1.2` — hairline SL was getting whipsawed on noise
- ATR floor enforced — SL always ≥ 1.5× ATR from entry
- Vol + AVWAP institutional gate — at least one must pass or signal is suppressed
- Age penalty raised `0.5 → 0.75` — stale signals penalised harder
- D1 context filter — D1 close vs D1 AVWAP sets directional bias
- Symmetric conviction scoring — BULL and BEAR treated identically
- `TP3_MULT` raised `2.2 → 3.0` — crypto runners need wider targets
- Minimum R:R on 4H raised `1.8 → 2.0` — higher quality gate
- EMA-50 removed (lagging); RSI removed (lagging) — replaced by Kalman + ZScore + Wyckoff
- Signal format: verbose → **compact card** (all data, half the lines)

**Workflow fixes (v8.0 YAML):**
- Signal JSON always initialised to `[]` if missing — Gist updates every scan regardless of whether a signal fired
- HTTP diagnostic printed on Gist update failure — `401` = missing `gist` OAuth scope on `GH_PAT`
- `Save state` step always commits signals file (placeholder or real)
- Workflow names updated to `v8.0`

---

## GitHub Secrets Required

| Secret | Used by | Description |
|---|---|---|
| `ALTCOIN_TG_TOKEN` | Altcoin bot | Telegram bot token for altcoin channel |
| `ALTCOIN_CHAT_ID` | Altcoin bot | Telegram chat/channel ID |
| `FOREX_TG_TOKEN` | Forex bot | Telegram bot token for forex channel |
| `FOREX_CHAT_ID` | Forex bot | Telegram chat/channel ID |
| `TWELVE_DATA_KEY` | Forex bot | Twelve Data API key (forex/gold OHLCV) |
| `GH_PAT` | Both (Gist) | Personal access token — needs `gist` + `repo` scope |
| `GIST_ID` | Both (Gist) | Public Gist ID where signals JSON is published |

---

## Cron Schedule

| Bot | Regular scan | Daily summary | Weekly summary |
|---|---|---|---|
| Altcoin | `:15` and `:45` every hour | 08:02 UTC daily | Monday 08:07 UTC |
| Forex | `:00` and `:30` every hour | 08:03 UTC daily | Monday 08:08 UTC |

Both bots support `workflow_dispatch` with `mode` input: `scan / daily / weekly / health`

---

## Gist Pipeline (Dashboard Feed)

The web dashboard (`index.html`) reads signal data from a public GitHub Gist. Each bot writes its own file into the same Gist:

```
Gist files:
  altcoin_signals.json  ← written by altcoin_bot
  forex_signals.json    ← written by forex_bot
```

To set up:
1. Create a public Gist at https://gist.github.com — add a placeholder file named `altcoin_signals.json` with content `[]`
2. Copy the Gist ID from the URL (the long hex string after your username)
3. Add it as `GIST_ID` in repo secrets
4. Generate a PAT at **GitHub → Settings → Developer settings → Personal access tokens (classic)**
   - Check: `gist` ✅ and `repo` ✅
5. Add the PAT as `GH_PAT` in repo secrets
6. Run both workflows manually once — check Actions logs for `✅ HTTP 200`

---

## File Reference

```
repo root/
├── .github/workflows/
│   ├── gwp-altcoin.yml       ← Altcoin bot workflow (v8.0)
│   └── gwp-forex.yml         ← Forex bot workflow (v8.0)
├── altcoin_bot.js            ← Altcoin signal engine (v8.0)
├── altcoin_state.json        ← Altcoin bot persistent state (auto-committed)
├── altcoin_signals.json      ← Latest altcoin signals (auto-committed + Gist)
├── forex_bot.js              ← Forex signal engine (v8.0)
├── forex_state.json          ← Forex bot persistent state (auto-committed)
├── forex_signals.json        ← Latest forex signals (auto-committed + Gist)
├── index.html                ← Web dashboard (reads from Gist)
├── package.json              ← Node.js dependencies
└── README.md                 ← This file
```

---

## Strategy — Ghost Wick Protocol™

Signals require **confluence across multiple institutional frameworks**:

1. **Volume Profile** — VAL band, POC, mid-band as targets
2. **AVWAP** — anchored VWAP trap detection (institutional entry zones)
3. **Market Structure** — CHoCH → BOS confirmation (Smart Money Concepts)
4. **Liquidity Sweep** — high/low sweep before reversal
5. **Wyckoff** — Spring / Upthrust phase detection
6. **Kalman Filter + Z-Score** — momentum burst detection (non-lagging)
7. **Elliott Wave** — Fibonacci projection for TP levels
8. **D1 Bias** — daily directional filter (no counter-trend signals)

Minimum conviction to fire: **52/105** (4H). Circuit breaker halts trading after 3 losses in 24 hours.

---

*© 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.*
*Every candle. Every session. Zero downtime.*

# GWP Bots — Ghost Wick Protocol™ v3.1 INSTITUTIONAL

**Autonomous institutional-grade trading signal bots by Abdin · Asterix.COM Ltd. · Accra, Ghana**

> *Real GWP. Real Price Action. Real Market Structure. Real Math & Statistics. Real Macro Fundamentals.*
> *Every candle. Every session. Zero downtime.*

---

## What This Is

Three production Node.js bots running on GitHub Actions, delivering institutional-quality signals to Telegram 24/7 and publishing live data to a public Gist for the web dashboard.

| Bot | File | Data Source | Assets |
|---|---|---|---|
| 🪙 **GWP Crypto** | `crypto_bot.js` | KuCoin (no key needed) | DEXE · UNI · SUSHI · SOL · BTC · ETH · LINK · ARB · INJ · COMP |
| 💱 **GWP Forex** | `forex_bot.js` | Twelve Data API | XAU/USD · EUR/USD · GBP/USD · USD/JPY · GBP/JPY |
| 📈 **GWP Stocks** | `stocks_bot.js` | Yahoo Finance (no key) | TSLA · NVDA · MSTR · COIN · PLTR · AMD · SMCI |

---

## v3.1 INSTITUTIONAL — 12-Fix Precision Upgrade

| # | Fix | What It Does |
|---|---|---|
| D1a | **D1 micro-AVWAP** | 20-candle lag → 3-candle response. Bias flips within 1 session |
| D1b | **D1 weight reduced** | ±6/−4 gate → ±2/−1 whisper. 4H+1H+15M is primary engine |
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

## Architecture — The 4-Pillar Engine

```
┌─────────────────────────────────────────────────────────┐
│           GHOST WICK PROTOCOL™  v3.1  ELITE MAX         │
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
│    D1 micro-AVWAP bias     → +2 aligned / −1 counter    │
│    Funding rate (crypto)   → +4 / 0 / −2               │
│    FOMC/NFP blackout       → hard block ±1h             │
│    Session vol multiplier  → Asian 1.5× / London std    │
│                                                         │
│  TRIPLE ENGINE BOOST                                    │
│    4H + 1H + 15M aligned   → +25 conviction             │
│    4H + 1H aligned         → +18 conviction             │
└─────────────────────────────────────────────────────────┘
```

---

## Signal Format (What You See in Telegram)

```
🎯  GWP · SOL/USDT · SHORT ▼ [4H]
🔴  84/105  ·  🔥 ELITE  ·  R:R 2.46:1
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

## Signal Tiers

| Tier | Trigger | Min R:R | Conviction Boost |
|---|---|---|---|
| 🔥🔥🔥 TRIPLE ENGINE | 4H + 1H + 15M aligned | 1.5 | +25 |
| 🔥🔥 CONFLUENCE | 4H + 1H aligned | 1.6 | +18 |
| 📈 SINGLE 4H | Institutional swing | 2.0 | — |
| ⚡ SINGLE 1H | Scalp entry | 1.6 | — |
| 🔬 MICRO 15M | Sniper (with HTF context) | 1.5 | — |

---

## Conviction Grade Scale (out of 105)

| Score | Grade | Action |
|---|---|---|
| 96–105 | 🏆 SUPREME★★★★ | 2.5× size — maximum institutional |
| 84–95 | ⚡ SUPREME★★ | 2.0× size — high conviction |
| 72–83 | 🔥 SUPREME★ | 1.5× size — elevated |
| 60–71 | 🔥 ELITE | 1.0× size — standard |
| 52–59 | ✅ SOLID | 0.5× size — reduced |
| <52 | blocked | Signal does not fire |

---

## Risk Management Built-In

| Layer | Mechanism |
|---|---|
| SL Layer 1 | Wick high/low + ATR buffer |
| SL Layer 2 | Minimum SL %: Crypto 1.2% · Forex 0.1% · Stocks 0.8% |
| SL Layer 3 | ATR floor: SL always ≥ 1.5× ATR from entry |
| Position exits | TP1 = structural swing (40% exit) · TP2 = VAL mid (40%) · TP3 = 3× runner (20%) |
| Circuit breaker | 3 losses → 24h symbol pause |
| Cooldown | H4: 4h · H1: 2h · M15: 1h — no signal spam |
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

## Cron Schedule

| Bot | Scan | Daily Summary | Weekly Report |
|---|---|---|---|
| Crypto | Every 15 min (24/7) | 08:02 UTC | Friday 21:00 UTC |
| Forex | Every 30 min (24/7) | 08:03 UTC | Friday 21:00 UTC |
| Stocks | Every 15 min (US hours only) | — | Friday 21:00 UTC |

---

## Manual Commands

```bash
node crypto_bot.js scan           # Run signal scan now
node crypto_bot.js checkpositions # Check all open positions
node crypto_bot.js health         # Health check + price feed
node crypto_bot.js daily          # Daily summary report
node crypto_bot.js weeklyreport   # Weekly performance report

# Same commands work for forex_bot.js and stocks_bot.js
```

---

## Repo Structure

```
gwp-bots/
├── .github/workflows/
│   ├── gwp-crypto.yml        ← Crypto bot (every 15min)
│   ├── gwp-forex.yml         ← Forex bot (every 30min)
│   └── gwp-stocks.yml        ← Stocks bot (US hours)
├── crypto_bot.js             ← Crypto signal engine v3.1
├── forex_bot.js              ← Forex signal engine v3.1
├── stocks_bot.js             ← Stocks signal engine v3.1
├── crypto_state.json         ← Persistent state (auto-committed)
├── forex_state.json          ← Persistent state (auto-committed)
├── stocks_state.json         ← Persistent state (auto-committed)
├── crypto_signals.json       ← Latest signals (→ Gist → dashboard)
├── forex_signals.json        ← Latest signals (→ Gist → dashboard)
├── stocks_signals.json       ← Latest signals (→ Gist → dashboard)
├── package.json              ← v3.1.0
└── README.md
```

---

*© 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary and confidential.*
*Advertised accuracy = % of fired signals meeting ≥90% institutional quality criteria.*

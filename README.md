# GWP Bots — Ghost Wick Protocol™ v7.0

**Autonomous trading signal bots by Abdin · Asterix.COM Ltd. · Accra, Ghana**

> *Every candle. Every session. Zero downtime.*

---

## Overview

Two production-grade Node.js bots that run on GitHub Actions and deliver institutional-quality trade signals to Telegram — 24 hours a day, 7 days a week.

| Bot | File | Exchange | Pairs |
|-----|------|----------|-------|
| **GWP Altcoin** | `altcoin_bot.js` | KuCoin (public REST) | DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH · LINK · ARB · INJ |
| **GWP Forex** | `forex_bot.js` | KuCoin + Twelve Data | XAUUSD · EURUSD · GBPUSD · USDJPY · GBPJPY · BTC |

---

## Strategy: Ghost Wick Protocol™ (GWP)

GWP is a **counter-trend, mean-reversion** strategy that hunts institutional liquidity grabs at the VAL (Value Area Low) band of the Volume Profile.

### The Core Setup
A signal fires when a candle **wick** penetrates INTO the VAL band while the candle **body** closes OUTSIDE — a ghost wick. This represents institutional absorption at a key volume level.

### Triple Timeframe Engine
All three timeframes are scanned simultaneously:

```
4H  →  Macro trend / volume profile anchor
1H  →  Swing entry confirmation
15M →  Sniper execution zone
```

When all three align in the same direction, a **Triple TF ELITE MAX™** signal fires — the highest-conviction alert in the system.

---

## Signal Anatomy

Every alert contains a structured breakdown:

```
👻 GWP — BTC/USDT  [1H]
━━━━━━━━━━━━━━━━━━━━━━━
🔴 SHORT ▼  Grade: A+ ELITE  7.0/8
⚡ Conviction: 74/123 — 🔥 SUPREME★
🕐 London/NY (24/7 ✅)
🪤 AVWAP TRAP
🔄 ZONE REVISIT

🏛 Market Structure  ⬇️ BOS BEAR
  CHoCH:—  BOS↓✅  LiqSwp↑✅  FVG✅

🎯 Entry:   66914.30
🛑 SL:      66981.65  (-0.10%)
✅ TP1:     66798.39  (+0.17% — 40%)
🏆 TP2:     66682.49  (+0.35% — VAL Mid)
💎 TP3:     66404.31  (+0.76% — runner)
📐 TP4:     66123.45  (+EW 78.6% runner)
📐 R:R:     3.44:1
💼 Risk:    $0.07  Pos: $2 (20×)

━━━━━ 🔬 THEORY ━━━━━
  🔴 WYK: UPTHRUST ✅ · Vol Climax↑
  📉 CYCLE: PEAK/TROUGH (T=14) ✅ REVERSAL GATE
  📐 EW: 78.6%=66123 · 61.8%=66404

━━━━━ 📊 LEVELS ━━━━━
Band: 66659 – 66705  Mid: 66682  POC: 66870
Wick: 20.8%  Gap: 178.6%  AVWAP: 67052

━━━━━ ✅ CHECKLIST ━━━━━
✅ 1. 1H candle CLOSED
✅ 2. Wick penetrated INTO VAL band
✅ 3. Body OUTSIDE band ≥8%
✅ 4. Wick depth ≥12% of band height
✅ 5. AVWAP Trap — institutional liquidity
⬜ 6. Volume spike ≥1.3× avg
✅ 7. R:R ≥ 1.6:1
✅ 8. Target not yet hit (stale check)
```

---

## Theory Engine (v7.0)

Three market theories are computed on every signal and displayed in the **THEORY** block:

### 1. Wyckoff Market Cycle Analysis
Detects **Springs** (fake breakdown → BULL fuel) and **Upthrusts** (fake breakout → BEAR fuel) within the 30-bar lookback range. Volume climax events are flagged when signal-bar volume exceeds 1.8× the 10-bar average.

- **🟢 WYK: SPRING ✅** — ideal bull setup
- **🔴 WYK: UPTHRUST ✅** — ideal bear setup
- Spring or Upthrust confirmation adds **+10 conviction points**

### 2. Sine-Wave Cycle Oscillator (Fractal Market Hypothesis)
Detects the dominant cycle period (T=8–20 bars) using autocorrelation on detrended price, then maps price position onto a sine wave. GWP is counter-trend — the best entries occur when the cycle is at **peak or trough (contraction phase)**, not during expansion.

- **📉 CYCLE: PEAK/TROUGH** → `✅ REVERSAL GATE` → **+8 conviction points**
- **🌊 CYCLE: EXPANSION** → `⚠️ MONITOR` → no bonus (proceed with caution)
- **〰️ CYCLE: MID-WAVE** → neutral

### 3. Elliott Wave — 0.786 (π/4) Retracement Level
Computes the 50-bar swing high/low and derives the 78.6% retracement level (≈ π/4 ≈ 0.7854). This level sits deeper than the 61.8% Golden Pocket and is used as **TP4** — the extended runner target for high-conviction moves.

- `📐 TP4: <price>  (+EW 78.6% runner)` shown in trade levels when applicable

---

## Conviction Scoring (v7.0: max 123)

| Component | Max Points |
|-----------|-----------|
| GWP Core Score (8-item checklist) | 32 |
| AVWAP Trap | 12 |
| Volume Spike | 6 |
| Path A bonus | 4 |
| Momentum Burst | 4 |
| Zone Revisit | 3 |
| Math Engine (Hurst + Z-Score + Kalman + ATR% + Volume + RSI) | 30 |
| **Wyckoff Spring/Upthrust** *(v7.0)* | **10** |
| **Sine-Wave Cycle Contraction** *(v7.0)* | **8** |
| Market Structure (CHoCH + BOS + LiqSweep + FVG) | 30 |
| Confluence Boost (4H+1H) | +18 |
| Triple TF Boost (4H+1H+15M) | +25 |

**Grade thresholds:**
- 🏆 SUPREME★★★★ = 108+
- 🏆 SUPREME★★★ = 96+
- ⚡ SUPREME★★ = 84+
- 🔥 SUPREME★ = 72+
- 🔥 ELITE = 58+
- ✅ SOLID = 50+

---

## Math Engine

Computed every scan on all active timeframes:

| Indicator | Purpose |
|-----------|---------|
| **ATR (14)** | Stop-loss buffer sizing |
| **RSI (14)** | Extreme overbought/oversold bonus |
| **Hurst Exponent** | Mean-reversion confirmation (H < 0.45 = ideal) |
| **Z-Score (20)** | Statistical price extremes |
| **Kalman Filter** | Fair value + velocity direction |
| **ATR Percentile** | Volatility regime detection |
| **Volume Ratio** | Relative volume spike detection |
| **Sine Oscillator** *(v7.0)* | Expansion vs contraction phase |

---

## Market Structure Engine

Runs on the last N bars (configurable per TF):

- **CHoCH** — Change of Character (prior trend reversal)
- **BOS** — Break of Structure (momentum confirmation)
- **Liquidity Sweep** — Wick beyond swing + body rejection
- **FVG** — Fair Value Gap within proximity of current price

MS is **additive only** (no penalty if absent). CHoCH scores highest (+14), BOS adds independently (+8).

---

## Setup

### GitHub Secrets Required

| Secret | Used By |
|--------|---------|
| `ALTCOIN_TG_TOKEN` | Altcoin bot Telegram token |
| `ALTCOIN_CHAT_ID` | Altcoin Telegram chat ID |
| `FOREX_TG_TOKEN` | Forex bot Telegram token |
| `FOREX_CHAT_ID` | Forex Telegram chat ID |
| `TWELVE_DATA_KEY` | Twelve Data API key (forex pairs) |

### Workflow Schedule

Both bots run every 30 minutes via GitHub Actions. The `forex_state.json` and `altcoin_state.json` files are committed back to the repository after each run to persist state (cooldowns, open positions, dedup windows).

---

## Telegram Commands

| Command | Action |
|---------|--------|
| `/scan` | Force a full scan immediately |
| `/[symbol]` | Scan a single pair (e.g. `/btc`, `/xauusd`, `/sol`) |
| `/daily` | Today's signal summary |
| `/weekly` | This week's W/L/P&L stats |
| `/health` | Live price check for all pairs |
| `/positions` | All open tracked positions |
| `/status` | Bot uptime + configuration |
| `/reset` | Clear cooldowns, dedups, circuit breakers |
| `/help` | Command reference |

---

## Safety Systems

- **Circuit Breaker** — 3 losses within 24h pauses scanning for that pair
- **Cooldowns** — Separate long/short cooldowns per pair per TF (prevents over-trading)
- **Signal Dedup** — Identical direction on same symbol suppressed within 1 hour
- **Stale Check** — Signals where price has already moved past the target are discarded
- **SL Floor** — Crypto minimum 0.35% SL, Forex minimum 0.10% (prevents hairline stops)

---

## File Structure

```
gwp-bots/
├── altcoin_bot.js        # Altcoin bot — KuCoin pairs
├── altcoin_state.json    # Persisted state (positions, cooldowns, stats)
├── forex_bot.js          # Forex+BTC bot — Twelve Data + KuCoin
├── forex_state.json      # Persisted state
├── package.json          # Node.js config (no external dependencies)
├── README.md             # This file
└── .github/
    └── workflows/        # GitHub Actions YAML schedules
```

---

## Version History

| Version | Key Changes |
|---------|-------------|
| **v7.0** | Wyckoff Spring/Upthrust detection (+10 pts), Sine-Wave Cycle Oscillator FMH (+8 pts), Elliott Wave 78.6% TP4 runner, Theory Analysis block in all signals, Section separators in signal format, Conviction ceiling raised to 123 |
| v6.1 | SL multi-layer buffer (ATR + candle range + asset-class floor), Bear bias removed, MS additive scoring, RSI extreme bonus, Z-Score thresholds lowered |
| v6.0 | 24/7 session filter removal, 15M micro-entry engine, Trend bias EMA50, Circuit breaker, Signal dedup, TP3 runner extension |

---

## License & Copyright

© 2026 Asterix.COM Ltd. / Abdin · Accra, Ghana  
Ghost Wick Protocol™ is proprietary and confidential.  
Unauthorized reproduction or distribution is prohibited.

> *GWP Altcoin v7.0 | Elite Max™ | 24/7 | Asterix.COM | Abdin*

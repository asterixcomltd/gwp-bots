# GWP Bots — Ghost Wick Protocol™ v6.0

**Autonomous trading signal bots by Abdin · Asterix.COM Ltd.**

Two independent bots running on GitHub Actions — no server, no VPS, zero hosting cost:

- **Forex Bot** — XAUUSD · EURUSD · GBPUSD · BTC (via Twelve Data + KuCoin)
- **Altcoin Bot** — DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH (via KuCoin)

---

## What's New in v6.0

| Feature | v3.0 | v6.0 |
|---|---|---|
| Timeframes | 4H + 1H | **4H + 1H + 15M Triple Engine** |
| Session filter | Active hours only | **24/7 — no dead periods** |
| MS (market structure) | Hard signal gate | **Soft filter — penalty only** |
| Take profits | TP1 + TP2 | **TP1 + TP2 + TP3 runner** |
| Conviction scale | /100 | **/105 (confluence bonus)** |
| Duplicate protection | None | **Smart dedup per scan cycle** |
| API failure handling | Crash | **Auto-retry (×2, 3s delay)** |
| Telegram messages | Single block | **Auto-split >3800 chars** |
| GitHub Actions | Node 20 (deprecated) | **Node 22, @v5 actions** |
| Mode detection | Runtime clock (fragile) | **`github.event.schedule` (exact)** |
| Git state persistence | `push \|\| true` (silent loss) | **Pull-rebase + 3-attempt retry** |
| Concurrent runs | Possible (git conflicts) | **Concurrency group — serialised** |

---

## Repository Structure

```
gwp-bots/
├── .github/
│   └── workflows/
│       ├── gwp-forex.yml         ← Forex bot schedule + CI
│       └── gwp-altcoin.yml       ← Altcoin bot schedule + CI
├── forex_bot.js                  ← GWP Forex v6.0 engine
├── altcoin_bot.js                ← GWP Altcoin v6.0 engine
├── forex_state.json              ← Auto-managed: cooldowns, positions, stats
├── altcoin_state.json            ← Auto-managed: cooldowns, positions, stats
├── package.json
└── README.md
```

---

## Deploy in 5 Steps

### 1. Upload the bot files

Upload `forex_bot.js`, `altcoin_bot.js`, `forex_state.json`, `altcoin_state.json`,
and `package.json` directly to the root of your repo via **Add file → Upload files**.

`forex_state.json` and `altcoin_state.json` should start as empty objects:
```json
{}
```

### 2. Upload the YAML workflow files

> ⚠️ The `.github/workflows/` folder is hidden in the web UI upload dialog.
> You must create the files using the editor, not drag-and-drop.

**From your phone or browser:**
1. Go to your repo → **Add file** → **Create new file**
2. In the filename box type exactly: `.github/workflows/gwp-forex.yml`
   (GitHub auto-creates the folders as you type each `/`)
3. Paste the full content of `gwp-forex.yml`
4. Click **Commit changes**
5. Repeat for `.github/workflows/gwp-altcoin.yml`

### 3. Set GitHub Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `FOREX_TG_TOKEN` | Forex Telegram bot token |
| `FOREX_CHAT_ID` | Forex Telegram chat / channel ID |
| `ALTCOIN_TG_TOKEN` | Altcoin Telegram bot token |
| `ALTCOIN_CHAT_ID` | Altcoin Telegram chat / channel ID |
| `TWELVE_DATA_KEY` | Twelve Data API key — free at twelvedata.com |

### 4. Enable workflow write permissions

**Settings → Actions → General → Workflow permissions**
Select **Read and write permissions** → Save

*(Required so the bot can commit state files back to the repo.)*

### 5. Test manually

**Actions** tab → **GWP Forex Bot v6.0** → **Run workflow** → mode: `health`

If data feeds are live you will receive a health report in Telegram within ~30 seconds.

---

## How It Works

### Scan Schedule

| Bot | Scan cron | Daily summary | Weekly summary |
|---|---|---|---|
| Forex | `0,30 * * * *` — every :00 and :30 | `3 8 * * *` — 08:03 UTC | `8 8 * * 1` — Mon 08:08 UTC |
| Altcoin | `15,45 * * * *` — every :15 and :45 | `2 8 * * *` — 08:02 UTC | `7 8 * * 1` — Mon 08:07 UTC |

Bots are staggered 15 minutes apart so they never run at the same time.
Both run **24/7** — no session filter, no dead periods.

### Triple Timeframe Engine

Every scan analyses **4H + 1H + 15M** simultaneously:

```
4H  ──→  Macro zone (VAL band, POC, AVWAP)
1H  ──→  Confirmation + tighter entry
15M ──→  Sniper entry — limit zone within the 1H setup
```

Signal types fired (highest to lowest conviction):

| Type | Condition | Conviction bonus |
|---|---|---|
| 🔥🔥🔥 **TRIPLE** | 4H + 1H + 15M all aligned | +25 |
| 🔥🔥 **CONFLUENCE** | 4H + 1H aligned | +18 |
| 👻 **4H SOLO** | 4H signal alone | — |
| ⚡ **SCALP** | 1H signal alone | — |
| 🔬 **MICRO SNIPER** | 15M with 4H or 1H context | — |

### Signal Quality Gates

| Gate | Value | What it filters |
|---|---|---|
| GWP wick score | ≥ 4.5 / 8 | Wick + body geometry |
| R:R | ≥ 1.5–1.8 (per TF) | Adaptive TP extends before rejecting |
| Conviction | ≥ 52–56 / 105 (per TF) | Combined score of all pillars |
| Cooldown | 1–4h per direction per TF | Duplicate signals same zone |
| Dedup window | 1 hour | Same signal firing twice in one scan |
| Circuit breaker | 3 losses → 24h pause | Protects capital on losing streaks |
| Stale check | ATR proximity | Kills signal only if target already reached |

### Conviction Scoring (0–105)

| Pillar | Max points |
|---|---|
| GWP wick score | 32 |
| AVWAP Trap | 12 |
| Volume spike on signal bar | 6 |
| Path A (direct return) bonus | 4 |
| Momentum burst (ATR expansion) | 4 |
| Zone revisit (accumulation) | 3 |
| Hurst exponent < 0.45 (mean-reversion) | 8 |
| Z-score extreme / mild | 6 / 3 |
| Kalman filter reversal signal | 6 |
| ATR percentile 25–75 (healthy range) | 4 |
| Volume ratio ≥ 2.0× | 4 |
| EMA50 trend alignment | 3 |
| Market structure (CHoCH / BOS / LiqSweep / FVG) | up to 17 |
| MS unconfirmed penalty | −3 |
| Confluence boost | +18 |
| Triple TF boost | +25 |

### Trade Levels

Every signal includes:

| Level | Size | Action |
|---|---|---|
| **Entry** | — | Current close (4H basis) or 15M sniper limit |
| **SL** | — | Signal high/low + ATR buffer |
| **TP1** | 40% | Half-way to VAL mid — take partial, move SL to BE |
| **TP2** | 40% | VAL band midpoint — main target |
| **TP3** | 20% | 2.2× the VAL band move — runner |

### Market Structure (filter, not gate)

MS is scored as a **conviction modifier** — unconfirmed MS = −3 points, not a signal block.

| Label | Points |
|---|---|
| 🔄 CHoCH (change of character) | +14 |
| ⬆️/⬇️ BOS (break of structure) | +8 |
| 💧 Liquidity sweep | +5 |
| 🟦/🟥 Fair value gap (FVG) | +3 |
| 🟡 Unconfirmed | −3 |

---

## Telegram Commands

Send these directly to either bot:

```
/scan         Full scan — all pairs, all timeframes
/health       Data feed check — live prices + API status
/positions    Open positions with live P&L
/daily        Today's signal summary
/weekly       This week: signals, win/loss, P&L
/status       Bot config, gates, open position count
/reset        Clear all cooldowns and circuit breakers
/help         Full command reference

── Forex single-pair scans ──────────────────
/xauusd   /eurusd   /gbpusd   /btc

── Altcoin single-pair scans ────────────────
/btc   /eth   /sol   /avax   /uni   /sushi   /dexe
```

---

## Secrets Configured ✅

| Secret | Status |
|---|---|
| `ALTCOIN_CHAT_ID` | ✅ |
| `ALTCOIN_TG_TOKEN` | ✅ |
| `FOREX_CHAT_ID` | ✅ |
| `FOREX_TG_TOKEN` | ✅ |
| `TWELVE_DATA_KEY` | ✅ |

---

## Troubleshooting

**Bot ran but no Telegram message received**
→ Check `FOREX_TG_TOKEN` / `ALTCOIN_TG_TOKEN` secrets are correct
→ Send `/health` manually — if it returns silently, the chat ID may be wrong

**"No 4H data" in Actions log**
→ KuCoin or Twelve Data was unreachable. Bot retries twice automatically.
→ If persistent: check `TWELVE_DATA_KEY` secret and twelvedata.com API status

**Node.js 20 deprecation warning**
→ Resolved in v6.0 — both workflows now use `actions/checkout@v5` + `actions/setup-node@v5` with Node 22

**Duplicate daily summaries**
→ Resolved in v6.0 — mode detection now uses `github.event.schedule` (exact cron match) instead of the runtime clock

**State file conflict / push failed**
→ Resolved in v6.0 — 3-attempt `pull --rebase` retry loop + concurrency group prevents simultaneous runs

**Circuit breaker active**
→ A pair had 3 losses in the window. Send `/reset` to clear, or wait 24h for auto-expiry

---

*Ghost Wick Protocol™ · © 2026 Asterix.COM Ltd. · Abdin*

# GWP Bots — Ghost Wick Protocol™ v3.0

**Autonomous trading signal bots by Abdin · Asterix.COM Ltd.**

Two independent bots running on GitHub Actions:
- **Forex Bot** — XAUUSD, EURUSD, GBPUSD, BTC (via Twelve Data + KuCoin)
- **Altcoin Bot** — DEXE, UNI, SUSHI, SOL, AVAX, BTC, ETH (via KuCoin)

---

## Deploy in 5 Steps

### 1. Upload files to your repo
Go to `github.com/asterixcomlt/gwp-bots` and upload ALL files maintaining this exact structure:

```
gwp-bots/
├── .github/
│   └── workflows/
│       ├── gwp-forex.yml       ← MUST be inside .github/workflows/
│       └── gwp-altcoin.yml     ← MUST be inside .github/workflows/
├── forex_bot.js
├── altcoin_bot.js
├── forex_state.json
├── altcoin_state.json
├── package.json
├── .gitignore
└── README.md
```

> ⚠️ **The `.github/workflows/` folder is hidden.** GitHub's web UI may not show it.
> Use the method in Step 2 to upload the YAMLs correctly.

### 2. Upload the YAML files correctly

**Method A — GitHub Web UI (easiest from phone):**
1. Go to your repo → click **Add file** → **Create new file**
2. In the filename box type: `.github/workflows/gwp-forex.yml`
   - GitHub will auto-create the folders as you type the slash
3. Paste the full content of `gwp-forex.yml` into the editor
4. Click **Commit changes**
5. Repeat for `gwp-altcoin.yml`

**Method B — Upload from zip:**
GitHub web UI drag-and-drop does NOT preserve folder structure. Use Method A.

### 3. Set GitHub Secrets
Go to **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `FOREX_TG_TOKEN` | Your forex Telegram bot token |
| `FOREX_CHAT_ID` | Your forex Telegram chat/channel ID |
| `ALTCOIN_TG_TOKEN` | Your altcoin Telegram bot token |
| `ALTCOIN_CHAT_ID` | Your altcoin Telegram chat/channel ID |
| `TWELVE_DATA_KEY` | Your Twelve Data API key (free at twelvedata.com) |

### 4. Enable workflow write permissions
Go to **Settings → Actions → General → Workflow permissions**
Select **Read and write permissions** → Save

### 5. Test manually
Go to **Actions** tab → click **GWP Forex Bot v3.0** → **Run workflow** → select `health`

---

## How It Works

### Scan Schedule
| Bot | Cron | UTC times |
|---|---|---|
| Forex | `0,30 * * * *` | Every :00 and :30 |
| Altcoin | `15,45 * * * *` | Every :15 and :45 |

Offset by 15 min so both never run simultaneously.

### Session Filters (not barriers — smart exits)
- **Forex**: Active 06:00–21:00 UTC (London + NY). Dead hours exit in <1 second.
- **Altcoin**: Active 06:00–01:00 UTC. Dead zone 01:00–06:00 blocked.
- Signals found BEFORE session close remain valid and re-check on next scan.

### Signal Quality Gates (filters, not walls)
Each gate eliminates noise — they don't block real setups:

| Gate | Purpose |
|---|---|
| GWP score ≥ 5.0/8 | Ensures wick + body structure is clean |
| R:R ≥ 2.0 | Adaptive TP extends before rejecting |
| Conviction ≥ 52/100 | Bayesian score of 6 overlapping pillars |
| Cooldown 4h per direction | Prevents duplicate signals same zone |
| Circuit breaker (3 losses) | Pauses pair 24h, protects capital |
| Smart stale check | Kills signal only if TARGET already hit |
| Volume spike ≥ 1.2× (altcoin) | Confirms institutional participation |

### Telegram Commands
Send these to your bot:
```
/scan        — Scan all pairs now
/health      — Check all data feeds
/positions   — Show open positions + live P&L
/daily       — Today's signal summary
/weekly      — This week's win/loss stats
/status      — Bot config overview
/reset       — Clear cooldowns (use after false SL)
/help        — Full command list
/xauusd /eurusd /gbpusd /btc  — Forex single scans
/btc /eth /sol /avax /uni /sushi /dexe  — Altcoin single scans
```

---

## Secrets Already Configured ✅
From your GitHub repo (confirmed in screenshot):
- ALTCOIN_CHAT_ID ✅
- ALTCOIN_TG_TOKEN ✅
- EMAIL_PASS ✅
- EMAIL_RECIPIENT ✅
- EMAIL_USER ✅
- FOREX_CHAT_ID ✅
- FOREX_TG_TOKEN ✅
- TWELVE_DATA_KEY ✅

---

*Ghost Wick Protocol™ · © 2026 Asterix.COM Ltd. · Abdin*

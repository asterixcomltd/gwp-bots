# GWP Bots — Ghost Wick Protocol™ v3.0
**Money Printing Machine Elite Max**
© 2026 Asterix.COM Ltd. / Abdin

---

## Bots
| Bot | Pairs | Data Source | State File |
|-----|-------|-------------|-----------|
| `forex_bot.js` | XAUUSD, EURUSD, GBPUSD, BTC | Twelve Data + KuCoin | `forex_state.json` |
| `altcoin_bot.js` | DEXE, UNI, SUSHI, SOL, AVAX, BTC, ETH | KuCoin (free, no key) | `altcoin_state.json` |

## GitHub Secrets Required
Go to **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Bot | Value |
|--------|-----|-------|
| `FOREX_TG_TOKEN` | Forex | Telegram bot token from @BotFather |
| `FOREX_CHAT_ID` | Forex | Your forex channel chat ID |
| `ALTCOIN_TG_TOKEN` | Altcoin | Telegram bot token from @BotFather |
| `ALTCOIN_CHAT_ID` | Altcoin | Your altcoin channel chat ID |
| `TWELVE_DATA_KEY` | Forex | Free API key from twelvedata.com |

## Schedules
- **Forex scans**: every 30 min at :00 and :30 UTC
- **Altcoin scans**: every 30 min at :15 and :45 UTC (offset to avoid conflicts)
- **Daily summary**: 08:00 UTC both bots
- **Weekly summary**: Monday 08:05 UTC both bots

Session filters are applied inside the bots:
- Forex: active 06:00–21:00 UTC (London + NY only)
- Altcoin: active all hours except dead-zone 01:00–06:00 UTC

## Telegram Commands
Both bots respond to:
```
/scan       — scan all pairs now
/status     — bot status + this week's stats
/positions  — open positions
/health     — live price check + API status
/daily      — today's signals + P&L
/weekly     — week stats + win rate
/reset      — clear cooldowns & circuit breakers
/help       — full command reference
```

Forex single-pair:  `/xauusd` `/eurusd` `/gbpusd` `/btc`
Altcoin single-pair: `/btc` `/eth` `/sol` `/avax` `/uni` `/sushi` `/dexe`

## Manual Trigger
GitHub → Actions → select workflow → **Run workflow** → choose mode

## Architecture
```
GitHub Actions (cron) → checkout repo → run bot.js
                      ← commit state.json back [skip ci]
```
State persists across runs via committed JSON files.
No server. No cost. Fully autonomous.

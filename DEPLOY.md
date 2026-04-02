# GWP BOTS v2.2 — GitHub Actions Deployment Guide
## Ghost Wick Protocol™ | Asterix.COM | Abdin

---

## WHAT YOU HAVE

```
gwp-bots/
├── .github/workflows/
│   ├── altcoin.yml     ← cron */15 * * * *
│   └── forex.yml       ← cron */30 * * * *
├── altcoin/
│   ├── bot.js          ← full GAS → Node.js conversion
│   └── state.json      ← replaces PropertiesService (auto-committed)
├── forex/
│   ├── bot.js
│   └── state.json
├── package.json
├── .gitignore
└── DEPLOY.md
```

---

## STEP 1 — INSTALL GITHUB CLI (one-time)

```bash
# macOS
brew install gh

# Windows (PowerShell as admin)
winget install --id GitHub.cli

# Ubuntu/Debian
sudo apt install gh
```

---

## STEP 2 — AUTHENTICATE

```bash
gh auth login
# Choose: GitHub.com → HTTPS → Login with a web browser → follow prompts
```

---

## STEP 3 — DEPLOY (6 commands, copy-paste)

```bash
# 1 — Create the repo
gh repo create gwp-bots --public --clone && cd gwp-bots

# 2 — Copy all bot files into the cloned repo
# (copy the files you downloaded into this gwp-bots/ folder first, then:)

# 3 — Install dependencies
npm install

# 4 — Push everything
git add . && git commit -m "feat: GWP Bots v2.2 — GitHub Actions" && git push

# 5 — Add your secrets (run each line separately)
gh secret set ALTCOIN_TG_TOKEN   --body "YOUR_ALTCOIN_BOT_TOKEN"
gh secret set ALTCOIN_CHAT_ID    --body "YOUR_CHAT_ID"
gh secret set FOREX_TG_TOKEN     --body "YOUR_FOREX_BOT_TOKEN"
gh secret set FOREX_CHAT_ID      --body "YOUR_CHAT_ID"
gh secret set TWELVE_DATA_KEY    --body "YOUR_TWELVE_DATA_KEY"
gh secret set EMAIL_USER         --body "your@gmail.com"
gh secret set EMAIL_PASS         --body "your_gmail_app_password"

# 6 — Trigger first manual run to verify
gh workflow run altcoin.yml
gh workflow run forex.yml
```

---

## STEP 4 — VERIFY IT WORKS

```bash
# Watch the live run logs
gh run watch

# Or check recent runs
gh run list --limit 10

# View logs of a specific run
gh run view --log
```

You should see Telegram messages arriving within 2 minutes.

---

## GMAIL APP PASSWORD SETUP (for email alerts)

1. Google Account → Security → 2-Step Verification (must be ON)
2. Google Account → Security → App passwords
3. Select app: Mail → Select device: Other → type "GWP Bot" → Generate
4. Copy the 16-character password → use as `EMAIL_PASS` secret

---

## TELEGRAM COMMANDS

Both bots now respond to Telegram commands via polling (≤15 min delay on Actions):

```
/scan      → immediate scan of all pairs
/btc /eth /sol /avax /uni /sushi /dexe  → altcoin single pair
/btc /xauusd /eurusd /gbpusd            → forex single pair
/daily     → today's signal log + open P&L
/weekly    → this week's stats
/positions → all open trades with live P&L
/health    → live prices + session status + circuit breaker status
/status    → bot version, filters, week stats
/reset     → clear all cooldowns + positions + circuit breakers
/help      → full command list
```

**Note:** Commands have ≤15 min delay (vs instant in GAS webhook).
For near-instant command response, trigger via GitHub Actions:
`gh workflow run altcoin.yml -f mode=health`

---

## DAILY & WEEKLY SUMMARIES

Summaries are triggered via `workflow_dispatch` with mode input.
To automate them, add separate cron jobs to the workflow files:

```yaml
# Add to altcoin.yml under 'on: schedule:'
# Daily at 08:00 UTC
- cron: "0 8 * * *"
# Weekly Monday 08:00 UTC  
- cron: "0 8 * * 1"
```

Then modify the run step to detect the time and call the right mode:
```yaml
run: |
  HOUR=$(date -u +%H)
  DAY=$(date -u +%u)
  if [ "$HOUR" = "08" ] && [ "$DAY" = "1" ]; then
    node altcoin/bot.js weekly
  elif [ "$HOUR" = "08" ]; then
    node altcoin/bot.js daily
  else
    node altcoin/bot.js scan
  fi
```

---

## KEY DIFFERENCES vs GAS

| Feature         | GAS                  | GitHub Actions              |
|----------------|----------------------|-----------------------------|
| Commands        | Instant (webhook)    | ≤15 min delay (polling)     |
| State           | PropertiesService    | `state.json` auto-committed |
| Quota           | 90 min/day           | **Unlimited (public repo)** |
| Monthly keepalive | Required           | Not needed                  |
| Phone editing   | Painful              | GitHub Mobile — native      |
| Cost            | Free                 | Free                        |

---

## TROUBLESHOOTING

| Symptom | Fix |
|---------|-----|
| No Telegram messages | Check secrets in repo Settings → Secrets → Actions |
| Workflow not triggering | GitHub cron can delay 15–30 min under load — normal |
| `npm ci` fails | Delete `node_modules/`, run `npm install`, commit `package-lock.json` |
| State not saving | Check repo has `contents: write` permission in workflow |
| Git push fails | Check GITHUB_TOKEN permissions: Settings → Actions → General → Workflow permissions → Read and write |
| Twelve Data errors | Free tier allows 800 req/day. 30-min scan = 4 pairs × 48 runs = 192 req/day — well within limit |

---

*GWP Bot v2.2 | Ghost Wick Protocol™ | Asterix.COM | Abdin*
*Unlimited quota · Auto-state · Mobile-friendly · No keepalive needed*

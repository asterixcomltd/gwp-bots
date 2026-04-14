#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# GWP WEBHOOK SETUP SCRIPT
# Run this ONCE after deploying to Vercel to register all 3 bot webhooks.
# Usage: bash setup-webhooks.sh
# ════════════════════════════════════════════════════════════════════════════

# ── CONFIG: paste your values below ──────────────────────────────────────────
VERCEL_URL="https://YOUR-PROJECT.vercel.app"   # e.g. https://gwp-bots.vercel.app
CRYPTO_TOKEN=""   # your CRYPTO_TG_TOKEN value
FOREX_TOKEN=""    # your FOREX_TG_TOKEN value
STOCKS_TOKEN=""   # your STOCKS_TG_TOKEN value
# ─────────────────────────────────────────────────────────────────────────────

register() {
  local name=$1
  local token=$2
  local bot=$3
  echo ""
  echo "→ Registering $name webhook..."
  curl -s "https://api.telegram.org/bot${token}/setWebhook" \
    -d "url=${VERCEL_URL}/api/webhook?bot=${bot}" \
    -d "allowed_updates=[\"message\",\"channel_post\"]" | python3 -m json.tool 2>/dev/null || echo "done"
}

check_vars() {
  if [[ "$VERCEL_URL" == *"YOUR-PROJECT"* ]]; then
    echo "❌  Edit VERCEL_URL in this script first."
    exit 1
  fi
  if [[ -z "$CRYPTO_TOKEN" || -z "$FOREX_TOKEN" || -z "$STOCKS_TOKEN" ]]; then
    echo "❌  Fill in all three bot tokens in this script first."
    exit 1
  fi
}

check_vars
echo "══════════════════════════════════════════"
echo "  GWP Webhook Registration"
echo "  Vercel URL: $VERCEL_URL"
echo "══════════════════════════════════════════"

register "GWP Crypto" "$CRYPTO_TOKEN" "crypto"
register "GWP Forex"  "$FOREX_TOKEN"  "forex"
register "GWP Stocks" "$STOCKS_TOKEN" "stocks"

echo ""
echo "══════════════════════════════════════════"
echo "✅  All webhooks registered."
echo "    Users who send /start now get an"
echo "    instant welcome — no waiting."
echo "══════════════════════════════════════════"

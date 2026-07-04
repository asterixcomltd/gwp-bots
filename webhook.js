"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GWP INSTANT WEBHOOK — Vercel Serverless Function
// Author  : Abdin · asterixcomltd@gmail.com · Asterix Holdings Ltd. · Accra, Ghana
// Purpose : Responds INSTANTLY to /start, /help, /status on all 3 bots.
//           All other commands are deferred to the next GitHub Actions scan.
//           Deploy this to Vercel, then register each bot's webhook once.
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");

// ── Telegram send helper ──────────────────────────────────────────────────────
function tgSend(token, chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${token}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => { res.resume(); resolve(); });
    req.on("error", () => resolve());
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

// ── Bot configs ───────────────────────────────────────────────────────────────
const BOTS = {
  crypto: {
    token: process.env.CRYPTO_TG_TOKEN || "",
    name:  "GWP Crypto Signals",
    emoji: "👻",
    desc:  "Institutional-grade crypto signals — DeFi altcoins & BTC",
    pairs: "DEXE · UNI · SUSHI · SOL · BTC · LINK · COMP",
    extra: "▸ KuCoin data — no API key needed\n▸ Session: 24/7, every 4H\n",
    commands: "/scan · /dexe · /sol · /btc · /positions · /status · /health · /help",
    version: "GWP Crypto v3.1 | Elite Max™ | Asterix Holdings Ltd.",
  },
  forex: {
    token: process.env.FOREX_TG_TOKEN || "",
    name:  "GWP Forex Signals",
    emoji: "📊",
    desc:  "Institutional-grade signals on Forex & Gold",
    pairs: "XAU/USD · EUR/USD · GBP/USD · USD/JPY · GBP/JPY",
    extra: "▸ Twelve Data feed\n▸ Session: 24/7, every 4H\n",
    commands: "/scan · /xauusd · /eurusd · /gbpusd · /usdjpy · /positions · /status · /help",
    version: "GWP Forex v3.1 | Elite Max™ | Asterix Holdings Ltd.",
  },
  stocks: {
    token: process.env.STOCKS_TG_TOKEN || "",
    name:  "GWP Stocks Signals",
    emoji: "📈",
    desc:  "Institutional-grade signals on top US stocks",
    pairs: "$TSLA · $NVDA · $MSTR · $COIN · $PLTR · $AMD · $SMCI · $SPCX",
    extra: "▸ Yahoo Finance data\n▸ Session: US market hours only (Mon–Fri)\n",
    commands: "/scan · /tsla · /nvda · /mstr · /pltr · /positions · /status · /help",
    version: "GWP Stocks v3.1 | Elite Max™ | Asterix Holdings Ltd.",
  },
};

// ── Welcome message ───────────────────────────────────────────────────────────
function buildWelcome(bot) {
  return (
    `${bot.emoji} <b>Welcome to ${bot.name}</b>\n` +
    `<b>Ghost Wick Protocol™ v3.1 — Institutional Grade</b>\n\n` +
    `🏛 <b>What you'll receive:</b>\n` +
    `▸ ${bot.desc}\n` +
    `▸ Triple TF confluence: 4H + 1H + 15M alignment\n` +
    `▸ Entry · SL · TP1 · TP2 · TP3 with conviction score\n` +
    `▸ Live TP/SL hit alerts as trade unfolds\n` +
    `▸ Assets: ${bot.pairs}\n\n` +
    `📡 <b>How it works:</b>\n` +
    `${bot.extra}` +
    `▸ Only high-conviction setups fire — no noise\n` +
    `▸ Live signals at <b>asterix-gwp.vercel.app</b>\n\n` +
    `⚡ <b>Commands:</b>\n` +
    `${bot.commands}\n\n` +
    `📚 <b>About GWP:</b>\n` +
    `The Ghost Wick Protocol detects when a candle wick enters a\n` +
    `VAL (Value Area Low/High) zone — price almost always returns.\n` +
    `3 timeframes must align for a signal to fire.\n\n` +
    `<i>Every candle. Every session. Zero downtime.</i>\n` +
    `<i>Asterix Holdings Ltd. · Accra, Ghana</i>\n\n` +
    `<i>${bot.version}</i>`
  );
}

// ── Deferred command reply ────────────────────────────────────────────────────
function buildDeferredReply(cmd, bot) {
  return (
    `⏳ <b>Command received: ${cmd}</b>\n\n` +
    `This command requires live market data and will be processed\n` +
    `at the next scheduled scan (within 4 hours).\n\n` +
    `Results will appear in the <b>${bot.name}</b> channel.\n\n` +
    `💡 <i>Tip: Use /start for instant bot info, or /help for all commands.</i>\n\n` +
    `<i>${bot.version}</i>`
  );
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Only accept POST
  if (req.method !== "POST") {
    res.status(200).send("GWP Webhook — OK");
    return;
  }

  // Identify which bot this webhook is for via query param: /api/webhook?bot=crypto
  const botKey = (req.query.bot || "").toLowerCase();
  const bot = BOTS[botKey];

  if (!bot || !bot.token) {
    res.status(200).json({ ok: false, reason: "unknown bot or missing token" });
    return;
  }

  let update;
  try {
    update = typeof req.body === "object" ? req.body : JSON.parse(req.body);
  } catch {
    res.status(200).json({ ok: false });
    return;
  }

  // Always respond 200 immediately (Telegram requires fast ack)
  res.status(200).json({ ok: true });

  // Process the update asynchronously
  const msg = update?.message || update?.channel_post;
  if (!msg?.text) return;

  const chatId = msg.chat?.id;
  const text   = msg.text?.trim() || "";
  const cmd    = text.toLowerCase().split(" ")[0];

  if (!chatId) return;

  if (cmd === "/start") {
    await tgSend(bot.token, chatId, buildWelcome(bot));
  } else if (cmd === "/help") {
    // Help is also instant — same as welcome
    await tgSend(bot.token, chatId, buildWelcome(bot));
  } else if (text.startsWith("/")) {
    // Any other command → deferred notice
    await tgSend(bot.token, chatId, buildDeferredReply(cmd, bot));
  }
};

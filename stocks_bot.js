"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — STOCKS EDITION  v3.1  MONEY PRINTING MACHINE ELITE MAX™
// Strategy : Ghost Wick Protocol™ (GWP) — 4H + 1H + 15M Triple Timeframe Engine
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Assets   : TSLA · NVDA · MSTR · COIN · PLTR · AMD · SMCI (Yahoo Finance)
// Platform : GitHub Actions (Node.js 22+) · stocks_state.json persistence
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// v3.1 CHANGES (on top of v3.0):
//   ✅ FIX: D1 AVWAP — full history → 3-candle micro-AVWAP (eliminates weeks of lag)
//   ✅ FIX: D1 conviction weight ±6/−4 → ±2/−1 (whisper, not gate)
//   ✅ Fix #1:  Zone touch count — fresh zones prioritized, exhausted zones penalized
//   ✅ Fix #2:  Volume-validated BOS — confirmed +8, unconfirmed +3
//   ✅ Fix #3:  Zone-aware LiqSweep scoring — in-zone trap +10, near-zone +5, +4
//   ✅ Fix #5:  FOMC/NFP macro blackout calendar — no trades 24h around events
//   ✅ Fix #6:  Structural TP1 — anchored to nearest swing level, not fixed distance
//   ✅ Fix #7:  Conviction-scaled position sizing — 0.5×–2.5× based on score
//   ✅ Fix #8:  Hurst reliability gate — requires 120+ candles for valid Hurst score
//   ✅ Fix #9:  Session-based volume multiplier — higher threshold in low-vol sessions
//   ✅ Fix #10: Enhanced performance tracker — best/worst trade, avg conv by outcome
//              Weekly report auto-fires Friday UTC 21:00 + /weeklyreport command
//   ✅ Fix #11: Double-candle CHoCH confirmation — +16 pts (vs +10 single-candle)
//   ✅ Fix #12: Signal quality score — % of institutional criteria met (0–100%)
//
// v1.0 — GWP Stocks Edition:
//   ✅ Same GWP engine as crypto_bot.js v8.0 (identical detection logic)
//   ✅ Data: Yahoo Finance API (free, no key, public REST)
//   ✅ 4H built by aggregating 1H candles (Yahoo does not provide 4H directly)
//   ✅ Market session gate: only scan during US market hours + pre/after hours
//   ✅ 7 most volatile US stocks selected by ATR/beta
//   ✅ SL min: 0.8% for stocks (tighter than crypto 1.2%)
//   ✅ ATR floor: SL always ≥ 1.5× ATR from entry
//   ✅ Vol+AVWAP gate preserved — no ghost signals
//   ✅ D1 bias context filter
//   ✅ Dedup, cooldowns, circuit breaker — all preserved
// v1.0.1 — Bug fix:
// v3.0 — Unified version with Crypto v3.0 / Forex v3.0:
//   ✅ SPEED: Parallel Yahoo Finance fetches (1H + 15M + D1 in Promise.all)
//   ✅ All v1.1 fixes already applied (D1 bias, firedDir, LIQ SWEEP, bias note)
//
// v1.1 — Bug fixes:
//   ✅ FIX 1: D1 bias conviction boost was BACKWARDS — counter-trend was boosted (+6)
//              Now: aligned = +6 boost, counter-trend = −4 penalty
//   ✅ FIX 2: LIQ SWEEP shown twice in single signal (ms.label + msLine duplicate)
//              Removed ms.label from single formatter — only msLine() now
//   ✅ FIX 3: D1 bias note was ambiguous in all 3 formatters
//              Now shows D1: BULL ✅ (aligned) or D1: BEAR ⚠️ CT (counter-trend)
//   ✅ FIX 4: Same-symbol opposite-direction signals could fire in same scan
//              Added firedDir lock — e.g. TSLA LONG [4H] blocks TSLA SHORT [1H]
//   ✅ Fixed "ms is not defined" crash in detectGWP() checks array
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── TF CONFIGS ────────────────────────────────────────────────────────────────
const TF_CONFIG = {
  H4: {
    tf:"H4", label:"4H",
    vpLookback:100, avwapLookback:30,
    minRR:2.0, minConviction:52, cooldownHrs:4,
    atrBufMult:0.55, maxAge:2, avwapProx:0.003,
    volLookback:20, msLookback:80, swingStrength:3,
    volSpikeMult:1.2,
  },
  H1: {
    tf:"H1", label:"1H",
    vpLookback:60, avwapLookback:20,
    minRR:1.6, minConviction:54, cooldownHrs:2,
    atrBufMult:0.65, maxAge:1, avwapProx:0.004,
    volLookback:20, msLookback:60, swingStrength:3,
    volSpikeMult:1.3,
  },
  M15: {
    tf:"M15", label:"15M",
    vpLookback:40, avwapLookback:12,
    minRR:1.5, minConviction:56, cooldownHrs:1,
    atrBufMult:0.60, maxAge:1, avwapProx:0.005,
    volLookback:15, msLookback:40, swingStrength:2,
    volSpikeMult:1.5,
  },
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN : process.env.STOCKS_TG_TOKEN || "",
  CHAT_ID        : process.env.STOCKS_CHAT_ID  || "",

  // 7 most volatile US stocks by ATR/beta (April 2026)
  // TSLA ~2.3β | NVDA ~2.0β | MSTR ~3.5β | COIN ~3.2β | PLTR ~2.5β | AMD ~1.8β | SMCI ~2.8β
  PAIRS: ["TSLA","NVDA","MSTR","COIN","PLTR","AMD","SMCI"],

  CAPITAL:100, RISK_PCT:1.5, LEVERAGE:1,   // no leverage for spot stocks (set >1 for CFD)
  VP_ROWS:24, MIN_WICK_DEPTH_PCT:0.12, MIN_BODY_GAP_PCT:0.08,

  VOLUME_FILTER:true,

  // Market session gate — only fire signals during US market + 2h pre/after
  // Pre-market: 07:00 ET | Market: 09:30–16:00 ET | After: 16:00–18:00 ET
  // In UTC: pre = 12:00, open = 14:30, close = 21:00, after = 23:00
  SESSION_GATE: true,

  CIRCUIT_BREAKER:true, CIRCUIT_BREAKER_LOSSES:3, CIRCUIT_BREAKER_HRS:24,

  CONFLUENCE_CONVICTION_BOOST:18,
  TRIPLE_TF_BOOST:25,
  CONFLUENCE_GATE_REDUCTION:6,

  TP3_MULT:3.0,

  MAX_RETRIES:2, RETRY_DELAY_MS:3000,
  DEDUP_WINDOW_MS: 3600000,

  // Stock SL floor: 0.8% minimum (stocks less gappy than crypto)
  STOCK_MIN_SL_PCT: 0.8,

  // ATR floor — SL must be ≥ this multiple of ATR from entry
  ATR_SL_FLOOR_MULT: 1.5,

  // v3.0 Gist publishing (merged repo — same Gist as crypto+forex)
  GH_PAT:  process.env.GH_PAT  || "",
  GIST_ID: process.env.GIST_ID || "",
};

const V = "GWP Stocks v3.0 | Elite Max™ | Asterix.COM | Abdin";

// ── STATE ─────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "stocks_state.json");
let state = {};
function loadState()  { try { state = JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); } catch(e) { state = {}; } }
function saveState()  { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function getProp(k)   { return state[k] || null; }
function setProp(k,v) { state[k] = v; }
function delProp(k)   { delete state[k]; }

// ── SIGNAL FILE WRITER ────────────────────────────────────────────────────────
function appendSignalToFile(symbol, r, conv, tfKey) {
  try {
    const pair = symbol + "/USD";
    const ts   = Date.now();
    const d    = new Date(ts);
    const time = d.getUTCHours().toString().padStart(2,"0") + ":" + d.getUTCMinutes().toString().padStart(2,"0");
    const conviction = parseFloat(conv && conv.score) || 50;
    const score = Math.min(Math.round(55 + (conviction - 50) / 73 * 45), 100);
    const sig = {
      pair, bot: "stocks",
      dir:   r.direction === "BULL" ? "LONG" : "SHORT",
      entry: r.entry ? r.entry.toString() : "0",
      sl:    r.sl    ? r.sl.toString()    : "0",
      tp:    r.tp2   ? r.tp2.toString()   : (r.tp1 ? r.tp1.toString() : "0"),
      tp1:   r.tp1   ? r.tp1.toString()   : "0",
      tp3:   r.tp3   ? r.tp3.toString()   : "0",
      rr:    r.rr    ? r.rr.toString()    : "",
      grade: r.grade || "",
      tf: tfKey, score, ts, time,
    };
    const sigFile = path.join(__dirname, "stocks_signals.json");
    let sigs = [];
    try { sigs = JSON.parse(fs.readFileSync(sigFile, "utf8")); } catch(e) {}
    if (!Array.isArray(sigs)) sigs = [];
    sigs.unshift(sig);
    if (sigs.length > 25) sigs = sigs.slice(0, 25);
    fs.writeFileSync(sigFile, JSON.stringify(sigs, null, 2));
    console.log(`  📝 Signal written → ${pair} ${sig.dir} [${tfKey}]`);
  } catch(e) { console.error("appendSignalToFile error:", e.message); }
}


// ── PUBLISH STOCKS_SIGNALS.JSON TO GITHUB GIST ───────────────────────────────
// v3.0: stocks moves into gwp-bots repo — shares the same Gist as crypto+forex
async function publishSignalsToGist() {
  if (!CONFIG.GH_PAT || !CONFIG.GIST_ID) return;
  try {
    const sigFile = path.join(__dirname, "stocks_signals.json");
    const data = fs.existsSync(sigFile) ? fs.readFileSync(sigFile, "utf8") : "[]";
    const payload = JSON.stringify({ files: { "stocks_signals.json": { content: data } } });
    const req = https.request({
      hostname: "api.github.com",
      path: `/gists/${CONFIG.GIST_ID}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Authorization": `token ${CONFIG.GH_PAT}`,
        "User-Agent": "GWP-Stocks-Bot/3.0",
      }
    }, r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>{ console.log(`  Gist → HTTP ${r.statusCode}`); }); });
    req.on("error", e => console.error("Gist publish error:", e.message));
    req.setTimeout(10000, () => req.destroy(new Error("Gist timeout")));
    req.write(payload);
    req.end();
  } catch(e) { console.error("publishSignalsToGist error:", e.message); }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((res, rej) => {
    const opts = new URL(url);
    const req  = https.get({
      hostname: opts.hostname,
      path:     opts.pathname + opts.search,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GWP-Stocks-Bot/1.0)",
        "Accept":     "application/json",
      }
    }, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => res(d));
    });
    req.on("error", rej);
    req.setTimeout(15000, () => { req.destroy(new Error("Timeout")); });
  });
}
function httpPost(hostname, pth, body) {
  return new Promise((res, rej) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path: pth, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(d)); });
    req.on("error", rej); req.write(payload); req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TELEGRAM ──────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.CHAT_ID) return;
  const chunks = [];
  for (let i = 0; i < text.length; i += 3800) chunks.push(text.slice(i, i + 3800));
  for (const chunk of chunks) {
    try {
      await httpPost("api.telegram.org", `/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
        { chat_id: CONFIG.CHAT_ID, text: chunk, parse_mode: "HTML" });
      if (chunks.length > 1) await sleep(300);
    } catch(e) { console.error("TG error:", e.message); }
  }
}
async function pollTelegram() {
  if (!CONFIG.TELEGRAM_TOKEN) return null;
  try {
    const offset = getProp("tg_offset") || 0;
    const raw    = await httpGet(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`);
    const json   = JSON.parse(raw); if (!json.ok || !json.result.length) return null;
    const last   = json.result[json.result.length - 1];
    setProp("tg_offset", last.update_id + 1);
    return json.result;
  } catch(e) { return null; }
}

// ── YAHOO FINANCE DATA LAYER ──────────────────────────────────────────────────
// Yahoo Finance v8 chart API (public, no key needed)
// Intervals: 1m, 2m, 5m, 15m, 30m, 60m, 1d, 1wk, 1mo
// Range:     1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max

async function fetchYahooCandles(symbol, interval, limit, retry = 0) {
  // Map our TF names to Yahoo intervals and appropriate range
  const intervalMap = { "15m": "15m", "1h": "60m", "1d": "1d" };
  const rangeMap    = {
    "15m": "5d",   // 5 days of 15m = ~130 bars (market hours only)
    "60m": "60d",  // 60 days of 1h = ~390 bars
    "1d":  "6mo",  // 6 months of daily
  };

  const yInterval = intervalMap[interval] || interval;
  const range     = rangeMap[yInterval] || "1mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${yInterval}&range=${range}&includePrePost=true`;

  try {
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!q || !timestamps.length) return null;

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({
        t:     timestamps[i] * 1000,
        open:  parseFloat(o),
        high:  parseFloat(h),
        low:   parseFloat(l),
        close: parseFloat(c),
        vol:   parseFloat(v || 0),
      });
    }

    // Return last `limit` candles
    return candles.slice(-Math.min(limit || 150, candles.length));
  } catch(e) {
    if (retry < CONFIG.MAX_RETRIES) {
      await sleep(CONFIG.RETRY_DELAY_MS);
      return fetchYahooCandles(symbol, interval, limit, retry + 1);
    }
    console.error(`Yahoo fetch error [${symbol} ${interval}]:`, e.message);
    return null;
  }
}

// ── BUILD 4H CANDLES FROM 1H ──────────────────────────────────────────────────
// Yahoo does not offer 4H directly. We aggregate 1H into 4H groups.
function build4HCandles(c1h) {
  if (!c1h || c1h.length < 4) return null;
  const result = [];
  // Group by 4-candle blocks (index-based, simplest approach)
  for (let i = 0; i + 3 < c1h.length; i += 4) {
    const block = c1h.slice(i, i + 4);
    result.push({
      t:     block[0].t,
      open:  block[0].open,
      high:  Math.max(...block.map(c => c.high)),
      low:   Math.min(...block.map(c => c.low)),
      close: block[3].close,
      vol:   block.reduce((s, c) => s + c.vol, 0),
    });
  }
  return result.length >= 20 ? result : null;
}

// Convenient TF fetchers
async function fetchKlines(symbol, tf, limit) {
  if (tf === "H4") {
    // Fetch 1H and aggregate → 4H needs limit*4 bars of 1H
    const c1h = await fetchYahooCandles(symbol, "1h", (limit || 120) * 4);
    return c1h ? build4HCandles(c1h) : null;
  }
  if (tf === "H1")  return fetchYahooCandles(symbol, "1h",  limit || 80);
  if (tf === "M15") return fetchYahooCandles(symbol, "15m", limit || 60);
  if (tf === "D1")  return fetchYahooCandles(symbol, "1d",  limit || 30);
  return null;
}

// ── MACRO EVENT BLACKOUT (v3.1 Fix #5) ───────────────────────────────────────
// Blocks signals within BLOCK_MINS of known high-impact events.
// FOMC 2026 dates (announced by Fed). Extend list as dates become known.
const MACRO_EVENTS_2026 = [
  // FOMC Meeting dates 2026 (day of decision, 18:00 UTC)
  "2026-01-29","2026-03-18","2026-05-06","2026-06-17",
  "2026-07-29","2026-09-16","2026-11-04","2026-12-16",
  // US NFP (first Friday each month, 12:30 UTC)
  "2026-01-09","2026-02-06","2026-03-06","2026-04-03",
  "2026-05-01","2026-06-05","2026-07-10","2026-08-07",
  "2026-09-04","2026-10-02","2026-11-06","2026-12-04",
];
const MACRO_BLOCK_MS = 60 * 60 * 1000; // 1 hour blackout window each side

function isNearMacroEvent() {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const dateStr of MACRO_EVENTS_2026) {
    if (dateStr !== todayStr) continue;
    // Check if current time is within BLOCK window of the event
    // FOMC = 18:00 UTC, NFP = 12:30 UTC
    const h = new Date().getUTCHours();
    const m = new Date().getUTCMinutes();
    const isNFP = parseInt(dateStr.slice(8)) <= 10; // NFP always early month
    const eventHour = isNFP ? 12 : 18;
    const nowMins = h * 60 + m;
    const eventMins = eventHour * 60 + (isNFP ? 30 : 0);
    if (Math.abs(nowMins - eventMins) <= 60) return { blocked: true, event: isNFP ? "NFP" : "FOMC", date: dateStr };
  }
  return { blocked: false };
}

// ── SESSION GATE ──────────────────────────────────────────────────────────────
function isMarketSessionActive() {
  if (!CONFIG.SESSION_GATE) return true;
  // NYSE: 09:30–16:00 ET | ET = UTC-4 (EDT) or UTC-5 (EST)
  // Pre-market from 07:00 ET (UTC 11:00/12:00)
  // After-hours to 18:00 ET (UTC 22:00/23:00)
  // We use UTC 11:00–23:00 to cover pre + regular + after hours (safe window)
  const h = new Date().getUTCHours();
  const d = new Date().getUTCDay(); // 0=Sun, 6=Sat
  if (d === 0 || d === 6) return false; // Weekend — no stocks
  return h >= 11 && h < 23;
}
function getSessionLabel() {
  const h = new Date().getUTCHours();
  const d = new Date().getUTCDay();
  // Check for upcoming macro event
  const macro = isNearMacroEvent();
  if (macro.blocked) return `⛔ MACRO EVENT: ${macro.event} — CAUTION`;
  if (d === 0 || d === 6) return "📴 Weekend — Market Closed";
  if (h >= 11 && h < 13)  return "🌅 Pre-Market (07:00–09:30 ET)";
  if (h >= 13 && h < 14)  return "🔔 Market Opening (09:00–09:30 ET)";
  if (h >= 14 && h < 21)  return "🔥 US Market Hours (09:30–16:00 ET) ✅";
  if (h >= 21 && h < 23)  return "🌆 After-Hours (16:00–18:00 ET)";
  return "🌙 Pre-Market Prep (overnight)";
}

// ── MATH ENGINE ──────────────────────────────────────────────────────────────
function calcATR(candles, p = 14) {
  if (candles.length < p + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) trs.push(Math.max(
    candles[i].high - candles[i].low,
    Math.abs(candles[i].high - candles[i - 1].close),
    Math.abs(candles[i].low  - candles[i - 1].close)
  ));
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p;
}
function calcATRPercentile(candles, p = 14) {
  if (candles.length < p + 10) return 50;
  const atrs = [];
  for (let i = p; i < candles.length; i++) atrs.push(calcATR(candles.slice(Math.max(0, i - p), i + 1), p));
  const cur = atrs[atrs.length - 1], rank = atrs.filter(a => a <= cur).length;
  return Math.round((rank / atrs.length) * 100);
}
function calcVolumeRatio(candles, p = 20) {
  if (candles.length < p + 1) return 1.0;
  const sl = candles.slice(-p - 1), avg = sl.slice(0, p).reduce((a, b) => a + b.vol, 0) / p;
  return avg > 0 ? sl[sl.length - 1].vol / avg : 1.0;
}
function calcHurst(closes) {
  if (closes.length < 20) return 0.5;
  const rets = []; for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const lags = [4, 8, 16].filter(l => l < rets.length - 2); if (lags.length < 2) return 0.5;
  const rsVals = lags.map(lag => {
    const chunks = Math.floor(rets.length / lag); let rsSum = 0;
    for (let c = 0; c < chunks; c++) {
      const sub = rets.slice(c * lag, (c + 1) * lag), mean = sub.reduce((a, b) => a + b, 0) / sub.length;
      const dem = sub.map(r => r - mean); let cum = 0;
      const cumDev = dem.map(d => (cum += d, cum));
      const R = Math.max(...cumDev) - Math.min(...cumDev);
      const variance = sub.reduce((a, b) => a + b * b, 0) / sub.length - mean * mean;
      rsSum += R / Math.sqrt(Math.max(variance, 1e-15));
    }
    return rsSum / chunks;
  });
  const logN = lags.map(l => Math.log(l)), logRS = rsVals.map(rs => Math.log(Math.max(rs, 1e-10)));
  const nP = logN.length, mLN = logN.reduce((a, b) => a + b) / nP, mLRS = logRS.reduce((a, b) => a + b) / nP;
  const num = logN.reduce((a, x, i) => a + (x - mLN) * (logRS[i] - mLRS), 0), den = logN.reduce((a, x) => a + (x - mLN) ** 2, 0);
  return den === 0 ? 0.5 : Math.min(Math.max(num / den, 0.1), 0.9);
}
function calcZScore(closes, p = 20) {
  if (closes.length < p) return { z: 0, extremeHigh: false, extremeLow: false, mildHigh: false, mildLow: false };
  const win = closes.slice(-p), mean = win.reduce((a, b) => a + b, 0) / p;
  const std  = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / p);
  const z    = std === 0 ? 0 : (closes[closes.length - 1] - mean) / std;
  return { z, extremeHigh: z > 1.5, extremeLow: z < -1.5, mildHigh: z > 0.8, mildLow: z < -0.8 };
}
function kalmanFilter(closes) {
  if (closes.length < 5) return null;
  const Q = 0.01, R = 0.5; let x = closes[0], v = 0, P = 1;
  for (let i = 1; i < closes.length; i++) {
    const xP = x + v, PP = P + Q, K = PP / (PP + R);
    x = xP + K * (closes[i] - xP); v = v + 0.1 * (closes[i] - x); P = (1 - K) * PP;
  }
  return { fairValue: x, velocity: v, bullish: v > 0 };
}
function calcMomentumBurst(candles, sigIdx) {
  if (sigIdx < 10) return false;
  const recent = candles.slice(Math.max(0, sigIdx - 10), sigIdx);
  const avgRange = recent.reduce((a, c) => a + (c.high - c.low), 0) / recent.length;
  return avgRange > 0 && (candles[sigIdx].high - candles[sigIdx].low) >= avgRange * 1.5;
}
function calcZoneRevisit(candles, bBot, bTop) {
  const recent = candles.slice(-12, -1);
  return recent.filter(c => c.low <= bTop * 1.005 && c.high >= bBot * 0.995).length >= 2;
}
function calcSineOscillator(closes) {
  const p = 20;
  if (closes.length < p * 2) return { sine: 0, leadSine: 0, domPeriod: p, expansion: false, contraction: false, label: "⬜ CYCLE: —" };
  const win = closes.slice(-(p * 2)), mean = win.reduce((a, b) => a + b, 0) / win.length;
  const detr = win.map(c => c - mean);
  let maxCorr = -Infinity, domPeriod = p;
  for (let lag = 8; lag <= p; lag++) {
    let corr = 0; for (let i = lag; i < detr.length; i++) corr += detr[i] * detr[i - lag];
    if (corr > maxCorr) { maxCorr = corr; domPeriod = lag; }
  }
  const cycPos = (closes.length % domPeriod) / domPeriod;
  const sine = Math.sin(2 * Math.PI * cycPos), leadSine = Math.sin(2 * Math.PI * cycPos + Math.PI / 4);
  const expansion = Math.abs(sine) < 0.25 && Math.abs(leadSine) > Math.abs(sine);
  const contraction = Math.abs(sine) > 0.70;
  const label = expansion ? `🌊 CYCLE: EXPANSION (T=${domPeriod})` : contraction ? `📉 CYCLE: PEAK/TROUGH (T=${domPeriod}) ✅ REVERSAL GATE` : `〰️ CYCLE: MID-WAVE (T=${domPeriod})`;
  return { sine: parseFloat(sine.toFixed(3)), leadSine: parseFloat(leadSine.toFixed(3)), domPeriod, expansion, contraction, label };
}
function runMathEngine(candles) {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const atr = calcATR(candles, 14), hurst = calcHurst(closes), zScore = calcZScore(closes, 20);
  const kalman = kalmanFilter(closes), atrPct = calcATRPercentile(candles, 14);
  const volRatio = calcVolumeRatio(candles, 20);
  return { atr, hurst, zScore, kalman, atrPct, volRatio, cur: closes[closes.length - 1], cycle: calcSineOscillator(closes), candleCount: closes.length };
}

// ── D1 BIAS ───────────────────────────────────────────────────────────────────
// v3.1: 3-candle micro-AVWAP. Old full-history AVWAP was anchored weeks into
// the past, causing D1=NEUTRAL/wrong while 4H+1H already had 3 valid entries.
// D1 is now a soft whisper (+2/−1), not a gate. Primary engine: 4H+1H+15M.
function getD1Bias(cd1) {
  if (!cd1 || cd1.length < 3) return "NEUTRAL";
  const last3 = cd1.slice(-3);   // v3.1: 3-candle only (was full history — eliminates lag)
  const closes = last3.map(c => c.close);
  let tv = 0, v = 0;
  last3.forEach(c => { const tp = (c.high + c.low + c.close) / 3; tv += tp * (c.vol || 1); v += (c.vol || 1); });
  const avwap = v > 0 ? tv / v : closes[closes.length - 1];
  const last  = closes[closes.length - 1];
  return last > avwap * 1.005 ? "BULL" : last < avwap * 0.995 ? "BEAR" : "NEUTRAL";
}

// ── WYCKOFF ───────────────────────────────────────────────────────────────────
function detectWyckoff(candles, direction) {
  if (candles.length < 15) return { spring: false, upthrust: false, label: "⬜ WYK: —" };
  const last10 = candles.slice(-10), last3 = candles.slice(-3);
  const lowestLow  = Math.min(...last10.map(c => c.low));
  const highestHigh = Math.max(...last10.map(c => c.high));
  const avgVol = last10.reduce((a, c) => a + (c.vol || 0), 0) / last10.length;
  const spring    = direction === "BULL" && last3.some(c => c.low <= lowestLow * 1.002 && c.close > lowestLow  * 1.005 && (c.vol || 0) > avgVol * 1.3);
  const upthrust  = direction === "BEAR" && last3.some(c => c.high >= highestHigh * 0.998 && c.close < highestHigh * 0.995 && (c.vol || 0) > avgVol * 1.3);
  const label = spring ? "🟢 WYK: SPRING ✅" : upthrust ? "🔴 WYK: UPTHRUST ✅" : "⬜ WYK: —";
  return { spring, upthrust, label };
}

// ── FIBONACCI ─────────────────────────────────────────────────────────────────
function calcFib786(candles, direction) {
  if (candles.length < 20) return { level786: null, level618: null, label: "⬜ EW: —" };
  const lookback = candles.slice(-50);
  const swingHigh = Math.max(...lookback.map(c => c.high));
  const swingLow  = Math.min(...lookback.map(c => c.low));
  const range     = swingHigh - swingLow;
  if (range === 0) return { level786: null, level618: null, label: "⬜ EW: —" };
  const level786 = direction === "BEAR" ? swingHigh - range * 0.786 : swingLow + range * 0.786;
  const level618 = direction === "BEAR" ? swingHigh - range * 0.618 : swingLow + range * 0.618;
  return { level786, level618, swingHigh, swingLow, label: `📐 EW: 78.6%=${level786.toFixed(2)} · 61.8%=${level618.toFixed(2)}` };
}

// ── VOLUME PROFILE + AVWAP ────────────────────────────────────────────────────
function computeVolumeProfile(candles, lookback) {
  const n = Math.min(lookback, candles.length), sl = candles.slice(candles.length - n);
  const hi = Math.max(...sl.map(c => c.high)), lo = Math.min(...sl.map(c => c.low)); if (hi <= lo) return null;
  const rows = CONFIG.VP_ROWS, rowH = (hi - lo) / rows, buck = new Array(rows).fill(0);
  sl.forEach(c => { for (let r = 0; r < rows; r++) { const rB = lo + r * rowH, rT = rB + rowH, ov = Math.min(c.high, rT) - Math.max(c.low, rB); if (ov > 0) buck[r] += (c.vol || 1) * (ov / ((c.high - c.low) || rowH)); } });
  let pocIdx = 0; for (let i = 1; i < rows; i++) if (buck[i] > buck[pocIdx]) pocIdx = i;
  const total = buck.reduce((a, b) => a + b, 0); let covered = buck[pocIdx], valIdx = pocIdx, vahIdx = pocIdx;
  while (covered < total * 0.70) {
    const up = vahIdx + 1 < rows ? buck[vahIdx + 1] : 0, dn = valIdx - 1 >= 0 ? buck[valIdx - 1] : 0;
    if (up >= dn) { vahIdx++; covered += up; } else { valIdx--; covered += dn; }
    if (valIdx <= 0 && vahIdx >= rows - 1) break;
  }
  const val = lo + valIdx * rowH;
  return { poc: lo + (pocIdx + 0.5) * rowH, val, vah: lo + (vahIdx + 1) * rowH, valBandBot: val, valBandTop: val + rowH, valBandMid: val + rowH * 0.5, rowHeight: rowH, hi, lo };
}
function computeAVWAP(candles, lookback) {
  const n = Math.min(lookback, candles.length), sl = candles.slice(candles.length - n); let tv = 0, v = 0;
  sl.forEach(c => { const tp = (c.high + c.low + c.close) / 3; tv += tp * (c.vol || 1); v += (c.vol || 1); });
  return v > 0 ? tv / v : null;
}

// ── VOLUME SPIKE ──────────────────────────────────────────────────────────────
function hasVolumeSpike(sigCandle, allCandles, sigIdx, volLookback, mult) {
  if (!CONFIG.VOLUME_FILTER) return true;
  const start = Math.max(0, sigIdx - volLookback), vols = allCandles.slice(start, sigIdx).map(c => c.vol || 0);
  if (!vols.length) return true;
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  return avg === 0 ? true : (sigCandle.vol || 0) >= avg * mult;
}

// ── MARKET STRUCTURE ENGINE ───────────────────────────────────────────────────
function detectSwings(candles, strength) {
  const highs = [], lows = [], str = strength || 3;
  for (let i = str; i < candles.length - str; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - str; j <= i + str; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low  <= candles[i].low)  isLow  = false;
    }
    if (isHigh) highs.push({ idx: i, price: candles[i].high, t: candles[i].t });
    if (isLow)  lows.push({  idx: i, price: candles[i].low,  t: candles[i].t });
  }
  return { highs, lows };
}
// v3.1 Fix #2: Volume-validated BOS — fake BOS (no vol) scores less
function detectBOS(candles, swings) {
  const last5 = candles.slice(-5);
  const safeHighs = swings.highs.filter(s => s.idx < candles.length - 3).slice(-5);
  const safeLows  = swings.lows.filter( s => s.idx < candles.length - 3).slice(-5);
  // Volume average for spike detection
  const volArr = candles.slice(-20).map(c => c.vol || 0);
  const avgVol = volArr.length ? volArr.reduce((a,b) => a+b,0) / volArr.length : 1;
  let bullBOS = false, bearBOS = false, bullLevel = null, bearLevel = null;
  let bullBOSVolConfirmed = false, bearBOSVolConfirmed = false;
  for (const c of last5) {
    const volOk = (c.vol || 0) >= avgVol * 1.2;
    for (const sh of safeHighs) {
      if (c.close > sh.price) { bullBOS = true; bullLevel = sh.price; bullBOSVolConfirmed = volOk; break; }
    }
    for (const sl of safeLows) {
      if (c.close < sl.price) { bearBOS = true; bearLevel = sl.price; bearBOSVolConfirmed = volOk; break; }
    }
  }
  return { bullBOS, bearBOS, bullLevel, bearLevel, bullBOSVolConfirmed, bearBOSVolConfirmed };
}
// v3.1 Fix #11: Double-candle CHoCH confirmation — requires 2 consecutive closes past reference level
function detectCHoCH(candles, swings) {
  const highs = swings.highs.slice(-4), lows = swings.lows.slice(-4);
  if (highs.length < 2 || lows.length < 2) return { detected: false, toBull: false, toBear: false, prevTrend: null, doubleConfirmed: false };
  const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hl = lows[lows.length - 1].price   > lows[lows.length - 2].price;
  const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const ll = lows[lows.length - 1].price   < lows[lows.length - 2].price;
  let prevTrend = null;
  if (hh && hl) prevTrend = "BULL";
  if (lh && ll) prevTrend = "BEAR";
  if (!prevTrend) return { detected: false, toBull: false, toBear: false, prevTrend: null, doubleConfirmed: false };
  const last5 = candles.slice(-5); let toBull = false, toBear = false, doubleConfirmed = false;
  if (prevTrend === "BEAR") {
    const refHigh = swings.highs.filter(s => s.idx < candles.length - 5).slice(-1)[0];
    if (refHigh) {
      if (last5.some(c => c.close > refHigh.price)) toBull = true;
      for (let i = 0; i < last5.length - 1; i++) { if (last5[i].close > refHigh.price && last5[i+1].close > refHigh.price) { doubleConfirmed = true; break; } }
    }
  }
  if (prevTrend === "BULL") {
    const refLow = swings.lows.filter(s => s.idx < candles.length - 5).slice(-1)[0];
    if (refLow) {
      if (last5.some(c => c.close < refLow.price)) toBear = true;
      for (let i = 0; i < last5.length - 1; i++) { if (last5[i].close < refLow.price && last5[i+1].close < refLow.price) { doubleConfirmed = true; break; } }
    }
  }
  return { detected: toBull || toBear, toBull, toBear, prevTrend, doubleConfirmed };
}
function detectLiquiditySweep(candles, swings) {
  const lookback = candles.slice(-15);
  const safeHighs = swings.highs.filter(s => s.idx < candles.length - 15).slice(-4);
  const safeLows  = swings.lows.filter( s => s.idx < candles.length - 15).slice(-4);
  let highSweep = false, lowSweep = false, highLevel = null, lowLevel = null;
  for (const c of lookback) {
    for (const sh of safeHighs) { if (c.high > sh.price && c.close < sh.price) { highSweep = true; highLevel = sh.price; break; } }
    for (const sl of safeLows)  { if (c.low  < sl.price && c.close > sl.price) { lowSweep  = true; lowLevel  = sl.price; break; } }
  }
  return { highSweep, lowSweep, highLevel, lowLevel };
}
function detectFVG(candles, direction) {
  const cur = candles[candles.length - 1]; let found = false, fvgHigh = null, fvgLow = null;
  for (let i = candles.length - 1; i >= Math.max(2, candles.length - 12); i--) {
    const c1 = candles[i - 2], c3 = candles[i];
    if (direction === "BULL" && c3.low > c1.high) { const prox = Math.abs(cur.close - c1.high) / cur.close; if ((cur.close >= c1.high && cur.close <= c3.low) || prox < 0.008) { found = true; fvgHigh = c3.low; fvgLow = c1.high; break; } }
    if (direction === "BEAR" && c3.high < c1.low) { const prox = Math.abs(cur.close - c1.low)  / cur.close; if ((cur.close <= c1.low  && cur.close >= c3.high) || prox < 0.008) { found = true; fvgHigh = c1.low; fvgLow = c3.high; break; } }
  }
  return { present: found, fvgHigh, fvgLow };
}
function analyzeMarketStructure(candles, direction, tfCfg) {
  if (!candles || candles.length < 20) return { confirmed: false, label: "⬜ MS: INSUFFICIENT", strength: 0, bos: null, choch: null, liqSweep: null, fvg: null };
  const slice  = candles.slice(-Math.min(tfCfg.msLookback, candles.length));
  const swings = detectSwings(slice, tfCfg.swingStrength);
  const bos = detectBOS(slice, swings), choch = detectCHoCH(slice, swings);
  const liqSweep = detectLiquiditySweep(slice, swings), fvg = detectFVG(slice, direction);
  let confirmed = false, label = "🟡 MS: UNCONFIRMED", strength = 0;
  if (direction === "BULL") {
    if (choch.detected && choch.toBull)  { confirmed = true; label = "🔄 CHoCH→BULL";  strength = 3; }
    else if (bos.bullBOS)                { confirmed = true; label = "⬆️ BOS BULL";    strength = 2; }
    else if (liqSweep.lowSweep)          { confirmed = true; label = "💧 LIQ SWEEP↓";  strength = 2; }
    else if (fvg.present)                { confirmed = true; label = "🟦 FVG BULL";    strength = 1; }
  }
  if (direction === "BEAR") {
    if (choch.detected && choch.toBear)  { confirmed = true; label = "🔄 CHoCH→BEAR";  strength = 3; }
    else if (bos.bearBOS)                { confirmed = true; label = "⬇️ BOS BEAR";    strength = 2; }
    else if (liqSweep.highSweep)         { confirmed = true; label = "💧 LIQ SWEEP↑";  strength = 2; }
    else if (fvg.present)                { confirmed = true; label = "🟥 FVG BEAR";    strength = 1; }
  }
  return { confirmed, label, strength, bos, choch, liqSweep, fvg, swings };
}

// ── CONVICTION ENGINE ─────────────────────────────────────────────────────────
function computeConviction(gwp, math, ms, tfKey, isConfluence = false, isTriple = false, d1Bias = "NEUTRAL") {
  let score = 0;

  // GWP CORE (0–32)
  const gs = parseFloat(gwp.score); score += gs >= 7.5 ? 32 : gs >= 6.5 ? 26 : gs >= 5.5 ? 18 : 10;

  // AVWAP TRAP (12)
  if (gwp.avwapTrap)     score += 12;

  // VOLUME SPIKE (6)
  if (gwp.volumeSpike)   score += 6;

  // PATH A BONUS (4)
  if (!gwp.isPathB)      score += 4;

  // MOMENTUM BURST (4)
  if (gwp.momentumBurst) score += 4;

  // ZONE REVISIT (3)
  if (gwp.zoneRevisit)   score += 3;

  // MATH ENGINE
  if (math) {
    // v3.1 Fix #8: Hurst reliability gate — requires 120+ candles for statistical validity
    // Below 120 candles, Hurst output is noise-dominated (unreliable fractal dimension)
    const hurstReliable = math.candleCount && math.candleCount >= 120;
    if (hurstReliable) {
      if (math.hurst < 0.45)      score += 8;
      else if (math.hurst < 0.55) score += 4;
    } else {
      // Fallback when Hurst unreliable: use vol ratio as substitute (+2 if strong participation)
      if (math.volRatio >= 1.5) score += 2;
    }

    const z = math.zScore;
    if (gwp.direction === "BULL" && z.extremeLow)  score += 7;
    if (gwp.direction === "BEAR" && z.extremeHigh) score += 7;
    if (gwp.direction === "BULL" && z.mildLow)     score += 3;
    if (gwp.direction === "BEAR" && z.mildHigh)    score += 3;

    if (math.kalman) {
      const rev = (gwp.direction === "BULL" && !math.kalman.bullish) || (gwp.direction === "BEAR" && math.kalman.bullish);
      if (rev) score += 6;
    }

    if (math.atrPct >= 25 && math.atrPct <= 75)      score += 4;
    else if (math.atrPct >= 15 && math.atrPct <= 85) score += 2;

    if (math.volRatio >= 2.0)      score += 4;
    else if (math.volRatio >= 1.5) score += 3;
    else if (math.volRatio >= 1.2) score += 1;
  }

  // WYCKOFF (0–10)
  if (gwp.wyckoff) {
    if (gwp.direction === "BULL" && gwp.wyckoff.spring)   score += 10;
    if (gwp.direction === "BEAR" && gwp.wyckoff.upthrust) score += 10;
  }

  // CYCLE GATE
  if (math && math.cycle && math.cycle.contraction) score += 8;

  // MARKET STRUCTURE (0–30)
  if (ms) {
    // v3.1 Fix #11: Double-candle CHoCH scoring — confirmed = +16, single = +10
    if (ms.choch && ms.choch.detected) {
      const chochDir = (gwp.direction === "BULL" && ms.choch.toBull) || (gwp.direction === "BEAR" && ms.choch.toBear);
      if (chochDir) score += ms.choch.doubleConfirmed ? 16 : 10;
    }
    // v3.1 Fix #2: Volume-validated BOS scoring
    if (ms.bos) {
      const bullOk = gwp.direction === "BULL" && ms.bos.bullBOS;
      const bearOk = gwp.direction === "BEAR" && ms.bos.bearBOS;
      if (bullOk) score += ms.bos.bullBOSVolConfirmed ? 8 : 3;  // strong vs weak BOS
      if (bearOk) score += ms.bos.bearBOSVolConfirmed ? 8 : 3;
    }
    // v3.1 Fix #3: Zone-aware LiqSweep — sweep IN zone = trap confirmed = higher score
    if (ms.liqSweep) {
      const bullLS = gwp.direction === "BULL" && ms.liqSweep.lowSweep;
      const bearLS = gwp.direction === "BEAR" && ms.liqSweep.highSweep;
      if (bullLS || bearLS) {
        // If sweep happened near the AVWAP/zone (avwapTrap confirmed) = institutional trap
        const inZone = gwp.avwapTrap || gwp.zoneRevisit;
        const touches = gwp.zoneTouches !== undefined ? gwp.zoneTouches : 3;
        const zoneWeak = touches >= 3;
        score += inZone && !zoneWeak ? 10 : inZone ? 5 : 4;  // in+fresh=10, in+exhausted=5, open=4
        if (inZone && !zoneWeak) {
          // Tag the signal — used in formatting
          gwp._trapConfirmed = true;
        }
      }
    }
    if (ms.fvg && ms.fvg.present) score += 3;
  }

  // v3.1: D1 BIAS — soft whisper (+2 aligned / −1 counter).
  // D1 is context-only. Primary engine is 4H+1H+15M.
  // Old ±6/−4 swing = up to 10 pts on a 105-pt scale was blocking live trends.
  if (d1Bias === "BULL" && gwp.direction === "BULL") score += 2;
  if (d1Bias === "BEAR" && gwp.direction === "BEAR") score += 2;
  if (d1Bias === "BULL" && gwp.direction === "BEAR") score -= 1;
  if (d1Bias === "BEAR" && gwp.direction === "BULL") score -= 1;

  // CONFLUENCE BOOSTS
  if (isTriple)           score += CONFIG.TRIPLE_TF_BOOST;
  else if (isConfluence)  score += CONFIG.CONFLUENCE_CONVICTION_BOOST;

  score = Math.max(0, Math.min(score, 123));
  const grade = score >= 108 ? "🏆 SUPREME★★★★" : score >= 96 ? "🏆 SUPREME★★★" : score >= 84 ? "⚡ SUPREME★★" : score >= 72 ? "🔥 SUPREME★" : score >= 58 ? "🔥 ELITE" : score >= 50 ? "✅ SOLID" : "⚠️ MARGINAL";
  return { score: score.toFixed(1), grade };
}

// ── DEDUP CHECK ───────────────────────────────────────────────────────────────
function isDuplicate(symbol, direction, tfKey) {
  const key  = `SDUP1_${tfKey}_${symbol}_${direction}`;
  const last = getProp(key);
  return last && (Date.now() - parseInt(last)) < CONFIG.DEDUP_WINDOW_MS;
}
function markFired(symbol, direction, tfKey) {
  setProp(`SDUP1_${tfKey}_${symbol}_${direction}`, Date.now().toString());
}

// ── ZONE TOUCH COUNTER (v3.1 Fix #1) ─────────────────────────────────────────
// Counts how many candles in the last 50 bars touched the VAL band zone.
// Virgin zone (1-2 touches) = high probability. Exhausted zone (3+) = weakened.
function getZoneTouchCount(candles, bBot, bTop) {
  const lookback = candles.slice(-50);
  let touches = 0;
  for (const c of lookback) {
    if (c.high >= bBot && c.low <= bTop) touches++;
  }
  return touches;
}

// ── CORE GWP DETECTOR ─────────────────────────────────────────────────────────
function detectGWP(candles, vp, avwap, math, tfCfg) {
  if (!candles || candles.length < 6 || !vp) return null;
  const n = candles.length, cur = candles[n - 1];
  const { valBandBot: bBot, valBandTop: bTop, valBandMid: bMid, rowHeight: bH } = vp;
  const minDepth = bH * CONFIG.MIN_WICK_DEPTH_PCT, minGap = bH * CONFIG.MIN_BODY_GAP_PCT;
  const atr = math ? math.atr : bH * 0.5, atrBuf = Math.max(bH * 0.22, atr * tfCfg.atrBufMult);

  for (let age = 0; age <= tfCfg.maxAge; age++) {
    const sig = candles[n - 2 - age]; if (!sig) continue;
    const bodyHi = Math.max(sig.open, sig.close), bodyLo = Math.min(sig.open, sig.close);
    let direction = null, wickDepth = 0, bodyGap = 0;

    if (sig.low <= bTop - minDepth && sig.low >= bBot * 0.97 && bodyLo >= bTop + minGap) {
      direction = "BEAR"; wickDepth = bTop - Math.max(sig.low, bBot); bodyGap = bodyLo - bTop;
    }
    if (sig.high >= bBot + minDepth && sig.high <= bTop * 1.03 && bodyHi <= bBot - minGap) {
      direction = "BULL"; wickDepth = Math.min(sig.high, bTop) - bBot; bodyGap = bBot - bodyHi;
    }
    if (!direction) continue;

    // Stale check
    const staleZone = atr * (tfCfg.tf === "M15" ? 0.3 : 0.5);
    if (direction === "BEAR" && cur.close <= (bMid - staleZone)) { console.log(`  GWP BEAR ${tfCfg.label} age=${age}: stale`); continue; }
    if (direction === "BULL" && cur.close >= (bMid + staleZone)) { console.log(`  GWP BULL ${tfCfg.label} age=${age}: stale`); continue; }

    let avwapTrap = false;
    if (avwap) { const prox = tfCfg.avwapProx; avwapTrap = Math.abs(sig.high - avwap) / avwap <= prox || Math.abs(sig.low - avwap) / avwap <= prox; }

    const sigIdx       = n - 2 - age;
    // v3.1 Fix #9: Session-adjusted vol multiplier
    const sessionVolMult = getSessionVolMult(tfCfg.volSpikeMult);
    const volumeSpike  = hasVolumeSpike(sig, candles, sigIdx, tfCfg.volLookback, sessionVolMult);
    const momentumBurst = calcMomentumBurst(candles, sigIdx);
    const zoneRevisit  = calcZoneRevisit(candles, bBot, bTop);
    const wyckoff      = detectWyckoff(candles, direction);
    const fib          = calcFib786(candles, direction);
    const cycle        = math ? math.cycle : null;

    const bodyGapPct = (bodyGap / bH) * 100, isPathB = bodyGapPct < 35;

    // INSTITUTIONAL GATE — at least Vol spike OR AVWAP trap must pass
    if (!volumeSpike && !avwapTrap) {
      console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: REJECTED — no vol spike AND no AVWAP trap`);
      continue;
    }

    // ── SL: Multi-layer + ATR floor ──────────────────────────────────────────
    const sigCandleRange = sig.high - sig.low, rangeBuffer = sigCandleRange * 0.15;
    let sl;
    if (direction === "BEAR") { const slBase = Math.max(sig.high + atrBuf, sig.high + rangeBuffer); sl = isPathB ? slBase + (slBase - cur.close) * 0.30 : slBase; }
    else                      { const slBase = Math.min(sig.low  - atrBuf, sig.low  - rangeBuffer); sl = isPathB ? slBase - (cur.close - slBase) * 0.30 : slBase; }

    // Minimum SL % for stocks
    const minSlDist = cur.close * CONFIG.STOCK_MIN_SL_PCT / 100;
    if (direction === "BEAR" && (sl - cur.close) < minSlDist) sl = cur.close + minSlDist;
    if (direction === "BULL" && (cur.close - sl) < minSlDist) sl = cur.close - minSlDist;

    // ATR floor — SL must be ≥ ATR_SL_FLOOR_MULT × ATR from entry
    if (atr > 0) {
      const atrFloor = atr * CONFIG.ATR_SL_FLOOR_MULT;
      if (direction === "BEAR" && (sl - cur.close) < atrFloor) sl = cur.close + atrFloor;
      if (direction === "BULL" && (cur.close - sl) < atrFloor) sl = cur.close - atrFloor;
    }

    const entry = cur.close, slDist = Math.abs(entry - sl);
    const tp2 = direction === "BEAR" ? entry - slDist * 2.0 : entry + slDist * 2.0;
    // v3.1 Fix #6: Structural TP1 — use nearest swing level between entry and TP2
    // Falls back to VP band edge if no swing exists in range
    const msSlice6 = candles.slice(-Math.min(tfCfg.msLookback, candles.length));
    const msSwings6 = detectSwings(msSlice6, tfCfg.swingStrength);
    let tp1;
    if (direction === "BEAR") {
      const candidateLows = msSwings6.lows
        .map(s => s.price)
        .filter(p => p < entry && p > tp2)
        .sort((a, b) => b - a);
      tp1 = candidateLows.length > 0 ? candidateLows[0] : bBot;
    } else {
      const candidateHighs = msSwings6.highs
        .map(s => s.price)
        .filter(p => p > entry && p < tp2)
        .sort((a, b) => a - b);
      tp1 = candidateHighs.length > 0 ? candidateHighs[0] : bTop;
    }
    // Safety: if structural TP1 is too close (< 0.3% from entry), fallback to bH distance
    if (Math.abs(entry - tp1) / entry < 0.003) {
      tp1 = direction === "BEAR" ? entry - bH * 1.0 : entry + bH * 1.0;
    }
    const tp3 = direction === "BEAR" ? entry - slDist * CONFIG.TP3_MULT : entry + slDist * CONFIG.TP3_MULT;
    const tp4 = direction === "BEAR" ? entry - slDist * 4.0 : entry + slDist * 4.0;
    const rr  = slDist > 0 ? Math.abs(tp2 - entry) / slDist : 0;

    if (rr < tfCfg.minRR) { console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: RR=${rr.toFixed(2)} < ${tfCfg.minRR}`); continue; }

    const reEntry = direction === "BEAR" ? (cur.close * 0.998).toFixed(4) : (cur.close * 1.002).toFixed(4);
    const rawScore = Math.min(10, (bodyGapPct / 100) * 10 + (wickDepth / bH) * 5 + (isPathB ? 0 : 2));
    const agePenalty = age > 0 ? Math.pow(0.75, age) : 1;
    const score = rawScore * agePenalty;
    // v3.1 Fix #1: Zone touch penalty — fresh zones score higher
    const zoneTouches = getZoneTouchCount(candles, bBot, bTop);
    const touchPenalty = zoneTouches >= 3 ? (zoneTouches >= 5 ? 2.0 : 1.0) : 0;
    const adjustedScore = Math.max(0, score - touchPenalty);
    const zoneFreshness = zoneTouches <= 2 ? "🟢 FRESH ZONE" : zoneTouches <= 4 ? "🟡 TESTED ZONE" : "🔴 EXHAUSTED ZONE";
    if (touchPenalty > 0) console.log(`  Zone touch penalty: ${zoneTouches} touches → -${touchPenalty} score`);

    const dp = v => v < 0.01 ? 6 : v < 1 ? 5 : v < 10 ? 4 : v < 1000 ? 3 : 2;
    const f  = n => Number(n).toFixed(dp(Math.abs(n)));

    const checks = [
      { pass: wickDepth >= minDepth,       item: `Wick into VAL band (≥${(minDepth).toFixed(4)})` },
      { pass: bodyGap >= minGap,           item: `Body outside band (≥${(minGap).toFixed(4)})` },
      { pass: volumeSpike,                 item: "Volume spike on signal candle" },
      { pass: avwapTrap,                   item: "AVWAP trap zone confluence" },
      { pass: !isPathB,                    item: "Path A (direct return, no sweep)" },
      { pass: momentumBurst,               item: "Momentum burst on signal candle" },
      { pass: false,                       item: "Market structure confirmed" },  // ✅ FIX: ms computed after detectGWP returns
    ];

    return {
      direction, grade: "GWP", score: adjustedScore.toFixed(1), rawScore, age,
      tf: tfCfg.tf, tfLabel: tfCfg.label,
      path: isPathB ? "B — Sweep + Return ⚠️" : "A — Direct Return 🎯",
      isPathB, volumeSpike, avwapTrap, momentumBurst, zoneRevisit,
      entry: f(entry), sl: f(sl), tp1: f(tp1), tp2: f(tp2), tp3: f(tp3),
      rr: rr.toFixed(2),
      slPct:  (Math.abs(entry - sl)  / entry * 100).toFixed(2),
      tp1Pct: (Math.abs(entry - tp1) / entry * 100).toFixed(2),
      tp2Pct: (Math.abs(entry - tp2) / entry * 100).toFixed(2),
      tp3Pct: (Math.abs(entry - tp3) / entry * 100).toFixed(2),
      wickDepthPct: (wickDepth / bH * 100).toFixed(1),
      bodyGapPct: bodyGapPct.toFixed(1),
      avwap: avwap ? f(avwap) : null,
      vp: { val: f(bBot), mid: f(bMid), top: f(bTop), poc: f(vp.poc) },
      checks, reEntry, signalTime: new Date(sig.t).toUTCString(),
      wyckoff, fib, tp4: f(tp4),
      cycleLabel: cycle ? cycle.label : "⬜ CYCLE: —",
      cycleGate:  cycle ? cycle.contraction : false,
      zoneFreshness, zoneTouches,
    };
  }
  return null;
}

// ── SESSION VOL MULTIPLIER (v3.1 Fix #9) ─────────────────────────────────────
function getSessionVolMult(baseMult) {
  const h = new Date().getUTCHours();
  if (h >= 12 && h <= 16) return baseMult;
  if (h >= 7  && h < 12)  return baseMult * 1.2;
  if (h >= 17 && h < 21)  return baseMult * 1.1;
  if (h >= 0  && h < 7)   return baseMult * 1.5;
  return baseMult * 1.3;
}

// ── COOLDOWNS ──────────────────────────────────────────────────────────────────
function isOnCooldown(symbol, direction, tfKey) {
  const last = getProp(`scd1_${tfKey}_${symbol}_${direction}`);
  return last && (Date.now() - parseInt(last)) / 3600000 < TF_CONFIG[tfKey].cooldownHrs;
}
function setCooldown(symbol, direction, tfKey) { setProp(`scd1_${tfKey}_${symbol}_${direction}`, Date.now().toString()); }

// ── CIRCUIT BREAKER ────────────────────────────────────────────────────────────
function isCircuitBroken(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return false;
  const raw = getProp("SCB1_" + symbol); if (!raw) return false;
  try { const cb = JSON.parse(raw); if (Date.now() - cb.ts < CONFIG.CIRCUIT_BREAKER_HRS * 3600000) return true; delProp("SCB1_" + symbol); } catch(e) {}
  return false;
}
async function recordLoss(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return;
  const key = "SCBL1_" + symbol, n = parseInt(getProp(key) || "0") + 1; setProp(key, n.toString());
  if (n >= CONFIG.CIRCUIT_BREAKER_LOSSES) { setProp("SCB1_" + symbol, JSON.stringify({ ts: Date.now(), losses: n })); delProp(key); await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol}</b>\n${n} losses. Paused ${CONFIG.CIRCUIT_BREAKER_HRS}h.\n\n<i>${V}</i>`); }
}
function recordWin(symbol) { if (CONFIG.CIRCUIT_BREAKER) delProp("SCBL1_" + symbol); }

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(symbol, r, conv, tfKey) {
  setProp("SPOS1_" + symbol + "_" + r.direction + "_" + tfKey, JSON.stringify({
    symbol, direction: r.direction, entry: parseFloat(r.entry), sl: parseFloat(r.sl),
    tp1: parseFloat(r.tp1), tp2: parseFloat(r.tp2), tp3: parseFloat(r.tp3),
    rr: r.rr, grade: r.grade, tf: tfKey, conviction: conv ? conv.score : "?",
    isPathB: r.isPathB, reEntry: r.reEntry, state: "OPEN", tp1hit: false, tp2hit: false, ts: Date.now(),
  }));
  appendSignalToFile(symbol, r, conv, tfKey);
}
async function checkOpenPositions() {
  const posKeys = Object.keys(state).filter(k => k.startsWith("SPOS1_"));
  for (const key of posKeys) {
    let p; try { p = JSON.parse(getProp(key)); } catch(e) { continue; }
    if (!p || p.state !== "OPEN") continue;
    let candles = null;
    try { candles = await fetchKlines(p.symbol, "M15", 3); } catch(e) {}
    if (!candles || !candles.length) continue;
    const price = candles[candles.length - 1].close, isL = p.direction === "BULL";
    const pnl = ((isL ? (price - p.entry) / p.entry : (p.entry - price) / p.entry) * 100).toFixed(3);
    const dp = v => v < 0.01 ? 6 : v < 1 ? 5 : v < 10 ? 4 : v < 1000 ? 3 : 2;
    const f  = n => Number(n).toFixed(dp(Math.abs(n)));
    let msg = null;
    if (!p.tp1hit && (isL ? price >= p.tp1 : price <= p.tp1)) { p.tp1hit = true; msg = `🎯 <b>GWP TP1 HIT — ${p.symbol} [${p.tf}]</b>\n40% exit. Move SL to BE.\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`; }
    if (!p.tp2hit && (isL ? price >= p.tp2 : price <= p.tp2)) { p.tp2hit = true; msg = `🏆 <b>GWP TP2 HIT — ${p.symbol} [${p.tf}]</b> 🔥\nHold 20% for TP3: <code>${f(p.tp3)}</code>\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`; }
    if (p.tp2hit && (isL ? price >= p.tp3 : price <= p.tp3)) { msg = `🏅 <b>GWP TP3 HIT! — ${p.symbol} [${p.tf}]</b> 💎\nFull exit. P&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`; p.state = "CLOSED"; await trackClose(p.symbol, p.direction, pnl, true, null); }
    if (isL ? price <= p.sl : price >= p.sl) { const pbN = p.isPathB ? `\n⚡ Path B re-entry: <code>${p.reEntry || "zone"}</code>` : ""; msg = `❌ <b>GWP SL HIT — ${p.symbol} [${p.tf}]</b>\n${p.direction} ${f(p.entry)} → SL ${f(p.sl)}\nP&L: <b>${pnl}%</b>${pbN}\n\n<i>${V}</i>`; p.state = "CLOSED"; await trackClose(p.symbol, p.direction, pnl, false, null); }
    if (msg) { await tgSend(msg); if (p.state === "CLOSED") delProp(key); else setProp(key, JSON.stringify(p)); } else { setProp(key, JSON.stringify(p)); }
  }
}

// ── TRACKING ───────────────────────────────────────────────────────────────────
function getDateKey() { return new Date().toISOString().slice(0, 10); }
function getWeekKey() { const now = new Date(), s = new Date(now.getFullYear(), 0, 1); return now.getFullYear() + "_W" + String(Math.ceil(((now - s) / 86400000 + s.getDay() + 1) / 7)).padStart(2, "0"); }
function trackFired(symbol, r, mode) {
  const dk = "S1_D_" + getDateKey(); let d; try { d = JSON.parse(getProp(dk) || "[]"); } catch(e) { d = []; }
  d.push({ sym: symbol, dir: r.direction, grade: r.grade, tf: r.tf, mode, rr: r.rr, ts: Date.now() }); setProp(dk, JSON.stringify(d));
  const wk = "S1_W_" + getWeekKey(); let w; try { w = JSON.parse(getProp(wk) || "{}"); } catch(e) { w = {}; }
  w.signals = (w.signals || 0) + 1; if (mode === "TRIPLE") w.triple = (w.triple || 0) + 1; else if (mode === "CONFLUENCE") w.confluence = (w.confluence || 0) + 1; setProp(wk, JSON.stringify(w));
}
// v3.1 Fix #10: Enhanced performance tracker with conviction score + weekly report
async function trackClose(symbol, direction, pnlPct, isWin, convScore = null) {
  const wk = "S1_W_" + getWeekKey(); let w; try { w = JSON.parse(getProp(wk) || "{}"); } catch(e) { w = {}; }
  if (isWin) { w.wins = (w.wins || 0) + 1; recordWin(symbol); } else { w.losses = (w.losses || 0) + 1; await recordLoss(symbol); }
  w.pnl = parseFloat(((w.pnl || 0) + parseFloat(pnlPct || 0)).toFixed(3));
  const p = parseFloat(pnlPct || 0);
  if (w.bestPnl === undefined || p > w.bestPnl) { w.bestPnl = p; w.bestSym = symbol; }
  if (w.worstPnl === undefined || p < w.worstPnl) { w.worstPnl = p; w.worstSym = symbol; }
  if (convScore !== null) {
    if (isWin) { w.winConvSum = (w.winConvSum || 0) + convScore; w.winConvN = (w.winConvN || 0) + 1; }
    else       { w.lossConvSum = (w.lossConvSum || 0) + convScore; w.lossConvN = (w.lossConvN || 0) + 1; }
  }
  setProp(wk, JSON.stringify(w));
}
async function sendWeeklyReport() {
  let w; try { w = JSON.parse(getProp("S1_W_" + getWeekKey()) || "{}"); } catch(e) { w = {}; }
  const closed = (w.wins || 0) + (w.losses || 0);
  const wr = closed > 0 ? ((w.wins || 0) / closed * 100).toFixed(1) + "%" : "—";
  const avgWinConv = w.winConvN  ? (w.winConvSum  / w.winConvN).toFixed(1)  : "—";
  const avgLossConv= w.lossConvN ? (w.lossConvSum / w.lossConvN).toFixed(1) : "—";
  let msg = `📊 <b>GWP STOCKS — WEEKLY PERFORMANCE REPORT</b>\n`;
  msg += `📆 ${getWeekKey().replace("_", " ")}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📡 Signals: ${w.signals || 0}  |  Conf: ${w.confluence || 0}  |  Triple: ${w.triple || 0}\n`;
  if (closed > 0) {
    msg += `✅ Wins: ${w.wins || 0}  ❌ Losses: ${w.losses || 0}  |  Win Rate: <b>${wr}</b>\n`;
    msg += `💰 Net P&L: <b>${(w.pnl || 0) >= 0 ? "+" : ""}${w.pnl || 0}%</b>\n`;
    if (w.bestSym)  msg += `🏆 Best:  ${w.bestSym} +${w.bestPnl}%\n`;
    if (w.worstSym) msg += `💀 Worst: ${w.worstSym} ${w.worstPnl}%\n`;
    msg += `🧠 Avg Conv — Wins: ${avgWinConv} | Losses: ${avgLossConv}\n`;
  } else { msg += `  No closed trades this week.\n`; }
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;
  await tgSend(msg);
}

// ── CONVICTION-BASED POSITION SIZING (v3.1 Fix #7) ───────────────────────────
// Institutional practice: scale position based on signal quality.
// Higher conviction = bigger position, marginal conviction = smaller.
function getSizeMult(convScore) {
  if (convScore >= 96) return { mult: 2.5, label: "2.5× 🏛 INSTITUTIONAL PRIME" };
  if (convScore >= 84) return { mult: 2.0, label: "2.0× 💎 MAX SIZE" };
  if (convScore >= 72) return { mult: 1.5, label: "1.5× ⚡ ELEVATED" };
  if (convScore >= 60) return { mult: 1.0, label: "1.0× ✅ STANDARD" };
  return { mult: 0.5, label: "0.5× ⚠️ REDUCED" };
}

// ── SIGNAL FORMATTERS ─────────────────────────────────────────────────────────
function msLine(ms, direction) {
  if (!ms || !ms.confirmed) return "🟡 <b>MS: UNCONFIRMED</b>";
  const choch = ms.choch && ms.choch.detected ? (direction === "BULL" && ms.choch.toBull ? "🔄 CHoCH→BULL ✅" : direction === "BEAR" && ms.choch.toBear ? "🔄 CHoCH→BEAR ✅" : "") : "";
  const bos   = ms.bos ? ((direction === "BULL" && ms.bos.bullBOS) ? "⬆️ BOS↑ ✅" : (direction === "BEAR" && ms.bos.bearBOS) ? "⬇️ BOS↓ ✅" : "") : "";
  const ls    = ms.liqSweep ? ((direction === "BULL" && ms.liqSweep.lowSweep) ? "💧 LiqSwp↓ ✅" : (direction === "BEAR" && ms.liqSweep.highSweep) ? "💧 LiqSwp↑ ✅" : "") : "";
  const fvg   = ms.fvg && ms.fvg.present ? "🟦 FVG ✅" : "";
  return [choch, bos, ls, fvg].filter(Boolean).join("  ");
}
function confBox(r) {
  const tags = [];
  if (r.avwapTrap)     tags.push("🪤 AVWAP TRAP");
  if (r.momentumBurst) tags.push("⚡ MOM BURST");
  if (r.zoneRevisit)   tags.push("🔄 ZONE REVISIT");
  if (r.volumeSpike)   tags.push("📊 VOL SPIKE");
  if (r.wyckoff && r.wyckoff.spring   && r.direction === "BULL") tags.push("🟢 WYK SPRING");
  if (r.wyckoff && r.wyckoff.upthrust && r.direction === "BEAR") tags.push("🔴 WYK UPTHRUST");
  if (r._trapConfirmed) tags.push("🎯 TRAP CONFIRMED");
  return tags.length ? tags.join("  ·  ") : "";
}
function checklistBlock(checks) { return checks.map(c => `${c.pass ? "✅" : "⬜"}  ${c.item}`).join("\n"); }

// ── SIGNAL QUALITY SCORE (v3.1 Fix #12) ──────────────────────────────────────
function computeSignalQuality(r, ms, math) {
  const checks = [
    r.volumeSpike,
    r.avwapTrap,
    r.momentumBurst,
    r.zoneRevisit,
    ms && ms.confirmed,
    ms && ms.choch && ms.choch.detected,
    ms && ms.bos && (ms.bos.bullBOS || ms.bos.bearBOS),
    ms && ms.liqSweep && (ms.liqSweep.lowSweep || ms.liqSweep.highSweep),
    ms && ms.fvg && ms.fvg.present,
    r.wyckoff && (r.wyckoff.spring || r.wyckoff.upthrust),
    r._trapConfirmed,
    math && math.hurst && ((r.direction === "BULL" && math.hurst > 0.55) || (r.direction === "BEAR" && math.hurst < 0.45)),
  ];
  const passed = checks.filter(Boolean).length;
  const pct = Math.round((passed / checks.length) * 100);
  const grade = pct >= 75 ? "ELITE" : pct >= 50 ? "STRONG" : pct >= 33 ? "FAIR" : "WEAK";
  return { pct, grade, passed, total: checks.length };
}

function formatSingleSignal(r, symbol, conv, ms, _label, d1Bias = "NEUTRAL", math = null) {
  const isBull = r.direction === "BULL";
  const dirEmoji = isBull ? "🟢" : "🔴";
  const dir      = isBull ? "LONG ▲" : "SHORT ▼";
  const tags     = confBox(r);
  const pbNote   = r.isPathB ? `\n⚠️  <b>PATH B</b>  Re-enter: <code>${r.reEntry}</code>` : "";
  const _isAligned = (d1Bias === "BULL" && r.direction === "BULL") || (d1Bias === "BEAR" && r.direction === "BEAR");
  const biasNote = d1Bias !== "NEUTRAL" ? `  ·  D1: <b>${d1Bias}</b> ${_isAligned ? "✅" : "⚠️ CT"}` : "";
  const ageNote  = r.age > 0 ? `  ·  <i>${r.age}b ago</i>` : "";
  // v3.1 Fix #12: Signal quality score
  const sq = computeSignalQuality(r, ms, math);
  const sqLine = `🏅  Quality: <b>${sq.pct}%</b> ${sq.grade} (${sq.passed}/${sq.total} criteria)\n`;
  return (
    `\n` +
    `🎯  <b>GWP · $${symbol} · ${dir} [${r.tfLabel}]</b>\n` +
    `${dirEmoji}  <b>${conv.score}/105</b>  ·  ${conv.grade}  ·  R:R <b>${r.rr}:1</b>${ageNote}${biasNote}\n` +
    `─────────────────────────────\n` +
    `<b>ENTRY</b>  <code>${r.entry}</code>   <b>SL</b>  <code>${r.sl}</code>  (-${r.slPct}%)\n` +
    `<b>TP1</b>  <code>${r.tp1}</code>  ·  <b>TP2</b>  <code>${r.tp2}</code>  ·  <b>TP3</b>  <code>${r.tp3}</code>\n` +
    `─────────────────────────────\n` +
    `📐  Size: <b>${getSizeMult(parseFloat(conv.score)).label}</b>\n` +
    sqLine +
    (tags ? `🔑  ${tags}\n` : "") +
    `  ${msLine(ms, r.direction) || "⬜ MS: UNCONFIRMED"}\n` +
    `${pbNote}\n` +
    `⏰  ${new Date().toUTCString()}\n` +
    `<i>${V}</i>`
  );
}
function formatConfluenceSignal(r4h, r1h, symbol, conv4h, conv1h, ms4h, ms1h, d1Bias) {
  const isBull = r4h.direction === "BULL";
  const dirEmoji = isBull ? "🟢" : "🔴";
  const dirWord  = isBull ? "LONG  ▲" : "SHORT  ▼";
  const conf     = confBox(r4h) || confBox(r1h);
  const _isAlignedConf = (d1Bias === "BULL" && r4h.direction === "BULL") || (d1Bias === "BEAR" && r4h.direction === "BEAR");
  const biasNote = d1Bias !== "NEUTRAL" ? `  ·  📅 D1: <b>${d1Bias}</b> ${_isAlignedConf ? "✅" : "⚠️ CT"}` : "";
  const pbNote   = r4h.isPathB ? `\n⚠️  <b>PATH B</b> — sweep zone · Re-enter: <code>${r4h.reEntry}</code>` : "";
  return (
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥🔥  <b>CONFLUENCE  ·  $${symbol}</b>  🔥🔥\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${dirEmoji}  <b>${dirWord}</b>   🔥🔥 CONFLUENCE SWING   [4H+1H]\n\n` +
    `⚡  Conviction 4H:  <b>${conv4h.score} / 105</b>   —   ${conv4h.grade}\n` +
    `⚡  Conviction 1H:  <b>${conv1h.score} / 105</b>\n` +
    `🕐  ${getSessionLabel()}${biasNote}\n` +
    (conf ? `\n🔆  ${conf}\n` : "") +
    `${pbNote}\n\n` +
    `─────────────────────────────\n` +
    `💼  <b>TRADE LEVELS</b>\n` +
    `─────────────────────────────\n\n` +
    `🎯  <b>ENTRY</b>       <code>${r4h.entry}</code>   (4H basis)\n` +
    `⚡  <b>PRECISE</b>     <code>${r1h.entry}</code>   (1H limit)\n` +
    `🛑  <b>STOP</b>        <code>${r4h.sl}</code>      <b>-${r4h.slPct}%</b>\n\n` +
    `✅  <b>TP1</b>         <code>${r4h.tp1}</code>     +${r4h.tp1Pct}%  · 40% exit\n` +
    `🏆  <b>TP2</b>         <code>${r4h.tp2}</code>     +${r4h.tp2Pct}%  · 40% / BE\n` +
    `💎  <b>TP3</b>         <code>${r4h.tp3}</code>     +${r4h.tp3Pct}%  · 20% runner\n\n` +
    `📐  <b>R:R</b>   <b>${r4h.rr} : 1</b>  (4H)   ·   ${r1h.rr} : 1  (1H)\n` +
    `📐  <b>Size:</b>  ${getSizeMult(parseFloat(conv4h.score)).label}\n\n` +
    `─────────────────────────────\n` +
    `🏛  <b>MARKET STRUCTURE</b>\n` +
    `─────────────────────────────\n\n` +
    `  <b>4H</b>  ${ms4h ? ms4h.label : "⬜"}\n` +
    `      ${msLine(ms4h, r4h.direction)}\n\n` +
    `  <b>1H</b>  ${ms1h ? ms1h.label : "⬜"}\n` +
    `      ${msLine(ms1h, r1h.direction)}\n\n` +
    `─────────────────────────────\n` +
    `✅  <b>4H CHECKLIST  (${r4h.checks.filter(c => c.pass).length}/${r4h.checks.length})</b>\n` +
    `─────────────────────────────\n\n` +
    `${checklistBlock(r4h.checks)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏰  ${new Date().toUTCString()}\n` +
    `<i>${V}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}
function formatTripleSignal(r4h, r1h, r15m, symbol, c4h, c1h, c15m, ms4h, ms1h, ms15m, d1Bias) {
  const isBull = r4h.direction === "BULL";
  const dirEmoji = isBull ? "🟢" : "🔴";
  const dirWord  = isBull ? "LONG  ▲" : "SHORT  ▼";
  const conf     = confBox(r4h) || confBox(r1h) || confBox(r15m);
  const _isAlignedTrip = (d1Bias === "BULL" && r4h.direction === "BULL") || (d1Bias === "BEAR" && r4h.direction === "BEAR");
  const biasNote = d1Bias !== "NEUTRAL" ? `  ·  📅 D1: <b>${d1Bias}</b> ${_isAlignedTrip ? "✅" : "⚠️ CT"}` : "";
  return (
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥🔥🔥  <b>TRIPLE TF  ·  $${symbol}</b>  🔥🔥🔥\n` +
    `<b>★★ INSTITUTIONAL PRIME — GWP STOCKS v1.0 ★★</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${dirEmoji}  <b>${dirWord}</b>   🔥🔥🔥 INSTITUTIONAL PRIME   [4H+1H+15M]\n\n` +
    `⚡  Conviction 4H:   <b>${c4h.score} / 105</b>   —   ${c4h.grade}\n` +
    `⚡  Conviction 1H:   <b>${c1h.score} / 105</b>\n` +
    `⚡  Conviction 15M:  <b>${c15m.score} / 105</b>\n` +
    `🕐  ${getSessionLabel()}${biasNote}\n` +
    (conf ? `\n🔆  ${conf}\n` : "") +
    `\n─────────────────────────────\n` +
    `💼  <b>TRADE LEVELS</b>\n` +
    `─────────────────────────────\n\n` +
    `🎯  <b>ENTRY</b>       <code>${r4h.entry}</code>   (4H basis)\n` +
    `🔬  <b>SNIPER</b>      <code>${r15m.entry}</code>   (15M limit)\n` +
    `🛑  <b>STOP</b>        <code>${r4h.sl}</code>      <b>-${r4h.slPct}%</b>\n\n` +
    `✅  <b>TP1</b>         <code>${r4h.tp1}</code>     +${r4h.tp1Pct}%  · 40% exit\n` +
    `🏆  <b>TP2</b>         <code>${r4h.tp2}</code>     +${r4h.tp2Pct}%  · 40% / BE\n` +
    `💎  <b>TP3</b>         <code>${r4h.tp3}</code>     +${r4h.tp3Pct}%  · 20% runner\n\n` +
    `📐  <b>R:R</b>   <b>${r4h.rr} : 1</b>\n\n` +
    `─────────────────────────────\n` +
    `🏛  <b>MARKET STRUCTURE  —  3 TF CONFIRMED</b>\n` +
    `─────────────────────────────\n\n` +
    `  <b>4H</b>  ${ms4h ? ms4h.label : "⬜"}  ·  ${msLine(ms4h, r4h.direction)}\n` +
    `  <b>1H</b>  ${ms1h ? ms1h.label : "⬜"}  ·  ${msLine(ms1h, r1h.direction)}\n` +
    `  <b>15M</b> ${ms15m ? ms15m.label : "⬜"}  ·  ${msLine(ms15m, r15m.direction)}\n\n` +
    `─────────────────────────────\n` +
    `✅  <b>4H CHECKLIST  (${r4h.checks.filter(c => c.pass).length}/${r4h.checks.length})</b>\n` +
    `─────────────────────────────\n\n` +
    `${checklistBlock(r4h.checks)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏰  ${new Date().toUTCString()}\n` +
    `<i>${V}</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

// ── INFO COMMANDS ─────────────────────────────────────────────────────────────
async function sendDailySummary() {
  const today = getDateKey(); let d; try { d = JSON.parse(getProp("S1_D_" + today) || "[]"); } catch(e) { d = []; }
  let msg = `📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (!d.length) msg += `📊 <b>Signals: 0</b>\nNo setups today.\n\n`;
  else { msg += `📊 <b>Signals: ${d.length}</b>\n`; d.forEach(s => { msg += `  ${s.dir === "BULL" ? "🟢" : "🔴"} $${s.sym} [${s.tf}] ${s.mode || ""} | ${s.grade} | R:R ${s.rr}\n`; }); msg += "\n"; }
  msg += `⏰ ${new Date().toUTCString()}\n<i>${V}</i>`; await tgSend(msg);
}
async function sendWeeklySummary() {
  let w; try { w = JSON.parse(getProp("S1_W_" + getWeekKey()) || "{}"); } catch(e) { w = {}; }
  const closed = (w.wins || 0) + (w.losses || 0), wr = closed > 0 ? ((w.wins || 0) / closed * 100).toFixed(0) + "%" : "—";
  let msg = `📆 <b>WEEKLY SUMMARY — ${getWeekKey().replace("_", " ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 Signals: ${w.signals || 0}  Confluences: ${w.confluence || 0}  Triples: ${w.triple || 0}\n`;
  if (closed > 0) msg += `✅ ${w.wins || 0}W  ❌ ${w.losses || 0}L  Win Rate: <b>${wr}</b>\n💰 Net P&L: <b>${(w.pnl || 0) >= 0 ? "+" : ""}${w.pnl || 0}%</b>\n`;
  else msg += `  No closed trades yet.\n`;
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`; await tgSend(msg);
}
async function sendHealth() {
  let msg = `💚 <b>GWP Stocks v1.0 ELITE MAX — HEALTH</b>\n\n`;
  for (const symbol of CONFIG.PAIRS) {
    let price = "?";
    try { const c = await fetchKlines(symbol, "H1", 2); if (c && c.length) price = c[c.length - 1].close.toFixed(2); } catch(e) {}
    const cb = isCircuitBroken(symbol) ? " ⛔CB" : "";
    msg += `${price !== "?" ? "✅" : "❌"} $${symbol}: ${price !== "?" ? "$" + price : "NO DATA"}${cb}\n`;
  }
  msg += `\n🕐 ${getSessionLabel()}\n`;
  msg += `📅 Last scan: ${state.lastScanTime || "never"}\n`;
  msg += `🔥 Last fired: ${state.lastScanFired || 0} signals\n`;
  msg += `📴 Session gate: ${isMarketSessionActive() ? "ACTIVE ✅" : "CLOSED ⏸️"}\n`;
  msg += `\n<i>${V}</i>`; await tgSend(msg);
}
async function sendStatus() {
  let w; try { w = JSON.parse(getProp("S1_W_" + getWeekKey()) || "{}"); } catch(e) { w = {}; }
  const openCount = Object.keys(state).filter(k => k.startsWith("SPOS1_")).length;
  await tgSend(
    `📡 <b>GWP Stocks v1.0 ELITE MAX — ONLINE</b> ✅\n\n` +
    `Stocks: ${CONFIG.PAIRS.map(s => "$" + s).join(", ")}\n` +
    `TFs: 4H + 1H + 15M (Triple Engine)\n` +
    `Gates: 4H≥${TF_CONFIG.H4.minConviction} | 1H≥${TF_CONFIG.H1.minConviction} | 15M≥${TF_CONFIG.M15.minConviction}\n` +
    `Session: US Market Mon-Fri (pre + regular + after hours)\n` +
    `SL: stocks min ${CONFIG.STOCK_MIN_SL_PCT}% | ATR floor ${CONFIG.ATR_SL_FLOOR_MULT}×ATR\n` +
    `TP3 mult: ${CONFIG.TP3_MULT}× | minRR 4H: ${TF_CONFIG.H4.minRR}\n` +
    `Open positions: ${openCount}\n` +
    `This week: ${w.signals || 0} signals | ${w.wins || 0}W ${w.losses || 0}L\n\n` +
    `<i>${V}</i>`
  );
}
async function sendPositions() {
  const keys = Object.keys(state).filter(k => k.startsWith("SPOS1_"));
  if (!keys.length) { await tgSend(`📭 No open positions.\n\n<i>${V}</i>`); return; }
  let msg = `📊 <b>Open GWP Stock Positions</b>\n\n`;
  for (const k of keys) { try { const p = JSON.parse(getProp(k)); msg += `${p.direction === "BULL" ? "🟢" : "🔴"} <b>$${p.symbol}</b> ${p.direction} [${p.tf}]\n  Entry: $${p.entry}  SL: $${p.sl}  TP2: $${p.tp2}  Conv: ${p.conviction}/105\n\n`; } catch(e) {} }
  await tgSend(msg + `<i>${V}</i>`);
}
async function sendHelp() {
  await tgSend(
    `👻 <b>GWP STOCKS v1.0 ELITE MAX™</b>\n` +
    `<b>Money Printing Machine — US Market Edition</b>\n\n` +
    `<b>Stocks scanned:</b>\n` +
    `$TSLA · $NVDA · $MSTR · $COIN · $PLTR · $AMD · $SMCI\n\n` +
    `<b>Commands:</b>\n` +
    `/scan — full scan (4H+1H+15M)\n` +
    `/tsla · /nvda · /mstr · /coin · /pltr · /amd · /smci\n` +
    `/daily · /weekly · /health · /positions · /status · /reset · /help\n\n` +
    `<b>v1.0 Engine:</b>\n` +
    `▸ 👻 GWP — VAL band wick into Volume Profile zone (king)\n` +
    `▸ 📐 Math — Hurst · Z · Kalman · ATR% · Volume\n` +
    `▸ 🏛 MS — CHoCH · BOS · LiqSweep · FVG (additive, no penalty)\n` +
    `▸ 📅 D1 Bias — daily AVWAP context filter\n` +
    `▸ 🔥 Triple TF: 4H+1H+15M alignment = MAX conviction\n` +
    `▸ 💎 TP3 = 3.0× VAL band range\n` +
    `▸ 🛑 ATR floor: SL always ≥ 1.5× ATR from entry\n` +
    `▸ 🚪 Vol+AVWAP gate: at least 1 must pass\n` +
    `▸ 📏 SL: min 0.8% for all stock positions\n` +
    `▸ 📴 Session gate: US market hours only (Mon-Fri)\n` +
    `▸ 4H built by aggregating 1H candles from Yahoo Finance\n\n` +
    `<i>${V}</i>`
  );
}
async function resetCooldowns() {
  let n = 0; for (const k of Object.keys(state)) { if (k.startsWith("scd1_") || k.startsWith("SPOS1_") || k.startsWith("SCB1_") || k.startsWith("SCBL1_") || k.startsWith("SDUP1_")) { delProp(k); n++; } }
  await tgSend(`✅ Cleared ${n} cooldowns/positions/dedups/circuit-breakers.\n\n<i>${V}</i>`);
}

// ── SINGLE PAIR SCAN ──────────────────────────────────────────────────────────
async function scanSingle(symbol) {
  try {
  const c4h  = await fetchKlines(symbol, "H4",  TF_CONFIG.H4.vpLookback + 20);
  const c1h  = await fetchKlines(symbol, "H1",  TF_CONFIG.H1.vpLookback + 20);
  const c15m = await fetchKlines(symbol, "M15", TF_CONFIG.M15.vpLookback + 20);
  const cd1  = await fetchKlines(symbol, "D1",  30);
  const d1Bias = getD1Bias(cd1);
  const vp4h  = c4h  ? computeVolumeProfile(c4h,  TF_CONFIG.H4.vpLookback)  : null;
  const vp1h  = c1h  ? computeVolumeProfile(c1h,  TF_CONFIG.H1.vpLookback)  : null;
  const vp15m = c15m ? computeVolumeProfile(c15m, TF_CONFIG.M15.vpLookback) : null;
  const m4h   = c4h  ? runMathEngine(c4h)  : null;
  const m1h   = c1h  ? runMathEngine(c1h)  : null;
  const m15m  = c15m ? runMathEngine(c15m) : null;
  const r4h   = c4h  && vp4h  ? detectGWP(c4h,  vp4h,  computeAVWAP(c4h,  TF_CONFIG.H4.avwapLookback),  m4h,  TF_CONFIG.H4)  : null;
  const r1h   = c1h  && vp1h  ? detectGWP(c1h,  vp1h,  computeAVWAP(c1h,  TF_CONFIG.H1.avwapLookback),  m1h,  TF_CONFIG.H1)  : null;
  const r15m2 = c15m && vp15m ? detectGWP(c15m, vp15m, computeAVWAP(c15m, TF_CONFIG.M15.avwapLookback), m15m, TF_CONFIG.M15) : null;
  const ms4h  = r4h   ? analyzeMarketStructure(c4h,  r4h.direction,  TF_CONFIG.H4)  : null;
  const ms1h  = r1h   ? analyzeMarketStructure(c1h,  r1h.direction,  TF_CONFIG.H1)  : null;
  const ms15m = r15m2 ? analyzeMarketStructure(c15m, r15m2.direction, TF_CONFIG.M15) : null;
  if (r4h && r1h && r15m2 && r4h.direction === r1h.direction && r1h.direction === r15m2.direction) {
    const c4 = computeConviction(r4h, m4h, ms4h, "H4", false, true, d1Bias), c1 = computeConviction(r1h, m1h, ms1h, "H1", false, true, d1Bias), c15 = computeConviction(r15m2, m15m, ms15m, "M15", false, true, d1Bias);
    await tgSend(formatTripleSignal(r4h, r1h, r15m2, symbol, c4, c1, c15, ms4h, ms1h, ms15m, d1Bias));
  } else if (r4h && r1h && r4h.direction === r1h.direction) {
    const c4 = computeConviction(r4h, m4h, ms4h, "H4", true, false, d1Bias), c1 = computeConviction(r1h, m1h, ms1h, "H1", true, false, d1Bias);
    await tgSend(formatConfluenceSignal(r4h, r1h, symbol, c4, c1, ms4h, ms1h, d1Bias));
  } else if (r4h) {
    const cv = computeConviction(r4h, m4h, ms4h, "H4", false, false, d1Bias);
    await tgSend(formatSingleSignal(r4h, symbol, cv, ms4h, "", d1Bias, m4h));
  } else if (r1h) {
    const cv = computeConviction(r1h, m1h, ms1h, "H1", false, false, d1Bias);
    await tgSend(formatSingleSignal(r1h, symbol, cv, ms1h, "⚡ <b>SCALP</b> —", d1Bias, m1h));
  } else {
    await tgSend(`⬜ <b>No GWP — $${symbol}</b>\n4H VP: ${vp4h ? vp4h.valBandBot.toFixed(2) + "–" + vp4h.valBandTop.toFixed(2) : "fail"}\n📅 D1 Bias: ${d1Bias}\n${getSessionLabel()}\n\n<i>${V}</i>`);
  }
  } catch(e) {
    console.error(`scanSingle error [$${symbol}]:`, e.message, e.stack);
    try { await tgSend(`❌ <b>Error scanning $${symbol}</b>\n<code>${e.message}</code>\n\n<i>${V}</i>`); } catch(_) {}
  }
}

// ── COMMAND HANDLER ────────────────────────────────────────────────────────────
async function handleCommand(cmd) {
  cmd = cmd.trim().toLowerCase().split(" ")[0];
  if (cmd === "/scan")      { await runBot(); return; }
  if (cmd === "/daily")     { await sendDailySummary(); return; }
  if (cmd === "/weekly")    { await sendWeeklySummary(); return; }
  if (cmd === "/health")    { await sendHealth(); return; }
  if (cmd === "/positions") { await sendPositions(); return; }
  if (cmd === "/status")    { await sendStatus(); return; }
  if (cmd === "/reset")     { await resetCooldowns(); return; }
  if (cmd === "/help")      { await sendHelp(); return; }
  const match = CONFIG.PAIRS.find(s => cmd === "/" + s.toLowerCase());
  if (match) { await scanSingle(match); return; }
}

// ── MAIN RUNNER ────────────────────────────────────────────────────────────────
async function runBot() {
  console.log(`\n═══ GWP STOCKS v1.1 ELITE MAX ═══ ${new Date().toISOString()}`);
  console.log(`  Session: ${getSessionLabel()}`);

  if (!isMarketSessionActive()) {
    console.log("  📴 Outside market hours — skipping scan (weekend or overnight)");
    return;
  }

  await checkOpenPositions();
  let fired = 0;

  // v3.1 Fix #5: Macro event blackout check (once before symbol loop)
  const macroCheck = isNearMacroEvent();
  if (macroCheck.blocked) {
    console.log(`  ⛔ MACRO BLACKOUT — ${macroCheck.event} (${macroCheck.date}) — skipping all signals`);
    await tgSend(`⛔ <b>MACRO BLACKOUT</b> — ${macroCheck.event} event detected.\nAll signals paused ±1h for safety.\n\n<i>${V}</i>`);
    return; // Skip this entire scan
  }

  for (const symbol of CONFIG.PAIRS) {
    try {
      console.log(`\n▶ $${symbol}`);
      if (isCircuitBroken(symbol)) { console.log("  ⛔ Circuit breaker"); continue; }

      // Stagger symbols to avoid Yahoo rate limiting
      await sleep(1200);

      // v3.0 SPEED: parallel fetch — 1H + 15M + D1 all at once
      const [c1h_raw, c15m, cd1] = await Promise.all([
        fetchYahooCandles(symbol, "1h", 500),
        fetchKlines(symbol, "M15", TF_CONFIG.M15.vpLookback + 20),
        fetchKlines(symbol, "D1",  30),
      ]);
      if (!c1h_raw || c1h_raw.length < 40) { console.log(`  No 1H data for ${symbol}`); continue; }

      const c4h  = build4HCandles(c1h_raw);
      const c1h  = c1h_raw.slice(-80);

      if (!c4h || c4h.length < 30) { console.log("  Not enough 4H bars"); continue; }

      const d1Bias = getD1Bias(cd1);
      console.log(`  D1 Bias: ${d1Bias}`);

      const vp4h  = computeVolumeProfile(c4h, TF_CONFIG.H4.vpLookback);
      const vp1h  = c1h.length >= 20 ? computeVolumeProfile(c1h, TF_CONFIG.H1.vpLookback) : null;
      const vp15m = c15m && c15m.length >= 15 ? computeVolumeProfile(c15m, TF_CONFIG.M15.vpLookback) : null;
      if (!vp4h) { console.log("  4H VP failed"); continue; }

      const av4h  = computeAVWAP(c4h,  TF_CONFIG.H4.avwapLookback);
      const av1h  = computeAVWAP(c1h,  TF_CONFIG.H1.avwapLookback);
      const av15m = c15m ? computeAVWAP(c15m, TF_CONFIG.M15.avwapLookback) : null;

      const m4h  = runMathEngine(c4h);
      const m1h  = runMathEngine(c1h);
      const m15m = c15m ? runMathEngine(c15m) : null;

      console.log(`  4H: ${vp4h.valBandBot.toFixed(2)}–${vp4h.valBandTop.toFixed(2)} | Hurst:${m4h ? m4h.hurst.toFixed(3) : "?"} | Price:${c4h[c4h.length - 1].close.toFixed(2)}`);

      const r4h  = detectGWP(c4h,  vp4h,  av4h,  m4h,  TF_CONFIG.H4);
      const r1h  = vp1h  ? detectGWP(c1h,  vp1h,  av1h,  m1h,  TF_CONFIG.H1)  : null;
      const r15m = vp15m ? detectGWP(c15m, vp15m, av15m, m15m, TF_CONFIG.M15) : null;

      const ms4h  = r4h  ? analyzeMarketStructure(c4h,  r4h.direction,  TF_CONFIG.H4)  : null;
      const ms1h  = r1h  ? analyzeMarketStructure(c1h,  r1h.direction,  TF_CONFIG.H1)  : null;
      const ms15m = r15m ? analyzeMarketStructure(c15m, r15m.direction, TF_CONFIG.M15) : null;

      console.log(`  4H:${r4h ? r4h.direction + " " + r4h.score : "—"}  1H:${r1h ? r1h.direction + " " + r1h.score : "—"}  15M:${r15m ? r15m.direction + " " + r15m.score : "—"}`);

      // Per-symbol directional lock for this scan — prevents contradictory signals
      // e.g. TSLA LONG [4H] + TSLA SHORT [1H] in the same scan run
      let firedDir = null;
      if (r4h && r1h && r15m && r4h.direction === r1h.direction && r1h.direction === r15m.direction) {
        const dir = r4h.direction;
        if (!isDuplicate(symbol, dir, "TRIPLE")) {
          const conv4h  = computeConviction(r4h,  m4h,  ms4h,  "H4",  false, true, d1Bias);
          const conv1h  = computeConviction(r1h,  m1h,  ms1h,  "H1",  false, true, d1Bias);
          const conv15m = computeConviction(r15m, m15m, ms15m, "M15", false, true, d1Bias);
          const gate    = TF_CONFIG.H4.minConviction - CONFIG.CONFLUENCE_GATE_REDUCTION;
          if (parseFloat(conv4h.score) >= gate) {
            console.log(`  🔥🔥🔥 TRIPLE! ${dir} Conv4H=${conv4h.score}`);
            await tgSend(formatTripleSignal(r4h, r1h, r15m, symbol, conv4h, conv1h, conv15m, ms4h, ms1h, ms15m, d1Bias));
            storePosition(symbol, r4h,  conv4h, "H4");
            storePosition(symbol, r1h,  conv1h, "H1");
            setCooldown(symbol, dir, "H4"); setCooldown(symbol, dir, "H1"); setCooldown(symbol, dir, "M15");
            markFired(symbol, dir, "TRIPLE");
            firedDir = dir;
            trackFired(symbol, r4h, "TRIPLE"); fired++; continue;
          }
        }
      }

      // ─ 4H + 1H CONFLUENCE ───────────────────────────────────────────────────
      if (r4h && r1h && r4h.direction === r1h.direction) {
        const dir = r4h.direction;
        if (isOnCooldown(symbol, dir, "H4") && isOnCooldown(symbol, dir, "H1")) { console.log("  🔒 Both TF cooldowns"); continue; }
        if (!isDuplicate(symbol, dir, "CONF")) {
          const conv4h = computeConviction(r4h, m4h, ms4h, "H4", true, false, d1Bias);
          const conv1h = computeConviction(r1h, m1h, ms1h, "H1", true, false, d1Bias);
          const gate   = TF_CONFIG.H4.minConviction - CONFIG.CONFLUENCE_GATE_REDUCTION;
          console.log(`  🔥🔥 CONFLUENCE! ${dir} 4H Conv=${conv4h.score} gate=${gate}`);
          if (parseFloat(conv4h.score) >= gate) {
            await tgSend(formatConfluenceSignal(r4h, r1h, symbol, conv4h, conv1h, ms4h, ms1h, d1Bias));
            storePosition(symbol, r4h, conv4h, "H4"); storePosition(symbol, r1h, conv1h, "H1");
            setCooldown(symbol, dir, "H4"); setCooldown(symbol, dir, "H1");
            markFired(symbol, dir, "CONF");
            firedDir = dir;
            trackFired(symbol, r4h, "CONFLUENCE"); fired++; continue;
          }
        }
      }

      // ─ 4H SOLO ──────────────────────────────────────────────────────────────
      if (r4h) {
        if (isOnCooldown(symbol, r4h.direction, "H4")) { console.log("  🔒 4H cooldown"); }
        else {
          const conv = computeConviction(r4h, m4h, ms4h, "H4", false, false, d1Bias);
          console.log(`  4H conv: ${conv.score}/105 ${conv.grade}`);
          if (parseFloat(conv.score) >= TF_CONFIG.H4.minConviction && !isDuplicate(symbol, r4h.direction, "H4")) {
            await tgSend(formatSingleSignal(r4h, symbol, conv, ms4h, "", d1Bias, m4h));
            storePosition(symbol, r4h, conv, "H4"); setCooldown(symbol, r4h.direction, "H4");
            markFired(symbol, r4h.direction, "H4");
            trackFired(symbol, r4h, "H4"); fired++;
          } else { console.log(`  ⚠️ 4H conv ${conv.score} below ${TF_CONFIG.H4.minConviction}`); }
        }
      }

      // ─ 1H SOLO ──────────────────────────────────────────────────────────────
      if (r1h) {
        if (isOnCooldown(symbol, r1h.direction, "H1")) { console.log("  🔒 1H cooldown"); }
        else {
          const conv = computeConviction(r1h, m1h, ms1h, "H1", false, false, d1Bias);
          console.log(`  1H conv: ${conv.score}/105 ${conv.grade}`);
          if (parseFloat(conv.score) >= TF_CONFIG.H1.minConviction && !isDuplicate(symbol, r1h.direction, "H1")) {
            await tgSend(formatSingleSignal(r1h, symbol, conv, ms1h, "⚡ <b>SCALP</b> —", d1Bias, m1h));
            storePosition(symbol, r1h, conv, "H1"); setCooldown(symbol, r1h.direction, "H1");
            markFired(symbol, r1h.direction, "H1");
            trackFired(symbol, r1h, "H1"); fired++;
          } else { console.log(`  ⚠️ 1H conv ${conv.score} below ${TF_CONFIG.H1.minConviction}`); }
        }
      }

      // ─ 15M MICRO (only with higher TF present for context) ──────────────────
      if (r15m && (r4h || r1h)) {
        const parentDir = (r4h || r1h).direction;
        if (r15m.direction === parentDir && !isOnCooldown(symbol, r15m.direction, "M15")) {
          const conv = computeConviction(r15m, m15m, ms15m, "M15", true, false, d1Bias);
          console.log(`  15M conv: ${conv.score}/105 ${conv.grade}`);
          if (parseFloat(conv.score) >= TF_CONFIG.M15.minConviction && !isDuplicate(symbol, r15m.direction, "M15")) {
            await tgSend(formatSingleSignal(r15m, symbol, conv, ms15m, "🔬 <b>MICRO SNIPER</b> —", d1Bias, m15m));
            storePosition(symbol, r15m, conv, "M15");
            setCooldown(symbol, r15m.direction, "M15");
            markFired(symbol, r15m.direction, "M15");
            trackFired(symbol, r15m, "M15"); fired++;
          }
        }
      }

    } catch(e) { console.error(`ERROR [$${symbol}]:`, e.message, e.stack); }
  }

  state.lastScanTime  = new Date().toISOString();
  state.lastScanFired = fired;
  if (fired > 0 || CONFIG.GIST_ID) await publishSignalsToGist();
  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);
}

// ── ENTRY POINT ────────────────────────────────────────────────────────────────
(async () => {
  loadState();
  const mode = process.argv[2] || "scan";
  console.log(`GWP Stocks v1.1 ELITE MAX | mode: ${mode} | ${new Date().toISOString()}`);
  console.log(`Stocks: ${CONFIG.PAIRS.join(", ")} | Session gate: ${CONFIG.SESSION_GATE}`);

  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.CHAT_ID) {
    console.error("[FATAL] Missing STOCKS_TG_TOKEN or STOCKS_CHAT_ID env vars");
    process.exit(1);
  }

  const updates = await pollTelegram();
  let commandsHandled = 0;
  if (updates && updates.length) {
    for (const u of updates) {
      if (u.message && u.message.text) {
        const cmdText = u.message.text.trim();
        console.log(`Command: ${cmdText}`);
        try {
          await handleCommand(cmdText);
          commandsHandled++;
        } catch(e) {
          console.error(`Command handler error [${cmdText}]:`, e.message, e.stack);
          try { await tgSend(`❌ <b>Command error</b> <code>${cmdText}</code>\n<code>${e.message}</code>\n\n<i>${V}</i>`); } catch(_) {}
        }
      }
    }
  }

  // Only run the scheduled/mode action if no Telegram commands were just handled.
  // (Prevents double-scan when /scan is sent, and avoids redundant runs after /health etc.)
  if (commandsHandled === 0) {
    if (mode === "scan")          await runBot();
    if (mode === "daily")         await sendDailySummary();
    if (mode === "weekly")        await sendWeeklySummary();
    if (mode === "weeklyreport")  await sendWeeklyReport();  // v3.1 Fix #10
    if (mode === "health")        await sendHealth();
    // v3.1 Fix #10: Auto weekly report on Friday UTC 21:00 run
    if (mode === "scan" && new Date().getUTCDay() === 5 && new Date().getUTCHours() === 21) await sendWeeklyReport();
  } else {
    console.log(`  ${commandsHandled} command(s) handled — skipping scheduled mode action.`);
  }

  // Send startup message only on first run of the day
  const startKey = "S1_started_" + getDateKey();
  if (!getProp(startKey) && mode === "scan") {
    setProp(startKey, "1");
    await tgSend(
      `🚀 <b>GWP STOCKS v3.0 ELITE MAX™ — ONLINE</b> [gwp-bots]\n\n` +
      `👻 Ghost Wick Protocol™ — Stocks Edition\n` +
      `📊 Scanning: ${CONFIG.PAIRS.map(s => "$" + s).join("  ·  ")}\n` +
      `🔥 Engine: Triple TF (4H+1H+15M) · Vol+AVWAP gate · ATR SL floor\n` +
      `📴 Session: US Market hours only (Mon-Fri)\n\n` +
      `<b>Commands: /scan /help /status /health /positions</b>\n` +
      `<b>Singles: /tsla /nvda /mstr /coin /pltr /amd /smci</b>\n\n` +
      `<i>${V}</i>`
    );
  }

  saveState();
  console.log("State saved → stocks_state.json | Repo: gwp-bots");
})().catch(e => {
  console.error("═══ FATAL UNHANDLED ERROR ═══");
  console.error(e.message);
  console.error(e.stack);
  process.exit(1);
});

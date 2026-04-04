"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — ALTCOIN EDITION  v3.0  MONEY PRINTING MACHINE ELITE MAX
// Strategy : Ghost Wick Protocol™ (GWP) + 6-Pillar Math Engine
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Exchange : KuCoin (Public REST API — no auth key needed)
// Pairs    : DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH
// Platform : GitHub Actions (Node.js 20) · state.json persistence
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// v3.0 ELITE MAX UPGRADES:
//   ✅ SMART STALE CHECK  — only kills signal when target (bMid) already hit
//   ✅ ATR-BASED SL       — anchored to full wick HIGH/LOW, not body
//   ✅ PATH B BUFFER      — +30% SL buffer when sweep expected
//   ✅ ADAPTIVE TP        — extends TP1 to bandBot if RR drops below gate
//   ✅ HURST EXPONENT     — detects mean-reverting vs trending regimes
//   ✅ KALMAN FILTER      — fair value + price velocity
//   ✅ Z-SCORE ENGINE     — statistical overbought/oversold extremes
//   ✅ RSI + EMA PILLARS  — multi-timeframe structure confirmation
//   ✅ BAYESIAN CONVICTION— 0–100 score, grade: SUPREME/ELITE/SOLID/VALID
//   ✅ 1H CONFIRMATION    — entry timing on lower timeframe
//   ✅ TP1 / TP2 LEVELS   — partial exit at 50%, full at VAL midpoint
//   ✅ AGE 0/1/2 LOOKBACK — catches setups up to 2 candles ago
//   ✅ CIRCUIT BREAKER    — 3-loss pause per pair
//   ✅ VOLUME FILTER      — 1.2× average required
//   ✅ SESSION FILTER     — blocks dead-zone 01:00–06:00 UTC
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN    : process.env.ALTCOIN_TG_TOKEN || "",
  CHAT_ID           : process.env.ALTCOIN_CHAT_ID  || "",

  PAIRS: ["DEXE-USDT","UNI-USDT","SUSHI-USDT","SOL-USDT","AVAX-USDT","BTC-USDT","ETH-USDT"],

  CAPITAL           : 5,
  RISK_PCT          : 1.5,
  LEVERAGE          : 20,
  MIN_RR            : 2.0,       // minimum R:R to fire (also checked after ATR SL calc)
  MIN_CONVICTION    : 52,        // minimum Bayesian conviction score 0–100

  VP_ROWS           : 24,
  VP_LOOKBACK       : 100,
  MIN_WICK_DEPTH_PCT: 0.15,
  MIN_BODY_GAP_PCT  : 0.10,

  AVWAP_LOOKBACK    : 30,
  AVWAP_PROXIMITY   : 0.004,

  COOLDOWN_HRS      : 4,

  VOLUME_FILTER     : true,
  VOLUME_SPIKE_MULT : 1.2,

  SESSION_FILTER    : true,
  SESSION_DEAD_START: 1,
  SESSION_DEAD_END  : 6,

  CIRCUIT_BREAKER        : true,
  CIRCUIT_BREAKER_LOSSES : 3,
  CIRCUIT_BREAKER_HRS    : 24,
};

const V = "GWP Altcoin v3.0 | Ghost Wick Protocol™ | Asterix.COM | Abdin";

// ── STATE ────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "state.json");
let state = {};
function loadState()  { try { state = JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); } catch(e) { state = {}; } }
function saveState()  { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function getProp(k)   { return state[k] || null; }
function setProp(k,v) { state[k] = v; }
function delProp(k)   { delete state[k]; }

// ── HTTP HELPERS ─────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => res(d));
    }).on("error", rej);
  });
}
function httpPost(hostname, pth, body) {
  return new Promise((res, rej) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path: pth, method: "POST",
      headers: { "Content-Type":"application/json","Content-Length":Buffer.byteLength(payload) }
    }, r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>res(d)); });
    req.on("error", rej);
    req.write(payload); req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TELEGRAM ─────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.CHAT_ID) return;
  try {
    await httpPost("api.telegram.org",
      `/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: CONFIG.CHAT_ID, text, parse_mode: "HTML" }
    );
  } catch(e) { console.error("TG error:", e.message); }
}

async function pollTelegram() {
  if (!CONFIG.TELEGRAM_TOKEN) return null;
  try {
    const offset = getProp("tg_offset") || 0;
    const raw  = await httpGet(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`);
    const json = JSON.parse(raw);
    if (!json.ok || !json.result.length) return null;
    const last = json.result[json.result.length - 1];
    setProp("tg_offset", last.update_id + 1);
    return json.result;
  } catch(e) { console.error("Poll error:", e.message); return null; }
}

// ── KUCOIN DATA ───────────────────────────────────────────────────────────────
const KU_TF = { H4:"4hour", H1:"1hour", M15:"15min", D1:"1day" };

async function fetchKlines(symbol, tf, limit) {
  const url = `https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]||tf}&symbol=${symbol}&limit=${Math.min(limit||150,300)}`;
  try {
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    if (!json.data || json.data.length < 5) return null;
    return json.data.reverse().map(c => ({
      t: parseInt(c[0])*1000, open:parseFloat(c[1]), close:parseFloat(c[2]),
      high:parseFloat(c[3]), low:parseFloat(c[4]), vol:parseFloat(c[5]),
    }));
  } catch(e) { console.error(`KuCoin [${symbol} ${tf}]:`, e.message); return null; }
}

// ── MATH ENGINE ───────────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length < period + 2) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    if (d >= 0) g += d; else l -= d;
  }
  return 100 - 100 / (1 + g / (l || 0.0001));
}

function calcEMA(vals, period) {
  if (vals.length < period) return vals[vals.length-1] || 0;
  const k = 2 / (period + 1);
  let e = vals.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < vals.length; i++) e = vals[i]*k + e*(1-k);
  return e;
}

function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low  - candles[i-1].close)
    ));
  }
  return trs.slice(-period).reduce((a,b) => a+b, 0) / period;
}

function calcHurst(closes) {
  if (closes.length < 20) return 0.5;
  const n = closes.length;
  const rets = [];
  for (let i = 1; i < n; i++) rets.push(Math.log(closes[i] / closes[i-1]));
  const lags = [4, 8, 16].filter(l => l < rets.length - 2);
  if (lags.length < 2) return 0.5;
  const rsVals = lags.map(lag => {
    const chunks = Math.floor(rets.length / lag);
    let rsSum = 0;
    for (let c = 0; c < chunks; c++) {
      const sub  = rets.slice(c*lag, (c+1)*lag);
      const mean = sub.reduce((a,b) => a+b, 0) / sub.length;
      const dem  = sub.map(r => r - mean);
      let cum = 0;
      const cumDev = dem.map(d => (cum += d, cum));
      const R = Math.max(...cumDev) - Math.min(...cumDev);
      const variance = sub.reduce((a,b) => a + b*b, 0) / sub.length - mean*mean;
      const S = Math.sqrt(Math.max(variance, 1e-15));
      rsSum += R / S;
    }
    return rsSum / chunks;
  });
  const logN  = lags.map(l => Math.log(l));
  const logRS = rsVals.map(rs => Math.log(Math.max(rs, 1e-10)));
  const nP    = logN.length;
  const mLN   = logN.reduce((a,b) => a+b) / nP;
  const mLRS  = logRS.reduce((a,b) => a+b) / nP;
  const num   = logN.reduce((a,x,i) => a + (x-mLN)*(logRS[i]-mLRS), 0);
  const den   = logN.reduce((a,x)   => a + (x-mLN)**2, 0);
  return den === 0 ? 0.5 : Math.min(Math.max(num/den, 0.1), 0.9);
}

function calcZScore(closes, period = 20) {
  if (closes.length < period) return { z:0, extremeHigh:false, extremeLow:false };
  const win  = closes.slice(-period);
  const mean = win.reduce((a,b) => a+b, 0) / period;
  const std  = Math.sqrt(win.reduce((a,b) => a+(b-mean)**2, 0) / period);
  const z    = std === 0 ? 0 : (closes[closes.length-1] - mean) / std;
  return { z, extremeHigh: z > 2.0, extremeLow: z < -2.0, mildHigh: z > 1.0, mildLow: z < -1.0 };
}

function kalmanFilter(closes) {
  if (closes.length < 5) return null;
  const Q = 0.01, R = 0.5;
  let x = closes[0], v = 0, P = 1;
  for (let i = 1; i < closes.length; i++) {
    const xP = x + v, PP = P + Q, K = PP / (PP + R);
    x = xP + K * (closes[i] - xP);
    v = v + 0.1 * (closes[i] - x);
    P = (1-K) * PP;
  }
  return { fairValue: x, velocity: v, bullish: v > 0 };
}

function runMathEngine(candles4h) {
  if (!candles4h || candles4h.length < 30) return null;
  const closes = candles4h.map(c => c.close);
  const atr    = calcATR(candles4h, 14);
  const rsi4h  = calcRSI(closes, 14);
  const ema21  = calcEMA(closes, 21);
  const ema55  = calcEMA(closes, 55);
  const hurst  = calcHurst(closes);
  const zScore = calcZScore(closes, 20);
  const kalman = kalmanFilter(closes);
  const cur    = closes[closes.length-1];
  const aboveEma21 = cur > ema21;
  const emaTrend   = ema21 > ema55;
  return { atr, rsi4h, ema21, ema55, hurst, zScore, kalman, aboveEma21, emaTrend, cur };
}

// ── VOLUME PROFILE ────────────────────────────────────────────────────────────
function computeVolumeProfile(candles) {
  const n   = Math.min(CONFIG.VP_LOOKBACK, candles.length);
  const sl  = candles.slice(candles.length - n);
  const hi  = Math.max(...sl.map(c => c.high));
  const lo  = Math.min(...sl.map(c => c.low));
  if (hi <= lo) return null;
  const rows = CONFIG.VP_ROWS, rowH = (hi-lo)/rows;
  const buck = new Array(rows).fill(0);
  sl.forEach(c => {
    for (let r = 0; r < rows; r++) {
      const rB = lo+r*rowH, rT = rB+rowH;
      const ov = Math.min(c.high,rT) - Math.max(c.low,rB);
      if (ov > 0) buck[r] += c.vol * (ov / ((c.high-c.low)||rowH));
    }
  });
  let pocIdx = 0;
  for (let i = 1; i < rows; i++) if (buck[i] > buck[pocIdx]) pocIdx = i;
  const total = buck.reduce((a,b) => a+b, 0);
  let covered = buck[pocIdx], valIdx = pocIdx, vahIdx = pocIdx;
  while (covered < total * 0.70) {
    const up = vahIdx+1 < rows ? buck[vahIdx+1] : 0;
    const dn = valIdx-1 >= 0  ? buck[valIdx-1] : 0;
    if (up >= dn) { vahIdx++; covered += up; } else { valIdx--; covered += dn; }
    if (valIdx <= 0 && vahIdx >= rows-1) break;
  }
  const val = lo + valIdx * rowH;
  return {
    poc: lo + (pocIdx+0.5)*rowH,
    val, vah: lo + (vahIdx+1)*rowH,
    valBandBot: val, valBandTop: val+rowH, valBandMid: val+rowH*0.5,
    rowHeight: rowH, hi, lo,
  };
}

function computeAVWAP(candles) {
  const n  = Math.min(CONFIG.AVWAP_LOOKBACK, candles.length);
  const sl = candles.slice(candles.length - n);
  let tv = 0, v = 0;
  sl.forEach(c => { const tp = (c.high+c.low+c.close)/3; tv += tp*c.vol; v += c.vol; });
  return v > 0 ? tv/v : null;
}

// ── 1H CONFIRMATION ───────────────────────────────────────────────────────────
function check1H(c1h, direction) {
  if (!c1h || c1h.length < 15) return { confirmed: false, reason: "no 1H data" };
  const closes = c1h.map(c => c.close);
  const rsi    = calcRSI(closes, 14);
  const ema9   = calcEMA(closes, 9);
  const ema21  = calcEMA(closes, 21);
  const last   = c1h[c1h.length-1];
  const bullC  = last.close > last.open;
  const bodyPct = Math.abs(last.close - last.open) / last.open * 100;
  if (direction === "BULL") {
    const ok = rsi > 42 && rsi < 78 && (ema9 > ema21 || (bullC && bodyPct > 0.05));
    return { confirmed: ok, rsi: rsi.toFixed(1), ema9va21: ema9 > ema21 };
  }
  if (direction === "BEAR") {
    const ok = rsi < 58 && rsi > 22 && (ema9 < ema21 || (!bullC && bodyPct > 0.05));
    return { confirmed: ok, rsi: rsi.toFixed(1), ema9va21: ema9 < ema21 };
  }
  return { confirmed: false };
}

// ── BAYESIAN CONVICTION SCORER ────────────────────────────────────────────────
function computeConviction(gwp, math, htf1h) {
  let score = 0;

  // GWP pattern quality (max 30)
  const gs = parseFloat(gwp.score);
  score += gs >= 7.5 ? 30 : gs >= 6.5 ? 24 : gs >= 5.5 ? 16 : 8;

  // AVWAP trap (max 12)
  if (gwp.avwapTrap) score += 12;

  // Volume spike (max 6)
  if (gwp.volumeSpike) score += 6;

  // Path A preferred (max 4)
  if (!gwp.isPathB) score += 4;

  if (math) {
    // Hurst < 0.45 = mean-reverting (ideal for GWP) (max 8)
    if (parseFloat(math.hurst) < 0.45) score += 8;
    else if (parseFloat(math.hurst) < 0.55) score += 4;

    // Z-score extreme in GWP direction (max 6)
    const z = math.zScore;
    if (gwp.direction === "BULL" && z.extremeLow)  score += 6;
    if (gwp.direction === "BEAR" && z.extremeHigh) score += 6;
    if (gwp.direction === "BULL" && z.mildLow)     score += 3;
    if (gwp.direction === "BEAR" && z.mildHigh)    score += 3;

    // Kalman velocity against price direction = mean reversion expected (max 6)
    if (math.kalman) {
      const reversing =
        (gwp.direction === "BULL" && !math.kalman.bullish) ||
        (gwp.direction === "BEAR" &&  math.kalman.bullish);
      if (reversing) score += 6;
    }

    // RSI alignment — not overbought for BULL, not oversold for BEAR (max 6)
    if (gwp.direction === "BULL" && math.rsi4h > 40 && math.rsi4h < 70) score += 6;
    if (gwp.direction === "BEAR" && math.rsi4h < 60 && math.rsi4h > 30) score += 6;

    // EMA structure aligned (max 5)
    if (gwp.direction === "BULL" && math.aboveEma21 === false) score += 5; // price below EMA = room to rise
    if (gwp.direction === "BEAR" && math.aboveEma21 === true)  score += 5; // price above EMA = room to fall
  }

  // 1H confirmation (max 7)
  if (htf1h && htf1h.confirmed) score += 7;

  score = Math.min(score, 100);

  const grade =
    score >= 80 ? "⚡ SUPREME★" :
    score >= 70 ? "🔥 ELITE"    :
    score >= 60 ? "✅ SOLID"    :
    score >= 50 ? "📊 VALID"    :
                  "❌ WEAK";

  return { score: score.toFixed(1), grade };
}

// ── VOLUME SPIKE CHECK ────────────────────────────────────────────────────────
function hasVolumeSpike(sigCandle, allCandles, sigIdx) {
  if (!CONFIG.VOLUME_FILTER) return true;
  const start = Math.max(0, sigIdx - 20);
  const vols  = allCandles.slice(start, sigIdx).map(c => c.vol || 0);
  if (!vols.length) return true;
  const avg = vols.reduce((a,b) => a+b, 0) / vols.length;
  return avg === 0 ? true : (sigCandle.vol || 0) >= avg * CONFIG.VOLUME_SPIKE_MULT;
}

// ── ENHANCED GWP DETECTOR ─────────────────────────────────────────────────────
function detectGWP(candles4h, vp, avwap, math) {
  if (!candles4h || candles4h.length < 6 || !vp) return null;

  const n   = candles4h.length;
  const cur = candles4h[n-1];
  const { valBandBot:bBot, valBandTop:bTop, valBandMid:bMid, rowHeight:bH } = vp;
  const minDepth = bH * CONFIG.MIN_WICK_DEPTH_PCT;
  const minGap   = bH * CONFIG.MIN_BODY_GAP_PCT;

  // ATR for SL sizing (v3.0 — anchored to full wick + ATR buffer)
  const atr    = math ? math.atr : bH * 0.5;
  const atrBuf = Math.max(bH * 0.22, atr * 0.45);

  for (let age = 0; age <= 2; age++) {
    const sig    = candles4h[n - 2 - age];
    if (!sig) continue;
    const bodyHi = Math.max(sig.open, sig.close);
    const bodyLo = Math.min(sig.open, sig.close);

    let direction = null, wickDepth = 0, bodyGap = 0;

    // BEAR GWP: wick probes DOWN into band, body closes FAR ABOVE band
    if (sig.low <= bTop - minDepth && sig.low >= bBot * 0.97 && bodyLo >= bTop + minGap) {
      direction = "BEAR";
      wickDepth = bTop - Math.max(sig.low, bBot);
      bodyGap   = bodyLo - bTop;
    }

    // BULL GWP: wick probes UP into band, body closes FAR BELOW band
    if (sig.high >= bBot + minDepth && sig.high <= bTop * 1.03 && bodyHi <= bBot - minGap) {
      direction = "BULL";
      wickDepth = Math.min(sig.high, bTop) - bBot;
      bodyGap   = bBot - bodyHi;
    }

    if (!direction) continue;

    // ── SMART STALE CHECK (v3.0 Fix 1) ─────────────────────────────────────
    // OLD: killed if price entered band at all (too aggressive in trending markets)
    // NEW: only stale if TARGET (bMid) already hit — signal still valid if price
    //      is between entry zone and target
    if (direction === "BEAR" && cur.close <= bMid) {
      console.log(`  GWP BEAR age=${age}: target already hit (cur=${cur.close.toFixed(5)} <= bMid=${bMid.toFixed(5)}) — stale`);
      continue;
    }
    if (direction === "BULL" && cur.close >= bMid) {
      console.log(`  GWP BULL age=${age}: target already hit (cur=${cur.close.toFixed(5)} >= bMid=${bMid.toFixed(5)}) — stale`);
      continue;
    }

    // Volume spike check
    const sigIdx     = n - 2 - age;
    const volumeSpike = hasVolumeSpike(sig, candles4h, sigIdx);
    if (!volumeSpike) {
      console.log(`  GWP ${direction} age=${age}: volume below threshold — filtered`);
      continue;
    }

    // AVWAP trap
    let avwapTrap = false;
    if (avwap) {
      const prox = CONFIG.AVWAP_PROXIMITY;
      avwapTrap =
        Math.abs(sig.high - avwap) / avwap <= prox ||
        Math.abs(sig.low  - avwap) / avwap <= prox;
    }

    // ── ATR-BASED SL (v3.0 Fix 2 — anchored to full wick, not body) ─────────
    const bodyGapPct = (bodyGap / bH) * 100;
    const isPathB    = bodyGapPct < 35;

    let sl;
    if (direction === "BEAR") {
      // SL above the full candle HIGH (wick included) + ATR buffer
      const slBase = sig.high + atrBuf;
      sl = isPathB ? slBase + (slBase - cur.close) * 0.30 : slBase;
    } else {
      // SL below the full candle LOW (wick included) - ATR buffer
      const slBase = sig.low - atrBuf;
      sl = isPathB ? slBase - (cur.close - slBase) * 0.30 : slBase;
    }

    const entry   = cur.close;
    const tp2     = bMid;  // full VAL midpoint
    const tp1Base = direction === "BEAR"
      ? entry - Math.abs(entry - tp2) * 0.5
      : entry + Math.abs(tp2 - entry) * 0.5;

    const risk   = Math.abs(entry - sl);
    if (risk <= 0) continue;

    let tp1 = tp1Base;
    let rr  = Math.abs(entry - tp2) / risk;

    // ── ADAPTIVE TP (v3.0) — extend TP1 if RR drops below gate ─────────────
    if (rr < CONFIG.MIN_RR) {
      // try deeper TP1 = full bandBot (for BEAR) or bandTop (for BULL)
      tp1 = direction === "BEAR" ? bBot : bTop;
      rr  = Math.abs(entry - tp2) / risk;
    }

    if (rr < CONFIG.MIN_RR) {
      console.log(`  GWP ${direction} age=${age}: R:R=${rr.toFixed(2)} still below gate after adaptation — skip`);
      continue;
    }

    // ── CHECKLIST ────────────────────────────────────────────────────────────
    const agePenalty = age * 0.5;
    const checks = [
      { item: `4H candle CLOSED${age>0?` [${age} bars ago]`:""}`, pass: true },
      { item: "Wick penetrated INTO VAL band",               pass: true },
      { item: "Body OUTSIDE band with clear gap ≥10%",       pass: bodyGapPct >= 10 },
      { item: "Wick depth ≥15% of band height",              pass: (wickDepth/bH) >= CONFIG.MIN_WICK_DEPTH_PCT },
      { item: "AVWAP Trap confluence",                        pass: avwapTrap },
      { item: `Volume spike ≥${CONFIG.VOLUME_SPIKE_MULT}×`,  pass: volumeSpike },
      { item: `R:R ≥ ${CONFIG.MIN_RR}:1`,                    pass: rr >= CONFIG.MIN_RR },
      { item: "Target not yet hit (smart stale check)",       pass: true },
    ];
    const rawScore = checks.filter(c => c.pass).length;
    const score    = Math.max(0, rawScore - agePenalty);
    const grade    = score >= 7.5 ? "A+★ SUPREME" : score >= 6.5 ? "A+ ELITE" : score >= 5.5 ? "A SOLID" : "B+ VALID";

    if (score < 5.0) { console.log(`  GWP ${direction} age=${age}: score=${score.toFixed(1)}/8 below threshold`); continue; }

    const dp = n => n < 0.01 ? 6 : n < 1 ? 5 : n < 10 ? 4 : n < 1000 ? 3 : 2;
    const f  = n => Number(n).toFixed(dp(n));
    const path = isPathB ? "B — Sweep + Return ⚠️ (widen SL, prep re-entry)" : "A — Direct Return 🎯 (preferred)";
    const reEntry = isPathB ? f(direction === "BEAR"
      ? entry + Math.abs(entry-sl)*0.8
      : entry - Math.abs(entry-sl)*0.8) : null;

    console.log(`  ✅ GWP FOUND: ${direction} | age=${age} | grade=${grade} | score=${score.toFixed(1)}/8 | R:R=${rr.toFixed(2)}`);

    return {
      direction, grade, score: score.toFixed(1), rawScore, age,
      path, isPathB, volumeSpike, avwapTrap,
      entry: f(entry), sl: f(sl), tp1: f(tp1), tp2: f(tp2),
      rr: rr.toFixed(2),
      slPct:  (Math.abs(entry-sl)/entry*100).toFixed(2),
      tp1Pct: (Math.abs(entry-tp1)/entry*100).toFixed(2),
      tp2Pct: (Math.abs(entry-tp2)/entry*100).toFixed(2),
      wickDepthPct: (wickDepth/bH*100).toFixed(1),
      bodyGapPct: bodyGapPct.toFixed(1),
      avwap: avwap ? f(avwap) : null,
      vp: { val:f(bBot), mid:f(bMid), top:f(bTop), poc:f(vp.poc) },
      checks, reEntry,
      signalTime: new Date(sig.t).toUTCString(),
    };
  }
  return null;
}

// ── SIGNAL FORMATTER ──────────────────────────────────────────────────────────
function formatSignal(r, symbol, conviction, htf1h) {
  const dir   = r.direction === "BULL" ? "🟢 LONG  ▲" : "🔴 SHORT ▼";
  const trap  = r.avwapTrap ? "\n🪤 <b>AVWAP TRAP</b> — liquidity stop-hunt in play" : "";
  const pathB = r.isPathB
    ? `\n⚠️ <b>PATH B</b> — sweep expected. Re-enter near <b>${r.reEntry}</b> after sweep candle closes.` : "";
  const ageNote = r.age > 0 ? `\n⏱ Signal candle: ${r.age} bars ago (${r.signalTime})` : "";
  const htfLine = htf1h
    ? `\n📐 1H Confirm: ${htf1h.confirmed ? "✅" : "❌"} (RSI ${htf1h.rsi})`  : "";
  const convLine = conviction
    ? `\n⚡ Conviction: <b>${conviction.score}/100</b> — ${conviction.grade}` : "";
  const check = r.checks.map((c,i) => `${c.pass?"✅":"⬜"} ${i+1}. ${c.item}`).join("\n");

  const riskUSD = CONFIG.CAPITAL * CONFIG.RISK_PCT / 100;
  const posUSD  = riskUSD * CONFIG.LEVERAGE;

  return (
    `👻 <b>GHOST WICK PROTOCOL — ${symbol.replace("-USDT","")}/USDT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${dir}  |  Grade: <b>${r.grade}</b>  |  ${r.score}/8\n` +
    `${convLine}${ageNote}${htfLine}${trap}\n\n` +
    `🎯 <b>Entry:</b>  <code>${r.entry}</code>\n` +
    `🛑 <b>SL:</b>     <code>${r.sl}</code>  (-${r.slPct}%)  [ATR-based, full wick]\n` +
    `✅ <b>TP1:</b>    <code>${r.tp1}</code>  (${r.direction==="BEAR"?"-":"+"}${r.tp1Pct}% — 50% exit · move SL to BE)\n` +
    `🏆 <b>TP2:</b>    <code>${r.tp2}</code>  (${r.direction==="BEAR"?"-":"+"}${r.tp2Pct}% — VAL Midpoint)\n` +
    `📐 <b>R:R:</b>    ${r.rr}:1\n` +
    `💼 <b>Risk:</b>   $${riskUSD.toFixed(2)} | Pos: $${posUSD.toFixed(0)} (${CONFIG.LEVERAGE}× lev)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>VAL Band</b>\n` +
    `  Band:   <code>${r.vp.val} – ${r.vp.top}</code>\n` +
    `  Target: <code>${r.vp.mid}</code>  ← VAL Midpoint\n` +
    `  POC:    <code>${r.vp.poc}</code>\n` +
    `  Wick depth:   ${r.wickDepthPct}% into band\n` +
    `  Body gap:     ${r.bodyGapPct}% from edge\n` +
    `${r.avwap ? `  AVWAP:  <code>${r.avwap}</code>\n` : ""}` +
    `\n🛤️ Path: <b>${r.path}</b>${pathB}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ <b>GWP Checklist v3.0</b>\n${check}\n\n` +
    `⏰ ${new Date().toUTCString()}\n` +
    `<i>${V}</i>`
  );
}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(symbol, r, conviction) {
  setProp("POS3_" + symbol + "_" + r.direction, JSON.stringify({
    symbol, direction: r.direction,
    entry: parseFloat(r.entry), sl: parseFloat(r.sl),
    tp1: parseFloat(r.tp1), tp2: parseFloat(r.tp2),
    rr: r.rr, grade: r.grade,
    conviction: conviction ? conviction.score : "?",
    isPathB: r.isPathB, reEntry: r.reEntry,
    state: "OPEN", tp1hit: false, ts: Date.now(),
  }));
}

async function checkOpenPositions() {
  const posKeys = Object.keys(state).filter(k => k.startsWith("POS3_"));
  for (const key of posKeys) {
    let p; try { p = JSON.parse(getProp(key)); } catch(e) { continue; }
    if (!p || p.state !== "OPEN") continue;

    const c = await fetchKlines(p.symbol, "M15", 3);
    if (!c || !c.length) continue;
    const price = c[c.length-1].close;
    const isL   = p.direction === "BULL";
    const pnl   = ((isL ? (price-p.entry)/p.entry : (p.entry-price)/p.entry) * 100).toFixed(2);
    const dp    = p.entry < 10 ? 5 : p.entry < 1000 ? 3 : 2;
    const f     = n => Number(n).toFixed(dp);
    let   msg   = null;

    if (!p.tp1hit && (isL ? price >= p.tp1 : price <= p.tp1)) {
      p.tp1hit = true;
      msg = `🎯 <b>GWP TP1 HIT — ${p.symbol.replace("-USDT","")}</b>\n` +
        `Exit 50% · Move SL to breakeven.\n` +
        `Remaining target: <code>${f(p.tp2)}</code> (VAL Midpoint)\n` +
        `P&L so far: <b>+${pnl}%</b>\n\n<i>${V}</i>`;
    }
    if (isL ? price >= p.tp2 : price <= p.tp2) {
      msg = `🏆 <b>GWP TP2 HIT! — ${p.symbol.replace("-USDT","")}</b> 🔥\n\n` +
        `${p.direction}  Entry: ${f(p.entry)} → Target: ${f(p.tp2)}\n` +
        `P&L: <b>+${pnl}%</b>  R:R achieved: ${p.rr}:1\n\n` +
        `<i>Close full position.</i>\n\n<i>${V}</i>`;
      p.state = "CLOSED";
      await trackClose(p.symbol, p.direction, pnl, true);
    }
    if (isL ? price <= p.sl : price >= p.sl) {
      const pathBNote = p.isPathB
        ? `\n⚡ <b>Path B sweep</b> — re-enter near <code>${p.reEntry||"zone"}</code> after sweep candle.` : "";
      msg = `❌ <b>GWP SL HIT — ${p.symbol.replace("-USDT","")}</b>\n\n` +
        `${p.direction}  Entry: ${f(p.entry)} → SL: ${f(p.sl)}\n` +
        `P&L: <b>${pnl}%</b>${pathBNote}\n\n<i>${V}</i>`;
      p.state = "CLOSED";
      await trackClose(p.symbol, p.direction, pnl, false);
    }

    if (msg) {
      await tgSend(msg);
      if (p.state === "CLOSED") delProp(key); else setProp(key, JSON.stringify(p));
    } else {
      setProp(key, JSON.stringify(p));
    }
  }
}

// ── TRACKING ──────────────────────────────────────────────────────────────────
function getDateKey() { return new Date().toISOString().slice(0,10); }
function getWeekKey() {
  const now = new Date(), s = new Date(now.getFullYear(),0,1);
  return now.getFullYear() + "_W" + String(Math.ceil(((now-s)/86400000 + s.getDay()+1)/7)).padStart(2,"0");
}

function trackFired(symbol, r) {
  const dk = "A3_D_" + getDateKey();
  let d; try { d = JSON.parse(getProp(dk)||"[]"); } catch(e) { d = []; }
  d.push({ sym: symbol.replace("-USDT",""), dir: r.direction, grade: r.grade, entry: r.entry, rr: r.rr, ts: Date.now() });
  setProp(dk, JSON.stringify(d));
  const wk = "A3_W_" + getWeekKey();
  let w; try { w = JSON.parse(getProp(wk)||"{}"); } catch(e) { w = {}; }
  w.signals = (w.signals||0) + 1; setProp(wk, JSON.stringify(w));
}

async function trackClose(symbol, direction, pnlPct, isWin) {
  const symS = symbol.replace("-USDT","");
  const wk = "A3_W_" + getWeekKey();
  let w; try { w = JSON.parse(getProp(wk)||"{}"); } catch(e) { w = {}; }
  if (isWin) { w.wins = (w.wins||0)+1; recordWin(symbol); }
  else        { w.losses = (w.losses||0)+1; await recordLoss(symbol); }
  w.pnl = parseFloat(((w.pnl||0) + parseFloat(pnlPct||0)).toFixed(2));
  setProp(wk, JSON.stringify(w));
}

// ── CIRCUIT BREAKER ───────────────────────────────────────────────────────────
function isCircuitBroken(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return false;
  const raw = getProp("CB3_" + symbol);
  if (!raw) return false;
  try {
    const cb = JSON.parse(raw);
    if (Date.now() - cb.ts < CONFIG.CIRCUIT_BREAKER_HRS * 3600000) return true;
    delProp("CB3_" + symbol);
  } catch(e) {}
  return false;
}

async function recordLoss(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return;
  const key = "CBL3_" + symbol;
  const n   = parseInt(getProp(key)||"0") + 1;
  setProp(key, n.toString());
  if (n >= CONFIG.CIRCUIT_BREAKER_LOSSES) {
    setProp("CB3_" + symbol, JSON.stringify({ ts: Date.now(), losses: n }));
    delProp(key);
    await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol.replace("-USDT","")}</b>\n${n} consecutive losses.\n` +
      `Pair paused ${CONFIG.CIRCUIT_BREAKER_HRS}h.\n\n<i>${V}</i>`);
  }
}
function recordWin(symbol) { if (CONFIG.CIRCUIT_BREAKER) delProp("CBL3_" + symbol); }

// ── COOLDOWN ──────────────────────────────────────────────────────────────────
function isOnCooldown(symbol, direction) {
  const last = getProp("cd3_"+symbol+"_"+direction);
  return last && (Date.now()-parseInt(last))/3600000 < CONFIG.COOLDOWN_HRS;
}
function setCooldown(symbol, direction) { setProp("cd3_"+symbol+"_"+direction, Date.now().toString()); }

// ── SESSION FILTER ────────────────────────────────────────────────────────────
function isInSession() {
  if (!CONFIG.SESSION_FILTER) return true;
  const h = new Date().getUTCHours();
  return !(h >= CONFIG.SESSION_DEAD_START && h < CONFIG.SESSION_DEAD_END);
}

// ── DAILY SUMMARY ─────────────────────────────────────────────────────────────
async function sendDailySummary() {
  const today = getDateKey();
  let d; try { d = JSON.parse(getProp("A3_D_"+today)||"[]"); } catch(e) { d = []; }
  const opens = Object.keys(state).filter(k=>k.startsWith("POS3_"))
    .map(k => { try { return JSON.parse(getProp(k)); } catch(e) { return null; } })
    .filter(p => p && p.state === "OPEN");
  let msg = `📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (!d.length) { msg += `📊 <b>Signals: 0</b>\n  No GWP setups today — market not ready.\n\n`; }
  else {
    msg += `📊 <b>Signals: ${d.length}</b>\n`;
    d.forEach(s => {
      const dir = s.dir === "BULL" ? "🟢 LONG" : "🔴 SHORT";
      msg += `  ${dir} ${s.sym} | ${s.grade} | R:R ${s.rr}\n`;
    });
    msg += "\n";
  }
  msg += `📈 <b>Open positions: ${opens.length}</b>\n`;
  for (const p of opens) {
    const c = await fetchKlines(p.symbol, "H1", 2);
    let pnl = "?";
    if (c) {
      const price = c[c.length-1].close;
      const raw = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
      pnl = (parseFloat(raw)>=0?"+":"")+raw+"%";
    }
    msg += `  ${p.direction==="BULL"?"🟢":"🔴"} ${p.symbol.replace("-USDT","")} @ ${p.entry} | P&L: <b>${pnl}</b>\n`;
  }
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;
  await tgSend(msg);
}

async function sendWeeklySummary() {
  let w; try { w = JSON.parse(getProp("A3_W_"+getWeekKey())||"{}"); } catch(e) { w = {}; }
  const closed = (w.wins||0)+(w.losses||0);
  const wr = closed > 0 ? ((w.wins||0)/closed*100).toFixed(0)+"%" : "—";
  let msg = `📆 <b>WEEKLY SUMMARY — ${getWeekKey().replace("_"," ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 Signals: ${w.signals||0}\n`;
  if (closed > 0) msg += `✅ ${w.wins||0}W  ❌ ${w.losses||0}L  |  Win Rate: <b>${wr}</b>\n💰 Net P&L: <b>${(w.pnl||0)>=0?"+":""}${w.pnl||0}%</b>\n`;
  else msg += `  No closed trades yet.\n`;
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;
  await tgSend(msg);
}

// ── STATUS / HEALTH / POSITIONS ────────────────────────────────────────────────
async function sendStatus() {
  let w; try { w = JSON.parse(getProp("A3_W_"+getWeekKey())||"{}"); } catch(e) { w = {}; }
  await tgSend(
    `🤖 <b>GWP Altcoin Bot v3.0 — ONLINE</b> ✅\n\n` +
    `Pairs: ${CONFIG.PAIRS.length} | Min R:R: ${CONFIG.MIN_RR}:1 | Min Conv: ${CONFIG.MIN_CONVICTION}\n` +
    `Cooldown: ${CONFIG.COOLDOWN_HRS}h per direction\n` +
    `Volume filter: ${CONFIG.VOLUME_FILTER?"✅ ON ("+CONFIG.VOLUME_SPIKE_MULT+"× avg)":"OFF"}\n` +
    `Session filter: ✅ ON (dead zone ${CONFIG.SESSION_DEAD_START}:00–${CONFIG.SESSION_DEAD_END}:00 UTC)\n` +
    `Circuit breaker: ✅ ON (${CONFIG.CIRCUIT_BREAKER_LOSSES} losses → ${CONFIG.CIRCUIT_BREAKER_HRS}h pause)\n\n` +
    `This week: ${w.signals||0} signals | ${w.wins||0}W ${w.losses||0}L\n\n` +
    `<i>${V}</i>`
  );
}

async function sendHealth() {
  let msg = `💚 <b>GWP Altcoin v3.0 — HEALTH</b>\n\n`;
  for (const sym of CONFIG.PAIRS) {
    const c  = await fetchKlines(sym, "H1", 2);
    const cb = isCircuitBroken(sym) ? " ⛔CB" : "";
    msg += `${c?"✅":"❌"} ${sym.replace("-USDT","")}${c?" $"+c[c.length-1].close.toFixed(4):": NO DATA"}${cb}\n`;
  }
  msg += `\n🕐 Session: ${isInSession()?"✅ ACTIVE":"💤 Dead zone"} (UTC ${new Date().getUTCHours()}:00)\n\n<i>${V}</i>`;
  await tgSend(msg);
}

async function sendPositions() {
  const keys = Object.keys(state).filter(k => k.startsWith("POS3_"));
  if (!keys.length) { await tgSend(`📭 No open GWP positions.\n\n<i>${V}</i>`); return; }
  let msg = `📊 <b>Open GWP Positions</b>\n\n`;
  for (const k of keys) {
    try {
      const p = JSON.parse(getProp(k));
      const c = await fetchKlines(p.symbol, "H1", 2);
      let pnl = "?";
      if (c) {
        const price = c[c.length-1].close;
        const raw = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
        pnl = (parseFloat(raw)>=0?"+":"")+raw+"%";
      }
      msg += `${p.direction==="BULL"?"🟢":"🔴"} <b>${p.symbol.replace("-USDT","")}</b> ${p.direction}\n`;
      msg += `  Entry: ${p.entry}  SL: ${p.sl}  TP2: ${p.tp2}  Conv: ${p.conviction}/100  Live: ${pnl}\n\n`;
    } catch(e) {}
  }
  await tgSend(msg + `<i>${V}</i>`);
}

async function sendHelp() {
  await tgSend(
    `👻 <b>GWP ALTCOIN BOT v3.0 — MONEY PRINTING MACHINE ELITE MAX</b>\n\n` +
    `<b>Scan:</b>\n/scan — all pairs\n/btc /eth /sol /avax /uni /sushi /dexe — single pair\n\n` +
    `<b>Summaries:</b>\n/daily · /weekly\n\n` +
    `<b>Info:</b>\n/health · /positions · /status · /reset · /help\n\n` +
    `<b>v3.0 Elite Max upgrades:</b>\n` +
    `▸ Smart stale check — signals survive trending markets\n` +
    `▸ ATR-based SL anchored to full wick\n` +
    `▸ Path B +30% sweep buffer\n` +
    `▸ Hurst exponent + Kalman filter + Z-Score\n` +
    `▸ Bayesian conviction score 0–100\n` +
    `▸ 1H entry confirmation\n` +
    `▸ TP1 / TP2 dual-target structure\n\n` +
    `<i>No news. No spam. Pure GWP price action.</i>\n\n<i>${V}</i>`
  );
}

async function resetCooldowns() {
  let n = 0;
  for (const k of Object.keys(state)) {
    if (k.startsWith("cd3_")||k.startsWith("POS3_")||k.startsWith("CB3_")||k.startsWith("CBL3_")) {
      delProp(k); n++;
    }
  }
  await tgSend(`✅ Cleared ${n} cooldowns/positions/circuit-breakers.\n\n<i>${V}</i>`);
}

async function scanSingle(symbol) {
  const c4h = await fetchKlines(symbol, "H4", CONFIG.VP_LOOKBACK + 20);
  if (!c4h) { await tgSend(`❌ No data for ${symbol}`); return; }
  const vp    = computeVolumeProfile(c4h);
  const avwap = computeAVWAP(c4h);
  const math  = runMathEngine(c4h);
  const r     = detectGWP(c4h, vp, avwap, math);
  if (!r) {
    await tgSend(
      `⬜ <b>No GWP — ${symbol.replace("-USDT","")}</b>\n` +
      `Band: ${vp ? vp.valBandBot.toFixed(4)+" – "+vp.valBandTop.toFixed(4) : "VP fail"}\n` +
      `Price: ${c4h ? "$"+c4h[c4h.length-1].close.toFixed(4) : "?"}\n` +
      `RSI 4H: ${math ? math.rsi4h.toFixed(1) : "?"}\n\n<i>${V}</i>`
    );
    return;
  }
  const c1h   = await fetchKlines(symbol, "H1", 30);
  const htf1h = check1H(c1h, r.direction);
  const conv  = computeConviction(r, math, htf1h);
  await tgSend(formatSignal(r, symbol, conv, htf1h));
}

// ── COMMAND HANDLER ───────────────────────────────────────────────────────────
async function handleCommand(cmd) {
  cmd = cmd.trim().toLowerCase().split(" ")[0];
  if (cmd === "/scan")      { await runBot();         return; }
  if (cmd === "/daily")     { await sendDailySummary(); return; }
  if (cmd === "/weekly")    { await sendWeeklySummary(); return; }
  if (cmd === "/health")    { await sendHealth();      return; }
  if (cmd === "/positions") { await sendPositions();   return; }
  if (cmd === "/status")    { await sendStatus();      return; }
  if (cmd === "/reset")     { await resetCooldowns();  return; }
  if (cmd === "/help")      { await sendHelp();        return; }
  if (cmd === "/dexe")      { await scanSingle("DEXE-USDT");  return; }
  if (cmd === "/uni")       { await scanSingle("UNI-USDT");   return; }
  if (cmd === "/sushi")     { await scanSingle("SUSHI-USDT"); return; }
  if (cmd === "/sol")       { await scanSingle("SOL-USDT");   return; }
  if (cmd === "/avax")      { await scanSingle("AVAX-USDT");  return; }
  if (cmd === "/btc")       { await scanSingle("BTC-USDT");   return; }
  if (cmd === "/eth")       { await scanSingle("ETH-USDT");   return; }
}

// ── MAIN RUNNER ───────────────────────────────────────────────────────────────
async function runBot() {
  console.log(`\n═══ GWP ALTCOIN v3.0 ═══ ${new Date().toISOString()}`);

  if (!isInSession()) {
    console.log(`  💤 SESSION FILTER: UTC ${new Date().getUTCHours()}:00 is dead zone — skip scan.`);
    return;
  }

  await checkOpenPositions();
  let fired = 0;

  for (const symbol of CONFIG.PAIRS) {
    try {
      console.log(`\n▶ ${symbol}`);
      if (isCircuitBroken(symbol)) { console.log("  ⛔ Circuit breaker active"); continue; }

      const c4h = await fetchKlines(symbol, "H4", CONFIG.VP_LOOKBACK + 20);
      if (!c4h || c4h.length < 30) { console.log("  No data"); continue; }

      const vp    = computeVolumeProfile(c4h);
      const avwap = computeAVWAP(c4h);
      const math  = runMathEngine(c4h);
      if (!vp) { console.log("  VP failed"); continue; }

      console.log(`  VAL: ${vp.valBandBot.toFixed(5)} – ${vp.valBandTop.toFixed(5)} | AVWAP: ${avwap?avwap.toFixed(5):"N/A"} | RSI: ${math?math.rsi4h.toFixed(1):"?"} | Hurst: ${math?parseFloat(math.hurst).toFixed(3):"?"}`);

      const r = detectGWP(c4h, vp, avwap, math);
      if (!r) { console.log(`  ⬜ No GWP`); continue; }

      if (isOnCooldown(symbol, r.direction)) { console.log(`  🔒 Cooldown (${r.direction})`); continue; }

      const c1h   = await fetchKlines(symbol, "H1", 30);
      const htf1h = check1H(c1h, r.direction);
      const conv  = computeConviction(r, math, htf1h);

      console.log(`  🧠 Conviction: ${conv.score}/100 (${conv.grade})`);

      if (parseFloat(conv.score) < CONFIG.MIN_CONVICTION) {
        console.log(`  ⚠️ Conviction ${conv.score} below gate ${CONFIG.MIN_CONVICTION} — skip`);
        continue;
      }

      console.log(`  🔥 SIGNAL FIRING: ${r.direction} | ${r.grade} | R:R=${r.rr} | Conv=${conv.score}`);

      await tgSend(formatSignal(r, symbol, conv, htf1h));
      storePosition(symbol, r, conv);
      setCooldown(symbol, r.direction);
      trackFired(symbol, r);
      fired++;

    } catch(e) { console.error(`ERROR [${symbol}]:`, e.message); }
  }

  // Update state for web app
  state.openPositions = Object.keys(state).filter(k=>k.startsWith("POS3_"))
    .map(k => { try { return JSON.parse(state[k]); } catch(e) { return null; } })
    .filter(p => p && p.state === "OPEN")
    .map(p => ({ pair:p.symbol.replace("-USDT","/USDT"), direction:p.direction==="BULL"?"LONG":"SHORT",
      entry:String(p.entry), sl:String(p.sl), tp:String(p.tp2),
      conviction:p.conviction, timeframe:"4H", timestamp:new Date(p.ts).toISOString() }));
  state.lastScanTime = new Date().toISOString();

  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
(async () => {
  loadState();
  const mode = process.argv[2] || "scan";
  console.log(`GWP Altcoin v3.0 ELITE MAX | mode: ${mode}`);

  const updates = await pollTelegram();
  if (updates && updates.length) {
    for (const u of updates) {
      if (u.message && u.message.text) {
        console.log(`Command: ${u.message.text}`);
        await handleCommand(u.message.text);
      }
    }
  }

  if (mode === "scan")   await runBot();
  if (mode === "daily")  await sendDailySummary();
  if (mode === "weekly") await sendWeeklySummary();
  if (mode === "health") await sendHealth();

  saveState();
  console.log("State saved.");
})();

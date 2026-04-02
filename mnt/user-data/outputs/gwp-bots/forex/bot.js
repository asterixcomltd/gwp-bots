// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — FOREX & CRYPTO EDITION  v2.2  (GitHub Actions / Node.js)
// Strategy : Ghost Wick Protocol™ (GWP) — Discovered by Abdin / Asterix.COM
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Assets   : BTC (KuCoin) · XAUUSD · EURUSD · GBPUSD (Twelve Data)
// Platform : GitHub Actions (Node.js 20)
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// STATE: Stored in forex/state.json (auto-committed by workflow each run)
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── CONFIG ──────────────────────────────────────────────────────────────────
const CFG = {
  TELEGRAM_BOT_TOKEN : process.env.FOREX_TG_TOKEN   || "",
  TELEGRAM_CHAT_ID   : process.env.FOREX_CHAT_ID    || "",
  TWELVE_DATA_KEY    : process.env.TWELVE_DATA_KEY  || "",
  EMAIL_ALERTS       : !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
  EMAIL_TO           : process.env.EMAIL_TO         || "ao3993600@gmail.com",
  EMAIL_CC           : process.env.EMAIL_CC         || "asterixcomltd@gmail.com",
  EMAIL_USER         : process.env.EMAIL_USER       || "",
  EMAIL_PASS         : process.env.EMAIL_PASS       || "",

  ACCOUNT_USD        : 100,
  RISK_PCT           : 1.5,
  LEVERAGE           : 30,
  MIN_RR             : 2.0,

  VP_ROWS            : 24,
  VP_LOOKBACK        : 100,
  MIN_WICK_DEPTH_PCT : 0.15,
  MIN_BODY_GAP_PCT   : 0.10,
  PATH_B_THRESHOLD   : 0.35,

  AVWAP_LOOKBACK     : 30,
  AVWAP_PROXIMITY    : 0.003,
  TREND_LOOKBACK     : 60,
  COOLDOWN_MINS      : 240,
  SCAN_INTERVAL_MINS : 30,

  VOLUME_FILTER      : true,
  VOLUME_SPIKE_MULT  : 1.2,

  CIRCUIT_BREAKER         : true,
  CIRCUIT_BREAKER_LOSSES  : 3,
  CIRCUIT_BREAKER_HRS     : 24,
};

const PAIRS = [
  { symbol:"BTC",    source:"kucoin", kucoin:"BTC-USDT", twelve:null,      sessionStart:7, sessionEnd:22 },
  { symbol:"XAUUSD", source:"twelve", kucoin:null,       twelve:"XAU/USD",  sessionStart:6, sessionEnd:20 },
  { symbol:"EURUSD", source:"twelve", kucoin:null,       twelve:"EUR/USD",  sessionStart:7, sessionEnd:21 },
  { symbol:"GBPUSD", source:"twelve", kucoin:null,       twelve:"GBP/USD",  sessionStart:7, sessionEnd:21 },
];

const SIG_F = "GWP Forex v2.2 | Ghost Wick Protocol™ | Asterix.COM | Abdin";

// ── STATE ────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "state.json");
let state = {};

function loadState() {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch(e) { state = {}; }
}
function saveState() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function getProp(key) { return state[key] || null; }
function setProp(key, val) { state[key] = val; }
function delProp(key) { delete state[key]; }

// ── HTTP ─────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function httpPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TELEGRAM ─────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CFG.TELEGRAM_BOT_TOKEN || !CFG.TELEGRAM_CHAT_ID) return;
  try {
    await httpPost("api.telegram.org",
      `/bot${CFG.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: CFG.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }
    );
  } catch(e) { console.error("Telegram:", e.message); }
}

async function pollTelegram() {
  if (!CFG.TELEGRAM_BOT_TOKEN) return null;
  try {
    const offset = getProp("tg_offset") || 0;
    const url = `https://api.telegram.org/bot${CFG.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=5`;
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    if (!json.ok || !json.result.length) return null;
    const last = json.result[json.result.length - 1];
    setProp("tg_offset", last.update_id + 1);
    return json.result;
  } catch(e) { console.error("Poll error:", e.message); return null; }
}

// ── EMAIL ────────────────────────────────────────────────────────────────────
async function sendEmail(subject, body) {
  if (!CFG.EMAIL_ALERTS) return;
  try {
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransporter({
      service: "gmail",
      auth: { user: CFG.EMAIL_USER, pass: CFG.EMAIL_PASS }
    });
    await t.sendMail({ from: CFG.EMAIL_USER, to: CFG.EMAIL_TO, cc: CFG.EMAIL_CC, subject, text: body });
  } catch(e) { console.error("Email:", e.message); }
}

// ── DATA — KuCoin ────────────────────────────────────────────────────────────
const KU_TF = { M15:"15min", H1:"1hour", H4:"4hour", D1:"1day" };

async function getCandlesKuCoin(symbol, tf, limit) {
  const url = `https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]||tf}&symbol=${symbol}&limit=${Math.min(limit||150,300)}`;
  try {
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    if (!json.data || json.data.length < 5) return null;
    return json.data.reverse().map(c => ({
      t:parseFloat(c[0])*1000, o:parseFloat(c[1]), c:parseFloat(c[2]),
      h:parseFloat(c[3]), l:parseFloat(c[4]), v:parseFloat(c[5]),
    }));
  } catch(e) { console.error(`KuCoin [${symbol}]:`, e.message); return null; }
}

// ── DATA — Twelve Data ───────────────────────────────────────────────────────
const TD_TF = { M15:"15min", H1:"1h", H4:"4h", D1:"1day" };

async function getCandlesTwelve(symbol, tf, limit) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${TD_TF[tf]||tf}&outputsize=${Math.min(limit||150,500)}` +
    `&apikey=${CFG.TWELVE_DATA_KEY}&order=ASC`;
  try {
    await sleep(2000); // Twelve Data rate limit
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    if (json.status === "error" || !json.values || !json.values.length) {
      console.error(`TwelveData [${symbol}]:`, json.message || "no data"); return null;
    }
    return json.values.map(c => ({
      t: new Date(c.datetime).getTime(),
      o: parseFloat(c.open),  c: parseFloat(c.close),
      h: parseFloat(c.high),  l: parseFloat(c.low),
      v: parseFloat(c.volume || 1000),
    }));
  } catch(e) { console.error(`TwelveData [${symbol}]:`, e.message); return null; }
}

async function getCandles(pair, tf, limit) {
  if (pair.source === "kucoin") return getCandlesKuCoin(pair.kucoin, tf, limit);
  if (pair.source === "twelve") return getCandlesTwelve(pair.twelve, tf, limit);
  return null;
}

// ── VOLUME PROFILE ────────────────────────────────────────────────────────────
function computeVolumeProfile(candles) {
  const n   = Math.min(CFG.VP_LOOKBACK, candles.length);
  const sl  = candles.slice(candles.length - n);
  const hi  = Math.max(...sl.map(c => c.h));
  const lo  = Math.min(...sl.map(c => c.l));
  if (hi <= lo) return null;

  const rows = CFG.VP_ROWS, rowH = (hi - lo) / rows;
  const buck = new Array(rows).fill(0);
  sl.forEach(c => {
    for (let r = 0; r < rows; r++) {
      const rB = lo + r * rowH, rT = rB + rowH;
      const ov = Math.min(c.h, rT) - Math.max(c.l, rB);
      if (ov > 0) buck[r] += c.v * (ov / ((c.h - c.l) || rowH));
    }
  });

  let pocIdx = 0;
  for (let i = 1; i < rows; i++) if (buck[i] > buck[pocIdx]) pocIdx = i;
  const total = buck.reduce((a,b) => a+b, 0);
  let covered = buck[pocIdx], valIdx = pocIdx, vahIdx = pocIdx;
  while (covered < total * 0.70) {
    const up = vahIdx+1 < rows ? buck[vahIdx+1] : 0;
    const dn = valIdx-1 >= 0  ? buck[valIdx-1] : 0;
    if (up >= dn) { vahIdx++; covered += up; }
    else          { valIdx--; covered += dn; }
    if (valIdx <= 0 && vahIdx >= rows-1) break;
  }
  return {
    poc: lo + (pocIdx + 0.5) * rowH,
    vah: lo + (vahIdx + 1) * rowH,
    val: lo + valIdx * rowH,
    valBandBot: lo + valIdx * rowH,
    valBandTop: lo + valIdx * rowH + rowH,
    valBandMid: lo + valIdx * rowH + rowH * 0.5,
    rowHeight: rowH, lo, hi,
  };
}

// ── AVWAP ─────────────────────────────────────────────────────────────────────
function computeAVWAP(candles) {
  const n = Math.min(CFG.AVWAP_LOOKBACK, candles.length);
  const sl = candles.slice(candles.length - n);
  let tv = 0, vol = 0;
  sl.forEach(c => { const tp = (c.h + c.l + c.c) / 3; tv += tp * c.v; vol += c.v; });
  return vol > 0 ? tv / vol : null;
}

// ── TREND ─────────────────────────────────────────────────────────────────────
async function computeTrendBias(pair) {
  const candles = await getCandles(pair, "D1", CFG.TREND_LOOKBACK);
  if (!candles || candles.length < 20) return "NEUTRAL";
  const closes = candles.map(c => c.c);
  const period = Math.min(50, closes.length);
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i]*k + ema*(1-k);
  const last = closes[closes.length-1];
  if (last > ema * 1.003) return "BULL";
  if (last < ema * 0.997) return "BEAR";
  return "NEUTRAL";
}

// ── v2.2 HELPERS ──────────────────────────────────────────────────────────────
function hasVolumeSpike_FX(sigCandle, allCandles, sigIdx) {
  if (!CFG.VOLUME_FILTER) return true;
  let sum = 0, count = 0;
  const start = Math.max(0, sigIdx - 20);
  for (let i = start; i < sigIdx; i++) { sum += (allCandles[i].v || 0); count++; }
  if (count === 0) return true;
  const avg = sum / count;
  if (avg === 0) return true;
  return (sigCandle.v || 0) >= avg * CFG.VOLUME_SPIKE_MULT;
}

function isInSession_FX(pair) {
  const h = new Date().getUTCHours();
  const start = pair.sessionStart !== undefined ? pair.sessionStart : 0;
  const end   = pair.sessionEnd   !== undefined ? pair.sessionEnd   : 24;
  return h >= start && h < end;
}

function isCircuitBroken_FX(pairSymbol) {
  if (!CFG.CIRCUIT_BREAKER) return false;
  const raw = getProp("CBFX2_" + pairSymbol);
  if (!raw) return false;
  try {
    const cb = JSON.parse(raw);
    if (Date.now() - cb.ts < CFG.CIRCUIT_BREAKER_HRS * 3600000) return true;
    delProp("CBFX2_" + pairSymbol);
  } catch(e) {}
  return false;
}

async function recordLossForCircuitBreaker_FX(pairSymbol) {
  if (!CFG.CIRCUIT_BREAKER) return;
  const key = "CBLOSSFX2_" + pairSymbol;
  const losses = parseInt(getProp(key) || "0") + 1;
  setProp(key, losses.toString());
  if (losses >= CFG.CIRCUIT_BREAKER_LOSSES) {
    setProp("CBFX2_" + pairSymbol, JSON.stringify({ ts: Date.now(), losses }));
    delProp(key);
    await tgSend(`⛔ <b>CIRCUIT BREAKER — ${pairSymbol}</b>\n\n${losses} consecutive losses.\nPair paused ${CFG.CIRCUIT_BREAKER_HRS}h.\nResumes: ${new Date(Date.now() + CFG.CIRCUIT_BREAKER_HRS * 3600000).toUTCString()}\n\n<i>${SIG_F}</i>`);
  }
}

function recordWinForCircuitBreaker_FX(pairSymbol) {
  if (!CFG.CIRCUIT_BREAKER) return;
  delProp("CBLOSSFX2_" + pairSymbol);
}

// ── GWP DETECTOR ──────────────────────────────────────────────────────────────
function detectGWP(candles4h, vp, avwap, isForex) {
  if (!candles4h || candles4h.length < 6 || !vp) return null;

  const n   = candles4h.length;
  const cur = candles4h[n - 1];
  const { valBandBot: bBot, valBandTop: bTop, valBandMid: bMid, rowHeight: bH } = vp;
  const minDepth = bH * CFG.MIN_WICK_DEPTH_PCT;
  const minGap   = bH * CFG.MIN_BODY_GAP_PCT;

  const dp = n => isForex ? (n < 10 ? 5 : 4) : (n < 0.01 ? 6 : n < 1 ? 5 : n < 10 ? 4 : n < 1000 ? 2 : 1);
  const f  = n => Number(n).toFixed(dp(n));

  for (let age = 0; age <= 2; age++) {
    const sig = candles4h[n - 2 - age];
    if (!sig) continue;

    const bodyHi = Math.max(sig.o, sig.c);
    const bodyLo = Math.min(sig.o, sig.c);
    let direction = null, wickDepth = 0, bodyGap = 0;

    if (sig.h >= bBot + minDepth && bodyHi <= bBot - minGap) {
      direction = "BULL"; wickDepth = Math.min(sig.h, bTop) - bBot; bodyGap = bBot - bodyHi;
    }
    if (sig.l <= bTop - minDepth && bodyLo >= bTop + minGap) {
      direction = "BEAR"; wickDepth = bTop - Math.max(sig.l, bBot); bodyGap = bodyLo - bTop;
    }
    if (!direction) continue;

    if (direction === "BULL" && cur.c > bBot) { console.log(`  GWP BULL age=${age}: stale`); continue; }
    if (direction === "BEAR" && cur.c < bTop) { console.log(`  GWP BEAR age=${age}: stale`); continue; }

    const sigIdx = n - 2 - age;
    if (!hasVolumeSpike_FX(sig, candles4h, sigIdx)) {
      console.log(`  GWP ${direction} age=${age}: volume below threshold — filtered`);
      continue;
    }

    let avwapTrap = false;
    if (avwap) {
      const prox = CFG.AVWAP_PROXIMITY;
      avwapTrap = Math.abs(sig.h - avwap) / avwap <= prox || Math.abs(sig.l - avwap) / avwap <= prox;
    }

    const slBuf      = isForex ? bH * 0.20 : bH * 0.25;
    const bodyGapPct = (bodyGap / bH) * 100;
    const isPathB    = bodyGapPct < CFG.PATH_B_THRESHOLD * 100;
    const slMult     = isPathB ? 1.8 : 1.0;
    const entry      = cur.c;
    const sl         = direction === "BULL" ? bodyLo - slBuf * slMult : bodyHi + slBuf * slMult;
    const tp2        = bMid;
    const tp1        = direction === "BULL"
      ? entry + Math.abs(tp2 - entry) * 0.5
      : entry - Math.abs(tp2 - entry) * 0.5;

    const risk = Math.abs(entry - sl), reward = Math.abs(entry - tp2);
    if (risk <= 0) continue;
    const rr = reward / risk;
    if (rr < CFG.MIN_RR) { console.log(`  GWP ${direction} age=${age}: R:R=${rr.toFixed(2)} < ${CFG.MIN_RR}`); continue; }

    const path = isPathB ? "B — Sweep + Return (widen SL, prep re-entry)" : "A — Direct Return (preferred)";
    const agePenalty = age * 0.5;
    const checklist = [
      { item: `4H candle CLOSED${age>0?" ["+age+" bars ago]":""}`, pass: true },
      { item: "Wick entered INTO VAL band",   pass: true },
      { item: "Body OUTSIDE band ≥10% gap",  pass: bodyGapPct >= 10 },
      { item: "Wick depth ≥15% of band",     pass: (wickDepth / bH) >= CFG.MIN_WICK_DEPTH_PCT },
      { item: "AVWAP Trap confluence",        pass: avwapTrap },
      { item: `Volume spike ≥${CFG.VOLUME_SPIKE_MULT}× avg [v2.2]`, pass: true },
      { item: `R:R ≥ ${CFG.MIN_RR}:1`,       pass: rr >= CFG.MIN_RR },
      { item: "Price not re-entered band",    pass: true },
    ];
    const rawScore = checklist.filter(c => c.pass).length;
    const score    = Math.max(0, rawScore - agePenalty);
    const grade    = score >= 7.5 ? "A+★ SUPREME"
                   : score >= 6.5 ? "A+ HIGH CONVICTION"
                   : score >= 5.5 ? "A  QUALIFIED"
                   : "B+ BORDERLINE";

    console.log(`  ✅ GWP: ${direction} | age=${age} | ${grade} | score=${score.toFixed(1)} | R:R=${rr.toFixed(2)}`);

    return {
      direction, grade,
      score: score.toFixed(1), rawScore, age,
      path, isPathB,
      entry: f(entry), sl: f(sl), tp1: f(tp1), tp2: f(tp2),
      rr: rr.toFixed(2),
      slPct:  (Math.abs(entry-sl)/entry*100).toFixed(isForex?4:2),
      tp2Pct: (Math.abs(entry-tp2)/entry*100).toFixed(isForex?4:2),
      wickDepPct: (wickDepth/bH*100).toFixed(1),
      bodyGapPct: bodyGapPct.toFixed(1),
      avwapTrap,
      avwap: avwap ? f(avwap) : null,
      vp: { val:f(bBot), mid:f(bMid), top:f(bTop), poc:f(vp.poc) },
      checklist,
      qualified: score >= 5.5,
      signalTime: new Date(sig.t).toUTCString(),
      reEntryTrigger: isPathB ? f(direction === "BULL"
        ? entry - Math.abs(entry-sl)*0.8
        : entry + Math.abs(entry-sl)*0.8) : null,
    };
  }
  return null;
}

// ── SIGNAL FORMATTER ──────────────────────────────────────────────────────────
function formatSignal(r, pairSymbol, trendBias) {
  const dir   = r.direction === "BULL" ? "🟢 LONG  ▲" : "🔴 SHORT ▼";
  const trap  = r.avwapTrap ? "\n🪤 <b>AVWAP TRAP confirmed</b> — dual institutional zone" : "";
  const pathB = r.isPathB
    ? `\n⚠️ <b>PATH B</b> — expect stop-hunt before reversal.\n   Re-entry trigger: <b>${r.reEntryTrigger}</b>` : "";
  const trend  = trendBias !== "NEUTRAL"
    ? `\n📈 1D Trend: <b>${trendBias}</b>${trendBias === r.direction ? " ✅ aligned" : " ⚠️ counter-trend"}` : "";
  const ageNote = r.age > 0 ? `\n⏱ Signal: <b>${r.age} 4H bars ago</b>` : "";
  const check  = r.checklist.map((c,i) => `${c.pass?"✅":"⬜"} ${i+1}. ${c.item}`).join("\n");

  return (
    `👻 <b>GWP — ${pairSymbol}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${dir}  |  Grade: <b>${r.grade}</b>  |  ${r.score}/8\n` +
    `${trend}${ageNote}${trap}\n\n` +
    `🎯 <b>Entry:</b>  <code>${r.entry}</code>\n` +
    `🛑 <b>SL:</b>     <code>${r.sl}</code>  (-${r.slPct}%)\n` +
    `📍 <b>TP1:</b>    <code>${r.tp1}</code>  (50% exit — move SL to BE)\n` +
    `🏆 <b>TP2:</b>    <code>${r.tp2}</code>  (+${r.tp2Pct}% — VAL Midpoint)\n` +
    `📐 <b>R:R:</b>    ${r.rr}:1\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>VAL Band</b>\n` +
    `  Band:   <code>${r.vp.val} – ${r.vp.top}</code>\n` +
    `  Target: <code>${r.vp.mid}</code>  ← VAL Midpoint\n` +
    `  POC:    <code>${r.vp.poc}</code>\n` +
    `  Wick depth:     ${r.wickDepPct}% into band\n` +
    `  Body clearance: ${r.bodyGapPct}% from edge\n` +
    `${r.avwap ? `  AVWAP:  <code>${r.avwap}</code>\n` : ""}` +
    `\n🛤️ Path: <b>${r.path}</b>${pathB}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ <b>GWP Checklist (v2.2)</b>\n${check}\n\n` +
    `⏰ ${new Date().toUTCString()}\n` +
    `<i>${SIG_F}</i>`
  );
}

// ── TRACKING ──────────────────────────────────────────────────────────────────
function getDateKey_FX() { return new Date().toISOString().slice(0, 10); }
function getWeekKey_FX() {
  const now = new Date(), start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return now.getFullYear() + "_W" + String(week).padStart(2, "0");
}

function trackSignalFired_FX(pairSymbol, r) {
  const dKey = "FX_DLOG_" + getDateKey_FX();
  let dLog; try { dLog = JSON.parse(getProp(dKey) || "[]"); } catch(e) { dLog = []; }
  dLog.push({ symbol:pairSymbol, direction:r.direction, grade:r.grade, entry:r.entry, rr:r.rr, ts:Date.now(), result:null, pnl:null });
  setProp(dKey, JSON.stringify(dLog));
  const wKey = "FX_WLOG_" + getWeekKey_FX();
  let wLog; try { wLog = JSON.parse(getProp(wKey) || "{}"); } catch(e) { wLog = {}; }
  wLog.signals = (wLog.signals || 0) + 1;
  setProp(wKey, JSON.stringify(wLog));
}

async function trackPositionClose_FX(pairSymbol, direction, pnlPct, isWin) {
  const dKey = "FX_DLOG_" + getDateKey_FX();
  let dLog; try { dLog = JSON.parse(getProp(dKey) || "[]"); } catch(e) { dLog = []; }
  for (let i = dLog.length - 1; i >= 0; i--) {
    if (dLog[i].symbol === pairSymbol && dLog[i].direction === direction && !dLog[i].result) {
      dLog[i].result = isWin ? "WIN" : "LOSS"; dLog[i].pnl = parseFloat(pnlPct).toFixed(2); break;
    }
  }
  setProp(dKey, JSON.stringify(dLog));
  const wKey = "FX_WLOG_" + getWeekKey_FX();
  let wLog; try { wLog = JSON.parse(getProp(wKey) || "{}"); } catch(e) { wLog = {}; }
  if (isWin) { wLog.wins = (wLog.wins || 0) + 1; recordWinForCircuitBreaker_FX(pairSymbol); }
  else        { wLog.losses = (wLog.losses || 0) + 1; await recordLossForCircuitBreaker_FX(pairSymbol); }
  wLog.totalPnl = parseFloat(((wLog.totalPnl || 0) + parseFloat(pnlPct || 0)).toFixed(2));
  setProp(wKey, JSON.stringify(wLog));
}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(pairSymbol, r) {
  setProp("POSFX2_" + pairSymbol + "_" + r.direction, JSON.stringify({
    symbol:pairSymbol, direction:r.direction,
    entry:parseFloat(r.entry), sl:parseFloat(r.sl),
    tp1:parseFloat(r.tp1), tp2:parseFloat(r.tp2),
    rr:r.rr, state:"OPEN", tp1hit:false,
    isPathB:r.isPathB, reEntry:r.reEntryTrigger, ts:Date.now(),
  }));
}

async function checkOpenPositions() {
  const posKeys = Object.keys(state).filter(k => k.startsWith("POSFX2_"));
  for (const key of posKeys) {
    let p; try { p = JSON.parse(getProp(key)); } catch(e) { continue; }
    if (!p || p.state !== "OPEN") continue;

    const pair = PAIRS.find(pr => pr.symbol === p.symbol);
    if (!pair) continue;

    const c = await getCandles(pair, "M15", 3);
    if (!c || !c.length) continue;
    const price = c[c.length-1].c;
    const isL   = p.direction === "BULL";
    const pnl   = (isL ? (price-p.entry)/p.entry : (p.entry-price)/p.entry) * 100;
    const dp    = p.entry < 10 ? 5 : p.entry < 1000 ? 4 : 2;
    const f     = n => Number(n).toFixed(dp);
    let   msg   = null;

    if (!p.tp1hit && (isL ? price >= p.tp1 : price <= p.tp1)) {
      p.tp1hit = true;
      msg = `🎯 <b>GWP TP1 HIT — ${p.symbol}</b>\nTake 50% profit · Move SL to breakeven\nRemaining: <code>${f(p.tp2)}</code> (VAL Midpoint)\nP&L: <b>+${pnl.toFixed(2)}%</b>\n\n<i>${SIG_F}</i>`;
    }
    if (isL ? price >= p.tp2 : price <= p.tp2) {
      msg = `🏆 <b>GWP VAL MIDPOINT HIT! — ${p.symbol}</b> 🔥\n\n${p.direction}  Entry: ${f(p.entry)} → Target: ${f(p.tp2)}\nP&L: <b>+${pnl.toFixed(2)}%</b>  R:R: ${p.rr}:1\n\n<i>Close full position.</i>\n\n<i>${SIG_F}</i>`;
      p.state = "CLOSED";
      await trackPositionClose_FX(p.symbol, p.direction, pnl.toFixed(2), true);
    }
    if (isL ? price <= p.sl : price >= p.sl) {
      const pbNote = p.isPathB ? `\n⚡ <b>Path B</b> — re-enter near <code>${p.reEntry||"re-entry zone"}</code> after sweep` : "";
      msg = `❌ <b>GWP SL HIT — ${p.symbol}</b>\n\n${p.direction}  Entry: ${f(p.entry)} → SL: ${f(p.sl)}\nP&L: ${pnl.toFixed(2)}%${pbNote}\n\n<i>${SIG_F}</i>`;
      p.state = "CLOSED";
      await trackPositionClose_FX(p.symbol, p.direction, pnl.toFixed(2), false);
    }

    if (msg) {
      await tgSend(msg);
      if (p.state === "CLOSED") delProp(key);
      else setProp(key, JSON.stringify(p));
    } else {
      setProp(key, JSON.stringify(p));
    }
  }
}

// ── COOLDOWN ──────────────────────────────────────────────────────────────────
function isOnCooldown(pairSymbol, direction) {
  const last = getProp("cdfx2_" + pairSymbol + "_" + direction);
  if (!last) return false;
  return (Date.now() - parseInt(last)) / 60000 < CFG.COOLDOWN_MINS;
}
function setCooldown(pairSymbol, direction) {
  setProp("cdfx2_" + pairSymbol + "_" + direction, Date.now().toString());
}

// ── DAILY SUMMARY ─────────────────────────────────────────────────────────────
async function sendDailySummary() {
  const today = getDateKey_FX();
  let dLog; try { dLog = JSON.parse(getProp("FX_DLOG_" + today) || "[]"); } catch(e) { dLog = []; }
  const opens = Object.keys(state).filter(k => k.startsWith("POSFX2_"))
    .map(k => { try { return JSON.parse(getProp(k)); } catch(e) { return null; } })
    .filter(p => p && p.state === "OPEN");

  let msg = `📅 <b>DAILY SUMMARY — ${today} UTC (FOREX)</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (!dLog.length) {
    msg += `📊 <b>Signals today: 0</b>\n  No GWP setups — market not ready.\n\n`;
  } else {
    msg += `📊 <b>Signals today: ${dLog.length}</b>\n`;
    dLog.forEach(s => {
      const dir = s.direction === "BULL" ? "🟢 LONG" : "🔴 SHORT";
      const res = s.result ? (s.result === "WIN" ? ` ✅ +${s.pnl}%` : ` ❌ ${s.pnl}%`) : " 🔄 OPEN";
      msg += `  ${dir} ${s.symbol} | ${s.grade} | R:R ${s.rr}${res}\n`;
    });
    msg += "\n";
  }
  msg += `📈 <b>Open positions: ${opens.length}</b>\n`;
  if (opens.length) {
    for (const p of opens) {
      let pnl = "?";
      try {
        const pair = PAIRS.find(pr => pr.symbol === p.symbol);
        if (pair) {
          const c = await getCandles(pair, "H1", 2);
          if (c) {
            const price = c[c.length-1].c;
            pnl = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
            pnl = (parseFloat(pnl) >= 0 ? "+" : "") + pnl + "%";
          }
        }
      } catch(e) {}
      msg += `  ${p.direction==="BULL"?"🟢":"🔴"} ${p.symbol} ${p.direction} @ ${p.entry} | Live P&L: <b>${pnl}</b>\n`;
    }
  } else { msg += "  No open positions.\n"; }

  msg += "\n🔍 <b>Pair status (live price):</b>\n";
  for (const pair of PAIRS) {
    const c = await getCandles(pair, "H1", 2);
    msg += c ? `  ${pair.symbol}: ${c[c.length-1].c.toFixed(4)}\n`
             : `  ❌ ${pair.symbol}: no data\n`;
  }
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${SIG_F}</i>`;
  await tgSend(msg);
}

// ── WEEKLY SUMMARY ────────────────────────────────────────────────────────────
async function sendWeeklySummary() {
  const wk = getWeekKey_FX();
  let wLog; try { wLog = JSON.parse(getProp("FX_WLOG_" + wk) || "{}"); } catch(e) { wLog = {}; }
  const signals = wLog.signals || 0, wins = wLog.wins || 0, losses = wLog.losses || 0;
  const pnl = wLog.totalPnl || 0, closed = wins + losses;
  const wr  = closed > 0 ? ((wins / closed) * 100).toFixed(0) + "%" : "—";

  let msg = `📆 <b>WEEKLY SUMMARY — ${wk.replace("_", " ")} (FOREX)</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 <b>Signals this week: ${signals}</b>\n`;
  if (closed > 0) {
    msg += `✅ Wins: ${wins}  |  ❌ Losses: ${losses}\n🎯 Win rate: <b>${wr}</b>\n`;
    msg += `💰 Net P&L closed: <b>${pnl >= 0 ? "+" : ""}${pnl}%</b>\n`;
  } else if (signals > 0) {
    msg += `  ${signals} signal(s) open — no closed trades yet.\n`;
  } else {
    msg += "  No GWP signals this week — waiting for the perfect setup.\n";
  }

  msg += "\n🗺 <b>VP distance (are we near the zone?):</b>\n";
  for (const pair of PAIRS) {
    const c = await getCandles(pair, "H4", CFG.VP_LOOKBACK + 20);
    if (!c) { msg += `  ❌ ${pair.symbol}\n`; continue; }
    const vp = computeVolumeProfile(c), cur = c[c.length-1];
    if (vp) {
      const dist = cur.c < vp.valBandBot
        ? ((vp.valBandBot - cur.c) / vp.valBandBot * 100).toFixed(2) + "% below band"
        : cur.c > vp.valBandTop
        ? ((cur.c - vp.valBandTop) / cur.c * 100).toFixed(2) + "% above band"
        : "★ INSIDE band — watching";
      msg += `  ${pair.symbol}: ${dist}\n`;
    }
  }
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${SIG_F}</i>`;
  await tgSend(msg);
}

// ── COMMAND HANDLER ───────────────────────────────────────────────────────────
async function handleCommand(cmd) {
  cmd = cmd.trim().toLowerCase().split(" ")[0];
  if (cmd === "/scan")     { await runBot(); return; }
  if (cmd === "/daily")    { await sendDailySummary(); return; }
  if (cmd === "/weekly")   { await sendWeeklySummary(); return; }
  if (cmd === "/health")   { await sendHealth(); return; }
  if (cmd === "/positions"){ await sendPositions(); return; }
  if (cmd === "/status")   { await sendStatus(); return; }
  if (cmd === "/reset")    { await resetCooldowns(); return; }
  if (cmd === "/help")     { await sendHelp(); return; }
  if (cmd === "/btc")    { await scanSingle(PAIRS[0]); return; }
  if (cmd === "/xauusd") { await scanSingle(PAIRS[1]); return; }
  if (cmd === "/eurusd") { await scanSingle(PAIRS[2]); return; }
  if (cmd === "/gbpusd") { await scanSingle(PAIRS[3]); return; }
}

async function scanSingle(pair) {
  const c = await getCandles(pair, "H4", CFG.VP_LOOKBACK + 20);
  if (!c) { await tgSend(`❌ No data for ${pair.symbol}`); return; }
  const vp = computeVolumeProfile(c), avwap = computeAVWAP(c);
  const r  = detectGWP(c, vp, avwap, pair.source === "twelve");
  if (!r || !r.qualified) {
    await tgSend(`⬜ <b>No GWP — ${pair.symbol}</b>\nBand: ${vp ? vp.valBandBot.toFixed(5)+" – "+vp.valBandTop.toFixed(5) : "VP fail"}\nPrice: ${c ? c[c.length-1].c.toFixed(5) : "?"}\n\n<i>${SIG_F}</i>`);
    return;
  }
  const trend = await computeTrendBias(pair);
  await tgSend(formatSignal(r, pair.symbol, trend));
}

async function sendHealth() {
  let msg = `💚 <b>GWP Forex Bot v2.2 — HEALTH</b>\n\nPair | Price | Session\n`;
  const utcH = new Date().getUTCHours();
  for (const pair of PAIRS) {
    const c = await getCandles(pair, "H1", 2);
    const inSess = (utcH >= pair.sessionStart && utcH < pair.sessionEnd) ? "✅" : "💤";
    const cb = isCircuitBroken_FX(pair.symbol) ? " ⛔CB" : "";
    msg += `${c ? "✅" : "❌"} ${pair.symbol}${c ? ": "+c[c.length-1].c.toFixed(4) : ": NO DATA"} | ${inSess} session${cb}\n`;
  }
  msg += `\n🕐 UTC hour: ${utcH}:00\n`;
  await tgSend(msg + `\n<i>${SIG_F}</i>`);
}

async function sendPositions() {
  const keys = Object.keys(state).filter(k => k.startsWith("POSFX2_"));
  if (!keys.length) { await tgSend(`📭 No open GWP positions.\n\n<i>${SIG_F}</i>`); return; }
  let msg = `📊 <b>Open GWP Positions (Forex)</b>\n\n`;
  for (const k of keys) {
    try {
      const p = JSON.parse(getProp(k));
      let pnl = "?";
      try {
        const pair = PAIRS.find(pr => pr.symbol === p.symbol);
        if (pair) {
          const c = await getCandles(pair, "H1", 2);
          if (c) {
            const price = c[c.length-1].c;
            pnl = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
            pnl = (parseFloat(pnl) >= 0 ? "+" : "") + pnl + "%";
          }
        }
      } catch(e) {}
      msg += `${p.direction==="BULL"?"🟢":"🔴"} <b>${p.symbol}</b> ${p.direction}\n  Entry:${p.entry} SL:${p.sl} TP2:${p.tp2} Live:${pnl}\n\n`;
    } catch(e) {}
  }
  await tgSend(msg + `<i>${SIG_F}</i>`);
}

async function sendStatus() {
  const wk = getWeekKey_FX();
  let wLog; try { wLog = JSON.parse(getProp("FX_WLOG_" + wk) || "{}"); } catch(e) { wLog = {}; }
  await tgSend(
    `🤖 <b>GWP Forex Bot v2.2 — ONLINE</b> ✅\n\n` +
    `Pairs: BTC · XAUUSD · EURUSD · GBPUSD\n` +
    `Min R:R: ${CFG.MIN_RR}:1 | Cooldown: ${CFG.COOLDOWN_MINS}m\n` +
    `Volume filter: ${CFG.VOLUME_FILTER ? "✅ ON ("+CFG.VOLUME_SPIKE_MULT+"× avg)" : "OFF"}\n` +
    `Session filter: ✅ ON (per-pair UTC windows)\n` +
    `Circuit breaker: ${CFG.CIRCUIT_BREAKER ? "✅ ON ("+CFG.CIRCUIT_BREAKER_LOSSES+" losses → "+CFG.CIRCUIT_BREAKER_HRS+"h)" : "OFF"}\n\n` +
    `This week: ${wLog.signals||0} signals | ${wLog.wins||0}W ${wLog.losses||0}L\n\n` +
    `<i>GitHub Actions · Unlimited quota · No monthly keepalive</i>\n\n<i>${SIG_F}</i>`
  );
}

async function sendHelp() {
  await tgSend(
    `👻 <b>GWP FOREX BOT v2.2</b>\n\n` +
    `<b>Scan:</b>\n/scan — all pairs\n/btc /xauusd /eurusd /gbpusd — single pair\n\n` +
    `<b>Summaries:</b>\n/daily · /weekly\n\n` +
    `<b>Info:</b>\n/health · /positions · /status · /reset · /help\n\n` +
    `<i>Running on GitHub Actions · Pure price action · No news spam</i>\n\n<i>${SIG_F}</i>`
  );
}

async function resetCooldowns() {
  let n = 0;
  for (const k of Object.keys(state)) {
    if (k.startsWith("cdfx2_") || k.startsWith("POSFX2_") || k.startsWith("CBFX2_") || k.startsWith("CBLOSSFX2_")) {
      delProp(k); n++;
    }
  }
  await tgSend(`✅ Cleared ${n} cooldowns/positions/circuit-breakers.\n\n<i>${SIG_F}</i>`);
}

// ── MAIN RUNNER ───────────────────────────────────────────────────────────────
async function runBot() {
  console.log(`\n═══ GWP FOREX v2.2 ═══ ${new Date().toISOString()}`);
  await checkOpenPositions();
  let fired = 0;

  for (const pair of PAIRS) {
    try {
      console.log(`\n▶ ${pair.symbol}`);
      if (!isInSession_FX(pair)) {
        console.log(`  💤 SESSION FILTER: ${pair.symbol} inactive at UTC ${new Date().getUTCHours()}:00 (window: ${pair.sessionStart}:00–${pair.sessionEnd}:00)`);
        continue;
      }
      if (isCircuitBroken_FX(pair.symbol)) continue;

      const candles = await getCandles(pair, "H4", CFG.VP_LOOKBACK + 20);
      if (!candles || candles.length < 30) { console.log("  No data"); continue; }

      const isForex = pair.source === "twelve";
      const vp      = computeVolumeProfile(candles);
      const avwap   = computeAVWAP(candles);
      if (!vp) { console.log("  VP failed"); continue; }

      console.log(`  VAL: ${vp.valBandBot.toFixed(5)} – ${vp.valBandTop.toFixed(5)} | AVWAP: ${avwap ? avwap.toFixed(5) : "N/A"}`);

      const r = detectGWP(candles, vp, avwap, isForex);
      if (!r) {
        const sig = candles[candles.length - 2];
        console.log(`  ⬜ No GWP. H=${sig.h.toFixed(5)} L=${sig.l.toFixed(5)} Band=${vp.valBandBot.toFixed(5)}-${vp.valBandTop.toFixed(5)}`);
        continue;
      }
      if (!r.qualified) { console.log(`  ⚠️ score=${r.score} — below threshold`); continue; }
      if (isOnCooldown(pair.symbol, r.direction)) { console.log(`  🔒 Cooldown (${r.direction})`); continue; }

      const trendBias = await computeTrendBias(pair);
      console.log(`  🔥 FIRING: ${r.direction} | ${r.grade} | R:R=${r.rr}`);

      await tgSend(formatSignal(r, pair.symbol, trendBias));
      storePosition(pair.symbol, r);
      setCooldown(pair.symbol, r.direction);
      trackSignalFired_FX(pair.symbol, r);
      fired++;

      if (CFG.EMAIL_ALERTS) {
        await sendEmail(
          `[GWP Forex v2.2] ${pair.symbol} ${r.direction} | ${r.grade}`,
          `GWP Forex v2.2\nPair: ${pair.symbol}\nDir: ${r.direction}\nGrade: ${r.grade}\nScore: ${r.score}\nEntry: ${r.entry}\nSL: ${r.sl}\nTP1: ${r.tp1}\nTP2: ${r.tp2}\nR:R: ${r.rr}`
        );
      }
    } catch(e) { console.error(`ERROR [${pair.symbol}]:`, e.message); }
  }

  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
(async () => {
  loadState();
  const mode = process.argv[2] || "scan";
  console.log(`GWP Forex v2.2 | mode: ${mode}`);

  const updates = await pollTelegram();
  if (updates && updates.length) {
    for (const u of updates) {
      if (u.message && u.message.text) {
        console.log(`Command received: ${u.message.text}`);
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

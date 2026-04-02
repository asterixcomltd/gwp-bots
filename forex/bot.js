// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — ALTCOIN EDITION  v2.2  (GitHub Actions / Node.js)
// Strategy : Ghost Wick Protocol™ (GWP) — Discovered by Abdin / Asterix.COM
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Exchange : KuCoin (Public REST API — no auth key needed)
// Pairs    : DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH
// Platform : GitHub Actions (Node.js 20)
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// STATE: Stored in altcoin/state.json (auto-committed by workflow each run)
// ════════════════════════════════════════════════════════════════════════════

const https  = require("https");
const fs     = require("fs");
const path   = require("path");

// ── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN    : process.env.ALTCOIN_TG_TOKEN  || "",
  CHAT_ID           : process.env.ALTCOIN_CHAT_ID   || "",
  EMAIL_ALERTS      : !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
  EMAIL_TO          : process.env.EMAIL_TO          || "ao3993600@gmail.com",
  EMAIL_CC          : process.env.EMAIL_CC          || "asterixcomltd@gmail.com",
  EMAIL_USER        : process.env.EMAIL_USER        || "",
  EMAIL_PASS        : process.env.EMAIL_PASS        || "",

  PAIRS: ["DEXE-USDT","UNI-USDT","SUSHI-USDT","SOL-USDT","AVAX-USDT","BTC-USDT","ETH-USDT"],

  CAPITAL           : 5,
  RISK_PCT          : 1.5,
  LEVERAGE          : 20,
  MIN_RR            : 2.5,

  VP_ROWS           : 24,
  VP_LOOKBACK       : 100,
  MIN_WICK_DEPTH_PCT: 0.15,
  MIN_BODY_GAP_PCT  : 0.10,
  PATH_B_THRESHOLD  : 0.35,

  AVWAP_LOOKBACK    : 30,
  AVWAP_PROXIMITY   : 0.004,
  TREND_LOOKBACK    : 60,
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

const V = "GWP Altcoin v2.2 | Ghost Wick Protocol™ | Asterix.COM | Abdin";

// ── STATE (replaces PropertiesService) ──────────────────────────────────────
const STATE_FILE = path.join(__dirname, "state.json");
let state = {};

function loadState() {
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch(e) { state = {}; }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getProp(key) { return state[key] || null; }
function setProp(key, val) { state[key] = val; }
function delProp(key) { delete state[key]; }

// ── HTTP helper ──────────────────────────────────────────────────────────────
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

// ── TELEGRAM ────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.CHAT_ID) return;
  try {
    await httpPost("api.telegram.org",
      `/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: CONFIG.CHAT_ID, text, parse_mode: "HTML" }
    );
  } catch(e) { console.error("Telegram error:", e.message); }
}

// Telegram polling — for command handling
async function pollTelegram() {
  if (!CONFIG.TELEGRAM_TOKEN) return null;
  try {
    const offsetKey = "tg_offset";
    const offset = getProp(offsetKey) || 0;
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`;
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    if (!json.ok || !json.result.length) return null;
    const updates = json.result;
    const last = updates[updates.length - 1];
    setProp(offsetKey, last.update_id + 1);
    return updates;
  } catch(e) { console.error("Poll error:", e.message); return null; }
}

// ── EMAIL ────────────────────────────────────────────────────────────────────
async function sendEmail(subject, body) {
  if (!CONFIG.EMAIL_ALERTS) return;
  try {
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransporter({
      service: "gmail",
      auth: { user: CONFIG.EMAIL_USER, pass: CONFIG.EMAIL_PASS }
    });
    await t.sendMail({
      from: CONFIG.EMAIL_USER,
      to: CONFIG.EMAIL_TO,
      cc: CONFIG.EMAIL_CC,
      subject, text: body
    });
  } catch(e) { console.error("Email error:", e.message); }
}

// ── DATA — KuCoin ────────────────────────────────────────────────────────────
const KU_TF = { H4:"4hour", H1:"1hour", M15:"15min", D1:"1day" };

async function fetchKlines(symbol, tf, limit) {
  const url = `https://api.kucoin.com/api/v1/market/candles` +
    `?type=${KU_TF[tf]||tf}&symbol=${symbol}&limit=${Math.min(limit||150,300)}`;
  try {
    const raw  = await httpGet(url);
    const json = JSON.parse(raw);
    if (!json.data || json.data.length < 5) return null;
    return json.data.reverse().map(c => ({
      t    : parseInt(c[0]) * 1000,
      open : parseFloat(c[1]),
      close: parseFloat(c[2]),
      high : parseFloat(c[3]),
      low  : parseFloat(c[4]),
      vol  : parseFloat(c[5]),
    }));
  } catch(e) { console.error(`KuCoin [${symbol} ${tf}]:`, e.message); return null; }
}

// ── VOLUME PROFILE ───────────────────────────────────────────────────────────
function computeVolumeProfile(candles) {
  const n   = Math.min(CONFIG.VP_LOOKBACK, candles.length);
  const sl  = candles.slice(candles.length - n);
  const hi  = Math.max(...sl.map(c => c.high));
  const lo  = Math.min(...sl.map(c => c.low));
  if (hi <= lo) return null;

  const rows = CONFIG.VP_ROWS;
  const rowH = (hi - lo) / rows;
  const buck = new Array(rows).fill(0);

  sl.forEach(c => {
    for (let r = 0; r < rows; r++) {
      const rB = lo + r * rowH, rT = rB + rowH;
      const ov = Math.min(c.high, rT) - Math.max(c.low, rB);
      if (ov > 0) buck[r] += c.vol * (ov / ((c.high - c.low) || rowH));
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

  const val = lo + valIdx * rowH;
  return {
    poc        : lo + (pocIdx + 0.5) * rowH,
    val,
    valBandBot : val,
    valBandTop : val + rowH,
    valBandMid : val + rowH * 0.5,
    rowHeight  : rowH,
    hi, lo,
  };
}

// ── AVWAP ─────────────────────────────────────────────────────────────────────
function computeAVWAP(candles) {
  const n  = Math.min(CONFIG.AVWAP_LOOKBACK, candles.length);
  const sl = candles.slice(candles.length - n);
  let tv = 0, v = 0;
  sl.forEach(c => { const tp = (c.high + c.low + c.close) / 3; tv += tp * c.vol; v += c.vol; });
  return v > 0 ? tv / v : null;
}

// ── TREND ─────────────────────────────────────────────────────────────────────
async function computeTrendBias(symbol) {
  const candles = await fetchKlines(symbol, "D1", CONFIG.TREND_LOOKBACK);
  if (!candles || candles.length < 20) return "NEUTRAL";
  const closes = candles.map(c => c.close);
  const period = Math.min(50, closes.length);
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i]*k + ema*(1-k);
  const last = closes[closes.length - 1];
  if (last > ema * 1.005) return "BULL";
  if (last < ema * 0.995) return "BEAR";
  return "NEUTRAL";
}

// ── v2.2 HELPERS ──────────────────────────────────────────────────────────────
function hasVolumeSpike(sigCandle, allCandles, sigIdx) {
  if (!CONFIG.VOLUME_FILTER) return true;
  let sum = 0, count = 0;
  const start = Math.max(0, sigIdx - 20);
  for (let i = start; i < sigIdx; i++) { sum += (allCandles[i].vol || 0); count++; }
  if (count === 0) return true;
  const avg = sum / count;
  if (avg === 0) return true;
  return (sigCandle.vol || 0) >= avg * CONFIG.VOLUME_SPIKE_MULT;
}

function isInSession() {
  if (!CONFIG.SESSION_FILTER) return true;
  const h = new Date().getUTCHours();
  return !(h >= CONFIG.SESSION_DEAD_START && h < CONFIG.SESSION_DEAD_END);
}

function isCircuitBroken(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return false;
  const raw = getProp("CB2_" + symbol);
  if (!raw) return false;
  try {
    const cb = JSON.parse(raw);
    if (Date.now() - cb.ts < CONFIG.CIRCUIT_BREAKER_HRS * 3600000) return true;
    delProp("CB2_" + symbol);
  } catch(e) {}
  return false;
}

async function recordLossForCircuitBreaker(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return;
  const key = "CBLOSS2_" + symbol;
  const losses = parseInt(getProp(key) || "0") + 1;
  setProp(key, losses.toString());
  if (losses >= CONFIG.CIRCUIT_BREAKER_LOSSES) {
    setProp("CB2_" + symbol, JSON.stringify({ ts: Date.now(), losses }));
    delProp(key);
    await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol.replace("-USDT","")}</b>\n\n` +
      `${losses} consecutive losses detected.\n` +
      `Pair paused for ${CONFIG.CIRCUIT_BREAKER_HRS} hours.\n` +
      `Auto-resumes at ${new Date(Date.now() + CONFIG.CIRCUIT_BREAKER_HRS * 3600000).toUTCString()}\n\n` +
      `<i>${V}</i>`);
  }
}

function recordWinForCircuitBreaker(symbol) {
  if (!CONFIG.CIRCUIT_BREAKER) return;
  delProp("CBLOSS2_" + symbol);
}

// ── GWP DETECTOR ──────────────────────────────────────────────────────────────
function detectGWP(candles4h, vp, avwap) {
  if (!candles4h || candles4h.length < 6 || !vp) return null;

  const n   = candles4h.length;
  const cur = candles4h[n - 1];
  const { valBandBot: bBot, valBandTop: bTop, valBandMid: bMid, rowHeight: bH } = vp;
  const minDepth = bH * CONFIG.MIN_WICK_DEPTH_PCT;
  const minGap   = bH * CONFIG.MIN_BODY_GAP_PCT;

  for (let age = 0; age <= 2; age++) {
    const sig = candles4h[n - 2 - age];
    if (!sig) continue;

    const bodyHi = Math.max(sig.open, sig.close);
    const bodyLo = Math.min(sig.open, sig.close);
    let direction = null, wickDepth = 0, bodyGap = 0;

    if (sig.high >= bBot + minDepth && bodyHi <= bBot - minGap) {
      direction = "BULL"; wickDepth = Math.min(sig.high, bTop) - bBot; bodyGap = bBot - bodyHi;
    }
    if (sig.low <= bTop - minDepth && bodyLo >= bTop + minGap) {
      direction = "BEAR"; wickDepth = bTop - Math.max(sig.low, bBot); bodyGap = bodyLo - bTop;
    }
    if (!direction) continue;

    if (direction === "BULL" && cur.close > bBot) { console.log(`  GWP BULL age=${age}: stale`); continue; }
    if (direction === "BEAR" && cur.close < bTop) { console.log(`  GWP BEAR age=${age}: stale`); continue; }

    const sigIdx = n - 2 - age;
    if (!hasVolumeSpike(sig, candles4h, sigIdx)) {
      console.log(`  GWP ${direction} age=${age}: volume below threshold — filtered`);
      continue;
    }

    let avwapTrap = false;
    if (avwap) {
      const prox = CONFIG.AVWAP_PROXIMITY;
      avwapTrap = Math.abs(sig.high - avwap) / avwap <= prox ||
                  Math.abs(sig.low  - avwap) / avwap <= prox;
    }

    const entry      = cur.close;
    const slBuf      = bH * 0.25;
    const bodyGapPct = (bodyGap / bH) * 100;
    const isPathB    = bodyGapPct < CONFIG.PATH_B_THRESHOLD * 100;
    const sl         = direction === "BULL"
      ? bodyLo - slBuf * (isPathB ? 1.8 : 1.0)
      : bodyHi + slBuf * (isPathB ? 1.8 : 1.0);
    const tp2  = bMid;
    const tp1  = direction === "BULL"
      ? entry + Math.abs(tp2 - entry) * 0.5
      : entry - Math.abs(tp2 - entry) * 0.5;

    const risk   = Math.abs(entry - sl);
    const reward = Math.abs(entry - tp2);
    if (risk <= 0) continue;
    const rr = reward / risk;

    if (rr < CONFIG.MIN_RR) { console.log(`  GWP ${direction} age=${age}: R:R=${rr.toFixed(2)} < ${CONFIG.MIN_RR} — skip`); continue; }

    const path = isPathB ? "B — Sweep + Return (widen SL, prep re-entry)" : "A — Direct Return (preferred, high probability)";
    const agePenalty = age * 0.5;
    const checklist = [
      { item: `4H candle fully CLOSED${age>0?" ["+age+" candles ago]":""}`, pass: true },
      { item: "Wick entered INTO VAL band",             pass: true },
      { item: "Body OUTSIDE band with clear gap ≥10%", pass: bodyGapPct >= 10 },
      { item: "Wick depth ≥15% of band height",        pass: (wickDepth / bH) >= CONFIG.MIN_WICK_DEPTH_PCT },
      { item: "AVWAP Trap confluence",                  pass: avwapTrap },
      { item: `Volume spike ≥${CONFIG.VOLUME_SPIKE_MULT}× avg [v2.2]`, pass: true },
      { item: `R:R ≥ ${CONFIG.MIN_RR}:1 confirmed`,    pass: rr >= CONFIG.MIN_RR },
      { item: "Price not yet re-entered band",          pass: true },
    ];
    const rawScore = checklist.filter(c => c.pass).length;
    const score    = Math.max(0, rawScore - agePenalty);
    const grade    = score >= 7.5 ? "A+★ SUPREME"
                   : score >= 6.5 ? "A+ HIGH CONVICTION"
                   : score >= 5.5 ? "A  QUALIFIED"
                   : "B+ BORDERLINE";

    const dp = n => n < 0.01 ? 6 : n < 1 ? 5 : n < 10 ? 4 : n < 1000 ? 3 : 2;
    const f  = n => Number(n).toFixed(dp(n));

    console.log(`  ✅ GWP FOUND: ${direction} | age=${age} | grade=${grade} | score=${score.toFixed(1)}/8 | R:R=${rr.toFixed(2)}`);

    return {
      direction, grade,
      score      : score.toFixed(1), rawScore, age,
      path, isPathB,
      entry      : f(entry), sl: f(sl), tp1: f(tp1), tp2: f(tp2),
      rr         : rr.toFixed(2),
      slPct      : (Math.abs(entry-sl)/entry*100).toFixed(2),
      tp2Pct     : (Math.abs(entry-tp2)/entry*100).toFixed(2),
      wickDepPct : (wickDepth/bH*100).toFixed(1),
      bodyGapPct : bodyGapPct.toFixed(1),
      avwapTrap,
      avwap      : avwap ? f(avwap) : null,
      vp         : { val:f(bBot), mid:f(bMid), top:f(bTop), poc:f(vp.poc) },
      checklist,
      qualified  : score >= 5.5,
      signalTime : new Date(sig.t).toUTCString(),
      reEntryTrigger: isPathB ? f(direction === "BULL"
        ? entry - Math.abs(entry-sl)*0.8
        : entry + Math.abs(entry-sl)*0.8) : null,
    };
  }
  return null;
}

// ── SIGNAL FORMATTER ──────────────────────────────────────────────────────────
function formatSignal(r, symbol, trendBias) {
  const dir    = r.direction === "BULL" ? "🟢 LONG  ▲" : "🔴 SHORT ▼";
  const trap   = r.avwapTrap ? "\n🪤 <b>AVWAP TRAP confirmed</b> — liquidity stop-hunt in play" : "";
  const pathB  = r.isPathB
    ? `\n⚠️ <b>PATH B</b> — price may sweep stops first.\n   If SL hit: RE-ENTER at <b>${r.reEntryTrigger}</b> after sweep candle closes.` : "";
  const trend  = trendBias !== "NEUTRAL"
    ? `\n📈 1D Trend: <b>${trendBias}</b>${trendBias === r.direction ? " ✅ aligned" : " ⚠️ counter-trend"}` : "";
  const ageNote = r.age > 0 ? `\n⏱ Signal candle: <b>${r.age} 4H bars ago</b> (${r.signalTime})` : "";
  const check  = r.checklist.map((c,i) => `${c.pass?"✅":"⬜"} ${i+1}. ${c.item}`).join("\n");

  return (
    `👻 <b>GHOST WICK PROTOCOL — ${symbol.replace("-USDT","")}/USDT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${dir}  |  Grade: <b>${r.grade}</b>  |  ${r.score}/8\n` +
    `${trend}${ageNote}${trap}\n\n` +
    `🎯 <b>Entry:</b>  <code>${r.entry}</code>\n` +
    `🛑 <b>SL:</b>     <code>${r.sl}</code>  (-${r.slPct}%)\n` +
    `✅ <b>TP1:</b>    <code>${r.tp1}</code>  (50% exit — move SL to BE)\n` +
    `🏆 <b>TP2:</b>    <code>${r.tp2}</code>  (+${r.tp2Pct}% — VAL Midpoint)\n` +
    `📐 <b>R:R:</b>    ${r.rr}:1\n` +
    `💼 <b>Risk:</b>   ${CONFIG.RISK_PCT}% of $${CONFIG.CAPITAL}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>VAL Band</b>\n` +
    `  Band:    <code>${r.vp.val} – ${r.vp.top}</code>\n` +
    `  Target:  <code>${r.vp.mid}</code>  ← VAL Midpoint\n` +
    `  POC:     <code>${r.vp.poc}</code>\n` +
    `  Wick depth:      ${r.wickDepPct}% into band\n` +
    `  Body clearance:  ${r.bodyGapPct}% from edge\n` +
    `${r.avwap ? `  AVWAP:  <code>${r.avwap}</code>\n` : ""}` +
    `\n🛤️ Path: <b>${r.path}</b>${pathB}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ <b>GWP Checklist (v2.2)</b>\n${check}\n\n` +
    `⏰ ${new Date().toUTCString()}\n` +
    `<i>${V}</i>`
  );
}

// ── TRACKING ──────────────────────────────────────────────────────────────────
function getDateKey() { return new Date().toISOString().slice(0, 10); }
function getWeekKey() {
  const now = new Date(), start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return now.getFullYear() + "_W" + String(week).padStart(2, "0");
}

function trackSignalFired(symbol, r) {
  const dKey = "ALT_DLOG_" + getDateKey();
  let dLog; try { dLog = JSON.parse(getProp(dKey) || "[]"); } catch(e) { dLog = []; }
  dLog.push({ symbol: symbol.replace("-USDT",""), direction: r.direction, grade: r.grade,
    entry: r.entry, rr: r.rr, ts: Date.now(), result: null, pnl: null });
  setProp(dKey, JSON.stringify(dLog));
  const wKey = "ALT_WLOG_" + getWeekKey();
  let wLog; try { wLog = JSON.parse(getProp(wKey) || "{}"); } catch(e) { wLog = {}; }
  wLog.signals = (wLog.signals || 0) + 1;
  setProp(wKey, JSON.stringify(wLog));
}

async function trackPositionClose(symbol, direction, pnlPct, isWin) {
  const symShort = symbol.replace("-USDT","");
  const dKey = "ALT_DLOG_" + getDateKey();
  let dLog; try { dLog = JSON.parse(getProp(dKey) || "[]"); } catch(e) { dLog = []; }
  for (let i = dLog.length - 1; i >= 0; i--) {
    if (dLog[i].symbol === symShort && dLog[i].direction === direction && !dLog[i].result) {
      dLog[i].result = isWin ? "WIN" : "LOSS"; dLog[i].pnl = parseFloat(pnlPct).toFixed(2); break;
    }
  }
  setProp(dKey, JSON.stringify(dLog));
  const wKey = "ALT_WLOG_" + getWeekKey();
  let wLog; try { wLog = JSON.parse(getProp(wKey) || "{}"); } catch(e) { wLog = {}; }
  if (isWin) { wLog.wins = (wLog.wins || 0) + 1; recordWinForCircuitBreaker(symbol); }
  else        { wLog.losses = (wLog.losses || 0) + 1; await recordLossForCircuitBreaker(symbol); }
  wLog.totalPnl = parseFloat(((wLog.totalPnl || 0) + parseFloat(pnlPct || 0)).toFixed(2));
  setProp(wKey, JSON.stringify(wLog));
}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(symbol, r) {
  setProp("POS2_" + symbol + "_" + r.direction, JSON.stringify({
    symbol, direction: r.direction,
    entry: parseFloat(r.entry), sl: parseFloat(r.sl),
    tp1: parseFloat(r.tp1), tp2: parseFloat(r.tp2),
    rr: r.rr, state: "OPEN", tp1hit: false,
    isPathB: r.isPathB, reEntry: r.reEntryTrigger,
    ts: Date.now(),
  }));
}

async function checkOpenPositions() {
  const posKeys = Object.keys(state).filter(k => k.startsWith("POS2_"));
  for (const key of posKeys) {
    let p; try { p = JSON.parse(getProp(key)); } catch(e) { continue; }
    if (!p || p.state !== "OPEN") continue;

    const c = await fetchKlines(p.symbol, "M15", 3);
    if (!c || !c.length) continue;
    const price = c[c.length-1].close;
    const isL   = p.direction === "BULL";
    const pnl   = (isL ? (price-p.entry)/p.entry : (p.entry-price)/p.entry) * 100;
    const dp    = p.entry < 10 ? 5 : p.entry < 1000 ? 3 : 2;
    const f     = n => Number(n).toFixed(dp);
    let   msg   = null;

    if (!p.tp1hit && (isL ? price >= p.tp1 : price <= p.tp1)) {
      p.tp1hit = true;
      msg = `🎯 <b>GWP TP1 HIT — ${p.symbol.replace("-USDT","")}</b>\n` +
        `Take 50% profit now · Move SL to breakeven.\n` +
        `Remaining target: <code>${f(p.tp2)}</code> (VAL Midpoint)\n` +
        `P&L so far: <b>+${pnl.toFixed(2)}%</b>\n\n<i>${V}</i>`;
    }
    if (isL ? price >= p.tp2 : price <= p.tp2) {
      msg = `🏆 <b>GWP VAL MIDPOINT HIT! — ${p.symbol.replace("-USDT","")}</b> 🔥\n\n` +
        `${p.direction}  Entry: ${f(p.entry)} → Target: ${f(p.tp2)}\n` +
        `P&L: <b>+${pnl.toFixed(2)}%</b>  R:R: ${p.rr}:1\n\n` +
        `<i>Close full position.</i>\n\n<i>${V}</i>`;
      p.state = "CLOSED";
      await trackPositionClose(p.symbol, p.direction, pnl.toFixed(2), true);
    }
    if (isL ? price <= p.sl : price >= p.sl) {
      const pathBNote = p.isPathB
        ? `\n⚡ <b>Path B sweep</b> — re-enter near <code>${p.reEntry||"re-entry zone"}</code> after sweep candle closes.` : "";
      msg = `❌ <b>GWP SL HIT — ${p.symbol.replace("-USDT","")}</b>\n\n` +
        `${p.direction}  Entry: ${f(p.entry)} → SL: ${f(p.sl)}\n` +
        `P&L: <b>${pnl.toFixed(2)}%</b>${pathBNote}\n\n<i>${V}</i>`;
      p.state = "CLOSED";
      await trackPositionClose(p.symbol, p.direction, pnl.toFixed(2), false);
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
function isOnCooldown(symbol, direction) {
  const last = getProp("cd2_" + symbol + "_" + direction);
  if (!last) return false;
  return (Date.now() - parseInt(last)) / 3600000 < CONFIG.COOLDOWN_HRS;
}
function setCooldown(symbol, direction) {
  setProp("cd2_" + symbol + "_" + direction, Date.now().toString());
}

// ── DAILY SUMMARY ─────────────────────────────────────────────────────────────
async function sendDailySummary() {
  const today = getDateKey();
  let dLog; try { dLog = JSON.parse(getProp("ALT_DLOG_" + today) || "[]"); } catch(e) { dLog = []; }
  const opens = Object.keys(state).filter(k => k.startsWith("POS2_"))
    .map(k => { try { return JSON.parse(getProp(k)); } catch(e) { return null; } })
    .filter(p => p && p.state === "OPEN");

  let msg = `📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (!dLog.length) {
    msg += `📊 <b>Signals today: 0</b>\n  No GWP setups detected — market not ready.\n\n`;
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
        const c = await fetchKlines(p.symbol, "H1", 2);
        if (c) {
          const price = c[c.length-1].close;
          pnl = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
          pnl = (parseFloat(pnl) >= 0 ? "+" : "") + pnl + "%";
        }
      } catch(e) {}
      msg += `  ${p.direction==="BULL"?"🟢":"🔴"} ${p.symbol.replace("-USDT","")} ${p.direction} @ ${p.entry} | Live P&L: <b>${pnl}</b>\n`;
    }
  } else { msg += "  No open positions.\n"; }

  msg += "\n🔍 <b>Pair status (live price):</b>\n";
  for (const sym of CONFIG.PAIRS) {
    const c = await fetchKlines(sym, "H1", 2);
    msg += c ? `  ${sym.replace("-USDT","")}: $${c[c.length-1].close.toFixed(4)}\n`
             : `  ❌ ${sym.replace("-USDT","")}: no data\n`;
  }
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;
  await tgSend(msg);
}

// ── WEEKLY SUMMARY ────────────────────────────────────────────────────────────
async function sendWeeklySummary() {
  const wk = getWeekKey();
  let wLog; try { wLog = JSON.parse(getProp("ALT_WLOG_" + wk) || "{}"); } catch(e) { wLog = {}; }
  const signals = wLog.signals || 0, wins = wLog.wins || 0, losses = wLog.losses || 0;
  const pnl = wLog.totalPnl || 0, closed = wins + losses;
  const wr  = closed > 0 ? ((wins / closed) * 100).toFixed(0) + "%" : "—";

  const opens = Object.keys(state).filter(k => k.startsWith("POS2_"))
    .map(k => { try { return JSON.parse(getProp(k)); } catch(e) { return null; } })
    .filter(p => p && p.state === "OPEN");

  let msg = `📆 <b>WEEKLY SUMMARY — ${wk.replace("_", " ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 <b>Signals this week: ${signals}</b>\n`;
  if (closed > 0) {
    msg += `✅ Wins: ${wins}  |  ❌ Losses: ${losses}\n🎯 Win rate: <b>${wr}</b>\n`;
    msg += `💰 Net P&L closed: <b>${pnl >= 0 ? "+" : ""}${pnl}%</b>\n`;
  } else if (signals > 0) {
    msg += `  ${signals} signal(s) open — no closed trades yet this week.\n`;
  } else {
    msg += "  No GWP signals this week — patience is the position.\n";
  }

  if (opens.length) {
    msg += `\n📈 <b>Open carries: ${opens.length}</b>\n`;
    for (const p of opens) {
      let pnlStr = "?";
      try {
        const c = await fetchKlines(p.symbol, "H1", 2);
        if (c) {
          const price = c[c.length-1].close;
          const raw = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
          pnlStr = (parseFloat(raw) >= 0 ? "+" : "") + raw + "%";
        }
      } catch(e) {}
      msg += `  ${p.direction==="BULL"?"🟢":"🔴"} ${p.symbol.replace("-USDT","")} ${p.direction} | Live: ${pnlStr}\n`;
    }
  }

  msg += "\n🗺 <b>VP distance (are we near the zone?):</b>\n";
  for (const sym of CONFIG.PAIRS) {
    const c = await fetchKlines(sym, "H4", CONFIG.VP_LOOKBACK + 20);
    if (!c) { msg += `  ❌ ${sym.replace("-USDT","")}\n`; continue; }
    const vp = computeVolumeProfile(c);
    const cur = c[c.length-1];
    if (vp) {
      const dist = cur.close < vp.valBandBot
        ? ((vp.valBandBot - cur.close) / vp.valBandBot * 100).toFixed(2) + "% below band"
        : cur.close > vp.valBandTop
        ? ((cur.close - vp.valBandTop) / cur.close * 100).toFixed(2) + "% above band"
        : "★ INSIDE band — watching";
      msg += `  ${sym.replace("-USDT","")}: ${dist}\n`;
    }
  }
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;
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
  if (cmd === "/dexe")  { await scanSingle("DEXE-USDT"); return; }
  if (cmd === "/uni")   { await scanSingle("UNI-USDT"); return; }
  if (cmd === "/sushi") { await scanSingle("SUSHI-USDT"); return; }
  if (cmd === "/sol")   { await scanSingle("SOL-USDT"); return; }
  if (cmd === "/avax")  { await scanSingle("AVAX-USDT"); return; }
  if (cmd === "/btc")   { await scanSingle("BTC-USDT"); return; }
  if (cmd === "/eth")   { await scanSingle("ETH-USDT"); return; }
}

async function scanSingle(symbol) {
  const c = await fetchKlines(symbol, "H4", CONFIG.VP_LOOKBACK + 20);
  if (!c) { await tgSend(`❌ No data for ${symbol}`); return; }
  const vp = computeVolumeProfile(c), avwap = computeAVWAP(c);
  const r  = detectGWP(c, vp, avwap);
  if (!r || !r.qualified) {
    await tgSend(`⬜ <b>No GWP — ${symbol.replace("-USDT","")}</b>\n` +
      `Band: ${vp ? vp.valBandBot.toFixed(4)+" – "+vp.valBandTop.toFixed(4) : "VP fail"}\n` +
      `Price: ${c ? "$"+c[c.length-1].close.toFixed(4) : "?"}\n\n<i>${V}</i>`);
    return;
  }
  const trend = await computeTrendBias(symbol);
  await tgSend(formatSignal(r, symbol, trend));
}

async function sendHealth() {
  let msg = `💚 <b>GWP Altcoin Bot v2.2 — HEALTH</b>\n\n`;
  for (const sym of CONFIG.PAIRS) {
    const c = await fetchKlines(sym, "H1", 2);
    const cb = isCircuitBroken(sym) ? " ⛔CB" : "";
    msg += `${c ? "✅" : "❌"} ${sym.replace("-USDT","")}${c ? ": $"+c[c.length-1].close.toFixed(4) : ": NO DATA"}${cb}\n`;
  }
  msg += `\n🕐 Session: ${isInSession() ? "✅ ACTIVE" : "💤 Dead zone"} (UTC ${new Date().getUTCHours()}:00)\n`;
  await tgSend(msg + `\n<i>${V}</i>`);
}

async function sendPositions() {
  const keys = Object.keys(state).filter(k => k.startsWith("POS2_"));
  if (!keys.length) { await tgSend(`📭 No open GWP positions.\n\n<i>${V}</i>`); return; }
  let msg = `📊 <b>Open GWP Positions</b>\n\n`;
  for (const k of keys) {
    try {
      const p = JSON.parse(getProp(k));
      let pnl = "?";
      try {
        const c = await fetchKlines(p.symbol, "H1", 2);
        if (c) {
          const price = c[c.length-1].close;
          pnl = ((p.direction==="BULL"?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(2);
          pnl = (parseFloat(pnl) >= 0 ? "+" : "") + pnl + "%";
        }
      } catch(e) {}
      msg += `${p.direction==="BULL"?"🟢":"🔴"} <b>${p.symbol.replace("-USDT","")}</b> ${p.direction}\n`;
      msg += `  Entry: ${p.entry}  SL: ${p.sl}  TP2: ${p.tp2}  Live: ${pnl}\n\n`;
    } catch(e) {}
  }
  await tgSend(msg + `<i>${V}</i>`);
}

async function sendStatus() {
  const wk = getWeekKey();
  let wLog; try { wLog = JSON.parse(getProp("ALT_WLOG_" + wk) || "{}"); } catch(e) { wLog = {}; }
  await tgSend(
    `🤖 <b>GWP Altcoin Bot v2.2 — ONLINE</b> ✅\n\n` +
    `Pairs: ${CONFIG.PAIRS.length} | Min R:R: ${CONFIG.MIN_RR}:1\n` +
    `Volume filter: ${CONFIG.VOLUME_FILTER ? "✅ ON ("+CONFIG.VOLUME_SPIKE_MULT+"× avg)" : "OFF"}\n` +
    `Session filter: ${CONFIG.SESSION_FILTER ? "✅ ON (dead zone "+CONFIG.SESSION_DEAD_START+":00–"+CONFIG.SESSION_DEAD_END+":00 UTC)" : "OFF"}\n` +
    `Circuit breaker: ${CONFIG.CIRCUIT_BREAKER ? "✅ ON ("+CONFIG.CIRCUIT_BREAKER_LOSSES+" losses → "+CONFIG.CIRCUIT_BREAKER_HRS+"h pause)" : "OFF"}\n\n` +
    `This week: ${wLog.signals||0} signals | ${wLog.wins||0}W ${wLog.losses||0}L\n\n` +
    `<i>GitHub Actions · Unlimited quota · No monthly keepalive</i>\n\n<i>${V}</i>`
  );
}

async function sendHelp() {
  await tgSend(
    `👻 <b>GWP ALTCOIN BOT v2.2</b>\n\n` +
    `<b>Scan:</b>\n/scan — all pairs\n/btc /eth /sol /avax /uni /sushi /dexe — single pair\n\n` +
    `<b>Summaries:</b>\n/daily · /weekly\n\n` +
    `<b>Info:</b>\n/health · /positions · /status · /reset · /help\n\n` +
    `<i>Running on GitHub Actions · Pure price action · No news spam</i>\n\n<i>${V}</i>`
  );
}

async function resetCooldowns() {
  let n = 0;
  for (const k of Object.keys(state)) {
    if (k.startsWith("cd2_") || k.startsWith("POS2_") || k.startsWith("CB2_") || k.startsWith("CBLOSS2_")) {
      delProp(k); n++;
    }
  }
  await tgSend(`✅ Cleared ${n} cooldowns/positions/circuit-breakers.\n\n<i>${V}</i>`);
}

// ── MAIN RUNNER ───────────────────────────────────────────────────────────────
async function runBot() {
  console.log(`\n═══ GWP ALTCOIN v2.2 ═══ ${new Date().toISOString()}`);

  if (!isInSession()) {
    console.log(`  💤 SESSION FILTER: UTC hour ${new Date().getUTCHours()} is in dead zone — skipping scan.`);
    return;
  }

  await checkOpenPositions();
  let fired = 0;

  for (const symbol of CONFIG.PAIRS) {
    try {
      console.log(`\n▶ ${symbol}`);
      if (isCircuitBroken(symbol)) continue;

      const candles = await fetchKlines(symbol, "H4", CONFIG.VP_LOOKBACK + 20);
      if (!candles || candles.length < 30) { console.log("  No data"); continue; }

      const vp    = computeVolumeProfile(candles);
      const avwap = computeAVWAP(candles);
      if (!vp) { console.log("  VP failed"); continue; }

      console.log(`  VAL: ${vp.valBandBot.toFixed(5)} – ${vp.valBandTop.toFixed(5)} | AVWAP: ${avwap ? avwap.toFixed(5) : "N/A"}`);

      const r = detectGWP(candles, vp, avwap);
      if (!r) {
        const sig = candles[candles.length - 2];
        console.log(`  ⬜ No GWP. H=${sig.high.toFixed(5)} L=${sig.low.toFixed(5)} Band=${vp.valBandBot.toFixed(5)}-${vp.valBandTop.toFixed(5)}`);
        continue;
      }
      if (!r.qualified) { console.log(`  ⚠️ score=${r.score}/8 — below threshold`); continue; }
      if (isOnCooldown(symbol, r.direction)) { console.log(`  🔒 Cooldown (${r.direction})`); continue; }

      const trendBias = await computeTrendBias(symbol);
      console.log(`  🔥 SIGNAL FIRING: ${r.direction} | ${r.grade} | R:R=${r.rr}`);

      await tgSend(formatSignal(r, symbol, trendBias));
      storePosition(symbol, r);
      setCooldown(symbol, r.direction);
      trackSignalFired(symbol, r);
      fired++;

      if (CONFIG.EMAIL_ALERTS) {
        await sendEmail(
          `[GWP Altcoin v2.2] ${symbol} ${r.direction} | ${r.grade}`,
          `GWP Signal\nPair: ${symbol}\nDir: ${r.direction}\nGrade: ${r.grade}\nScore: ${r.score}/8\nEntry: ${r.entry}\nSL: ${r.sl}\nTP1: ${r.tp1}\nTP2: ${r.tp2}\nR:R: ${r.rr}\nPath: ${r.path}`
        );
      }
    } catch(e) { console.error(`ERROR [${symbol}]:`, e.message); }
  }

  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);

  // Write openPositions for the web app
  const openPos = Object.keys(state)
    .filter(k => k.startsWith("POS2_"))
    .map(k => { try { return JSON.parse(state[k]); } catch(e) { return null; } })
    .filter(p => p && p.state === "OPEN")
    .map(p => ({
      pair      : p.symbol.replace("-USDT", "/USDT"),
      direction : p.direction === "BULL" ? "LONG" : "SHORT",
      entry     : String(p.entry),
      sl        : String(p.sl),
      tp        : String(p.tp2),
      score     : 85,
      timeframe : "4H",
      timestamp : new Date(p.ts).toISOString()
    }));
  state.openPositions = openPos;
  state.lastScanTime  = new Date().toISOString();
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────
(async () => {
  loadState();

  const mode = process.argv[2] || "scan";
  console.log(`GWP Altcoin v2.2 | mode: ${mode}`);

  // Process any pending Telegram commands first
  const updates = await pollTelegram();
  if (updates && updates.length) {
    for (const u of updates) {
      if (u.message && u.message.text) {
        console.log(`Command received: ${u.message.text}`);
        await handleCommand(u.message.text);
      }
    }
  }

  if (mode === "scan")    await runBot();
  if (mode === "daily")   await sendDailySummary();
  if (mode === "weekly")  await sendWeeklySummary();
  if (mode === "health")  await sendHealth();

  saveState();
  console.log("State saved.");
})();

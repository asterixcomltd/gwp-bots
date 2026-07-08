"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — CRYPTO EDITION  v3.1  MONEY PRINTING MACHINE ELITE MAX™
// Strategy : Ghost Wick Protocol™ (GWP) — 1D+4H+1H+30M+15M, 3-of-5 vote + entry trigger
// Author   : Abdin · asterixcomltd@gmail.com · Asterix Holdings Ltd. · Accra, Ghana
// Exchange : KuCoin (Public REST API — no auth key needed)
// Pairs    : DEXE · UNI · SUSHI · SOL · BTC · LINK · COMP
// Platform : GitHub Actions (Node.js 22+) · crypto_state.json persistence
//
// © 2026 Asterix Holdings Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// v3.1 CHANGES (on top of v3.0):
//   ✅ FIX: D1 AVWAP lookback 20 candles → 3 candles (eliminates 10+ day lag)
//   ✅ FIX: D1 conviction weight ±6/−4 → ±2/−1 (whisper, not gate)
//   ✅ Fix #1:  Zone touch count — fresh zones prioritized, exhausted zones penalized
//   ✅ Fix #2:  Volume-validated BOS — confirmed +8, unconfirmed +3
//   ✅ Fix #3:  Zone-aware LiqSweep scoring — in-zone trap +10, near-zone +5, +4
//   ✅ Fix #4:  KuCoin funding rate adjustment (crypto only) — extremes adjust conviction
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
// v3.1.1 HOTFIXES (2026-04-12):
//   ✅ BugFix A: SL/TP position checks use candle HIGH/LOW not CLOSE (intracandle)
//   ✅ BugFix B: NFP/FOMC macro blackout — separate Set-based lookup (day≤10 bug)
//   ✅ BugFix C: Conviction display /105 → /123 (actual max score is 123)
//   ✅ BugFix D: Orphaned ETH-USDT circuit breaker key removed from state
//   ✅ BugFix E: Pairs comment updated to match actual PAIRS array
//
// v3.0 CHANGES (on top of v8.1):
//   ✅ FIX 1: D1 bias BACKWARDS — counter-trend was getting +6. Fix: aligned=+6, counter=−4
//   ✅ FIX 2: LIQ SWEEP shown twice (ms.label + msLine) — removed ms.label from single format
//   ✅ FIX 3: D1 bias note showed bare "D1: BEAR" — now shows ✅ or ⚠️ CT context
//   ✅ FIX 4: Opposite-direction signals could fire same scan — added firedDir lock
//   ✅ SPEED 1: httpGet had NO TIMEOUT — added 15s req.destroy() timeout
//   ✅ SPEED 2: 40 sequential KuCoin fetches → Promise.all() per symbol (~4× faster)
//
// v8.1 CHANGES (on top of v8.0):
//   ✅ FIX: Secondary TP dedup keys (ATPD8_) added to checkOpenPositions
//           — Double-barrier against TP1/TP2 repeat spam
//           — tp1hit flag + independent timestamp key: BOTH must be clear
//             for a TP alert to fire. Guards against any future state
//             persistence failure.
//   ✅ FIX: resetCooldowns() now also clears ATPD8_ dedup keys
//
// v8.0 CHANGES (on top of v7.0):
//   ✅ FIX: CRYPTO_MIN_SL_PCT 0.35 → 1.2 (CRITICAL — hairline SL was killing trades)
//   ✅ FIX: ATR floor on SL — SL always ≥ 1.5× ATR from entry
//   ✅ FIX: Vol+AVWAP institutional gate — at least ONE must pass (no ghost signals)
//   ✅ FIX: Age penalty raised 0.5 → 0.75 (older signals penalised more)
//   ✅ FIX: D1 context filter — D1 close vs D1 AVWAP sets directional bias
//   ✅ FIX: Symmetric conviction — BULL/BEAR get identical scoring treatment
//   ✅ FIX: TP3_MULT 2.2 → 3.0 (wider runner — crypto moves 300%+ often)
//   ✅ FIX: minRR H4: 1.8 → 2.0 (higher quality setups only)
//   ✅ REMOVED: EMA-50 trend bias — lagging, not institutional
//   ✅ REMOVED: RSI bonus/penalty — lagging, replaced by Kalman+ZScore+Wyckoff
// ════════════════════════════════════════════════════════════════════════════

// v4.0 CHANGES (ported from MVS bot, data-validated before porting — not
// theorized): 
//   ✅ POC PROMINENCE — decisive POC (clear volume peak, ratio >= 1.5) scores
//      +5 conviction; contested POC (barely edges out 2nd-loudest row) -3.
//      MVS's own 360d/720d backtests found ~10pp WR gap between the two.
//   ✅ POC MIGRATION — POC drifting WITH the trade's direction across this
//      window now scores -4 (a level already "spent"/re-rated); MVS found
//      this was backwards from the original theory, which had rewarded it.
//      Against/static drift stays neutral, exactly as MVS settled on.
//   ✅ Equity curve — new crypto_equity_curve.json, a small append-only log
//      of every closed trade (ts, trade P&L, cumulative P&L, equity index),
//      used to report real peak-equity / max-drawdown in weekly reports
//      instead of only a single running P&L total.
//   NOT ported: MVS's separate POC_REQUIRE_1H_CONFIRM hard gate and
//   MIN_CONFLUENCE_POC — GWP's POC is one of four TF-bias-vote pillars here,
//   not its own pivot/entry type the way it is in MVS, so a hard gate on it
//   would remove signal frequency for no clean equivalent gain; the scoring
//   adjustment above captures the validated part of the finding without that
//   frequency cost. Backtest.js received the identical changes (+slippage,
//   below) so live and backtest can't drift apart, this repo's own stated
//   discipline for every prior gate.
//

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── TF CONFIGS ────────────────────────────────────────────────────────────────
// v5.0: extended from 3 TFs (H4/H1/M15) to 5 (D1/H4/H1/M30/M15), ported from
// the MVS bot's validated 5-timeframe/3-of-5-vote design. D1 and M30 are new;
// H4/H1/M15 values are unchanged from v3.5/v3.6.
const TF_CONFIG = {
  D1: {
    tf:"D1", label:"1D",
    vpLookback:60, avwapLookback:10,
    minRR:1.5, minConviction:70, cooldownHrs:20,
    atrBufMult:0.50, maxAge:1, avwapProx:0.0035,
    volLookback:20, msLookback:60, swingStrength:3,
    volSpikeMult:1.15,
  },
  H4: {
    tf:"H4", label:"4H",
    vpLookback:100, avwapLookback:30,
    minRR:1.5,          // v3.3: lowered 2.0 → 1.5 (backtest: R:R gate was killing 98% of valid signals)
    minConviction:68, cooldownHrs:3,  // v3.5: raised 60 → 68 (backtest: conv 60-69 had 0% WR); cooldown 4h → 3h (more signals)
    atrBufMult:0.55, maxAge:2, avwapProx:0.004,
    volLookback:20, msLookback:80, swingStrength:3,
    volSpikeMult:1.2,
  },
  H1: {
    tf:"H1", label:"1H",
    vpLookback:60, avwapLookback:20,
    minRR:1.4, minConviction:58, cooldownHrs:2,  // v3.5: lowered 60 → 58 (backtest: H1 profitable at 58+, more signal frequency)
    atrBufMult:0.65, maxAge:1, avwapProx:0.005,
    volLookback:20, msLookback:60, swingStrength:3,
    volSpikeMult:1.3,
  },
  M30: {
    tf:"M30", label:"30M",
    vpLookback:45, avwapLookback:15,
    minRR:1.4, minConviction:60, cooldownHrs:1.5,
    atrBufMult:0.62, maxAge:1, avwapProx:0.0055,
    volLookback:18, msLookback:55, swingStrength:2,
    volSpikeMult:1.4,
  },
  M15: {
    tf:"M15", label:"15M",
    vpLookback:40, avwapLookback:12,
    minRR:1.5, minConviction:62, cooldownHrs:1,  // v3.4: conv 56 → 62
    atrBufMult:0.60, maxAge:1, avwapProx:0.006,
    volLookback:15, msLookback:40, swingStrength:2,
    volSpikeMult:1.5,
  },
};



// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN : process.env.CRYPTO_TG_TOKEN || "",
  CHAT_ID        : process.env.CRYPTO_CHAT_ID  || "",

  PAIRS: ["DEXE-USDT","UNI-USDT","COMP-USDT","SOL-USDT","BTC-USDT","LINK-USDT","ETH-USDT","NEAR-USDT","AVAX-USDT","AAVE-USDT","ARB-USDT","INJ-USDT","DOT-USDT","FIL-USDT","SUI-USDT","ATOM-USDT","MNT-USDT"],  // v4.0: added MNT (Mantle) — 17 pairs, high-liquidity KuCoin listing

  CAPITAL:50, RISK_PCT:1.5, LEVERAGE:20,  // v3.5: scaled 5 → 50 USD
  VP_ROWS:24, MIN_WICK_DEPTH_PCT:0.12, MIN_BODY_GAP_PCT:0.08,

  VOLUME_FILTER:true,

  // 24/7 — NO DEAD PERIODS — NO SESSION FILTER
  SESSION_FILTER: false,

  CIRCUIT_BREAKER:true, CIRCUIT_BREAKER_LOSSES:3, CIRCUIT_BREAKER_HRS:24,

  CONFLUENCE_CONVICTION_BOOST:18,
  TRIPLE_TF_BOOST:25,
  CONFLUENCE_GATE_REDUCTION:6,

  // v3.5: TP3 lowered 3.0 → 2.0 (backtest: only 1/15 trades reached 3.0×; 2.0× captures more runners)
  TP3_MULT:2.0,

  MAX_RETRIES:2, RETRY_DELAY_MS:3000,
  DEDUP_WINDOW_MS: 3600000,

  // v8.0: CRYPTO_MIN_SL_PCT raised 0.35 → 1.2 (CRITICAL FIX — hairline SL)
  CRYPTO_MIN_SL_PCT: 1.5,  // v3.3: lowered 2.0 → 1.5 (backtest: 2.0% × pair mult created SLs too wide for VAL band targets)

  // v8.0: ATR floor — SL must be ≥ this multiple of ATR from entry
  ATR_SL_FLOOR_MULT: 1.0,  // v3.3: lowered 1.5 → 1.0 (backtest: 1.5×ATR too wide for crypto volatility)

  // v8.1: TP hit dedup window — 4 hours prevents repeat TP alerts even if
  // state file fails to persist across runs
  TP_HIT_DEDUP_MS: 14400000,
};

const V = "GWP Crypto v4.0 | Elite Max™ | 24/7 | Asterix.COM | Abdin";

// v3.2: Per-pair volatility multiplier for SL sizing (higher = wider SL)
const PAIR_VOL_MULT = {
  "BTC-USDT":0.8, "SOL-USDT":1.5, "DEXE-USDT":1.8, "UNI-USDT":1.3,
  "COMP-USDT":1.3, "LINK-USDT":1.2,
  "ETH-USDT":0.9, "NEAR-USDT":1.4,
  // v3.6: new pairs — volatility-calibrated from 30-day ATR%
  "AVAX-USDT":1.4, "AAVE-USDT":1.3, "ARB-USDT":1.5, "INJ-USDT":1.6,
  "DOT-USDT":1.3, "FIL-USDT":1.5, "SUI-USDT":1.5, "ATOM-USDT":1.2,
  // v4.0: MNT (Mantle) — L2 infra token, volatility comparable to ARB/AVAX class
  "MNT-USDT":1.4,
};

const CORR_GROUPS = [
  ["SOL-USDT","NEAR-USDT","SUI-USDT","AVAX-USDT","DOT-USDT","ATOM-USDT"], // L1s
  ["BTC-USDT","ETH-USDT"], // majors
  ["DEXE-USDT","COMP-USDT","AAVE-USDT"], // DeFi governance
  ["UNI-USDT","LINK-USDT","ARB-USDT","MNT-USDT"], // DeFi/infra + L2s
  ["INJ-USDT","FIL-USDT"], // infra/storage
];
function getCorrelatedPairs(sym){
  const g=CORR_GROUPS.find(gr=>gr.includes(sym));
  return g?g.filter(s=>s!==sym):[];
}
function hasCorrelatedPosition(symbol,direction){
  const corr=getCorrelatedPairs(symbol);
  for(const cs of corr){
    const keys=Object.keys(state).filter(k=>k.startsWith("APOS8_"+cs+"_"+direction));
    for(const k of keys){try{const p=JSON.parse(state[k]);if(p&&p.state==="OPEN")return cs;}catch(e){}}
  }
  return null;
}

// ── STATE ─────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "crypto_state.json");
let state = {};
function loadState()  { try { state = JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); } catch(e) { state = {}; } }
function saveState()  { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function getProp(k)   { return state[k] || null; }
function setProp(k,v) { state[k] = v; }
function delProp(k)   { delete state[k]; }

// ── EQUITY CURVE (v4.0, ported from MVS equity-curve.json) ───────────────────
// A dedicated, small, append-only time series of every closed trade's P&L —
// separate from crypto_state.json so weekly reports can compute a real max
// drawdown / peak-equity instead of only ever showing a single running total.
const EQUITY_FILE = path.join(__dirname, "crypto_equity_curve.json");
function appendEquityPoint(tradePnlPct, cumPnlPct) {
  try {
    let curve = [];
    try { curve = JSON.parse(fs.readFileSync(EQUITY_FILE, "utf8")); } catch(e) {}
    if (!Array.isArray(curve)) curve = [];
    const equityIndex = parseFloat((100 * (1 + cumPnlPct / 100)).toFixed(3));
    // Newest-first, matching this repo's established log convention.
    curve.unshift({ ts: Date.now(), tradePnlPct: parseFloat((tradePnlPct||0).toFixed(3)), cumPnlPct: parseFloat((cumPnlPct||0).toFixed(3)), equityIndex });
    if (curve.length > 500) curve = curve.slice(0, 500);
    fs.writeFileSync(EQUITY_FILE, JSON.stringify(curve, null, 2));
  } catch(e) { console.error("appendEquityPoint error:", e.message); }
}
function getEquityStats() {
  try {
    const curve = JSON.parse(fs.readFileSync(EQUITY_FILE, "utf8"));
    if (!Array.isArray(curve) || !curve.length) return null;
    const chronological = [...curve].reverse(); // oldest → newest for peak/DD math
    let peak = -Infinity, maxDD = 0;
    for (const pt of chronological) {
      if (pt.equityIndex > peak) peak = pt.equityIndex;
      const dd = peak > 0 ? ((peak - pt.equityIndex) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }
    return { points: curve.length, current: curve[0].equityIndex, peak, maxDrawdownPct: parseFloat(maxDD.toFixed(2)) };
  } catch(e) { return null; }
}

// ── SIGNAL FILE WRITER ────────────────────────────────────────────────────────
function appendSignalToFile(symbol, r, conv, tfKey) {
  try {
    const pair = symbol.replace('-USDT', '') + '/USDT';
    const ts   = Date.now();
    const d    = new Date(ts);
    const time = d.getUTCHours().toString().padStart(2,'0') + ':' + d.getUTCMinutes().toString().padStart(2,'0');
    const conviction = parseFloat(conv && conv.score) || 50;
    const score = Math.min(Math.round(55 + (conviction - 50) / 73 * 45), 100);
    const sig = {
      pair, bot: 'crypto',
      dir:   r.direction === 'BULL' ? 'LONG' : 'SHORT',
      entry: r.entry ? r.entry.toString() : '0',
      sl:    r.sl    ? r.sl.toString()    : '0',
      tp:    r.tp2   ? r.tp2.toString()   : (r.tp1 ? r.tp1.toString() : '0'),
      tp1:   r.tp1   ? r.tp1.toString()   : '0',
      tp3:   r.tp3   ? r.tp3.toString()   : '0',
      rr:    r.rr    ? r.rr.toString()    : '',
      grade: r.grade || '',
      tf: tfKey, score, ts, time,
    };
    const sigFile = path.join(__dirname, 'crypto_signals.json');
    let sigs = [];
    try { sigs = JSON.parse(fs.readFileSync(sigFile, 'utf8')); } catch(e) {}
    if (!Array.isArray(sigs)) sigs = [];
    sigs.unshift(sig);
    if (sigs.length > 25) sigs = sigs.slice(0, 25);
    fs.writeFileSync(sigFile, JSON.stringify(sigs, null, 2));
    console.log(`  📝 Signal written to crypto_signals.json → ${pair} ${sig.dir} [${tfKey}]`);
  } catch(e) { console.error('appendSignalToFile error:', e.message); }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((res, rej) => {
    const opts=new URL(url);
    const req=https.get({hostname:opts.hostname,path:opts.pathname+opts.search},
      r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>res(d));});
    req.on("error",rej);
    req.setTimeout(15000,()=>{req.destroy(new Error("Timeout"));});
  });
}
function httpPost(hostname, pth, body) {
  return new Promise((res, rej) => {
    const payload=JSON.stringify(body);
    const req=https.request({hostname,path:pth,method:"POST",
      headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(payload)}},
      r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>res(d));});
    req.on("error",rej); req.write(payload); req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TELEGRAM ──────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CONFIG.TELEGRAM_TOKEN||!CONFIG.CHAT_ID) return;
  const chunks = [];
  for (let i=0; i<text.length; i+=3800) chunks.push(text.slice(i,i+3800));
  for (const chunk of chunks) {
    try {
      await httpPost("api.telegram.org",`/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
        {chat_id:CONFIG.CHAT_ID,text:chunk,parse_mode:"HTML"});
      if (chunks.length > 1) await sleep(300);
    } catch(e) { console.error("TG error:",e.message); }
  }
}
async function pollTelegram() {
  if (!CONFIG.TELEGRAM_TOKEN) return null;
  try {
    const offset=getProp("tg_offset")||0;
    const raw=await httpGet(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`);
    const json=JSON.parse(raw); if(!json.ok||!json.result.length) return null;
    const last=json.result[json.result.length-1]; setProp("tg_offset",last.update_id+1); return json.result;
  } catch(e) { return null; }
}

// ── KUCOIN DATA ───────────────────────────────────────────────────────────────
const KU_TF = { H4:"4hour", H1:"1hour", M30:"30min", M15:"15min", D1:"1day" };

async function fetchKlines(symbol, tf, limit, retry=0) {
  const url=`https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]||tf}&symbol=${symbol}&limit=${Math.min(limit||150,300)}`;
  try {
    const raw=await httpGet(url); const json=JSON.parse(raw);
    if(!json.data||json.data.length<5) return null;
    return json.data.reverse().map(c=>({
      t:parseInt(c[0])*1000, open:parseFloat(c[1]), close:parseFloat(c[2]),
      high:parseFloat(c[3]), low:parseFloat(c[4]), vol:parseFloat(c[5]),
    }));
  } catch(e) {
    if (retry < CONFIG.MAX_RETRIES) {
      await sleep(CONFIG.RETRY_DELAY_MS);
      return fetchKlines(symbol, tf, limit, retry+1);
    }
    return null;
  }
}

// ── MATH ENGINE ───────────────────────────────────────────────────────────────
// v8.0: RSI REMOVED — lagging indicator. EMA-50 REMOVED — lagging indicator.
// Kept: ATR (structural), Hurst (fractal), Z-Score (mean reversion), Kalman (velocity),
//       ATR% (volatility percentile), Volume ratio (institutional participation)
function calcATR(candles,p=14){
  if(candles.length<p+1)return 0;const trs=[];
  for(let i=1;i<candles.length;i++)trs.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}
function calcATRPercentile(candles,p=14){
  if(candles.length<p+10)return 50;const atrs=[];
  for(let i=p;i<candles.length;i++)atrs.push(calcATR(candles.slice(Math.max(0,i-p),i+1),p));
  const cur=atrs[atrs.length-1],rank=atrs.filter(a=>a<=cur).length;
  return Math.round((rank/atrs.length)*100);
}
function calcVolumeRatio(candles,p=20){
  if(candles.length<p+1)return 1.0;
  const sl=candles.slice(-p-1),avg=sl.slice(0,p).reduce((a,b)=>a+b.vol,0)/p;
  return avg>0?sl[sl.length-1].vol/avg:1.0;
}
function calcHurst(closes){
  if(closes.length<120)return 0.5; // Bug#15: 120+ candles needed for Hurst
  const rets=[];for(let i=1;i<closes.length;i++)rets.push(Math.log(closes[i]/closes[i-1]));
  const lags=[4,8,16].filter(l=>l<rets.length-2);if(lags.length<2)return 0.5;
  const rsVals=lags.map(lag=>{const chunks=Math.floor(rets.length/lag);let rsSum=0;
    for(let c=0;c<chunks;c++){const sub=rets.slice(c*lag,(c+1)*lag),mean=sub.reduce((a,b)=>a+b,0)/sub.length,dem=sub.map(r=>r-mean);let cum=0;const cumDev=dem.map(d=>(cum+=d,cum)),R=Math.max(...cumDev)-Math.min(...cumDev),variance=sub.reduce((a,b)=>a+b*b,0)/sub.length-mean*mean;rsSum+=R/Math.sqrt(Math.max(variance,1e-15));}return rsSum/chunks;});
  const logN=lags.map(l=>Math.log(l)),logRS=rsVals.map(rs=>Math.log(Math.max(rs,1e-10)));
  const nP=logN.length,mLN=logN.reduce((a,b)=>a+b)/nP,mLRS=logRS.reduce((a,b)=>a+b)/nP;
  const num=logN.reduce((a,x,i)=>a+(x-mLN)*(logRS[i]-mLRS),0),den=logN.reduce((a,x)=>a+(x-mLN)**2,0);
  return den===0?0.5:Math.min(Math.max(num/den,0.1),0.9);
}
function calcZScore(closes,p=20){
  if(closes.length<p)return{z:0,extremeHigh:false,extremeLow:false,mildHigh:false,mildLow:false};
  const win=closes.slice(-p),mean=win.reduce((a,b)=>a+b,0)/p,std=Math.sqrt(win.reduce((a,b)=>a+(b-mean)**2,0)/p);
  const z=std===0?0:(closes[closes.length-1]-mean)/std;
  return{z,extremeHigh:z>1.5,extremeLow:z<-1.5,mildHigh:z>0.8,mildLow:z<-0.8};
}
function kalmanFilter(closes){
  if(closes.length<5)return null;const Q=0.01,R=0.5;let x=closes[0],v=0,P=1;
  for(let i=1;i<closes.length;i++){const xP=x+v,PP=P+Q,K=PP/(PP+R);x=xP+K*(closes[i]-xP);v=v+0.1*(closes[i]-x);P=(1-K)*PP;}
  return{fairValue:x,velocity:v,bullish:v>0};
}
function calcMomentumBurst(candles,sigIdx){
  if(sigIdx<10)return false;
  const recent=candles.slice(Math.max(0,sigIdx-10),sigIdx);
  const avgRange=recent.reduce((a,c)=>a+(c.high-c.low),0)/recent.length;
  const sigRange=candles[sigIdx].high-candles[sigIdx].low;
  return avgRange>0&&sigRange>=avgRange*1.5;
}
function calcZoneRevisit(candles,bBot,bTop){
  const recent=candles.slice(-12,-1);
  return recent.filter(c=>c.low<=bTop*1.005&&c.high>=bBot*0.995).length>=2;
}
function runMathEngine(candles){
  if(!candles||candles.length<30)return null;
  const closes=candles.map(c=>c.close);
  // v8.0: RSI and EMA-50 removed — pure non-lagging institutional engine
  const atr=calcATR(candles,14),hurst=calcHurst(closes),zScore=calcZScore(closes,20);
  const kalman=kalmanFilter(closes),atrPct=calcATRPercentile(candles,14);
  const volRatio=calcVolumeRatio(candles,20);
  return{atr,hurst,zScore,kalman,atrPct,volRatio,cur:closes[closes.length-1],cycle:calcSineOscillator(closes),candleCount:closes.length};
}

// ── FUNDING RATE CONTEXT (v3.1 Fix #4) — Crypto perpetuals only ──────────────
// Crowded longs (high positive funding) = bear squeeze imminent
// Crowded shorts (negative funding) = bull squeeze imminent
async function getFundingRate(symbol) {
  try {
    // KuCoin swap funding rate endpoint
    const path = `/api/v1/mark-price/${symbol}-USDT/current`;
    const data = await new Promise((resolve, reject) => {
      const opts = { hostname:"api-futures.kucoin.com", path, method:"GET", timeout:8000 };
      const req = https.request(opts, res => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.end();
    });
    if (!data || !data.data) return { rate: 0, label: "💰 Funding: N/A", score: 0 };
    // Try currentFundingRate field
    const rate = parseFloat(data.data.currentFundingRate || data.data.fundingRate || 0);
    let label, score = 0;
    if (rate > 0.001)       { label = `💰 Funding: +${(rate*100).toFixed(4)}% 🔴 (Longs crowded)`; score = -2; }
    else if (rate > 0.0005) { label = `💰 Funding: +${(rate*100).toFixed(4)}% 🟡 (Mildly long-biased)`; score = -1; }
    else if (rate < -0.0005){ label = `💰 Funding: ${(rate*100).toFixed(4)}% 🟢 (Shorts crowded)`; score = 2; }
    else                    { label = `💰 Funding: ${(rate*100).toFixed(4)}% ⚪ (Neutral)`; score = 0; }
    return { rate, label, score };
  } catch(e) { return { rate: 0, label: "💰 Funding: N/A", score: 0 }; }
}

// ── D1 CONTEXT FILTER ─────────────────────────────────────────────────────────
// v3.4: 1-candle D1 bias — uses only yesterday's daily candle direction.
// Previous 3-candle AVWAP lagged 1-2 days on reversals — by the time D1
// flipped, the H4 reversal move was half over. 1-candle reacts instantly:
// a big bullish engulfing daily = BULL immediately, no 3-day wait.
// Strong body = clear bias. Small body / doji = NEUTRAL (no signal blocked).
function getD1Bias(d1Candles) {
  if(!d1Candles||d1Candles.length<2) return 'NEUTRAL';
  const yesterday = d1Candles[d1Candles.length - 1];
  const bodyPct = Math.abs(yesterday.close - yesterday.open) / yesterday.open;
  // Require meaningful body (>0.3%) — dojis/spinning tops = NEUTRAL
  if(bodyPct < 0.003) return 'NEUTRAL';
  return yesterday.close > yesterday.open ? 'BULL' : 'BEAR';
}

// ── WYCKOFF MARKET CYCLE ANALYSIS ────────────────────────────────────────────
function detectWyckoff(candles,direction){
  if(candles.length<30)return{spring:false,upthrust:false,phase:"UNKNOWN",label:"⬜ WYK: —"};
  const lookback=candles.slice(-30,-1);
  const rangeHigh=Math.max(...lookback.map(c=>c.high));
  const rangeLow =Math.min(...lookback.map(c=>c.low));
  const sig=candles[candles.length-2];
  const spring  =sig.low <rangeLow *0.9995&&sig.close>rangeLow;
  const upthrust=sig.high>rangeHigh*1.0005&&sig.close<rangeHigh;
  const recentVols=candles.slice(-10).map(c=>c.vol);
  const avgVol=recentVols.reduce((a,b)=>a+b,0)/recentVols.length;
  const volClimax=sig.vol>avgVol*1.8;
  let phase="RANGING",label="⬜ WYK: RANGING";
  if(spring  &&direction==="BULL"){phase="SPRING";   label="🟢 WYK: SPRING ✅";}
  if(upthrust&&direction==="BEAR"){phase="UPTHRUST"; label="🔴 WYK: UPTHRUST ✅";}
  if(volClimax&&direction==="BULL")label+=" · Vol Climax↓";
  if(volClimax&&direction==="BEAR")label+=" · Vol Climax↑";
  return{spring,upthrust,phase,label,rangeHigh,rangeLow,volClimax};
}

// ── SINE-WAVE CYCLE OSCILLATOR ────────────────────────────────────────────────
function calcSineOscillator(closes){
  const p=20;
  if(closes.length<p*2)return{sine:0,leadSine:0,domPeriod:p,expansion:false,contraction:false,label:"⬜ CYCLE: —"};
  const win=closes.slice(-(p*2)),mean=win.reduce((a,b)=>a+b,0)/win.length;
  const detr=win.map(c=>c-mean);
  let maxCorr=-Infinity,domPeriod=p;
  for(let lag=8;lag<=p;lag++){
    let corr=0;for(let i=lag;i<detr.length;i++)corr+=detr[i]*detr[i-lag];
    if(corr>maxCorr){maxCorr=corr;domPeriod=lag;}
  }
  const cycPos=(closes.length%domPeriod)/domPeriod;
  const sine    =Math.sin(2*Math.PI*cycPos);
  const leadSine=Math.sin(2*Math.PI*cycPos+Math.PI/4);
  const expansion  =Math.abs(sine)<0.25&&Math.abs(leadSine)>Math.abs(sine);
  const contraction=Math.abs(sine)>0.70;
  const label=expansion
    ?`🌊 CYCLE: EXPANSION (T=${domPeriod})`
    :contraction
      ?`📉 CYCLE: PEAK/TROUGH (T=${domPeriod}) ✅ REVERSAL GATE`
      :`〰️ CYCLE: MID-WAVE (T=${domPeriod})`;
  return{sine:parseFloat(sine.toFixed(3)),leadSine:parseFloat(leadSine.toFixed(3)),domPeriod,expansion,contraction,label};
}

// ── ELLIOTT WAVE — 0.786 RETRACEMENT ─────────────────────────────────────────
function calcFib786(candles,direction){
  if(candles.length<20)return{level786:null,level618:null,label:"⬜ EW: —"};
  const lookback=candles.slice(-50);
  const swingHigh=Math.max(...lookback.map(c=>c.high));
  const swingLow =Math.min(...lookback.map(c=>c.low));
  const range=swingHigh-swingLow;
  if(range===0)return{level786:null,level618:null,label:"⬜ EW: —"};
  const level786=direction==="BEAR"?swingHigh-range*0.786:swingLow+range*0.786;
  const level618=direction==="BEAR"?swingHigh-range*0.618:swingLow+range*0.618;
  return{level786,level618,swingHigh,swingLow,
    label:`📐 EW: 78.6%=${level786.toFixed(2)} · 61.8%=${level618.toFixed(2)}`};
}

// ── VOLUME PROFILE + AVWAP ────────────────────────────────────────────────────
function computeVolumeProfile(candles,lookback){
  const n=Math.min(lookback,candles.length),sl=candles.slice(candles.length-n);
  const hi=Math.max(...sl.map(c=>c.high)),lo=Math.min(...sl.map(c=>c.low));if(hi<=lo)return null;
  const rows=CONFIG.VP_ROWS,rowH=(hi-lo)/rows,buck=new Array(rows).fill(0);
  sl.forEach(c=>{for(let r=0;r<rows;r++){const rB=lo+r*rowH,rT=rB+rowH,ov=Math.min(c.high,rT)-Math.max(c.low,rB);if(ov>0)buck[r]+=c.vol*(ov/((c.high-c.low)||rowH));}});
  let pocIdx=0;for(let i=1;i<rows;i++)if(buck[i]>buck[pocIdx])pocIdx=i;
  const total=buck.reduce((a,b)=>a+b,0);let covered=buck[pocIdx],valIdx=pocIdx,vahIdx=pocIdx;
  while(covered<total*0.70){const up=vahIdx+1<rows?buck[vahIdx+1]:0,dn=valIdx-1>=0?buck[valIdx-1]:0;if(up>=dn){vahIdx++;covered+=up;}else{valIdx--;covered+=dn;}if(valIdx<=0&&vahIdx>=rows-1)break;}
  const val=lo+valIdx*rowH;

  // v4.0 (ported from MVS v10.13, data-validated): POC PROMINENCE + MIGRATION.
  // Prominence — is POC a clear, decisive peak or a contested one that barely
  // edges out the next-loudest price row? MVS's 360d/720d backtests found
  // decisive POC (ratio >= 1.5) scored ~10pp higher win rate than contested POC.
  let secondVol=0; for(let i=0;i<rows;i++){ if(i===pocIdx) continue; if(buck[i]>secondVol) secondVol=buck[i]; }
  const prominenceRatio = secondVol>0 ? buck[pocIdx]/secondVol : 99;
  const pocDecisive = prominenceRatio >= 1.5;

  // Migration — has POC drifted between the first and second half of this
  // window? MVS found migration-TOWARD-trade-direction was a WORSE signal (a
  // level already "spent"/re-rated), not a confirming one as first assumed —
  // so this is reported as a raw signed row-distance; the caller (which knows
  // trade direction) interprets it, same split MVS used between its POC math
  // and its strategy-level direction check.
  let pocMigrationRows = 0;
  if (sl.length >= 20) {
    const half=Math.floor(sl.length/2), firstHalf=sl.slice(0,half), secondHalf=sl.slice(half);
    const bIdx=(chunk)=>{const b=new Array(rows).fill(0);chunk.forEach(c=>{for(let r=0;r<rows;r++){const rB=lo+r*rowH,rT=rB+rowH,ov=Math.min(c.high,rT)-Math.max(c.low,rB);if(ov>0)b[r]+=c.vol*(ov/((c.high-c.low)||rowH));}});let idx=0;for(let i=1;i<rows;i++)if(b[i]>b[idx])idx=i;return idx;};
    pocMigrationRows = bIdx(secondHalf) - bIdx(firstHalf);
  }

  return{poc:lo+(pocIdx+0.5)*rowH,val,vah:lo+(vahIdx+1)*rowH,valBandBot:val,valBandTop:val+rowH,valBandMid:val+rowH*0.5,rowHeight:rowH,hi,lo,
    prominenceRatio:parseFloat(prominenceRatio.toFixed(2)),pocDecisive,pocMigrationRows};
}
function computeAVWAP(candles,lookback){
  const n=Math.min(lookback,candles.length),sl=candles.slice(candles.length-n);let tv=0,v=0;
  sl.forEach(c=>{const tp=(c.high+c.low+c.close)/3;tv+=tp*c.vol;v+=c.vol;});return v>0?tv/v:null;
}

// ── VOLUME SPIKE ──────────────────────────────────────────────────────────────
function hasVolumeSpike(sigCandle, allCandles, sigIdx, volLookback, mult) {
  if (!CONFIG.VOLUME_FILTER) return true;
  const start=Math.max(0,sigIdx-volLookback),vols=allCandles.slice(start,sigIdx).map(c=>c.vol||0);
  if(!vols.length) return true;
  const avg=vols.reduce((a,b)=>a+b,0)/vols.length;
  return avg===0?true:(sigCandle.vol||0)>=avg*mult;
}

// ── MARKET STRUCTURE ENGINE ───────────────────────────────────────────────────
// ── TIMEFRAME BIAS VOTE (ported from the MVS bot's proven 2-of-3 design) ──────
// One compressed BULL/BEAR/NEUTRAL read per timeframe: price vs POC/VAH/VAL
// plus price vs the midpoint of the recent swing range. 3-4 of 4 pillars
// agreeing BULL -> BULLISH, 0-1 -> BEARISH, a 2-2 split -> NEUTRAL (this TF
// abstains from the vote rather than forcing a weak lean either way).
function computeTfBias(candles, vp, fibLookback = 50) {
  if (!candles || !vp || candles.length < fibLookback) return null;
  const price = candles[candles.length - 1].close;
  const fibData = candles.slice(-fibLookback);
  const swingHigh = Math.max(...fibData.map(c => c.high));
  const swingLow = Math.min(...fibData.map(c => c.low));
  const fibMid = (swingHigh + swingLow) / 2;
  const votes = {
    poc: price >= vp.poc ? "BULL" : "BEAR",
    vah: price >= vp.vah ? "BULL" : "BEAR",
    val: price >= vp.val ? "BULL" : "BEAR",
    fib: price >= fibMid ? "BULL" : "BEAR",
  };
  const bullVotes = Object.values(votes).filter(v => v === "BULL").length;
  let bias;
  if (bullVotes >= 3) bias = "BULLISH";
  else if (bullVotes <= 1) bias = "BEARISH";
  else bias = "NEUTRAL";
  return { bias, bullVotes, votes, swingHigh, swingLow, fibMid };
}
// N-of-M timeframe direction resolution. votes: [{tf, result: computeTfBias(...) | null}, ...]
// Returns {direction:"BULL"|"BEAR", agreeing:[tf,...], tally:"3/5"} or null if no minAgree agreement.
// v5.0: generalized from a hardcoded 2-of-3 to a configurable minAgree (default 3, now used
// as 3-of-5 across D1/H4/H1/M30/M15).
function resolveVoteDirection(votes, minAgree = 3) {
  const usable = votes.filter(v => v.result && v.result.bias !== "NEUTRAL");
  const total = votes.length;
  const bulls = usable.filter(v => v.result.bias === "BULLISH").map(v => v.tf);
  const bears = usable.filter(v => v.result.bias === "BEARISH").map(v => v.tf);
  if (bulls.length >= minAgree) return { direction: "BULL", agreeing: bulls, tally: `${bulls.length}/${total}` };
  if (bears.length >= minAgree) return { direction: "BEAR", agreeing: bears, tally: `${bears.length}/${total}` };
  return null;
}

// ── ENTRY CONFIRMATION COUNT (MVS-style, replaces the old high cumulative ─────
// conviction-score threshold as the pass/fail gate) ────────────────────────────
// detectGWP already requires volumeSpike OR avwapTrap internally before it even
// returns a signal — so every gwp candidate already has at least one of these
// two for free. This just asks: is there at least one MORE independent reason
// to trust this specific setup (Wyckoff spring/upthrust, confirmed market
// structure, or a decent reward:risk)? 2-of-5 total mirrors MVS's own
// REJECTION_MIN_PATTERNS=2 threshold almost exactly. Conviction score is still
// computed elsewhere for grading/labeling/position-sizing — it's just no
// longer the gate. D1 counter-trend stays a separate, distinct hard block.
function checkEntryConfirmations(gwp, ms) {
  const confirmations = [];
  if (gwp.volumeSpike) confirmations.push("VOLUME_SPIKE");
  if (gwp.avwapTrap) confirmations.push("AVWAP_TRAP");
  if (gwp.wyckoff && (gwp.wyckoff.phase === "SPRING" || gwp.wyckoff.phase === "UPTHRUST")) confirmations.push("WYCKOFF");
  if (ms && ms.confirmed) confirmations.push("MS_CONFIRMED");
  if (parseFloat(gwp.rr) >= 1.5) confirmations.push("RR_FLOOR");
  return { count: confirmations.length, confirmations, valid: confirmations.length >= 2 };
}

function detectSwings(candles,strength){
  const highs=[],lows=[],str=strength||3;
  for(let i=str;i<candles.length-str;i++){
    let isHigh=true,isLow=true;
    for(let j=i-str;j<=i+str;j++){if(j===i)continue;if(candles[j].high>=candles[i].high)isHigh=false;if(candles[j].low<=candles[i].low)isLow=false;}
    if(isHigh)highs.push({idx:i,price:candles[i].high,t:candles[i].t});
    if(isLow) lows.push( {idx:i,price:candles[i].low, t:candles[i].t});
  }
  return{highs,lows};
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
function detectCHoCH(candles,swings){
  const highs=swings.highs.slice(-4),lows=swings.lows.slice(-4);
  if(highs.length<2||lows.length<2)return{detected:false,toBull:false,toBear:false,prevTrend:null,doubleConfirmed:false};
  const hh=highs[highs.length-1].price>highs[highs.length-2].price;
  const hl=lows[lows.length-1].price  >lows[lows.length-2].price;
  const lh=highs[highs.length-1].price<highs[highs.length-2].price;
  const ll=lows[lows.length-1].price  <lows[lows.length-2].price;
  let prevTrend=null;
  if(hh&&hl)prevTrend="BULL";
  if(lh&&ll)prevTrend="BEAR";
  if(!prevTrend)return{detected:false,toBull:false,toBear:false,prevTrend:null,doubleConfirmed:false};
  const last5=candles.slice(-5);let toBull=false,toBear=false,doubleConfirmed=false;
  if(prevTrend==="BEAR"){
    const refHigh=swings.highs.filter(s=>s.idx<candles.length-5).slice(-1)[0];
    if(refHigh){
      const crosses=last5.filter(c=>c.close>refHigh.price);
      if(crosses.length>=1) toBull=true;
      // Double-candle: check 2 consecutive closes above reference
      for(let i=0;i<last5.length-1;i++){if(last5[i].close>refHigh.price&&last5[i+1].close>refHigh.price){doubleConfirmed=true;break;}}
    }
  }
  if(prevTrend==="BULL"){
    const refLow=swings.lows.filter(s=>s.idx<candles.length-5).slice(-1)[0];
    if(refLow){
      const crosses=last5.filter(c=>c.close<refLow.price);
      if(crosses.length>=1) toBear=true;
      for(let i=0;i<last5.length-1;i++){if(last5[i].close<refLow.price&&last5[i+1].close<refLow.price){doubleConfirmed=true;break;}}
    }
  }
  return{detected:toBull||toBear,toBull,toBear,prevTrend,doubleConfirmed};
}
function detectLiquiditySweep(candles,swings){
  const lookback=candles.slice(-15);
  const safeHighs=swings.highs.filter(s=>s.idx<candles.length-15).slice(-4);
  const safeLows =swings.lows.filter( s=>s.idx<candles.length-15).slice(-4);
  let highSweep=false,lowSweep=false,highLevel=null,lowLevel=null;
  for(const c of lookback){
    for(const sh of safeHighs){if(c.high>sh.price&&c.close<sh.price){highSweep=true;highLevel=sh.price;break;}}
    for(const sl of safeLows) {if(c.low <sl.price&&c.close>sl.price){lowSweep=true; lowLevel=sl.price;break;}}
  }
  return{highSweep,lowSweep,highLevel,lowLevel};
}
function detectFVG(candles,direction){
  const cur=candles[candles.length-1];let found=false,fvgHigh=null,fvgLow=null;
  for(let i=candles.length-1;i>=Math.max(2,candles.length-12);i--){
    const c1=candles[i-2],c3=candles[i];
    if(direction==="BULL"&&c3.low>c1.high){const prox=Math.abs(cur.close-c1.high)/cur.close;if((cur.close>=c1.high&&cur.close<=c3.low)||prox<0.008){found=true;fvgHigh=c3.low;fvgLow=c1.high;break;}}
    if(direction==="BEAR"&&c3.high<c1.low){const prox=Math.abs(cur.close-c1.low)/cur.close;if((cur.close<=c1.low&&cur.close>=c3.high)||prox<0.008){found=true;fvgHigh=c1.low;fvgLow=c3.high;break;}}
  }
  return{present:found,fvgHigh,fvgLow};
}
function analyzeMarketStructure(candles,direction,tfCfg){
  if(!candles||candles.length<20){return{confirmed:false,label:"⬜ MS: INSUFFICIENT",strength:0,bos:null,choch:null,liqSweep:null,fvg:null};}
  const slice=candles.slice(-Math.min(tfCfg.msLookback,candles.length));
  const swings=detectSwings(slice,tfCfg.swingStrength);
  const bos=detectBOS(slice,swings),choch=detectCHoCH(slice,swings);
  const liqSweep=detectLiquiditySweep(slice,swings),fvg=detectFVG(slice,direction);
  let confirmed=false,label="🟡 MS: UNCONFIRMED",strength=0;
  if(direction==="BULL"){
    if(choch.detected&&choch.toBull) {confirmed=true;label="🔄 CHoCH→BULL";   strength=3;}
    else if(bos.bullBOS)              {confirmed=true;label="⬆️ BOS BULL";     strength=2;}
    else if(liqSweep.lowSweep)        {confirmed=true;label="💧 LIQ SWEEP↓";   strength=2;}
    else if(fvg.present)               {confirmed=true;label="🟦 FVG BULL";    strength=1;}
  }
  if(direction==="BEAR"){
    if(choch.detected&&choch.toBear) {confirmed=true;label="🔄 CHoCH→BEAR";   strength=3;}
    else if(bos.bearBOS)              {confirmed=true;label="⬇️ BOS BEAR";     strength=2;}
    else if(liqSweep.highSweep)       {confirmed=true;label="💧 LIQ SWEEP↑";   strength=2;}
    else if(fvg.present)               {confirmed=true;label="🟥 FVG BEAR";    strength=1;}
  }
  const prevStr=choch.prevTrend?`Prev:${choch.prevTrend}`:"Trend:unclear";
  return{confirmed,label,strength,bos,choch,liqSweep,fvg,swings,prevStr};
}

// ── CONVICTION ENGINE ─────────────────────────────────────────────────────────
// v8.0: RSI removed. EMA bias removed. Symmetric BULL/BEAR scoring.
function computeConviction(gwp,math,ms,tfKey,isConfluence=false,isTriple=false,d1Bias='NEUTRAL'){
  let score=0;

  // GWP CORE (0–32)
  const gs=parseFloat(gwp.score);score+=gs>=7.5?32:gs>=6.5?26:gs>=5.5?18:10;

  // AVWAP TRAP — institutional liquidity anchor (12)
  if(gwp.avwapTrap) score+=12;

  // VOLUME SPIKE on signal candle (6)
  if(gwp.volumeSpike) score+=6;

  // PATH A BONUS (4)
  if(!gwp.isPathB) score+=4;

  // MOMENTUM BURST on signal bar (4)
  if(gwp.momentumBurst) score+=4;

  // ZONE REVISIT — accumulation proxy (3)
  if(gwp.zoneRevisit) score+=3;

  // MATH ENGINE — v8.0: no RSI, no EMA. Pure institutional math.
  if(math){
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

    // Z-Score — SYMMETRIC: BULL and BEAR get identical bonus
    const z=math.zScore;
    if(gwp.direction==="BULL"&&z.extremeLow)  score+=7;
    if(gwp.direction==="BEAR"&&z.extremeHigh) score+=7;
    if(gwp.direction==="BULL"&&z.mildLow)     score+=3;
    if(gwp.direction==="BEAR"&&z.mildHigh)    score+=3;

    // Kalman velocity reversal (price action momentum flip — non-lagging)
    if(math.kalman){
      const rev=(gwp.direction==="BULL"&&!math.kalman.bullish)||(gwp.direction==="BEAR"&&math.kalman.bullish);
      if(rev)score+=6;
    }

    // ATR percentile sweet zone
    if(math.atrPct>=25&&math.atrPct<=75)     score+=4;
    else if(math.atrPct>=15&&math.atrPct<=85)score+=2;

    // Volume ratio
    if(math.volRatio>=2.0)      score+=4;
    else if(math.volRatio>=1.5) score+=3;
    else if(math.volRatio>=1.2) score+=1;
  }

  // v4.0 POC QUALITY (ported from MVS v10.13 — checked against 360d/720d
  // MVS backtests before porting, not just theorized). Decisive POC (a clear
  // volume peak) outperformed contested POC by ~10pp win rate in both MVS
  // backtest windows; POC migrating WITH the trade direction underperformed
  // migration against/static (a level already "spent"/re-rated) — the
  // opposite of the original theory, so it's a penalty here, not a bonus.
  if(gwp.pocDecisive===true) score+=5;
  else if(gwp.pocDecisive===false) score-=3;
  if(gwp.pocMigration==="WITH") score-=4;

  // WYCKOFF STRUCTURAL CONFIRMATION (0–10) — Institutional cycle
  if(gwp.wyckoff){
    if(gwp.direction==="BULL"&&gwp.wyckoff.spring)   score+=10;
    if(gwp.direction==="BEAR"&&gwp.wyckoff.upthrust) score+=10;
  }

  // SINE-WAVE CYCLE GATE — contraction = cycle exhaustion = GWP reversal window (+8)
  if(math&&math.cycle&&math.cycle.contraction) score+=8;

  // MARKET STRUCTURE (0–30) — ADDITIVE, no penalty
  if(ms){
    // v3.1 Fix #11: Double-candle CHoCH scoring — confirmed = +16, single = +10
    if(ms.choch&&ms.choch.detected){
      const chochDir=(gwp.direction==="BULL"&&ms.choch.toBull)||(gwp.direction==="BEAR"&&ms.choch.toBear);
      if(chochDir) score += ms.choch.doubleConfirmed ? 16 : 10;
    }
    // v3.1 Fix #2: Volume-validated BOS scoring
    if (ms.bos) {
      const bullOk = gwp.direction==="BULL" && ms.bos.bullBOS;
      const bearOk = gwp.direction==="BEAR" && ms.bos.bearBOS;
      if (bullOk) score += ms.bos.bullBOSVolConfirmed ? 8 : 3;  // strong vs weak BOS
      if (bearOk) score += ms.bos.bearBOSVolConfirmed ? 8 : 3;
    }
    // v3.1 Fix #3: Zone-aware LiqSweep — sweep IN zone = trap confirmed = higher score
    if (ms.liqSweep) {
      const bullLS = gwp.direction==="BULL" && ms.liqSweep.lowSweep;
      const bearLS = gwp.direction==="BEAR" && ms.liqSweep.highSweep;
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
    if(ms.fvg&&ms.fvg.present)score+=3;
  }

  // v3.4: D1 BIAS — aligned +8, counter −12 (soft gate, not hard block).
  // 1-candle D1 flips instantly on reversals, so counter-trend penalty is safe.
  // Strong reversals (CHoCH+Wyckoff) can still overcome -12 with high conviction.
  // Weak counter-trend signals get filtered by the conviction gate (60+).
  if(d1Bias==='BULL'&&gwp.direction==='BULL') score+=8;
  if(d1Bias==='BEAR'&&gwp.direction==='BEAR') score+=8;
  if(d1Bias==='BULL'&&gwp.direction==='BEAR') score-=12;
  if(d1Bias==='BEAR'&&gwp.direction==='BULL') score-=12;

  // v3.2: Session-aware conviction
  const h=new Date().getUTCHours();
  if(h>=12&&h<=16) score+=3; // London/NY overlap — best signals
  else if(h>=7&&h<12) score+=1; // London
  else if(h>=0&&h<7) score-=2; // Asia — weaker signals

  // v3.2: Volatility regime
  if(math&&math.atrPct<15) score-=4; // extreme low vol — unreliable
  if(math&&math.atrPct>85) score+=2; // high vol — strong moves

  // CONFLUENCE BOOSTS
  if(isTriple)  score+=CONFIG.TRIPLE_TF_BOOST;
  else if(isConfluence) score+=CONFIG.CONFLUENCE_CONVICTION_BOOST;

  score=Math.max(0,Math.min(score,123));
  const grade=score>=108?"🏆 SUPREME★★★★":score>=96?"🏆 SUPREME★★★":score>=84?"⚡ SUPREME★★":score>=72?"🔥 SUPREME★":score>=58?"🔥 ELITE":score>=50?"✅ SOLID":"⚠️ MARGINAL";
  return{score:score.toFixed(1),grade};
}

// ── DEDUP CHECK ───────────────────────────────────────────────────────────────
function isDuplicate(symbol,direction,tfKey){
  const key=`ADUP8_${tfKey}_${symbol}_${direction}`;
  const last=getProp(key);
  return last&&(Date.now()-parseInt(last))<CONFIG.DEDUP_WINDOW_MS;
}
function markFired(symbol,direction,tfKey){
  setProp(`ADUP8_${tfKey}_${symbol}_${direction}`,Date.now().toString());
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
// v8.0: ATR floor on SL, Vol+AVWAP institutional gate, age penalty 0.5→0.75, TP3=3.0×
function detectGWP(candles,vp,avwap,math,tfCfg,symbol){
  if(!candles||candles.length<6||!vp)return null;
  const n=candles.length,cur=candles[n-1];
  const{valBandBot:bBot,valBandTop:bTop,valBandMid:bMid,rowHeight:bH}=vp;
  const minDepth=bH*CONFIG.MIN_WICK_DEPTH_PCT,minGap=bH*CONFIG.MIN_BODY_GAP_PCT;
  const atr=math?math.atr:bH*0.5,atrBuf=Math.max(bH*0.22,atr*tfCfg.atrBufMult);

  for(let age=0;age<=tfCfg.maxAge;age++){
    const sig=candles[n-2-age];if(!sig)continue;
    const bodyHi=Math.max(sig.open,sig.close),bodyLo=Math.min(sig.open,sig.close);
    let direction=null,wickDepth=0,bodyGap=0;

    if(sig.low<=bTop-minDepth&&sig.low>=bBot*0.97&&bodyLo>=bTop+minGap){
      direction="BEAR";wickDepth=bTop-Math.max(sig.low,bBot);bodyGap=bodyLo-bTop;
    }
    if(sig.high>=bBot+minDepth&&sig.high<=bTop*1.03&&bodyHi<=bBot-minGap){
      direction="BULL";wickDepth=Math.min(sig.high,bTop)-bBot;bodyGap=bBot-bodyHi;
    }
    if(!direction)continue;

    // Smarter stale check
    const staleZone=atr*((tfCfg.tf==="M15"||tfCfg.tf==="M30")?0.3:0.5);
    if(direction==="BEAR"&&cur.close<=(bMid-staleZone)){console.log(`  GWP BEAR ${tfCfg.label} age=${age}: stale`);continue;}
    if(direction==="BULL"&&cur.close>=(bMid+staleZone)){console.log(`  GWP BULL ${tfCfg.label} age=${age}: stale`);continue;}

    let avwapTrap=false;
    if(avwap){const prox=tfCfg.avwapProx;avwapTrap=Math.abs(sig.high-avwap)/avwap<=prox||Math.abs(sig.low-avwap)/avwap<=prox;}

    const sigIdx=n-2-age;
    // v3.1 Fix #9: Session-adjusted vol multiplier
    const sessionVolMult = getSessionVolMult(tfCfg.volSpikeMult);
    const volumeSpike = hasVolumeSpike(sig, candles, sigIdx, tfCfg.volLookback, sessionVolMult);
    const momentumBurst=calcMomentumBurst(candles,sigIdx);
    const zoneRevisit=calcZoneRevisit(candles,bBot,bTop);
    const wyckoff=detectWyckoff(candles,direction);
    const fib=calcFib786(candles,direction);
    const cycle=math?math.cycle:null;

    const bodyGapPct=(bodyGap/bH)*100,isPathB=bodyGapPct<35;

    // v8.0: INSTITUTIONAL GATE — at least Vol spike OR AVWAP trap must pass
    if(!volumeSpike&&!avwapTrap){
      console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: REJECTED — no vol spike AND no AVWAP trap`);
      continue;
    }

    // ── v8.0 SL: Multi-layer + ATR floor ─────────────────────────────────────
    const sigCandleRange=sig.high-sig.low,rangeBuffer=sigCandleRange*0.15;
    let sl;
    if(direction==="BEAR"){const slBase=Math.max(sig.high+atrBuf,sig.high+rangeBuffer);sl=isPathB?slBase+(slBase-cur.close)*0.30:slBase;}
    else{const slBase=Math.min(sig.low-atrBuf,sig.low-rangeBuffer);sl=isPathB?slBase-(cur.close-slBase)*0.30:slBase;}

    // Layer 3: enforce minimum SL % for crypto (v8.0: 1.2%)
    const pairVolMult=PAIR_VOL_MULT[symbol]||1.0;
    const minSlDist=(cur.close*CONFIG.CRYPTO_MIN_SL_PCT*pairVolMult/100);
    if(direction==="BEAR"&&(sl-cur.close)<minSlDist)sl=cur.close+minSlDist;
    if(direction==="BULL"&&(cur.close-sl)<minSlDist)sl=cur.close-minSlDist;

    // v8.0: ATR floor — SL must be ≥ ATR_SL_FLOOR_MULT × ATR from entry
    const atrFloor = atr * CONFIG.ATR_SL_FLOOR_MULT;
    if(direction==="BEAR"&&(sl-cur.close)<atrFloor)sl=cur.close+atrFloor;
    if(direction==="BULL"&&(cur.close-sl)<atrFloor)sl=cur.close-atrFloor;
    // v3.2: High-vol regime SL boost
    if(math&&math.atrPct>80){const boost=Math.abs(sl-cur.close)*0.20;sl=direction==="BEAR"?sl+boost:sl-boost;}
    // ─────────────────────────────────────────────────────────────────────────

    const entry=cur.close,tp2=bMid;
    // v3.4: TP1 at 40% of entry→TP2 distance (backtest: 91.7% WR, +$0.32 PnL)
    // Closer TP1 → more TP1 hits → more BE stops → dramatically higher win rate.
    // Old structural TP1 (nearest swing) was too far, causing most trades to SL before TP1.
    let tp1;
    const tp2Dist = Math.abs(entry - tp2);
    tp1 = direction === "BEAR" ? entry - tp2Dist * 0.40 : entry + tp2Dist * 0.40;
    const risk=Math.abs(entry-sl);if(risk<=0)continue;
    let rr=Math.abs(entry-tp2)/risk;
    if(rr<tfCfg.minRR){tp1=direction==="BEAR"?bBot:bTop;rr=Math.abs(entry-tp2)/risk;}
    if(rr<tfCfg.minRR){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: R:R=${rr.toFixed(2)} below gate ${tfCfg.minRR}`);continue;}

    // v8.0: TP3 = 3.0× VAL band distance (wider runner for crypto)
    const tp3=direction==="BEAR"?entry-Math.abs(entry-tp2)*CONFIG.TP3_MULT:entry+Math.abs(tp2-entry)*CONFIG.TP3_MULT;

    // v8.0: age penalty raised 0.5 → 0.75
    const agePenalty=age*0.75;
    const checks=[
      {item:`${tfCfg.label} candle CLOSED${age>0?` [${age} bars ago]`:""}`,pass:true},
      {item:"Wick penetrated INTO VAL band",                                  pass:true},
      {item:"Body OUTSIDE band ≥8%",                                          pass:bodyGapPct>=8},
      {item:"Wick depth ≥12% of band height",                                 pass:(wickDepth/bH)>=CONFIG.MIN_WICK_DEPTH_PCT},
      {item:"AVWAP Trap — institutional liquidity",                            pass:avwapTrap},
      {item:`Volume spike ≥${tfCfg.volSpikeMult}× avg`,                      pass:volumeSpike},
      {item:`R:R ≥ ${tfCfg.minRR}:1`,                                        pass:rr>=tfCfg.minRR},
      {item:"Target not yet hit (stale check)",                                pass:true},
    ];
    const rawScore=checks.filter(c=>c.pass).length,score=Math.max(0,rawScore-agePenalty);
    // v3.1 Fix #1: Zone touch penalty — fresh zones score higher
    const zoneTouches = getZoneTouchCount(candles, bBot, bTop);
    const touchPenalty = zoneTouches >= 3 ? (zoneTouches >= 5 ? 2.0 : 1.0) : 0;
    const adjustedScore = Math.max(0, score - touchPenalty);
    const zoneFreshness = zoneTouches <= 2 ? "🟢 FRESH ZONE" : zoneTouches <= 4 ? "🟡 TESTED ZONE" : "🔴 EXHAUSTED ZONE";
    if (touchPenalty > 0) console.log(`  Zone touch penalty: ${zoneTouches} touches → -${touchPenalty} score`);
    const grade=adjustedScore>=7.5?"A+★ SUPREME":adjustedScore>=6.5?"A+ ELITE":adjustedScore>=5.5?"A SOLID":"B+ VALID";
    if(adjustedScore<4.5){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: score=${adjustedScore.toFixed(1)} below threshold`);continue;}

    const dp=v=>v<0.01?6:v<1?5:v<10?4:v<1000?3:2,f=v=>Number(v).toFixed(dp(Math.abs(v)));
    const tp4=fib.level786?f(fib.level786):null;
    const reEntry=isPathB?f(direction==="BEAR"?entry+Math.abs(entry-sl)*0.8:entry-Math.abs(entry-sl)*0.8):null;
    console.log(`  ✅ GWP [${tfCfg.label}]: ${direction} | age=${age} | ${grade} | score=${adjustedScore.toFixed(1)} | R:R=${rr.toFixed(2)} | SL=${f(sl)} (${(Math.abs(entry-sl)/entry*100).toFixed(2)}%) | VolSpike=${volumeSpike} | AvwapTrap=${avwapTrap}`);

    const limitEntry = avwap ? (direction==="BEAR" ? Math.max(cur.close, avwap) : Math.min(cur.close, avwap)) : cur.close;

    // v4.0 (ported from MVS v10.13): resolve POC migration relative to THIS
    // trade's direction. Small drift (<1 row) is treated as static/noise.
    let pocMigration="STATIC";
    if (Math.abs(vp.pocMigrationRows||0) >= 1) {
      const migratingUp=(vp.pocMigrationRows||0)>0;
      const withTrade=(direction==="BULL"&&migratingUp)||(direction==="BEAR"&&!migratingUp);
      pocMigration=withTrade?"WITH":"AGAINST";
    }

    return{
      direction,grade,score:adjustedScore.toFixed(1),rawScore,age,
      pocDecisive:vp.pocDecisive,pocProminenceRatio:vp.prominenceRatio,pocMigration,
      tf:tfCfg.tf,tfLabel:tfCfg.label,
      path:isPathB?"B — Sweep + Return ⚠️":"A — Direct Return 🎯",
      isPathB,volumeSpike,avwapTrap,momentumBurst,zoneRevisit,
      entry:f(entry),sl:f(sl),tp1:f(tp1),tp2:f(tp2),tp3:f(tp3),rr:rr.toFixed(2),
      limitEntry:f(limitEntry),
      slPct:(Math.abs(entry-sl)/entry*100).toFixed(2),
      tp1Pct:(Math.abs(entry-tp1)/entry*100).toFixed(2),
      tp2Pct:(Math.abs(entry-tp2)/entry*100).toFixed(2),
      tp3Pct:(Math.abs(entry-tp3)/entry*100).toFixed(2),
      wickDepthPct:(wickDepth/bH*100).toFixed(1),bodyGapPct:bodyGapPct.toFixed(1),
      avwap:avwap?f(avwap):null,
      vp:{val:f(bBot),mid:f(bMid),top:f(bTop),poc:f(vp.poc)},
      checks,reEntry,signalTime:new Date(sig.t).toUTCString(),
      wyckoff,fib,tp4,
      cycleLabel:cycle?cycle.label:"⬜ CYCLE: —",
      cycleGate:cycle?cycle.contraction:false,
      zoneFreshness, zoneTouches,
    };
  }
  return null;
}

// ── MACRO EVENT BLACKOUT (v3.1 Fix #5 · Bug#4 Fix) ──────────────────────────
// Separate FOMC and NFP sets to prevent day-of-month ≤ 10 misclassification.
// FOMC 2026 = 18:00 UTC decisions. NFP 2026 = first Friday, 12:30 UTC.
const FOMC_DATES_2026 = new Set([
  "2026-01-29","2026-03-18","2026-05-06","2026-06-17",
  "2026-07-29","2026-09-16","2026-11-04","2026-12-16",
]);
const NFP_DATES_2026 = new Set([
  "2026-01-09","2026-02-06","2026-03-06","2026-04-03",
  "2026-05-01","2026-06-05","2026-07-10","2026-08-07",
  "2026-09-04","2026-10-02","2026-11-06","2026-12-04",
]);

function isNearMacroEvent() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const h = new Date().getUTCHours();
  const m = new Date().getUTCMinutes();
  const nowMins = h * 60 + m;
  // NFP: 12:30 UTC ± 60 min
  if (NFP_DATES_2026.has(todayStr)) {
    if (Math.abs(nowMins - (12 * 60 + 30)) <= 60) return { blocked: true, event: "NFP", date: todayStr };
  }
  // FOMC: 18:00 UTC ± 60 min
  if (FOMC_DATES_2026.has(todayStr)) {
    if (Math.abs(nowMins - (18 * 60)) <= 60) return { blocked: true, event: "FOMC", date: todayStr };
  }
  return { blocked: false };
}

// ── SESSION CONTEXT ────────────────────────────────────────────────────────────
function getSessionLabel(){
  const h=new Date().getUTCHours();
  // Check for upcoming macro event
  const macro = isNearMacroEvent();
  if (macro.blocked) return `⛔ MACRO EVENT: ${macro.event} — CAUTION`;
  if(h>=0&&h<6)  return "🌏 Asia (24/7 ✅)";
  if(h>=6&&h<12) return "🇬🇧 London (24/7 ✅)";
  if(h>=12&&h<17)return "🌍 London/NY (24/7 ✅)";
  if(h>=17&&h<21)return "🇺🇸 New York (24/7 ✅)";
  return "🌙 Off-hours (24/7 ✅)";
}

// ── SESSION VOL MULTIPLIER (v3.1 Fix #9) ─────────────────────────────────────
// Tighten vol gate during low-liquidity hours. Asian thin hours produce ghost
// spikes at 1.2× of thin volume that would fail at peak London+NY hours.
function getSessionVolMult(baseMult) {
  const h = new Date().getUTCHours();
  if (h >= 12 && h <= 16) return baseMult;          // London+NY overlap: standard gate
  if (h >= 7  && h < 12)  return baseMult * 1.2;   // London open: slightly stricter
  if (h >= 17 && h < 21)  return baseMult * 1.1;   // NY afternoon: mild tightening
  if (h >= 0  && h < 7)   return baseMult * 1.5;   // Asian thin: 50% stricter
  return baseMult * 1.3;                             // Dead zone: 30% stricter
}

// ── COOLDOWNS ──────────────────────────────────────────────────────────────────
function isOnCooldown(symbol,direction,tfKey){
  const last=getProp(`acd8_${tfKey}_${symbol}_${direction}`);
  return last&&(Date.now()-parseInt(last))/3600000<TF_CONFIG[tfKey].cooldownHrs;
}
function setCooldown(symbol,direction,tfKey){setProp(`acd8_${tfKey}_${symbol}_${direction}`,Date.now().toString());}

// ── CIRCUIT BREAKER ────────────────────────────────────────────────────────────
function isCircuitBroken(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return false;
  const raw=getProp("ACB8_"+symbol);if(!raw)return false;
  try{const cb=JSON.parse(raw);if(Date.now()-cb.ts<CONFIG.CIRCUIT_BREAKER_HRS*3600000)return true;delProp("ACB8_"+symbol);}catch(e){}
  return false;
}
async function recordLoss(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return;
  const key="ACBL8_"+symbol,n=parseInt(getProp(key)||"0")+1;setProp(key,n.toString());
  if(n>=CONFIG.CIRCUIT_BREAKER_LOSSES){setProp("ACB8_"+symbol,JSON.stringify({ts:Date.now(),losses:n}));delProp(key);await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol}</b>\n${n} losses in window. Paused ${CONFIG.CIRCUIT_BREAKER_HRS}h.\n\n<i>${V}</i>`);}
}
function recordWin(symbol){if(CONFIG.CIRCUIT_BREAKER)delProp("ACBL8_"+symbol);}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(symbol,r,conv,tfKey){
  setProp("APOS8_"+symbol+"_"+r.direction+"_"+tfKey,JSON.stringify({
    symbol,direction:r.direction,entry:parseFloat(r.entry),sl:parseFloat(r.sl),
    tp1:parseFloat(r.tp1),tp2:parseFloat(r.tp2),tp3:parseFloat(r.tp3),
    rr:r.rr,grade:r.grade,tf:tfKey,conviction:conv?conv.score:"?",
    isPathB:r.isPathB,reEntry:r.reEntry,state:"OPEN",tp1hit:false,tp2hit:false,sizeRemaining:1.0,ts:Date.now(),
  }));
  appendSignalToFile(symbol, r, conv, tfKey);
}

// ── OPEN POSITION MONITOR ─────────────────────────────────────────────────────
// v8.1 FIX: Secondary TP dedup keys (ATPD8_) prevent repeat TP alerts.
// Two-barrier system: position.tp1hit flag AND a standalone timestamp key
// must BOTH be clear before a TP1 alert fires. If git push fails and the
// state file reverts, the dedup key provides an additional window of protection.
async function checkOpenPositions(){
  const posKeys=Object.keys(state).filter(k=>k.startsWith("APOS8_"));
  for(const key of posKeys){
    let p;try{p=JSON.parse(getProp(key));}catch(e){continue;}
    if(!p||p.state!=="OPEN")continue;
    let candles=null;
    try{candles=await fetchKlines(p.symbol,"M15",3);}catch(e){}
    if(!candles||!candles.length)continue;
    // v3.1 Fix: use candle high/low for SL/TP checks — catches intracandle touches
    const last=candles[candles.length-1];
    const price=last.close,hi=last.high,lo=last.low,isL=p.direction==="BULL";
    const pnl=((isL?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(3);
    const dp=v=>v<0.01?6:v<1?5:v<10?4:v<1000?3:2;
    const f=n=>Number(n).toFixed(dp(Math.abs(n)));
    let msg=null;

    // ── v8.1: Secondary TP dedup keys ─────────────────────────────────────────
    // ATPD8_<posKey>_1 / _2 store timestamps of last TP alert sent.
    // Check both the position flag AND the standalone dedup key.
    const tp1DedupKey=`ATPD8_${key}_1`;
    const tp2DedupKey=`ATPD8_${key}_2`;
    const tp1DedupTs =parseInt(getProp(tp1DedupKey)||"0");
    const tp2DedupTs =parseInt(getProp(tp2DedupKey)||"0");
    const tp1Sent    =p.tp1hit||(tp1DedupTs>0&&(Date.now()-tp1DedupTs)<CONFIG.TP_HIT_DEDUP_MS);
    const tp2Sent    =p.tp2hit||(tp2DedupTs>0&&(Date.now()-tp2DedupTs)<CONFIG.TP_HIT_DEDUP_MS);
    // ─────────────────────────────────────────────────────────────────────────

    // Use high for BULL TP checks, low for BEAR TP checks (intracandle detection)
    if(!tp1Sent&&(isL?hi>=p.tp1:lo<=p.tp1)){
      p.tp1hit=true;
      p.sl=p.entry; // v3.2: move SL to breakeven
      p.sizeRemaining=0.6; // v3.2: 40% exited
      setProp(tp1DedupKey,Date.now().toString()); // v8.1: secondary dedup key
      msg=`🎯 <b>GWP TP1 HIT — ${p.symbol} [${p.tf}]</b>\n40% exit. SL moved to BE: <code>${f(p.entry)}</code>\nRemaining: 60%\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;
    }
    if(!tp2Sent&&(isL?hi>=p.tp2:lo<=p.tp2)){
      p.tp2hit=true;
      p.sl=p.tp1; // v3.2: trail SL to TP1 level
      p.sizeRemaining=0.3; // v3.2: another 30% exited
      setProp(tp2DedupKey,Date.now().toString()); // v8.1: secondary dedup key
      msg=`🏆 <b>GWP TP2 HIT — ${p.symbol} [${p.tf}]</b> 🔥\nHold 20% for TP3: <code>${f(p.tp3)}</code>\nSL trailing TP1: <code>${f(p.tp1)}</code>\nRemaining: 30%\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;
    }
    if(p.tp2hit&&(isL?hi>=p.tp3:lo<=p.tp3)){const partialPnl=(parseFloat(pnl)*(p.sizeRemaining||0.3)).toFixed(3);msg=`🏅 <b>GWP TP3 HIT! — ${p.symbol} [${p.tf}]</b> 💎\nFull exit (final ${((p.sizeRemaining||0.3)*100).toFixed(0)}%). P&L: <b>+${partialPnl}%</b> (on remaining)\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,true,null);}
    // Use candle high for BEAR SL (wick through SL), candle low for BULL SL
    if(isL?lo<=p.sl:hi>=p.sl){const szRem=p.sizeRemaining||1.0;const adjPnl=(parseFloat(pnl)*szRem).toFixed(3);const pbN=p.isPathB?`\n⚡ Path B re-entry: <code>${p.reEntry||"zone"}</code>`:"";msg=`❌ <b>GWP SL HIT — ${p.symbol} [${p.tf}]</b>\n${p.direction} ${f(p.entry)} → SL ${f(p.sl)}\nRemaining: ${(szRem*100).toFixed(0)}%\nP&L: <b>${adjPnl}%</b>${pbN}\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,adjPnl,false,null);}
    if(msg){await tgSend(msg);if(p.state==="CLOSED")delProp(key);else setProp(key,JSON.stringify(p));}else{setProp(key,JSON.stringify(p));}
  }
}

// ── TRACKING ───────────────────────────────────────────────────────────────────
function getDateKey(){return new Date().toISOString().slice(0,10);}
function getWeekKey(){const now=new Date(),s=new Date(now.getFullYear(),0,1);return now.getFullYear()+"_W"+String(Math.ceil(((now-s)/86400000+s.getDay()+1)/7)).padStart(2,"0");}
function trackFired(symbol,r,mode){
  const dk="A8_D_"+getDateKey();let d;try{d=JSON.parse(getProp(dk)||"[]");}catch(e){d=[];}
  d.push({sym:symbol,dir:r.direction,grade:r.grade,tf:r.tf,mode,rr:r.rr,ts:Date.now()});setProp(dk,JSON.stringify(d));
  const wk="A8_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  w.signals=(w.signals||0)+1;
  w.byTf=w.byTf||{};w.byTf[mode]=(w.byTf[mode]||0)+1;
  setProp(wk,JSON.stringify(w));
}
// v3.1 Fix #10: Enhanced performance tracker with conviction score + weekly report
async function trackClose(symbol, direction, pnlPct, isWin, convScore = null) {
  const wk = "A8_W_" + getWeekKey(); let w; try { w = JSON.parse(getProp(wk) || "{}"); } catch(e) { w = {}; }
  if (isWin) { w.wins = (w.wins || 0) + 1; recordWin(symbol); } else { w.losses = (w.losses || 0) + 1; await recordLoss(symbol); }
  const pnlFloat = parseFloat(pnlPct || 0);
  w.pnl = parseFloat(((w.pnl || 0) + pnlFloat).toFixed(3));
  // v3.6: Update cumulative P&L for compounding engine
  const cumPnl = updateCumulativePnl(pnlFloat);
  const eCap = getEffectiveCapital();
  console.log(`  💰 Compounding: cumPnl=${cumPnl}%, effectiveCapital=$${eCap.capital}`);
  appendEquityPoint(pnlFloat, cumPnl); // v4.0: log this closed trade to the equity curve
  // v3.2: Per-pair stats
  if(!w.byPair) w.byPair={};
  if(!w.byPair[symbol]) w.byPair[symbol]={wins:0,losses:0,pnl:0};
  w.byPair[symbol][isWin?'wins':'losses']++;
  w.byPair[symbol].pnl+=pnlFloat;
  // Track best/worst trade
  if (w.bestPnl === undefined || pnlFloat > w.bestPnl) { w.bestPnl = pnlFloat; w.bestSym = symbol; }
  if (w.worstPnl === undefined || pnlFloat < w.worstPnl) { w.worstPnl = pnlFloat; w.worstSym = symbol; }
  // Track avg conviction of winners vs losers
  if (convScore !== null) {
    if (isWin) { w.winConvSum = (w.winConvSum || 0) + convScore; w.winConvN = (w.winConvN || 0) + 1; }
    else       { w.lossConvSum = (w.lossConvSum || 0) + convScore; w.lossConvN = (w.lossConvN || 0) + 1; }
  }
  setProp(wk, JSON.stringify(w));
}
async function sendWeeklyReport() {
  let w; try { w = JSON.parse(getProp("A8_W_" + getWeekKey()) || "{}"); } catch(e) { w = {}; }
  const closed = (w.wins || 0) + (w.losses || 0);
  const wr = closed > 0 ? ((w.wins || 0) / closed * 100).toFixed(1) + "%" : "—";
  const avgWinConv = w.winConvN  ? (w.winConvSum  / w.winConvN).toFixed(1)  : "—";
  const avgLossConv= w.lossConvN ? (w.lossConvSum / w.lossConvN).toFixed(1) : "—";
  let msg = `📊 <b>GWP CRYPTO — WEEKLY PERFORMANCE REPORT</b>\n`;
  msg += `📆 ${getWeekKey().replace("_", " ")}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📡 Signals: ${w.signals || 0}  |  By TF: ${w.byTf ? Object.entries(w.byTf).map(([tf,n])=>`${tf}:${n}`).join(" ") : "—"}\n`;
  if (closed > 0) {
    msg += `✅ Wins: ${w.wins || 0}  ❌ Losses: ${w.losses || 0}  |  Win Rate: <b>${wr}</b>\n`;
    msg += `💰 Net P&L: <b>${(w.pnl || 0) >= 0 ? "+" : ""}${w.pnl || 0}%</b>\n`;
    if (w.bestSym)  msg += `🏆 Best:  ${w.bestSym} +${w.bestPnl}%\n`;
    if (w.worstSym) msg += `💀 Worst: ${w.worstSym} ${w.worstPnl}%\n`;
    msg += `🧠 Avg Conv — Wins: ${avgWinConv} | Losses: ${avgLossConv}\n`;
  } else { msg += `  No closed trades this week.\n`; }
  if(w.byPair){
    msg += `\n📊 <b>By Pair:</b>\n`;
    for(const [sym,d] of Object.entries(w.byPair)){
      const t=d.wins+d.losses;
      msg += `  ${sym}: ${d.wins}W/${d.losses}L (${t>0?((d.wins/t)*100).toFixed(0):'—'}%) P&L: ${d.pnl>=0?'+':''}${d.pnl.toFixed(2)}%\n`;
    }
  }
  // v3.6: Compounding status
  const eCap = getEffectiveCapital();
  msg += `\n📈 <b>Compounding:</b> $${eCap.capital.toFixed(2)} effective (${eCap.cumPnlPct>=0?'+':''}${eCap.cumPnlPct.toFixed(2)}% cumulative)\n`;
  // v4.0: equity curve summary (ported from MVS) — peak/drawdown over all
  // logged closes, not just this week's, since drawdown is a running concept.
  const eq = getEquityStats();
  if (eq) msg += `📉 <b>Equity Curve:</b> index ${eq.current.toFixed(2)} (peak ${eq.peak.toFixed(2)}, max DD ${eq.maxDrawdownPct}%) · ${eq.points} closes logged\n`;
  msg += `\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;
  await tgSend(msg);
}
function symLabel(s){return s.replace("-USDT","");}

// ── SIGNAL FORMATTERS v8.0 ───────────────────────────────────────────────────
function getTradeType(tfKey,isConfluence,isTriple){
  if(isTriple)     return "🔥🔥🔥 INSTITUTIONAL PRIME";
  if(isConfluence) return "🔥🔥 CONFLUENCE SWING";
  if(tfKey==="H4") return "📈 INTRADAY";
  if(tfKey==="H1") return "⚡ SCALP";
  if(tfKey==="M15")return "🔬 MICRO SCALP";
  return "📊 SWING";
}
function msLine(ms,direction){
  if(!ms||!ms.confirmed)return"🟡 <b>MS: UNCONFIRMED</b>";
  const choch=ms.choch&&ms.choch.detected?(direction==="BULL"&&ms.choch.toBull?"🔄 CHoCH→BULL ✅":direction==="BEAR"&&ms.choch.toBear?"🔄 CHoCH→BEAR ✅":""):"";
  const bos=ms.bos?((direction==="BULL"&&ms.bos.bullBOS)?"⬆️ BOS↑ ✅":(direction==="BEAR"&&ms.bos.bearBOS)?"⬇️ BOS↓ ✅":""):"";
  const ls=ms.liqSweep?((direction==="BULL"&&ms.liqSweep.lowSweep)?"💧 LiqSwp↓ ✅":(direction==="BEAR"&&ms.liqSweep.highSweep)?"💧 LiqSwp↑ ✅":""):"";
  const fvg=ms.fvg&&ms.fvg.present?"🟦 FVG ✅":"";
  return[choch,bos,ls,fvg].filter(Boolean).join("  ");
}
function confBox(r){
  const tags=[];
  if(r.avwapTrap)     tags.push("🪤 AVWAP TRAP");
  if(r.momentumBurst) tags.push("⚡ MOM BURST");
  if(r.zoneRevisit)   tags.push("🔄 ZONE REVISIT");
  if(r.volumeSpike)   tags.push("📊 VOL SPIKE");
  if(r.wyckoff&&r.wyckoff.spring&&r.direction==="BULL") tags.push("🟢 WYK SPRING");
  if(r.wyckoff&&r.wyckoff.upthrust&&r.direction==="BEAR") tags.push("🔴 WYK UPTHRUST");
  if (r._trapConfirmed) tags.push("🎯 TRAP CONFIRMED");
  return tags.length?tags.join("  ·  "):"";
}
function checklistBlock(checks){
  return checks.map((c,i)=>`${c.pass?"✅":"⬜"}  ${c.item}`).join("\n");
}

// ── COMPOUNDING CAPITAL ENGINE (v3.6) ────────────────────────────────────────
// Tracks cumulative realized P&L and adjusts effective capital for compounding.
// Base capital grows/shrinks with realized returns. Resets weekly floor.
function getEffectiveCapital() {
  const base = CONFIG.CAPITAL;  // $50
  try {
    const cumPnlPct = parseFloat(getProp("A8_CUM_PNL") || "0");
    // Compound: effective = base × (1 + cumPnlPct/100)
    // Floor at 80% of base (drawdown protection) — never risk below $40
    // Cap at 300% of base ($150) — prevents over-leverage on hot streaks
    const raw = base * (1 + cumPnlPct / 100);
    const effective = Math.max(base * 0.8, Math.min(base * 3.0, raw));
    return { capital: parseFloat(effective.toFixed(2)), cumPnlPct, isCompounding: cumPnlPct > 0 };
  } catch(e) { return { capital: base, cumPnlPct: 0, isCompounding: false }; }
}
function updateCumulativePnl(tradePnlPct) {
  const current = parseFloat(getProp("A8_CUM_PNL") || "0");
  const updated = parseFloat((current + tradePnlPct).toFixed(3));
  setProp("A8_CUM_PNL", String(updated));
  return updated;
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

// ── SIGNAL QUALITY SCORE (v3.1 Fix #12) ──────────────────────────────────────
// Measures % of institutional criteria met (0–100%)
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

// ── COMPACT SIGNAL FORMAT v8.0 ────────────────────────────────────────────────
function formatSingleSignal(r,symbol,conv,ms,_label,d1Bias='NEUTRAL',math=null){
  const isBull=r.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dir=isBull?"LONG ▲":"SHORT ▼";
  const pairLabel=symLabel(symbol)+"/USDT";
  const tags=confBox(r);
  const tp4Note=r.tp4?`  ·  <b>TP4</b> <code>${r.tp4}</code>`:"";
  const pbNote=r.isPathB?`\n⚠️  <b>PATH B</b>  Re-enter: <code>${r.reEntry}</code>`:"";
  const _isAl=(d1Bias==='BULL'&&r.direction==='BULL')||(d1Bias==='BEAR'&&r.direction==='BEAR');
  const biasNote=d1Bias!=='NEUTRAL'?`  ·  D1: <b>${d1Bias}</b> ${_isAl?'✅':'⚠️ CT'}`:''  ;
  const ageNote=r.age>0?`  ·  <i>${r.age}b ago</i>`:"";
  // v3.1 Fix #12: Signal quality score
  const sq=computeSignalQuality(r,ms,math);
  const sqLine=`🏅  Quality: <b>${sq.pct}%</b> ${sq.grade} (${sq.passed}/${sq.total} criteria)\n`;
  return(
    `\n`+
    `🎯  <b>GWP · ${pairLabel} · ${dir} [${r.tfLabel}]</b>\n`+
    (_label?`${_label}\n`:"")+
    `${dirEmoji}  <b>${conv.score}/123</b>  ·  ${conv.grade}  ·  R:R <b>${r.rr}:1</b>${ageNote}${biasNote}\n`+
    `─────────────────────────────\n`+
    `<b>ENTRY</b>  <code>${r.entry}</code>   <b>SL</b>  <code>${r.sl}</code>  (-${r.slPct}%)\n`+
    (r.limitEntry && Math.abs(parseFloat(r.limitEntry) - parseFloat(r.entry)) / parseFloat(r.entry) > 0.001
      ? `📍  <b>LIMIT</b>  <code>${r.limitEntry}</code>  (better fill vs market)\n` : "")+
    `<b>TP1</b>  <code>${r.tp1}</code>  ·  <b>TP2</b>  <code>${r.tp2}</code>  ·  <b>TP3</b>  <code>${r.tp3}</code>${tp4Note}\n`+
    `─────────────────────────────\n`+
    `📐  Size: <b>${getSizeMult(parseFloat(conv.score)).label}</b>\n`+
    sqLine+
    (tags?`🔑  ${tags}\n`:"")+
    `  ${msLine(ms,r.direction)||"🟡 MS: UNCONFIRMED"}\n`+
    `${pbNote}\n`+
    (r._fundingLabel ? `${r._fundingLabel}\n` : "") +
    `⏰  ${new Date().toUTCString()}\n`+
    `<i>${V}</i>`
  );
}

function formatConfluenceSignal(r4h,r1h,symbol,conv4h,conv1h,ms4h,ms1h,d1Bias){
  const isBull=r4h.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dirWord =isBull?"LONG  ▲":"SHORT  ▼";
  const eCap=getEffectiveCapital();
  const riskUSD=eCap.capital*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const compLabel=eCap.isCompounding?`  📈 +${eCap.cumPnlPct.toFixed(1)}%`:"";
  const conf=confBox(r4h)||confBox(r1h);
  const biasNote=d1Bias!=='NEUTRAL'?`  ·  📅 D1: <b>${d1Bias}</b>`:"";
  const pbNote=r4h.isPathB?`\n⚠️  <b>PATH B</b> — sweep zone · Re-enter: <code>${r4h.reEntry}</code>`:"";
  return(
    `\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `🔥🔥  <b>CONFLUENCE  ·  ${symLabel(symbol)}/USDT</b>  🔥🔥\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `\n`+
    `${dirEmoji}  <b>${dirWord}</b>   🔥🔥 CONFLUENCE SWING   [4H+1H]\n`+
    `\n`+
    `⚡  Conviction 4H:  <b>${conv4h.score} / 123</b>   —   ${conv4h.grade}\n`+
    `⚡  Conviction 1H:  <b>${conv1h.score} / 123</b>\n`+
    `🕐  ${getSessionLabel()}${biasNote}\n`+
    (conf?`\n🔆  ${conf}\n`:"")+
    `${pbNote}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `💼  <b>TRADE LEVELS</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `🎯  <b>ENTRY</b>       <code>${r4h.entry}</code>   (4H basis)\n`+
    `⚡  <b>PRECISE</b>     <code>${r1h.entry}</code>   (1H limit)\n`+
    `🛑  <b>STOP</b>        <code>${r4h.sl}</code>      <b>-${r4h.slPct}%</b>\n`+
    `\n`+
    `✅  <b>TP1</b>         <code>${r4h.tp1}</code>     +${r4h.tp1Pct}%  · 40% exit\n`+
    `🏆  <b>TP2</b>         <code>${r4h.tp2}</code>     +${r4h.tp2Pct}%  · 40% / BE\n`+
    `💎  <b>TP3</b>         <code>${r4h.tp3}</code>     +${r4h.tp3Pct}%  · 20% runner\n`+
    `\n`+
    `📐  <b>R:R</b>   <b>${r4h.rr} : 1</b>  (4H)   ·   ${r1h.rr} : 1  (1H)\n`+
    `💼  Risk: $${riskUSD.toFixed(2)}   ·   Pos: $${posUSD.toFixed(0)}   (${CONFIG.LEVERAGE}×)${compLabel}\n`+
    `📐  <b>Size:</b>  ${getSizeMult(parseFloat(conv4h.score)).label}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `🏛  <b>MARKET STRUCTURE</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `  <b>4H</b>  ${ms4h?ms4h.label:"⬜"}\n`+
    `      ${msLine(ms4h,r4h.direction)}\n`+
    `\n`+
    `  <b>1H</b>  ${ms1h?ms1h.label:"⬜"}\n`+
    `      ${msLine(ms1h,r1h.direction)}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `📊  <b>4H BAND  ·  LEVELS</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `  Band      <code>${r4h.vp.val}  –  ${r4h.vp.top}</code>\n`+
    `  Mid       <code>${r4h.vp.mid}</code>   ← target\n`+
    `  POC       <code>${r4h.vp.poc}</code>\n`+
    (r4h.avwap?`  AVWAP    <code>${r4h.avwap}</code>\n`:"")+
    `\n`+
    `─────────────────────────────\n`+
    `🔬  <b>THEORY  ·  ANALYSIS</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `  ${r4h.wyckoff?r4h.wyckoff.label:"⬜ WYK: —"}\n`+
    `  ${r4h.cycleLabel}\n`+
    `  ${r4h.fib?r4h.fib.label:"⬜ EW: —"}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `✅  <b>4H CHECKLIST  (${r4h.checks.filter(c=>c.pass).length}/${r4h.checks.length})</b>\n`+
    `─────────────────────────────\n`+
    `\n${checklistBlock(r4h.checks)}\n`+
    `\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `⏰  ${new Date().toUTCString()}\n`+
    `<i>${V}</i>\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

function formatTripleSignal(r4h,r1h,r15m,symbol,c4h,c1h,c15m,ms4h,ms1h,ms15m,d1Bias){
  const isBull=r4h.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dirWord =isBull?"LONG  ▲":"SHORT  ▼";
  const eCap=getEffectiveCapital();
  const riskUSD=eCap.capital*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const compLabel=eCap.isCompounding?`  📈 +${eCap.cumPnlPct.toFixed(1)}%`:"";
  const conf=confBox(r4h)||confBox(r1h)||confBox(r15m);
  const biasNote=d1Bias!=='NEUTRAL'?`  ·  📅 D1: <b>${d1Bias}</b>`:"";
  return(
    `\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `🔥🔥🔥  <b>TRIPLE TF  ·  ${symLabel(symbol)}/USDT</b>  🔥🔥🔥\n`+
    `<b>★★ INSTITUTIONAL PRIME — ELITE MAX™ v8.0 ★★</b>\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `\n`+
    `${dirEmoji}  <b>${dirWord}</b>   🔥🔥🔥 INSTITUTIONAL PRIME   [4H+1H+15M]\n`+
    `\n`+
    `⚡  Conviction 4H:   <b>${c4h.score} / 123</b>   —   ${c4h.grade}\n`+
    `⚡  Conviction 1H:   <b>${c1h.score} / 123</b>\n`+
    `⚡  Conviction 15M:  <b>${c15m.score} / 123</b>\n`+
    `🕐  ${getSessionLabel()}${biasNote}\n`+
    (conf?`\n🔆  ${conf}\n`:"")+
    `\n`+
    `─────────────────────────────\n`+
    `💼  <b>TRADE LEVELS</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `🎯  <b>ENTRY</b>       <code>${r4h.entry}</code>   (4H basis)\n`+
    `🔬  <b>SNIPER</b>      <code>${r15m.entry}</code>   (15M limit)\n`+
    `🛑  <b>STOP</b>        <code>${r4h.sl}</code>      <b>-${r4h.slPct}%</b>\n`+
    `\n`+
    `✅  <b>TP1</b>         <code>${r4h.tp1}</code>     +${r4h.tp1Pct}%  · 40% exit\n`+
    `🏆  <b>TP2</b>         <code>${r4h.tp2}</code>     +${r4h.tp2Pct}%  · 40% / BE\n`+
    `💎  <b>TP3</b>         <code>${r4h.tp3}</code>     +${r4h.tp3Pct}%  · 20% runner\n`+
    `\n`+
    `📐  <b>R:R</b>   <b>${r4h.rr} : 1</b>\n`+
    `💼  Risk: $${riskUSD.toFixed(2)}   ·   Pos: $${posUSD.toFixed(0)}   (${CONFIG.LEVERAGE}×)${compLabel}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `🏛  <b>MARKET STRUCTURE  —  3 TF CONFIRMED</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `  <b>4H</b>  ${ms4h?ms4h.label:"⬜"}  ·  ${msLine(ms4h,r4h.direction)}\n`+
    `  <b>1H</b>  ${ms1h?ms1h.label:"⬜"}  ·  ${msLine(ms1h,r1h.direction)}\n`+
    `  <b>15M</b> ${ms15m?ms15m.label:"⬜"}  ·  ${msLine(ms15m,r15m.direction)}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `📊  <b>4H BAND  ·  LEVELS</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `  Band      <code>${r4h.vp.val}  –  ${r4h.vp.top}</code>\n`+
    `  Mid       <code>${r4h.vp.mid}</code>   ← target\n`+
    `  POC       <code>${r4h.vp.poc}</code>\n`+
    (r4h.avwap?`  AVWAP    <code>${r4h.avwap}</code>\n`:"")+
    `  1H Band   <code>${r1h.vp.val}  –  ${r1h.vp.top}</code>\n`+
    `  15M Zone  <code>${r15m.vp.val}  –  ${r15m.vp.top}</code>\n`+
    `\n`+
    `─────────────────────────────\n`+
    `🔬  <b>THEORY  ·  ANALYSIS</b>\n`+
    `─────────────────────────────\n`+
    `\n`+
    `  ${r4h.wyckoff?r4h.wyckoff.label:"⬜ WYK: —"}\n`+
    `  ${r4h.cycleLabel}\n`+
    `  ${r4h.fib?r4h.fib.label:"⬜ EW: —"}\n`+
    `\n`+
    `─────────────────────────────\n`+
    `✅  <b>4H CHECKLIST  (${r4h.checks.filter(c=>c.pass).length}/${r4h.checks.length})</b>\n`+
    `─────────────────────────────\n`+
    `\n${checklistBlock(r4h.checks)}\n`+
    `\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `⏰  ${new Date().toUTCString()}\n`+
    `<i>${V}</i>\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

// ── INFO COMMANDS ─────────────────────────────────────────────────────────────
async function sendDailySummary(){
  const today=getDateKey();let d;try{d=JSON.parse(getProp("A8_D_"+today)||"[]");}catch(e){d=[];}
  let msg=`📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if(!d.length)msg+=`📊 <b>Signals: 0</b>\nScanning 24/7. No setups triggered today.\n\n`;
  else{msg+=`📊 <b>Signals: ${d.length}</b>\n`;d.forEach(s=>{msg+=`  ${s.dir==="BULL"?"🟢":"🔴"} ${s.sym} [${s.tf}] ${s.mode||""} | ${s.grade} | R:R ${s.rr}\n`;});msg+="\n";}
  msg+=`⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendWeeklySummary(){
  let w;try{w=JSON.parse(getProp("A8_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const closed=(w.wins||0)+(w.losses||0),wr=closed>0?((w.wins||0)/closed*100).toFixed(0)+"%":"—";
  let msg=`📆 <b>WEEKLY SUMMARY — ${getWeekKey().replace("_"," ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg+=`📊 Signals: ${w.signals||0}  By TF: ${w.byTf?Object.entries(w.byTf).map(([tf,n])=>`${tf}:${n}`).join(" "):"—"}\n`;
  if(closed>0)msg+=`✅ ${w.wins||0}W  ❌ ${w.losses||0}L  Win Rate: <b>${wr}</b>\n💰 Net P&L: <b>${(w.pnl||0)>=0?"+":""}${w.pnl||0}%</b>\n`;
  else msg+=`  No closed trades yet.\n`;
  // v3.6: Compounding status
  const eCap2 = getEffectiveCapital();
  msg+=`📈 Capital: $${eCap2.capital.toFixed(2)} (${eCap2.cumPnlPct>=0?'+':''}${eCap2.cumPnlPct.toFixed(2)}% cum)\n`;
  msg+=`\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendHealth(){
  let msg=`💚 <b>GWP Crypto v3.6 ELITE MAX — HEALTH</b>\n\n`;
  for(const symbol of CONFIG.PAIRS){
    let price="?";
    try{const c=await fetchKlines(symbol,"H1",2);if(c&&c.length)price=c[c.length-1].close;}catch(e){}
    const cb=isCircuitBroken(symbol)?" ⛔CB":"";
    msg+=`${price!=="?"?"✅":"❌"} ${symbol}: ${price!=="?"?"$"+price:"NO DATA"}${cb}\n`;
  }
  msg+=`\n🕐 ${getSessionLabel()}\n`;
  msg+=`🔄 Scanning: 24/7 — No dead periods\n`;
  msg+=`📅 Last scan: ${state.lastScanTime||"never"}\n`;
  msg+=`🔥 Last fired: ${state.lastScanFired||0} signals\n`;
  msg+=`⚙️ v3.1: Zone-aware · Structural TP1 · Session vol · Macro blackout · 12-Fix Institutional\n\n<i>${V}</i>`;await tgSend(msg);
}
async function sendStatus(){
  let w;try{w=JSON.parse(getProp("A8_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const openCount=Object.keys(state).filter(k=>k.startsWith("APOS8_")).length;
  await tgSend(
    `📡 <b>GWP Crypto v3.1 ELITE MAX — ONLINE</b> ✅\n\n`+
    `Pairs: ${CONFIG.PAIRS.map(s=>s.replace("-USDT","")).join(", ")}\n`+
    `TFs: 1D + 4H + 1H + 30M + 15M — 3-of-5 vote + entry trigger\n`+
    `Gates: D1≥${TF_CONFIG.D1.minConviction} | 4H≥${TF_CONFIG.H4.minConviction} | 1H≥${TF_CONFIG.H1.minConviction} | 30M≥${TF_CONFIG.M30.minConviction} | 15M≥${TF_CONFIG.M15.minConviction}\n`+
    `Session: 24/7 — ALWAYS ON\n`+
    `Confluence: +${CONFIG.CONFLUENCE_CONVICTION_BOOST} | Triple: +${CONFIG.TRIPLE_TF_BOOST}\n`+
    `SL: crypto min ${CONFIG.CRYPTO_MIN_SL_PCT}% | ATR floor ${CONFIG.ATR_SL_FLOOR_MULT}×ATR\n`+
    `TP3 mult: ${CONFIG.TP3_MULT}× | minRR 4H: ${TF_CONFIG.H4.minRR}\n`+
    `Open positions: ${openCount}\n`+
    `This week: ${w.signals||0} signals | ${w.wins||0}W ${w.losses||0}L\n\n`+
    `<i>${V}</i>`
  );
}
async function sendPositions(){
  const keys=Object.keys(state).filter(k=>k.startsWith("APOS8_"));
  if(!keys.length){await tgSend(`📭 No open positions.\n\n<i>${V}</i>`);return;}
  let msg=`📊 <b>Open GWP Positions</b>\n\n`;
  for(const k of keys){try{const p=JSON.parse(getProp(k));msg+=`${p.direction==="BULL"?"🟢":"🔴"} <b>${p.symbol}</b> ${p.direction} [${p.tf}]\n  Entry: ${p.entry}  SL: ${p.sl}  TP2: ${p.tp2}  TP3: ${p.tp3}  Conv: ${p.conviction}/123\n\n`;}catch(e){}}
  await tgSend(msg+`<i>${V}</i>`);
}
async function sendHelp(){
  await tgSend(
    `👻 <b>GWP CRYPTO v3.1 ELITE MAX™</b>\n`+
    `<b>Money Printing Machine — 24/7 Always On</b>\n\n`+
    `<b>Commands:</b>\n`+
    `/scan — full scan (1D+4H+1H+30M+15M)\n`+
    `/dexe · /uni · /comp · /sol · /sushi · /btc · /link\n`+
    `/daily · /weekly · /health · /positions · /status · /reset · /help\n\n`+
    `<b>v5.0 Engine:</b>\n`+
    `▸ 👻 GWP — VAL band wick (king)\n`+
    `▸ 📐 Math — Hurst · Z · Kalman · ATR% · Volume (NO lagging indicators)\n`+
    `▸ 🏛 MS — CHoCH · BOS · LiqSweep · FVG (additive, no penalty)\n`+
    `▸ 🗳️ 5-TF Vote: 1D+4H+1H+30M+15M, 3-of-5 must agree on direction\n`+
    `▸ 🎯 Entry trigger: fastest TF with a live GWP pattern + confirmations fires the trade\n`+
    `▸ 💎 TP3 = 3.0× VAL band (big crypto moves need big targets)\n`+
    `▸ 🛑 ATR floor: SL always ≥ 1.5× ATR from entry\n`+
    `▸ 🚪 Vol+AVWAP gate: at least 1 must pass\n`+
    `▸ 📏 SL: min 1.2% for all crypto positions\n\n`+
    `<i>Every candle. Every session. Zero downtime.</i>\n\n`+
    `<i>${V}</i>`
  );
}
async function resetCooldowns(){
  // v8.1: also clears ATPD8_ TP dedup keys
  let n=0;for(const k of Object.keys(state)){if(k.startsWith("acd8_")||k.startsWith("APOS8_")||k.startsWith("ACB8_")||k.startsWith("ACBL8_")||k.startsWith("ADUP8_")||k.startsWith("ATPD8_")){delProp(k);n++;}}
  await tgSend(`✅ Cleared ${n} cooldowns/positions/dedups/circuit-breakers/tp-guards.\n\n<i>${V}</i>`);
}

// ── SINGLE PAIR SCAN ──────────────────────────────────────────────────────────
async function scanSingle(symbol){
  const c4h=await fetchKlines(symbol,"H4",TF_CONFIG.H4.vpLookback+50);
  const c1h=await fetchKlines(symbol,"H1",TF_CONFIG.H1.vpLookback+80);
  const c15m=await fetchKlines(symbol,"M15",TF_CONFIG.M15.vpLookback+100);
  const cd1=await fetchKlines(symbol,"D1",30);
  const d1Bias=getD1Bias(cd1);
  const vp4h=c4h?computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback):null;
  const vp1h=c1h?computeVolumeProfile(c1h,TF_CONFIG.H1.vpLookback):null;
  const vp15m=c15m?computeVolumeProfile(c15m,TF_CONFIG.M15.vpLookback):null;
  const m4h=c4h?runMathEngine(c4h):null,m1h=c1h?runMathEngine(c1h):null,m15m=c15m?runMathEngine(c15m):null;
  const r4h=c4h&&vp4h?detectGWP(c4h,vp4h,computeAVWAP(c4h,TF_CONFIG.H4.avwapLookback),m4h,TF_CONFIG.H4,symbol):null;
  const r1h=c1h&&vp1h?detectGWP(c1h,vp1h,computeAVWAP(c1h,TF_CONFIG.H1.avwapLookback),m1h,TF_CONFIG.H1,symbol):null;
  const r15m=c15m&&vp15m?detectGWP(c15m,vp15m,computeAVWAP(c15m,TF_CONFIG.M15.avwapLookback),m15m,TF_CONFIG.M15,symbol):null;
  const ms4h=r4h?analyzeMarketStructure(c4h,r4h.direction,TF_CONFIG.H4):null;
  const ms1h=r1h?analyzeMarketStructure(c1h,r1h.direction,TF_CONFIG.H1):null;
  const ms15m=r15m?analyzeMarketStructure(c15m,r15m.direction,TF_CONFIG.M15):null;
  if(r4h&&r1h&&r15m&&r4h.direction===r1h.direction&&r1h.direction===r15m.direction){
    const c4=computeConviction(r4h,m4h,ms4h,"H4",false,true,d1Bias),c1=computeConviction(r1h,m1h,ms1h,"H1",false,true,d1Bias),c15=computeConviction(r15m,m15m,ms15m,"M15",false,true,d1Bias);
    await tgSend(formatTripleSignal(r4h,r1h,r15m,symbol,c4,c1,c15,ms4h,ms1h,ms15m,d1Bias));
  }else if(r4h&&r1h&&r4h.direction===r1h.direction){
    const c4=computeConviction(r4h,m4h,ms4h,"H4",true,false,d1Bias),c1=computeConviction(r1h,m1h,ms1h,"H1",true,false,d1Bias);
    await tgSend(formatConfluenceSignal(r4h,r1h,symbol,c4,c1,ms4h,ms1h,d1Bias));
  }else if(r4h){
    const cv=computeConviction(r4h,m4h,ms4h,"H4",false,false,d1Bias);
    await tgSend(formatSingleSignal(r4h,symbol,cv,ms4h,"",d1Bias,m4h));
  }else if(r1h){
    const cv=computeConviction(r1h,m1h,ms1h,"H1",false,false,d1Bias);
    await tgSend(formatSingleSignal(r1h,symbol,cv,ms1h,"⚡ <b>SCALP</b> —",d1Bias,m1h));
  }else{
    await tgSend(`⬜ <b>No GWP — ${symLabel(symbol)}/USDT</b>\n4H VP: ${vp4h?vp4h.valBandBot.toFixed(4)+"–"+vp4h.valBandTop.toFixed(4):"fail"}\n📅 D1 Bias: ${d1Bias}\n${getSessionLabel()}\n\n<i>${V}</i>`);
  }
}

// ── COMMAND HANDLER ────────────────────────────────────────────────────────────
async function sendWelcome(){
  await tgSend(
    `👻 <b>Welcome to GWP Crypto Signals</b>\n`+
    `<b>Ghost Wick Protocol™ v3.1 — Institutional Crypto</b>\n\n`+
    `🏛 <b>What you'll receive:</b>\n`+
    `▸ Institutional-grade BULL/BEAR signals on DeFi altcoins\n`+
    `▸ 5-TF vote: 1D + 4H + 1H + 30M + 15M, 3-of-5 agreement + entry trigger\n`+
    `▸ Entry · SL · TP1 · TP2 · TP3 with conviction score /123\n`+
    `▸ Live TP/SL hit alerts as trade unfolds\n`+
    `▸ Pairs: DEXE · UNI · SUSHI · SOL · BTC · LINK · COMP\n\n`+
    `📡 <b>How it works:</b>\n`+
    `▸ Bot runs every 4H — new candle = new scan\n`+
    `▸ Only high-conviction setups fire (no spam)\n`+
    `▸ Signals go to both this channel AND asterix-gwp.vercel.app\n\n`+
    `⚡ <b>Quick commands:</b>\n`+
    `/scan · /positions · /status · /health · /help\n\n`+
    `<i>Every candle. Every session. Zero downtime.</i>\n`+
    `<i>Asterix Holdings Ltd. · Accra, Ghana</i>\n\n`+
    `<i>${V}</i>`
  );
}
async function handleCommand(cmd){
  cmd=cmd.trim().toLowerCase().split(" ")[0];
  if(cmd==="/start")     {await sendWelcome();return;}
  if(cmd==="/scan")      {await runBot();return;}
  if(cmd==="/daily")     {await sendDailySummary();return;}
  if(cmd==="/weekly")    {await sendWeeklySummary();return;}
  if(cmd==="/health")    {await sendHealth();return;}
  if(cmd==="/positions") {await sendPositions();return;}
  if(cmd==="/status")    {await sendStatus();return;}
  if(cmd==="/reset")     {await resetCooldowns();return;}
  if(cmd==="/help")      {await sendHelp();return;}
  const match=CONFIG.PAIRS.find(s=>cmd===("/"+s.replace("-USDT","").toLowerCase()));
  if(match){await scanSingle(match);return;}
}

// ── MAIN RUNNER ────────────────────────────────────────────────────────────────
async function runBot(){
  console.log(`\n═══ GWP CRYPTO v3.1 ELITE MAX ═══ ${new Date().toISOString()}`);
  console.log(`  Running 24/7 — ${getSessionLabel()}`);

  await checkOpenPositions();
  let fired=0;

  // v3.1 Fix #5: Macro event blackout check (once before symbol loop)
  const macroCheck = isNearMacroEvent();
  if (macroCheck.blocked) {
    console.log(`  ⛔ MACRO BLACKOUT — ${macroCheck.event} (${macroCheck.date}) — skipping all signals`);
    await tgSend(`⛔ <b>MACRO BLACKOUT</b> — ${macroCheck.event} event detected.\nAll signals paused ±1h for safety.\n\n<i>${V}</i>`);
    return; // Skip this entire scan
  }

  // v3.2: Daily drawdown gate
  const dayKey="A8_D_"+getDateKey();
  let dayData;try{dayData=JSON.parse(getProp(dayKey)||"{}");}catch(e){dayData={};}
  if((dayData.pnl||0)<=-3){
    console.log("⛔ DAILY DRAWDOWN GATE: P&L "+dayData.pnl+"% — pausing all signals");
    await tgSend(`⛔ <b>DAILY DRAWDOWN GATE</b>\nP&L today: <b>${dayData.pnl}%</b>\nAll signals paused until tomorrow.\n\n<i>${V}</i>`);
    return;
  }

  for(const symbol of CONFIG.PAIRS){
    try{
      console.log(`\n▶ ${symbol}`);
      if(isCircuitBroken(symbol)){console.log("  ⛔ Circuit breaker");continue;}

      // v5.0 SPEED: parallel fetch across all 5 timeframes
      const [cd1,c4h,c1h,c30m,c15m]=await Promise.all([
        fetchKlines(symbol,"D1", TF_CONFIG.D1.vpLookback+150),
        fetchKlines(symbol,"H4", TF_CONFIG.H4.vpLookback+50),
        fetchKlines(symbol,"H1", TF_CONFIG.H1.vpLookback+80),
        fetchKlines(symbol,"M30",TF_CONFIG.M30.vpLookback+120),
        fetchKlines(symbol,"M15",TF_CONFIG.M15.vpLookback+100),
      ]);
      if(!c4h||c4h.length<30){console.log("  No 4H data");continue;}

      const d1Bias = getD1Bias(cd1); // context field only (shown in signal footer)
      console.log(`  D1 Bias: ${d1Bias}`);

      const vpD1 =cd1 &&cd1.length>=40 ?computeVolumeProfile(cd1, TF_CONFIG.D1.vpLookback) :null;
      const vp4h =computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback);
      const vp1h =c1h &&c1h.length>=20 ?computeVolumeProfile(c1h, TF_CONFIG.H1.vpLookback) :null;
      const vp30m=c30m&&c30m.length>=25?computeVolumeProfile(c30m,TF_CONFIG.M30.vpLookback):null;
      const vp15m=c15m&&c15m.length>=15?computeVolumeProfile(c15m,TF_CONFIG.M15.vpLookback):null;
      if(!vp4h){console.log("  4H VP failed");continue;}

      // ── 5-TIMEFRAME VOTE (1D/4H/1H/30M/15M) — primary directional gate ────
      // v5.0: extended from the 2-of-3 (4H/1H/15M) informational vote to a
      // full 5-TF, 3-of-5 HARD gate (ported from the MVS bot's validated
      // design). Each TF casts ONE compressed BULL/BEAR/NEUTRAL read
      // (computeTfBias, from price vs POC/VAH/VAL vs recent-swing midpoint).
      // At least 3 of the 5 TFs must agree on direction before ANY GWP entry
      // trigger below is even eligible to fire. This supersedes the old
      // separate D1-counter-trend hard block — D1 is now just one of five
      // voters, so a lone D1-vs-the-rest disagreement is naturally outvoted
      // instead of needing a bespoke rule.
      const biasD1 =vpD1 ?computeTfBias(cd1, vpD1) :null;
      const bias4h =computeTfBias(c4h, vp4h);
      const bias1h =vp1h ?computeTfBias(c1h, vp1h) :null;
      const bias30m=vp30m?computeTfBias(c30m,vp30m):null;
      const bias15m=vp15m?computeTfBias(c15m,vp15m):null;
      const vote=resolveVoteDirection([
        { tf:"D1",  result: biasD1  },
        { tf:"H4",  result: bias4h  },
        { tf:"H1",  result: bias1h  },
        { tf:"M30", result: bias30m },
        { tf:"M15", result: bias15m },
      ], 3);
      console.log(`  🗳️ VOTE: D1=${biasD1?biasD1.bias:"N/A"} 4H=${bias4h?bias4h.bias:"N/A"} 1H=${bias1h?bias1h.bias:"N/A"} 30M=${bias30m?bias30m.bias:"N/A"} 15M=${bias15m?bias15m.bias:"N/A"}`+
        (vote?` → ${vote.direction} (${vote.tally}: ${vote.agreeing.join("+")})`:" → NO 3-OF-5 AGREEMENT — skip"));
      if(!vote){continue;}

      const avD1 =vpD1 ?computeAVWAP(cd1, TF_CONFIG.D1.avwapLookback) :null;
      const av4h =computeAVWAP(c4h, TF_CONFIG.H4.avwapLookback);
      const av1h =c1h ?computeAVWAP(c1h, TF_CONFIG.H1.avwapLookback) :null;
      const av30m=c30m?computeAVWAP(c30m,TF_CONFIG.M30.avwapLookback):null;
      const av15m=c15m?computeAVWAP(c15m,TF_CONFIG.M15.avwapLookback):null;

      const mD1 =vpD1?runMathEngine(cd1):null;
      const m4h =runMathEngine(c4h);
      const m1h =c1h ?runMathEngine(c1h) :null;
      const m30m=c30m?runMathEngine(c30m):null;
      const m15m=c15m?runMathEngine(c15m):null;

      const rD1 =vpD1 ?detectGWP(cd1, vpD1, avD1, mD1, TF_CONFIG.D1, symbol) :null;
      const r4h =detectGWP(c4h, vp4h, av4h, m4h, TF_CONFIG.H4, symbol);
      const r1h =vp1h ?detectGWP(c1h, vp1h, av1h, m1h, TF_CONFIG.H1, symbol) :null;
      const r30m=vp30m?detectGWP(c30m,vp30m,av30m,m30m,TF_CONFIG.M30,symbol):null;
      const r15m=vp15m?detectGWP(c15m,vp15m,av15m,m15m,TF_CONFIG.M15,symbol):null;

      const msD1 =rD1 ?analyzeMarketStructure(cd1, rD1.direction, TF_CONFIG.D1) :null;
      const ms4h =r4h ?analyzeMarketStructure(c4h, r4h.direction, TF_CONFIG.H4) :null;
      const ms1h =r1h ?analyzeMarketStructure(c1h, r1h.direction, TF_CONFIG.H1) :null;
      const ms30m=r30m?analyzeMarketStructure(c30m,r30m.direction,TF_CONFIG.M30):null;
      const ms15m=r15m?analyzeMarketStructure(c15m,r15m.direction,TF_CONFIG.M15):null;

      console.log(`  D1:${rD1?rD1.direction+" "+rD1.score:"—"}  4H:${r4h?r4h.direction+" "+r4h.score:"—"}  1H:${r1h?r1h.direction+" "+r1h.score:"—"}  30M:${r30m?r30m.direction+" "+r30m.score:"—"}  15M:${r15m?r15m.direction+" "+r15m.score:"—"}`);

      // ── ENTRY TRIGGER — fastest TF with a live GWP pattern in the vote's
      // direction that clears BOTH checkEntryConfirmations (≥2-of-5 pattern
      // confirmations) AND its own minConviction floor (after a vote-strength
      // boost). Fastest-first means the tightest possible entry once the
      // higher-TF vote has confirmed trend; if 15M hasn't triggered yet, we
      // fall back to slower TFs so a valid 30M/1H/4H/D1 wick-reversal can
      // still fire the trade. "3 TFs agree AND entry is triggered → fire."
      const candidates=[
        {tf:"M15",r:r15m,ms:ms15m,m:m15m},
        {tf:"M30",r:r30m,ms:ms30m,m:m30m},
        {tf:"H1", r:r1h, ms:ms1h, m:m1h },
        {tf:"H4", r:r4h, ms:ms4h, m:m4h },
        {tf:"D1", r:rD1, ms:msD1, m:mD1 },
      ];
      let entry=null;
      for(const c of candidates){
        if(!c.r||c.r.direction!==vote.direction)continue;
        if(isOnCooldown(symbol,vote.direction,c.tf)){console.log(`  🔒 ${c.tf} cooldown`);continue;}
        if(isDuplicate(symbol,vote.direction,c.tf))continue;
        const gate=checkEntryConfirmations(c.r,c.ms);
        if(!gate.valid)continue;
        const conv=computeConviction(c.r,c.m,c.ms,c.tf,false,false,d1Bias);
        // Vote-strength boost — more agreeing TFs = higher conviction
        const voteBoost=vote.agreeing.length>=5?25:vote.agreeing.length===4?18:10;
        conv.score=Math.min(parseFloat(conv.score)+voteBoost,123).toFixed(1);
        if(parseFloat(conv.score)<TF_CONFIG[c.tf].minConviction){
          console.log(`  ⚠️ ${c.tf} conv ${conv.score} below ${TF_CONFIG[c.tf].minConviction} (post-vote-boost) — trying next TF`);
          continue;
        }
        entry={...c,conv,gate};
        break;
      }
      if(!entry){console.log(`  Vote ${vote.direction} (${vote.tally}) confirmed, but no TF has triggered entry yet`);continue;}

      const corrBlock=hasCorrelatedPosition(symbol,vote.direction);
      if(corrBlock){console.log(`  ⚠️ Correlation block: ${corrBlock} already open ${vote.direction}`);continue;}

      // v3.1 Fix #4: Funding rate adjustment (crypto only)
      const funding = await getFundingRate(symbol.replace("-USDT",""));
      if (funding.score !== 0) {
        const fDir = vote.direction;
        if (fDir==="BEAR" && funding.rate > 0.0005) entry.conv.score = Math.min(parseFloat(entry.conv.score) + 4, 123).toFixed(1);
        if (fDir==="BULL" && funding.rate > 0.0005) entry.conv.score = Math.max(parseFloat(entry.conv.score) - 2, 0).toFixed(1);
        if (fDir==="BULL" && funding.rate < -0.0005) entry.conv.score = Math.min(parseFloat(entry.conv.score) + 4, 123).toFixed(1);
        if (fDir==="BEAR" && funding.rate < -0.0005) entry.conv.score = Math.max(parseFloat(entry.conv.score) - 2, 0).toFixed(1);
      }
      entry.r._fundingLabel = funding.label;

      console.log(`  🔥 FIRE [${entry.tf}] ${vote.direction} — vote ${vote.tally} (${vote.agreeing.join("+")}) | conv=${entry.conv.score}/123 | confirmations=${entry.gate.count}/5`);
      const voteTag=`🗳️ <b>${vote.tally} TF VOTE</b> (${vote.agreeing.join("+")}) — `;
      await tgSend(formatSingleSignal(entry.r,symbol,entry.conv,entry.ms,voteTag,d1Bias,entry.m));
      storePosition(symbol,entry.r,entry.conv,entry.tf);
      setCooldown(symbol,vote.direction,entry.tf);
      markFired(symbol,vote.direction,entry.tf);
      trackFired(symbol,entry.r,entry.tf);
      fired++;

    }catch(e){console.error(`ERROR [${symbol}]:`,e.message,e.stack);}
  }

  state.lastScanTime=new Date().toISOString();
  state.lastScanFired=fired;
  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);
}

// ── ENTRY POINT ────────────────────────────────────────────────────────────────
(async()=>{
  loadState();
  const mode=process.argv[2]||"scan";
  console.log(`GWP Crypto v3.1 ELITE MAX | mode: ${mode} | ${new Date().toISOString()}`);
  console.log(`Pairs: ${CONFIG.PAIRS.join(", ")} | 24/7 | No lagging indicators | ATR SL floor | Vol+AVWAP gate | SL min 1.2%`);

  const updates=await pollTelegram();
  if(updates&&updates.length){for(const u of updates){if(u.message&&u.message.text){console.log(`Command: ${u.message.text}`);await handleCommand(u.message.text);}}}

  if(mode==="scan")          await runBot();
  if(mode==="daily")         await sendDailySummary();
  if(mode==="weekly")        await sendWeeklySummary();
  if(mode==="weeklyreport")  await sendWeeklyReport();  // v3.1 Fix #10
  if(mode==="health")        await sendHealth();
  // v3.1 Fix #10: Auto weekly report on Friday UTC 21:00 run
  if(mode==="scan" && new Date().getUTCDay()===5 && new Date().getUTCHours()===21) await sendWeeklyReport();

  saveState();
  console.log("State saved → crypto_state.json");
})();

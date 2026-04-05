"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — FOREX EDITION  v7.0  MONEY PRINTING MACHINE ELITE MAX™
// Strategy : Ghost Wick Protocol™ (GWP) — 4H + 1H + 15M Triple Timeframe Engine
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Assets   : XAUUSD · EURUSD · GBPUSD (Twelve Data) · BTC (KuCoin)
// Platform : GitHub Actions (Node.js 22+) · forex_state.json persistence
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// v6.1 FIXES (on top of v6.0):
//   ✅ FIX: SL TOO TIGHT — atrBufMult raised 1H:0.35→0.55, M15:0.30→0.50
//           + candle-range buffer: SL always outside signal candle range
//           + asset-class minimum: crypto SL ≥ 0.30%, forex ≥ 0.10%
//           → Root cause of BTC SHORT hitting SL immediately
//   ✅ FIX: BEAR BIAS — trendBull bonus removed (GWP is counter-trend)
//   ✅ FIX: BEAR BIAS — MS scoring now ADDITIVE (CHoCH + BOS both score)
//   ✅ FIX: BEAR BIAS — removed -3 !ms.confirmed penalty (MS = bonus only)
//   ✅ FIX: BEAR BIAS — Z-Score thresholds lowered (extreme z<-1.5, mild z<-0.8)
//   ✅ FIX: BEAR BIAS — RSI oversold/overbought bonus added (+7 at extreme)
//   ✅ NEW: USDJPY + GBPJPY added (6 forex pairs → more BULL opportunities)
//   ✅ NEW: /usdjpy /gbpjpy commands
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── TF CONFIGS ────────────────────────────────────────────────────────────────
const TF_CONFIG = {
  H4: {
    tf:"H4", label:"4H",
    vpLookback:100, avwapLookback:30,
    minRR:1.8, minConviction:52, cooldownHrs:4,
    atrBufMult:0.50, maxAge:2, avwapProx:0.003,  // 0.45→0.50
    msLookback:80, swingStrength:3, volSpikeMult:1.2,
    minSlPct:0.10,   // minimum SL distance %
  },
  H1: {
    tf:"H1", label:"1H",
    vpLookback:60, avwapLookback:20,
    minRR:1.6, minConviction:52, cooldownHrs:2,
    atrBufMult:0.60, maxAge:1, avwapProx:0.004,  // 0.35→0.60 KEY FIX
    msLookback:60, swingStrength:3, volSpikeMult:1.3,
    minSlPct:0.15,
  },
  M15: {
    tf:"M15", label:"15M",
    vpLookback:40, avwapLookback:12,
    minRR:1.5, minConviction:54, cooldownHrs:1,
    atrBufMult:0.55, maxAge:1, avwapProx:0.005,  // 0.30→0.55 KEY FIX
    msLookback:40, swingStrength:2, volSpikeMult:1.5,
    minSlPct:0.10,
  },
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN  : process.env.FOREX_TG_TOKEN   || "",
  CHAT_ID         : process.env.FOREX_CHAT_ID    || "",
  TWELVE_DATA_KEY : process.env.TWELVE_DATA_KEY  || "",

  PAIRS: [
    { symbol:"XAUUSD", label:"XAU/USD 🥇", source:"twelve", twelveSymbol:"XAU/USD",  dec:2, crypto:false },
    { symbol:"EURUSD", label:"EUR/USD 💶", source:"twelve", twelveSymbol:"EUR/USD",  dec:5, crypto:false },
    { symbol:"GBPUSD", label:"GBP/USD 💷", source:"twelve", twelveSymbol:"GBP/USD",  dec:5, crypto:false },
    { symbol:"USDJPY", label:"USD/JPY 🇯🇵", source:"twelve", twelveSymbol:"USD/JPY", dec:3, crypto:false },
    { symbol:"GBPJPY", label:"GBP/JPY 🇯🇵", source:"twelve", twelveSymbol:"GBP/JPY", dec:3, crypto:false },
    { symbol:"BTC",    label:"BTC/USDT ₿",  source:"kucoin", kucoinSymbol:"BTC-USDT", dec:2, crypto:true  },
  ],

  CAPITAL:100, RISK_PCT:1.5, LEVERAGE:30,
  VP_ROWS:24, MIN_WICK_DEPTH_PCT:0.12, MIN_BODY_GAP_PCT:0.08,

  SESSION_FILTER: false,  // 24/7 — NO DEAD PERIODS

  CIRCUIT_BREAKER:true, CIRCUIT_BREAKER_LOSSES:3, CIRCUIT_BREAKER_HRS:24,
  TD_SLEEP_MS:1500,
  CONFLUENCE_CONVICTION_BOOST:18,
  TRIPLE_TF_BOOST:25,
  CONFLUENCE_GATE_REDUCTION:6,
  TP3_MULT:2.2,
  MAX_RETRIES:2, RETRY_DELAY_MS:3000,
  DEDUP_WINDOW_MS:3600000,

  // Minimum SL % by asset class (v6.1 — prevents hairline SL)
  CRYPTO_MIN_SL_PCT: 0.35,  // 0.35% minimum for BTC/crypto
  FOREX_MIN_SL_PCT:  0.10,  // 0.10% minimum for forex pairs
};

const V = "GWP Forex v7.0 | Elite Max™ | 24/7 | Asterix.COM | Abdin";

// ── STATE ─────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "forex_state.json");
let state = {};
function loadState()  { try { state = JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); } catch(e) { state = {}; } }
function saveState()  { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function getProp(k)   { return state[k] || null; }
function setProp(k,v) { state[k] = v; }
function delProp(k)   { delete state[k]; }

// ── HTTP ──────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((res, rej) => {
    https.get(url, r => { let d=""; r.on("data",c=>d+=c); r.on("end",()=>res(d)); }).on("error",rej);
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

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — Add Google Sheet logging to altcoin_bot.js and forex_bot.js
// Apply this as a code addition, NOT a replacement of existing code.
// © 2026 Asterix.COM Ltd. / Abdin
// ═══════════════════════════════════════════════════════════════════════════


// ────────────────────────────────────────────────────────────────────────────
// 1.  ADD THIS BLOCK right after the CONFIG object (around line ~100 in both bots)
//     i.e. after the closing }; of CONFIG
// ────────────────────────────────────────────────────────────────────────────

const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL || "";

/**
 * logToSheet — fires an HTTP POST to the GAS sheet webhook.
 * Non-blocking: failure is logged but never throws.
 *
 * @param {string} pair   e.g. "BTC/USDT"
 * @param {string} dir    "LONG" | "SHORT"
 * @param {string} entry  entry price string
 * @param {string} sl     stop-loss price string
 * @param {string} tp     TP1 price string
 * @param {number} score  conviction percentage 0–100
 * @param {string} tf     "4H" | "1H" | "15M"
 */
async function logToSheet(pair, dir, entry, sl, tp, score, tf) {
  if (!SHEET_WEBHOOK_URL) return;           // secret not set → skip silently
  try {
    const body = JSON.stringify({
      pair, dir, entry: String(entry), sl: String(sl),
      tp: String(tp), score, tf,
      time: new Date().toISOString(),
    });
    const url  = new URL(SHEET_WEBHOOK_URL);
    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname : url.hostname,
          path     : url.pathname + url.search,
          method   : "POST",
          headers  : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        },
        res => { res.resume(); resolve(); }           // consume body, resolve
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
    console.log(`  📊 Sheet logged: ${pair} ${dir} ${tf} score=${score}`);
  } catch (err) {
    console.warn(`  ⚠️ Sheet log failed (non-fatal): ${err.message}`);
  }
}


// ────────────────────────────────────────────────────────────────────────────
// 2.  ALTCOIN BOT — altcoin_bot.js
//     In runBot(), after EACH tgSend() that fires a real signal, add logToSheet().
//     Replace the 4 firing blocks as shown below.
// ────────────────────────────────────────────────────────────────────────────

/* ── TRIPLE TF — find this block (around line 893): ──
    await tgSend(formatTripleSignal(...));
    storePosition(...); storePosition(...);
    setCooldown(...); setCooldown(...); setCooldown(...);
    markFired(...);
    trackFired(...); fired++; continue;

   REPLACE with: */

    await tgSend(formatTripleSignal(r4h,r1h,r15m,symbol,conv4h,conv1h,conv15m,ms4h,ms1h,ms15m));
    await logToSheet(
      symLabel(symbol)+"/USDT",
      r4h.direction==="BULL"?"LONG":"SHORT",
      r4h.entry, r4h.sl, r4h.tp1,
      Math.round((parseFloat(conv4h.score)/123)*100),
      "4H+1H+15M"
    );
    storePosition(symbol,r4h,conv4h,"H4"); storePosition(symbol,r1h,conv1h,"H1");
    setCooldown(symbol,dir,"H4"); setCooldown(symbol,dir,"H1"); setCooldown(symbol,dir,"M15");
    markFired(symbol,dir,"TRIPLE");
    trackFired(symbol,r4h,"TRIPLE"); fired++; // continue; ← keep if present


/* ── CONFLUENCE 4H+1H — find this block (around line 912): ──
    await tgSend(formatConfluenceSignal(...));
   REPLACE/ADD after tgSend: */

    await tgSend(formatConfluenceSignal(r4h,r1h,symbol,conv4h,conv1h,ms4h,ms1h));
    await logToSheet(
      symLabel(symbol)+"/USDT",
      r4h.direction==="BULL"?"LONG":"SHORT",
      r4h.entry, r4h.sl, r4h.tp1,
      Math.round((parseFloat(conv4h.score)/123)*100),
      "4H+1H"
    );


/* ── 4H SOLO — after the existing tgSend line: */

    await tgSend(formatSingleSignal(r4h,symbol,conv,ms4h,""));
    await logToSheet(
      symLabel(symbol)+"/USDT",
      r4h.direction==="BULL"?"LONG":"SHORT",
      r4h.entry, r4h.sl, r4h.tp1,
      Math.round((parseFloat(conv.score)/123)*100),
      "4H"
    );


/* ── 1H SOLO — after the existing tgSend line: */

    await tgSend(formatSingleSignal(r1h,symbol,conv,ms1h,"⚡ <b>SCALP</b> —"));
    await logToSheet(
      symLabel(symbol)+"/USDT",
      r1h.direction==="BULL"?"LONG":"SHORT",
      r1h.entry, r1h.sl, r1h.tp1,
      Math.round((parseFloat(conv.score)/123)*100),
      "1H"
    );


/* ── 15M MICRO SNIPER — after the existing tgSend line: */

    await tgSend(formatSingleSignal(r15m,symbol,conv,ms15m,"🔬 <b>MICRO SNIPER</b> —"));
    await logToSheet(
      symLabel(symbol)+"/USDT",
      r15m.direction==="BULL"?"LONG":"SHORT",
      r15m.entry, r15m.sl, r15m.tp1,
      Math.round((parseFloat(conv.score)/123)*100),
      "15M"
    );


// ────────────────────────────────────────────────────────────────────────────
// 3.  FOREX BOT — forex_bot.js
//     Same pattern — add after each real tgSend() in runBot().
//     Forex pairs have a `pair.label` property (e.g. "XAU/USD") instead of symLabel().
// ────────────────────────────────────────────────────────────────────────────

/* ── TRIPLE — after tgSend line ~1023: */

    await tgSend(formatTripleSignal(r4h,r1h,r15m,pair,conv4h,conv1h,conv15m,ms4h,ms1h,ms15m));
    await logToSheet(
      pair.label,
      r4h.direction==="BULL"?"LONG":"SHORT",
      r4h.entry, r4h.sl, r4h.tp1,
      Math.round((parseFloat(conv4h.score)/123)*100),
      "4H+1H+15M"
    );


/* ── CONFLUENCE — after tgSend line ~1042: */

    await tgSend(formatConfluenceSignal(r4h,r1h,pair,conv4h,conv1h,ms4h,ms1h));
    await logToSheet(
      pair.label,
      r4h.direction==="BULL"?"LONG":"SHORT",
      r4h.entry, r4h.sl, r4h.tp1,
      Math.round((parseFloat(conv4h.score)/123)*100),
      "4H+1H"
    );


/* ── 4H SOLO — after tgSend line ~1058: */

    await tgSend(formatSingleSignal(r4h,pair,conv,ms4h,""));
    await logToSheet(
      pair.label,
      r4h.direction==="BULL"?"LONG":"SHORT",
      r4h.entry, r4h.sl, r4h.tp1,
      Math.round((parseFloat(conv.score)/123)*100),
      "4H"
    );


/* ── 1H SOLO — after tgSend line ~1073: */

    await tgSend(formatSingleSignal(r1h,pair,conv,ms1h,"⚡ <b>SCALP</b> —"));
    await logToSheet(
      pair.label,
      r1h.direction==="BULL"?"LONG":"SHORT",
      r1h.entry, r1h.sl, r1h.tp1,
      Math.round((parseFloat(conv.score)/123)*100),
      "1H"
    );


/* ── 15M SCALP — after tgSend line ~1088: */

    await tgSend(formatSingleSignal(r15m,pair,conv,ms15m,"🔬 <b>MICRO SNIPER</b> —"));
    await logToSheet(
      pair.label,
      r15m.direction==="BULL"?"LONG":"SHORT",
      r15m.entry, r15m.sl, r15m.tp1,
      Math.round((parseFloat(conv.score)/123)*100),
      "15M"
    );


// ────────────────────────────────────────────────────────────────────────────
// 4.  YAML — gwp-altcoin.yml + gwp-forex.yml
//     Add SHEET_WEBHOOK_URL to the env block of the "Run bot" step
// ────────────────────────────────────────────────────────────────────────────

/* In gwp-altcoin.yml — step "Run GWP Altcoin Bot": */
//        env:
//          ALTCOIN_TG_TOKEN: ${{ secrets.ALTCOIN_TG_TOKEN }}
//          ALTCOIN_CHAT_ID:  ${{ secrets.ALTCOIN_CHAT_ID }}
// +        SHEET_WEBHOOK_URL: ${{ secrets.SHEET_WEBHOOK_URL }}

/* In gwp-forex.yml — step "Run GWP Forex Bot": */
//        env:
//          FOREX_TG_TOKEN: ${{ secrets.FOREX_TG_TOKEN }}
//          FOREX_CHAT_ID:  ${{ secrets.FOREX_CHAT_ID }}
//          TWELVE_DATA_KEY: ${{ secrets.TWELVE_DATA_KEY }}
// +        SHEET_WEBHOOK_URL: ${{ secrets.SHEET_WEBHOOK_URL }}


// ────────────────────────────────────────────────────────────────────────────
// 5.  GITHUB SECRET — add ONE new secret to the repo
// ────────────────────────────────────────────────────────────────────────────
//
//  Name : SHEET_WEBHOOK_URL
//  Value: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
//
//  Both bots share the same webhook URL → same sheet → same web app feed.
// ────────────────────────────────────────────────────────────────────────────

// ── TELEGRAM ──────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CONFIG.TELEGRAM_TOKEN||!CONFIG.CHAT_ID) return;
  const chunks=[];for(let i=0;i<text.length;i+=3800)chunks.push(text.slice(i,i+3800));
  for(const chunk of chunks){
    try{
      await httpPost("api.telegram.org",`/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,
        {chat_id:CONFIG.CHAT_ID,text:chunk,parse_mode:"HTML"});
      if(chunks.length>1)await sleep(300);
    }catch(e){console.error("TG error:",e.message);}
  }
}
async function pollTelegram() {
  if (!CONFIG.TELEGRAM_TOKEN) return null;
  try {
    const offset=getProp("tg_offset")||0;
    const raw=await httpGet(`https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=5`);
    const json=JSON.parse(raw);if(!json.ok||!json.result.length)return null;
    const last=json.result[json.result.length-1];setProp("tg_offset",last.update_id+1);return json.result;
  }catch(e){return null;}
}

// ── DATA ──────────────────────────────────────────────────────────────────────
const KU_TF = { H4:"4hour", H1:"1hour", M15:"15min", D1:"1day" };
const TD_TF = { H4:"4h", H1:"1h", M15:"15min", D1:"1day" };

async function fetchKuCoin(symbol, tf, limit, retry=0) {
  const url=`https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]||tf}&symbol=${symbol}&limit=${Math.min(limit||150,300)}`;
  try{
    const raw=await httpGet(url);const json=JSON.parse(raw);
    if(!json.data||json.data.length<5)return null;
    return json.data.reverse().map(c=>({t:parseInt(c[0])*1000,open:parseFloat(c[1]),close:parseFloat(c[2]),high:parseFloat(c[3]),low:parseFloat(c[4]),vol:parseFloat(c[5])}));
  }catch(e){
    if(retry<CONFIG.MAX_RETRIES){await sleep(CONFIG.RETRY_DELAY_MS);return fetchKuCoin(symbol,tf,limit,retry+1);}
    return null;
  }
}
async function fetchTwelveData(symbol, tf, limit, retry=0) {
  if(!CONFIG.TWELVE_DATA_KEY)return null;
  await sleep(CONFIG.TD_SLEEP_MS);
  const url=`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${TD_TF[tf]||tf}&outputsize=${Math.min(limit||150,300)}&apikey=${CONFIG.TWELVE_DATA_KEY}&order=ASC`;
  try{
    const raw=await httpGet(url);const json=JSON.parse(raw);
    if(json.status==="error"||!json.values||json.values.length<5){console.error(`TD [${symbol} ${tf}]:`,json.message||"error");return null;}
    return json.values.map(c=>({t:new Date(c.datetime).getTime(),open:parseFloat(c.open),close:parseFloat(c.close),high:parseFloat(c.high),low:parseFloat(c.low),vol:parseFloat(c.volume||1000)}));
  }catch(e){
    if(retry<CONFIG.MAX_RETRIES){await sleep(CONFIG.RETRY_DELAY_MS);return fetchTwelveData(symbol,tf,limit,retry+1);}
    return null;
  }
}
async function fetchCandles(pair, tf, limit) {
  if(pair.source==="kucoin")return fetchKuCoin(pair.kucoinSymbol,tf,limit);
  if(pair.source==="twelve")return fetchTwelveData(pair.twelveSymbol,tf,limit);
  return null;
}

// ── MATH ENGINE ───────────────────────────────────────────────────────────────
function calcRSI(closes,p=14){
  if(closes.length<p+2)return 50;let g=0,l=0;
  for(let i=closes.length-p;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>=0)g+=d;else l-=d;}
  return 100-100/(1+g/(l||0.0001));
}
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
  if(closes.length<20)return 0.5;
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
  // v6.1: lowered thresholds — fires more readily for counter-trend setups
  return{z,extremeHigh:z>1.5,extremeLow:z<-1.5,mildHigh:z>0.8,mildLow:z<-0.8};
}
function kalmanFilter(closes){
  if(closes.length<5)return null;const Q=0.01,R=0.5;let x=closes[0],v=0,P=1;
  for(let i=1;i<closes.length;i++){const xP=x+v,PP=P+Q,K=PP/(PP+R);x=xP+K*(closes[i]-xP);v=v+0.1*(closes[i]-x);P=(1-K)*PP;}
  return{fairValue:x,velocity:v,bullish:v>0};
}
function calcEMA(closes,p=50){
  if(closes.length<p)return closes[closes.length-1];
  const k=2/(p+1);let ema=closes.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<closes.length;i++)ema=closes[i]*k+ema*(1-k);
  return ema;
}
function calcMomentumBurst(candles,sigIdx){
  if(sigIdx<10)return false;
  const recent=candles.slice(Math.max(0,sigIdx-10),sigIdx);
  const avgRange=recent.reduce((a,c)=>a+(c.high-c.low),0)/recent.length;
  return avgRange>0&&(candles[sigIdx].high-candles[sigIdx].low)>=avgRange*1.5;
}
function calcZoneRevisit(candles,bBot,bTop){
  return candles.slice(-12,-1).filter(c=>c.low<=bTop*1.005&&c.high>=bBot*0.995).length>=2;
}
function runMathEngine(candles){
  if(!candles||candles.length<30)return null;
  const closes=candles.map(c=>c.close);
  const atr=calcATR(candles,14),rsi=calcRSI(closes,14),hurst=calcHurst(closes);
  const zScore=calcZScore(closes,20),kalman=kalmanFilter(closes);
  const atrPct=calcATRPercentile(candles,14),volRatio=calcVolumeRatio(candles,20);
  // v6.1: trendBull removed — GWP is a counter-trend strategy
  return{atr,rsi,hurst,zScore,kalman,atrPct,volRatio,cur:closes[closes.length-1],cycle:calcSineOscillator(closes)};
}


// ── WYCKOFF MARKET CYCLE ANALYSIS ────────────────────────────────────────────
// Spring   = fake breakdown below support, body closes back inside → BULL
// Upthrust = fake breakout above resistance, body closes back inside → BEAR
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
// ── SINE-WAVE CYCLE OSCILLATOR (FMH / Ehlers-inspired) ───────────────────────
// Fractal Market Hypothesis: markets cycle between expansion (trending) and
// contraction (mean-reverting). GWP fires counter-trend → CONTRACTION = ideal.
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
  const leadSine=Math.sin(2*Math.PI*cycPos+Math.PI/4);  // 45° lead = early warning
  const expansion  =Math.abs(sine)<0.25&&Math.abs(leadSine)>Math.abs(sine);
  const contraction=Math.abs(sine)>0.70;
  const label=expansion
    ?`🌊 CYCLE: EXPANSION (T=${domPeriod})`
    :contraction
      ?`📉 CYCLE: PEAK/TROUGH (T=${domPeriod})`
      :`〰️ CYCLE: MID-WAVE (T=${domPeriod})`;
  return{sine:parseFloat(sine.toFixed(3)),leadSine:parseFloat(leadSine.toFixed(3)),domPeriod,expansion,contraction,label};
}
// ── ELLIOTT WAVE — 0.786 (π/4) RETRACEMENT LEVEL ─────────────────────────────
// π/4 ≈ 0.7854. Deeper corrective target beyond 0.618 golden pocket.
// Used as TP4 runner — high-conviction moves often reach this level.
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
  return{poc:lo+(pocIdx+0.5)*rowH,val,vah:lo+(vahIdx+1)*rowH,valBandBot:val,valBandTop:val+rowH,valBandMid:val+rowH*0.5,rowHeight:rowH,hi,lo};
}
function computeAVWAP(candles,lookback){
  const n=Math.min(lookback,candles.length),sl=candles.slice(candles.length-n);let tv=0,v=0;
  sl.forEach(c=>{const tp=(c.high+c.low+c.close)/3;tv+=tp*c.vol;v+=c.vol;});return v>0?tv/v:null;
}

// ── VOLUME SPIKE ──────────────────────────────────────────────────────────────
function hasVolumeSpike(sigCandle,allCandles,sigIdx,lookback,mult){
  const start=Math.max(0,sigIdx-lookback),vols=allCandles.slice(start,sigIdx).map(c=>c.vol||0);
  if(!vols.length)return true;
  const avg=vols.reduce((a,b)=>a+b,0)/vols.length;
  return avg===0?true:(sigCandle.vol||0)>=avg*mult;
}

// ── MARKET STRUCTURE ENGINE ───────────────────────────────────────────────────
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
function detectBOS(candles,swings){
  const last5=candles.slice(-5);
  const safeHighs=swings.highs.filter(s=>s.idx<candles.length-3).slice(-5);
  const safeLows =swings.lows.filter( s=>s.idx<candles.length-3).slice(-5);
  let bullBOS=false,bearBOS=false,bullLevel=null,bearLevel=null;
  for(const c of last5){
    for(const sh of safeHighs){if(c.close>sh.price){bullBOS=true;bullLevel=sh.price;break;}}
    for(const sl of safeLows) {if(c.close<sl.price){bearBOS=true;bearLevel=sl.price;break;}}
  }
  return{bullBOS,bearBOS,bullLevel,bearLevel};
}
function detectCHoCH(candles,swings){
  const highs=swings.highs.slice(-4),lows=swings.lows.slice(-4);
  if(highs.length<2||lows.length<2)return{detected:false,toBull:false,toBear:false,prevTrend:null};
  const hh=highs[highs.length-1].price>highs[highs.length-2].price;
  const hl=lows[lows.length-1].price  >lows[lows.length-2].price;
  const lh=highs[highs.length-1].price<highs[highs.length-2].price;
  const ll=lows[lows.length-1].price  <lows[lows.length-2].price;
  let prevTrend=null;
  if(hh&&hl)prevTrend="BULL";
  if(lh&&ll)prevTrend="BEAR";
  if(!prevTrend)return{detected:false,toBull:false,toBear:false,prevTrend:null};
  const last5=candles.slice(-5);let toBull=false,toBear=false;
  if(prevTrend==="BEAR"){const refHigh=swings.highs.filter(s=>s.idx<candles.length-5).slice(-1)[0];if(refHigh&&last5.some(c=>c.close>refHigh.price))toBull=true;}
  if(prevTrend==="BULL"){const refLow=swings.lows.filter(s=>s.idx<candles.length-5).slice(-1)[0];if(refLow&&last5.some(c=>c.close<refLow.price))toBear=true;}
  return{detected:toBull||toBear,toBull,toBear,prevTrend};
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
    if(direction==="BULL"&&c3.low>c1.high){const prox=Math.abs(cur.close-c1.high)/cur.close;if((cur.close>=c1.high&&cur.close<=c3.low)||prox<0.010){found=true;fvgHigh=c3.low;fvgLow=c1.high;break;}}
    if(direction==="BEAR"&&c3.high<c1.low){const prox=Math.abs(cur.close-c1.low)/cur.close;if((cur.close<=c1.low&&cur.close>=c3.high)||prox<0.010){found=true;fvgHigh=c1.low;fvgLow=c3.high;break;}}
  }
  return{present:found,fvgHigh,fvgLow};
}
function analyzeMarketStructure(candles,direction,tfCfg){
  if(!candles||candles.length<20)return{confirmed:false,label:"⬜ MS: INSUFFICIENT",strength:0,bos:null,choch:null,liqSweep:null,fvg:null};
  const slice=candles.slice(-Math.min(tfCfg.msLookback,candles.length));
  const swings=detectSwings(slice,tfCfg.swingStrength);
  const bos=detectBOS(slice,swings),choch=detectCHoCH(slice,swings);
  const liqSweep=detectLiquiditySweep(slice,swings),fvg=detectFVG(slice,direction);
  let confirmed=false,label="🟡 MS: UNCONFIRMED",strength=0;
  if(direction==="BULL"){
    if(choch.detected&&choch.toBull){confirmed=true;label="🔄 CHoCH→BULL";strength=3;}
    else if(bos.bullBOS)            {confirmed=true;label="⬆️ BOS BULL";  strength=2;}
    else if(liqSweep.lowSweep)      {confirmed=true;label="💧 LIQ SWEEP↓";strength=2;}
    else if(fvg.present)             {confirmed=true;label="🟦 FVG BULL";  strength=1;}
  }
  if(direction==="BEAR"){
    if(choch.detected&&choch.toBear){confirmed=true;label="🔄 CHoCH→BEAR";strength=3;}
    else if(bos.bearBOS)            {confirmed=true;label="⬇️ BOS BEAR";  strength=2;}
    else if(liqSweep.highSweep)     {confirmed=true;label="💧 LIQ SWEEP↑";strength=2;}
    else if(fvg.present)             {confirmed=true;label="🟥 FVG BEAR";  strength=1;}
  }
  const prevStr=choch.prevTrend?`Prev:${choch.prevTrend}`:"Trend:unclear";
  return{confirmed,label,strength,bos,choch,liqSweep,fvg,swings,prevStr};
}

// ── CONVICTION ENGINE ─────────────────────────────────────────────────────────
// v6.1: trendBull removed, MS ADDITIVE, Z-Score lowered, RSI bonus added
function computeConviction(gwp,math,ms,tfKey,isConfluence=false,isTriple=false){
  let score=0;

  // GWP CORE (0–32)
  const gs=parseFloat(gwp.score);score+=gs>=7.5?32:gs>=6.5?26:gs>=5.5?18:10;

  // AVWAP TRAP (12)
  if(gwp.avwapTrap) score+=12;

  // VOLUME SPIKE (6)
  if(gwp.volumeSpike) score+=6;

  // PATH A BONUS (4)
  if(!gwp.isPathB) score+=4;

  // MOMENTUM BURST (4)
  if(gwp.momentumBurst) score+=4;

  // ZONE REVISIT (3)
  if(gwp.zoneRevisit) score+=3;

  // MATH ENGINE (0–30)
  if(math){
    if(math.hurst<0.45)      score+=8;
    else if(math.hurst<0.55) score+=4;

    // Z-Score (v6.1: lower thresholds for better counter-trend detection)
    const z=math.zScore;
    if(gwp.direction==="BULL"&&z.extremeLow) score+=6;
    if(gwp.direction==="BEAR"&&z.extremeHigh)score+=6;
    if(gwp.direction==="BULL"&&z.mildLow)    score+=3;
    if(gwp.direction==="BEAR"&&z.mildHigh)   score+=3;

    // Kalman velocity reversal
    if(math.kalman){const rev=(gwp.direction==="BULL"&&!math.kalman.bullish)||(gwp.direction==="BEAR"&&math.kalman.bullish);if(rev)score+=6;}

    // ATR percentile sweet zone
    if(math.atrPct>=25&&math.atrPct<=75)     score+=4;
    else if(math.atrPct>=15&&math.atrPct<=85)score+=2;

    // Volume ratio
    if(math.volRatio>=2.0)      score+=4;
    else if(math.volRatio>=1.5) score+=3;
    else if(math.volRatio>=1.2) score+=1;

    // v6.1: RSI extreme bonus — fuel for counter-trend reversal
    if(math.rsi&&gwp.direction==="BULL"&&math.rsi<30) score+=7;
    else if(math.rsi&&gwp.direction==="BULL"&&math.rsi<40) score+=3;
    if(math.rsi&&gwp.direction==="BEAR"&&math.rsi>70) score+=7;
    else if(math.rsi&&gwp.direction==="BEAR"&&math.rsi>60) score+=3;
    // v6.1: trendBull bias REMOVED — GWP is counter-trend by design
  }

  // WYCKOFF STRUCTURAL CONFIRMATION (0–10)
  if(gwp.wyckoff){
    if(gwp.direction==="BULL"&&gwp.wyckoff.spring)   score+=10;
    if(gwp.direction==="BEAR"&&gwp.wyckoff.upthrust) score+=10;
  }
  // SINE-WAVE CYCLE GATE — contraction = cycle exhaustion = GWP reversal window (+8)
  if(math&&math.cycle&&math.cycle.contraction) score+=8;
    // MARKET STRUCTURE (0–30) — v6.1: ADDITIVE, no penalty
  if(ms){
    // CHoCH is king — but BOS also scores independently (was else-if)
    if(ms.choch&&ms.choch.detected){
      if((gwp.direction==="BULL"&&ms.choch.toBull)||(gwp.direction==="BEAR"&&ms.choch.toBear))score+=14;
    }
    // v6.1: BOS ADDITIVE — scores even when CHoCH is present
    if(ms.bos){
      if((gwp.direction==="BULL"&&ms.bos.bullBOS)||(gwp.direction==="BEAR"&&ms.bos.bearBOS))score+=8;
    }
    const lsConf=(gwp.direction==="BULL"&&ms.liqSweep&&ms.liqSweep.lowSweep)||(gwp.direction==="BEAR"&&ms.liqSweep&&ms.liqSweep.highSweep);
    if(lsConf)score+=5;
    if(ms.fvg&&ms.fvg.present)score+=3;
    // v6.1: !ms.confirmed penalty REMOVED — MS is bonus only, never a barrier
  }

  // CONFLUENCE BOOSTS
  if(isTriple)  score+=CONFIG.TRIPLE_TF_BOOST;
  else if(isConfluence)score+=CONFIG.CONFLUENCE_CONVICTION_BOOST;

  score=Math.max(0,Math.min(score,123));
  const grade=score>=108?"🏆 SUPREME★★★★":score>=96?"🏆 SUPREME★★★":score>=84?"⚡ SUPREME★★":score>=72?"🔥 SUPREME★":score>=58?"🔥 ELITE":score>=50?"✅ SOLID":"⚠️ MARGINAL";
  return{score:score.toFixed(1),grade};
}

// ── DEDUP ─────────────────────────────────────────────────────────────────────
function isDuplicate(symbol,direction,tag){
  const key=`FDUP6_${tag}_${symbol}_${direction}`;const last=getProp(key);
  return last&&(Date.now()-parseInt(last))<CONFIG.DEDUP_WINDOW_MS;
}
function markFired(symbol,direction,tag){setProp(`FDUP6_${tag}_${symbol}_${direction}`,Date.now().toString());}

// ── CORE GWP DETECTOR ─────────────────────────────────────────────────────────
// v6.1: KEY FIX — SL calculation now uses candle-range buffer + asset-class minimum
function detectGWP(candles,vp,avwap,math,dec,tfCfg,isCrypto){
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
    const staleZone=atr*(tfCfg.tf==="M15"?0.3:0.5);
    if(direction==="BEAR"&&cur.close<=(bMid-staleZone)){console.log(`  GWP BEAR ${tfCfg.label} age=${age}: stale`);continue;}
    if(direction==="BULL"&&cur.close>=(bMid+staleZone)){console.log(`  GWP BULL ${tfCfg.label} age=${age}: stale`);continue;}

    let avwapTrap=false;
    if(avwap){const prox=tfCfg.avwapProx;avwapTrap=Math.abs(sig.high-avwap)/avwap<=prox||Math.abs(sig.low-avwap)/avwap<=prox;}

    const sigIdx=n-2-age;
    const volumeSpike=hasVolumeSpike(sig,candles,sigIdx,20,tfCfg.volSpikeMult);
    const momentumBurst=calcMomentumBurst(candles,sigIdx);
    const zoneRevisit=calcZoneRevisit(candles,bBot,bTop);
    const wyckoff=detectWyckoff(candles,direction);
    const fib=calcFib786(candles,direction);
    const cycle=math?math.cycle:null;

    const bodyGapPct=(bodyGap/bH)*100,isPathB=bodyGapPct<35;

    // ── v6.1 SL FIX: Multi-layer buffer ──────────────────────────────────────
    // Layer 1: ATR buffer (raised atrBufMult)
    // Layer 2: Signal candle full range (prevents SL inside the wick)
    // Layer 3: Asset-class minimum percentage
    const sigCandleRange=sig.high-sig.low;
    const rangeBuffer=sigCandleRange*0.15;  // 15% of signal candle range

    let sl;
    if(direction==="BEAR"){
      const slBase=Math.max(sig.high+atrBuf, sig.high+rangeBuffer);
      sl=isPathB?slBase+(slBase-cur.close)*0.30:slBase;
    }else{
      const slBase=Math.min(sig.low-atrBuf, sig.low-rangeBuffer);
      sl=isPathB?slBase-(cur.close-slBase)*0.30:slBase;
    }

    // Layer 3: enforce minimum SL distance by asset class
    const entry=cur.close;
    const minSlPct = isCrypto ? CONFIG.CRYPTO_MIN_SL_PCT : (tfCfg.minSlPct||CONFIG.FOREX_MIN_SL_PCT);
    const minSlDist = entry * minSlPct / 100;
    if(direction==="BEAR"&&(sl-entry)<minSlDist) sl=entry+minSlDist;
    if(direction==="BULL"&&(entry-sl)<minSlDist) sl=entry-minSlDist;
    // ─────────────────────────────────────────────────────────────────────────

    const tp2=bMid;
    let tp1=direction==="BEAR"?entry-Math.abs(entry-tp2)*0.5:entry+Math.abs(tp2-entry)*0.5;
    const risk=Math.abs(entry-sl);if(risk<=0)continue;
    let rr=Math.abs(entry-tp2)/risk;
    if(rr<tfCfg.minRR){tp1=direction==="BEAR"?bBot:bTop;rr=Math.abs(entry-tp2)/risk;}
    if(rr<tfCfg.minRR){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: R:R=${rr.toFixed(2)} below gate`);continue;}

    const tp3=direction==="BEAR"?entry-Math.abs(entry-tp2)*CONFIG.TP3_MULT:entry+Math.abs(tp2-entry)*CONFIG.TP3_MULT;
    const agePenalty=age*0.5;
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
    const grade=score>=7.5?"A+★ SUPREME":score>=6.5?"A+ ELITE":score>=5.5?"A SOLID":"B+ VALID";
    if(score<4.5){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: score=${score.toFixed(1)} below threshold`);continue;}

    const fmt=v=>Number(v).toFixed(dec);
    const tp4=fib.level786?fmt(fib.level786):null;
    const reEntry=isPathB?fmt(direction==="BEAR"?entry+Math.abs(entry-sl)*0.8:entry-Math.abs(entry-sl)*0.8):null;
    console.log(`  ✅ GWP [${tfCfg.label}]: ${direction} age=${age} ${grade} score=${score.toFixed(1)} R:R=${rr.toFixed(2)} SL=${fmt(sl)} (${(Math.abs(entry-sl)/entry*100).toFixed(3)}%)`);

    return{
      direction,grade,score:score.toFixed(1),rawScore,age,tf:tfCfg.tf,tfLabel:tfCfg.label,
      path:isPathB?"B — Sweep + Return ⚠️":"A — Direct Return 🎯",
      isPathB,volumeSpike,avwapTrap,momentumBurst,zoneRevisit,
      entry:fmt(entry),sl:fmt(sl),tp1:fmt(tp1),tp2:fmt(tp2),tp3:fmt(tp3),rr:rr.toFixed(2),
      slPct:(Math.abs(entry-sl)/entry*100).toFixed(3),
      tp1Pct:(Math.abs(entry-tp1)/entry*100).toFixed(3),
      tp2Pct:(Math.abs(entry-tp2)/entry*100).toFixed(3),
      tp3Pct:(Math.abs(entry-tp3)/entry*100).toFixed(3),
      wickDepthPct:(wickDepth/bH*100).toFixed(1),bodyGapPct:bodyGapPct.toFixed(1),
      avwap:avwap?fmt(avwap):null,
      vp:{val:fmt(bBot),mid:fmt(bMid),top:fmt(bTop),poc:fmt(vp.poc)},
      checks,reEntry,signalTime:new Date(sig.t).toUTCString(),
      wyckoff,fib,tp4,
      cycleLabel:cycle?cycle.label:"⬜ CYCLE: —",
      cycleGate:cycle?cycle.contraction:false,
    };
  }
  return null;
}

// ── SESSION LABEL ────────────────────────────────────────────────────────────
function getForexSession(){
  const h=new Date().getUTCHours();
  if(h>=7&&h<12)  return "🇬🇧 London (24/7 ✅)";
  if(h>=12&&h<17) return "🌍 London/NY (24/7 ✅)";
  if(h>=17&&h<21) return "🇺🇸 New York (24/7 ✅)";
  if(h>=0&&h<6)   return "🌏 Asia (24/7 ✅)";
  return "🌙 Off-hours (24/7 ✅)";
}

// ── COOLDOWNS ──────────────────────────────────────────────────────────────────
function isOnCooldown(symbol,direction,tfKey){
  const last=getProp(`fcd6_${tfKey}_${symbol}_${direction}`);
  return last&&(Date.now()-parseInt(last))/3600000<TF_CONFIG[tfKey].cooldownHrs;
}
function setCooldown(symbol,direction,tfKey){setProp(`fcd6_${tfKey}_${symbol}_${direction}`,Date.now().toString());}

// ── CIRCUIT BREAKER ────────────────────────────────────────────────────────────
function isCircuitBroken(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return false;
  const raw=getProp("FCB6_"+symbol);if(!raw)return false;
  try{const cb=JSON.parse(raw);if(Date.now()-cb.ts<CONFIG.CIRCUIT_BREAKER_HRS*3600000)return true;delProp("FCB6_"+symbol);}catch(e){}
  return false;
}
async function recordLoss(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return;
  const key="FCBL6_"+symbol,n=parseInt(getProp(key)||"0")+1;setProp(key,n.toString());
  if(n>=CONFIG.CIRCUIT_BREAKER_LOSSES){setProp("FCB6_"+symbol,JSON.stringify({ts:Date.now(),losses:n}));delProp(key);await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol}</b>\n${n} losses. Paused ${CONFIG.CIRCUIT_BREAKER_HRS}h.\n\n<i>${V}</i>`);}
}
function recordWin(symbol){if(CONFIG.CIRCUIT_BREAKER)delProp("FCBL6_"+symbol);}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(pair,r,conv,tfKey){
  setProp("FPOS6_"+pair.symbol+"_"+r.direction+"_"+tfKey,JSON.stringify({
    symbol:pair.symbol,label:pair.label,source:pair.source,
    kucoinSymbol:pair.kucoinSymbol||null,twelveSymbol:pair.twelveSymbol||null,
    dec:pair.dec,direction:r.direction,entry:parseFloat(r.entry),sl:parseFloat(r.sl),
    tp1:parseFloat(r.tp1),tp2:parseFloat(r.tp2),tp3:parseFloat(r.tp3),
    rr:r.rr,grade:r.grade,tf:tfKey,conviction:conv?conv.score:"?",
    isPathB:r.isPathB,reEntry:r.reEntry,state:"OPEN",tp1hit:false,tp2hit:false,ts:Date.now(),
  }));
}
async function checkOpenPositions(){
  const posKeys=Object.keys(state).filter(k=>k.startsWith("FPOS6_"));
  for(const key of posKeys){
    let p;try{p=JSON.parse(getProp(key));}catch(e){continue;}
    if(!p||p.state!=="OPEN")continue;
    let candles=null;
    if(p.source==="kucoin")candles=await fetchKuCoin(p.kucoinSymbol,"M15",3);
    else if(p.source==="twelve")candles=await fetchTwelveData(p.twelveSymbol,"M15",3);
    if(!candles||!candles.length)continue;
    const price=candles[candles.length-1].close,isL=p.direction==="BULL";
    const pnl=((isL?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(3);
    const f=n=>Number(n).toFixed(p.dec);let msg=null;
    if(!p.tp1hit&&(isL?price>=p.tp1:price<=p.tp1)){p.tp1hit=true;msg=`🎯 <b>GWP TP1 HIT — ${p.label} [${p.tf}]</b>\n40% exit. Move SL to BE.\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;}
    if(!p.tp2hit&&(isL?price>=p.tp2:price<=p.tp2)){p.tp2hit=true;msg=`🏆 <b>GWP TP2 HIT — ${p.label} [${p.tf}]</b> 🔥\nHold 20% for TP3: <code>${f(p.tp3)}</code>\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;}
    if(p.tp2hit&&(isL?price>=p.tp3:price<=p.tp3)){msg=`🏅 <b>GWP TP3 HIT! — ${p.label} [${p.tf}]</b> 💎\nFull exit. P&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,true);}
    if(isL?price<=p.sl:price>=p.sl){const pbN=p.isPathB?`\n⚡ Path B re-entry: <code>${p.reEntry||"zone"}</code>`:"";msg=`❌ <b>GWP SL HIT — ${p.label} [${p.tf}]</b>\n${p.direction} ${f(p.entry)} → SL ${f(p.sl)}\nP&L: <b>${pnl}%</b>${pbN}\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,false);}
    if(msg){await tgSend(msg);if(p.state==="CLOSED")delProp(key);else setProp(key,JSON.stringify(p));}else{setProp(key,JSON.stringify(p));}
  }
}

// ── TRACKING ───────────────────────────────────────────────────────────────────
function getDateKey(){return new Date().toISOString().slice(0,10);}
function getWeekKey(){const now=new Date(),s=new Date(now.getFullYear(),0,1);return now.getFullYear()+"_W"+String(Math.ceil(((now-s)/86400000+s.getDay()+1)/7)).padStart(2,"0");}
function trackFired(pair,r,mode){
  const dk="F6_D_"+getDateKey();let d;try{d=JSON.parse(getProp(dk)||"[]");}catch(e){d=[];}
  d.push({sym:pair.symbol,dir:r.direction,grade:r.grade,tf:r.tf,mode,rr:r.rr,ts:Date.now()});setProp(dk,JSON.stringify(d));
  const wk="F6_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  w.signals=(w.signals||0)+1;if(mode==="TRIPLE")w.triple=(w.triple||0)+1;else if(mode==="CONFLUENCE")w.confluence=(w.confluence||0)+1;setProp(wk,JSON.stringify(w));
}
async function trackClose(symbol,direction,pnlPct,isWin){
  const wk="F6_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  if(isWin){w.wins=(w.wins||0)+1;recordWin(symbol);}else{w.losses=(w.losses||0)+1;await recordLoss(symbol);}
  w.pnl=parseFloat(((w.pnl||0)+parseFloat(pnlPct||0)).toFixed(3));setProp(wk,JSON.stringify(w));
}

// ── SIGNAL FORMATTERS ─────────────────────────────────────────────────────────
function fmtMS(ms,direction){
  if(!ms)return"⬜ MS: no data";
  const chochStr=ms.choch&&ms.choch.detected?`CHoCH→${ms.choch.prevTrend==="BEAR"?"BULL":"BEAR"}✅`:"CHoCH:—";
  const bosStr  =ms.bos?(direction==="BULL"&&ms.bos.bullBOS?"BOS↑✅":direction==="BEAR"&&ms.bos.bearBOS?"BOS↓✅":"BOS:—"):"BOS:—";
  const lsStr   =ms.liqSweep?(direction==="BULL"&&ms.liqSweep.lowSweep?"LiqSwp↓✅":direction==="BEAR"&&ms.liqSweep.highSweep?"LiqSwp↑✅":"LiqSwp:—"):"LiqSwp:—";
  const fvgStr  =ms.fvg&&ms.fvg.present?"FVG✅":"FVG:—";
  return`${ms.label}\n  ${chochStr}  ${bosStr}  ${lsStr}  ${fvgStr}`;
}
function fmtExtras(r){
  let x="";
  if(r.momentumBurst) x+="\n⚡ <b>MOMENTUM BURST</b> — velocity expansion on signal bar";
  if(r.zoneRevisit)   x+="\n🔄 <b>ZONE REVISIT</b> — accumulation at VAL band";
  if(r.isPathB)       x+=`\n⚠️ <b>PATH B</b> — sweep possible. Re-entry: <b>${r.reEntry}</b>`;
  return x;
}
function formatTripleSignal(r4h,r1h,r15m,pair,c4h,c1h,c15m,ms4h,ms1h,ms15m){
  const dir=r4h.direction==="BULL"?"🟢 LONG  ▲":"🔴 SHORT ▼";
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const trap=r4h.avwapTrap||r1h.avwapTrap||r15m.avwapTrap?"🪤 <b>AVWAP TRAP CONFIRMED</b>\n":"";
  const check4h=r4h.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");
  const check1h=r1h.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");
  const check15m=r15m.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");
  return(
    `🔥🔥🔥 <b>TRIPLE TF — ${pair.label}</b> 🔥🔥🔥\n`+
    `<b>★★ ELITE MAX™ — HIGHEST CONVICTION ★★</b>\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `${dir}  |  <b>4H + 1H + 15M ALIGNED</b>\n`+
    `⚡ Conviction 4H: <b>${c4h.score}/105</b> — ${c4h.grade}\n`+
    `⚡ Conviction 1H: <b>${c1h.score}/105</b>\n`+
    `⚡ Conviction 15M: <b>${c15m.score}/105</b>\n`+
    `${trap}`+
    `🕐 ${getForexSession()}\n\n`+
    `━━━━━ 📐 4H ━━━━━\n`+
    `Grade: <b>${r4h.grade}</b>  Score: ${r4h.score}/8\n`+
    `🏛 ${fmtMS(ms4h,r4h.direction)}\n`+
    `Band: <code>${r4h.vp.val} – ${r4h.vp.top}</code>  POC: <code>${r4h.vp.poc}</code>\n`+
    `${r4h.avwap?`AVWAP: <code>${r4h.avwap}</code>\n`:""}${fmtExtras(r4h)}\n\n`+
    `━━━━━ ⚡ 1H ━━━━━\n`+
    `Grade: <b>${r1h.grade}</b>  Score: ${r1h.score}/8\n`+
    `🏛 ${fmtMS(ms1h,r1h.direction)}\n`+
    `Band: <code>${r1h.vp.val} – ${r1h.vp.top}</code>\n`+
    `${fmtExtras(r1h)}\n\n`+
    `━━━━━ 🔬 15M ━━━━━\n`+
    `Grade: <b>${r15m.grade}</b>  Score: ${r15m.score}/8\n`+
    `🏛 ${fmtMS(ms15m,r15m.direction)}\n`+
    `Sniper zone: <code>${r15m.vp.val} – ${r15m.vp.top}</code>\n`+
    `${fmtExtras(r15m)}\n\n`+
    `━━━━━ 💼 TRADE LEVELS ━━━━━\n`+
    `🎯 <b>Entry:</b>   <code>${r4h.entry}</code>  (4H basis)\n`+
    `🔬 <b>Sniper:</b>  <code>${r15m.entry}</code>  (15M limit)\n`+
    `🛑 <b>SL:</b>      <code>${r4h.sl}</code>  (-${r4h.slPct}%)  [v6.1 safe buffer]\n`+
    `✅ <b>TP1:</b>     <code>${r4h.tp1}</code>  (+${r4h.tp1Pct}% — 40%)\n`+
    `🏆 <b>TP2:</b>     <code>${r4h.tp2}</code>  (+${r4h.tp2Pct}% — 40% · BE)\n`+
    `💎 <b>TP3:</b>     <code>${r4h.tp3}</code>  (+${r4h.tp3Pct}% — 20% runner)\n`+
    `📐 <b>R:R:</b>     ${r4h.rr}:1  |  💼 Risk: $${riskUSD.toFixed(2)} Pos: $${posUSD.toFixed(0)} (${CONFIG.LEVERAGE}×)\n\n`+
    `\n━━━━━ 🔬 THEORY ━━━━━\n`+
    `  ${r4h.wyckoff?r4h.wyckoff.label:"⬜ WYK: —"}\n`+
    `  ${r4h.cycleLabel}${r4h.cycleGate?" ✅ REVERSAL GATE":" ⚠️ MONITOR"}\n`+
    `  ${r4h.fib?r4h.fib.label:"⬜ EW: —"}\n\n`+
    `━━━━━ ✅ 4H ━━━━━\n${check4h}\n`+
    `\n━━━━━ ✅ 1H ━━━━━\n${check1h}\n`+
    `\n━━━━━ ✅ 15M ━━━━━\n${check15m}\n\n`+
    `⏰ ${new Date().toUTCString()}\n<i>${V}</i>`
  );
}
function formatConfluenceSignal(r4h,r1h,pair,conv4h,conv1h,ms4h,ms1h){
  const dir=r4h.direction==="BULL"?"🟢 LONG  ▲":"🔴 SHORT ▼";
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const trap4h=r4h.avwapTrap?"🪤 <b>AVWAP TRAP [4H]</b>\n":"";
  const trap1h=r1h.avwapTrap?"🪤 <b>AVWAP TRAP [1H]</b>\n":"";
  const check4h=r4h.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");
  const check1h=r1h.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");
  return(
    `🔥🔥 <b>TF CONFLUENCE — ${pair.label}</b> 🔥🔥\n`+
    `<b>★ MONEY PRINTING MACHINE ELITE MAX™ ★</b>\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `${dir}  |  <b>4H + 1H ALIGNED</b>\n`+
    `⚡ Conviction: <b>${conv4h.score}/105</b> — ${conv4h.grade}\n`+
    `${trap4h}${trap1h}`+
    `🕐 ${getForexSession()}\n\n`+
    `━━━━━ 📐 4H ━━━━━\n`+
    `Grade: <b>${r4h.grade}</b>  Score: ${r4h.score}/8\n`+
    `🏛 ${fmtMS(ms4h,r4h.direction)}\n`+
    `Band: <code>${r4h.vp.val} – ${r4h.vp.top}</code>  POC: <code>${r4h.vp.poc}</code>\n`+
    `${r4h.avwap?`AVWAP: <code>${r4h.avwap}</code>\n`:""}${fmtExtras(r4h)}\n\n`+
    `━━━━━ ⚡ 1H ━━━━━\n`+
    `Grade: <b>${r1h.grade}</b>  Score: ${r1h.score}/8\n`+
    `🏛 ${fmtMS(ms1h,r1h.direction)}\n`+
    `Band: <code>${r1h.vp.val} – ${r1h.vp.top}</code>  POC: <code>${r1h.vp.poc}</code>\n`+
    `${fmtExtras(r1h)}\n\n`+
    `━━━━━ 💼 TRADE LEVELS ━━━━━\n`+
    `🎯 <b>Entry:</b>   <code>${r4h.entry}</code>  (4H)\n`+
    `⚡ <b>Precise:</b> <code>${r1h.entry}</code>  (1H limit)\n`+
    `🛑 <b>SL:</b>      <code>${r4h.sl}</code>  (-${r4h.slPct}%)  [v6.1 safe buffer]\n`+
    `✅ <b>TP1:</b>     <code>${r4h.tp1}</code>  (+${r4h.tp1Pct}% — 40%)\n`+
    `🏆 <b>TP2:</b>     <code>${r4h.tp2}</code>  (+${r4h.tp2Pct}% — 40% · BE)\n`+
    `💎 <b>TP3:</b>     <code>${r4h.tp3}</code>  (+${r4h.tp3Pct}% — 20% runner)\n`+
    `📐 <b>R:R:</b>     ${r4h.rr}:1 (4H)  |  ${r1h.rr}:1 (1H)\n`+
    `💼 <b>Risk:</b>    $${riskUSD.toFixed(2)} Pos: $${posUSD.toFixed(0)} (${CONFIG.LEVERAGE}×)\n\n`+
    `\n━━━━━ 🔬 THEORY ━━━━━\n`+
    `  ${r4h.wyckoff?r4h.wyckoff.label:"⬜ WYK: —"}\n`+
    `  ${r4h.cycleLabel}${r4h.cycleGate?" ✅ REVERSAL GATE":" ⚠️ MONITOR"}\n`+
    `  ${r4h.fib?r4h.fib.label:"⬜ EW: —"}\n\n`+
    `━━━━━ ✅ 4H ━━━━━\n${check4h}\n`+
    `\n━━━━━ ✅ 1H ━━━━━\n${check1h}\n\n`+
    `⏰ ${new Date().toUTCString()}\n<i>${V}</i>`
  );
}
function formatSingleSignal(r,pair,conv,ms,label){
  const dir=r.direction==="BULL"?"🟢 LONG  ▲":"🔴 SHORT ▼";
  const ageN=r.age>0?`\n⏱ ${r.age} bars ago (${r.signalTime})`:"";
  const check=r.checks.map((c,i)=>`${c.pass?"✅":"⬜"} ${i+1}. ${c.item}`).join("\n");
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  return(
    `👻 <b>GWP — ${pair.label}</b>  [${r.tfLabel}]\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `${label?label+" ":""}${dir}  Grade: <b>${r.grade}</b>  ${r.score}/8\n`+
    `⚡ Conviction: <b>${conv.score}/105</b> — ${conv.grade}${ageN}\n`+
    `🕐 ${getForexSession()}`+
    (r.avwapTrap?"\n🪤 <b>AVWAP TRAP</b>":"")+
    `${fmtExtras(r)}\n\n`+
    `🏛 <b>Market Structure</b>\n  ${fmtMS(ms,r.direction)}\n\n`+
    `🎯 <b>Entry:</b>  <code>${r.entry}</code>\n`+
    `🛑 <b>SL:</b>     <code>${r.sl}</code>  (-${r.slPct}%)  [v6.1 safe buffer]\n`+
    `✅ <b>TP1:</b>    <code>${r.tp1}</code>  (+${r.tp1Pct}% — 40%)\n`+
    `🏆 <b>TP2:</b>    <code>${r.tp2}</code>  (+${r.tp2Pct}% — VAL Mid)\n`+
    `💎 <b>TP3:</b>    <code>${r.tp3}</code>  (+${r.tp3Pct}% — runner)\n`+
    `📐 <b>R:R:</b>    ${r.rr}:1\n`+
    `💼 <b>Risk:</b>   $${riskUSD.toFixed(2)} Pos: $${posUSD.toFixed(0)} (${CONFIG.LEVERAGE}×)\n`+
    (r.tp4?`📐 <b>TP4:</b>    <code>${r.tp4}</code>  (+EW 78.6% runner)\n`:"")+
    `\n━━━━━ 🔬 THEORY ━━━━━\n`+
    `  ${r.wyckoff?r.wyckoff.label:"⬜ WYK: —"}\n`+
    `  ${r.cycleLabel}${r.cycleGate?" ✅ REVERSAL GATE":" ⚠️ MONITOR"}\n`+
    `  ${r.fib?r.fib.label:"⬜ EW: —"}\n`+
    `\n━━━━━ 📊 LEVELS ━━━━━\n`+
    `📊 Band: <code>${r.vp.val}–${r.vp.top}</code>  Mid: <code>${r.vp.mid}</code>  POC: <code>${r.vp.poc}</code>\n`+
    `Wick: ${r.wickDepthPct}%  Gap: ${r.bodyGapPct}%${r.avwap?`  AVWAP: <code>${r.avwap}</code>`:""}\n`+
    `\n━━━━━ ✅ CHECKLIST ━━━━━\n${check}\n\n`+
    `⏰ ${new Date().toUTCString()}\n<i>${V}</i>`
  );
}

// ── INFO COMMANDS ─────────────────────────────────────────────────────────────
async function sendDailySummary(){
  const today=getDateKey();let d;try{d=JSON.parse(getProp("F6_D_"+today)||"[]");}catch(e){d=[];}
  let msg=`📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if(!d.length)msg+=`📊 <b>Signals: 0</b>\nScanning 24/7. No setups triggered today.\n\n`;
  else{msg+=`📊 <b>Signals: ${d.length}</b>\n`;d.forEach(s=>{msg+=`  ${s.dir==="BULL"?"🟢":"🔴"} ${s.sym} [${s.tf}] ${s.mode||""} | ${s.grade} | R:R ${s.rr}\n`;});msg+="\n";}
  msg+=`⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendWeeklySummary(){
  let w;try{w=JSON.parse(getProp("F6_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const closed=(w.wins||0)+(w.losses||0),wr=closed>0?((w.wins||0)/closed*100).toFixed(0)+"%":"—";
  let msg=`📆 <b>WEEKLY SUMMARY — ${getWeekKey().replace("_"," ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg+=`📊 Signals: ${w.signals||0}  Confluences: ${w.confluence||0}  Triples: ${w.triple||0}\n`;
  if(closed>0)msg+=`✅ ${w.wins||0}W  ❌ ${w.losses||0}L  Win Rate: <b>${wr}</b>\n💰 P&L: <b>${(w.pnl||0)>=0?"+":""}${w.pnl||0}%</b>\n`;
  else msg+=`  No closed trades yet.\n`;
  msg+=`\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendHealth(){
  let msg=`💚 <b>GWP Forex v7.0 ELITE MAX — HEALTH</b>\n\n`;
  for(const pair of CONFIG.PAIRS){
    let price="?";
    try{const c=pair.source==="kucoin"?await fetchKuCoin(pair.kucoinSymbol,"H1",2):await fetchTwelveData(pair.twelveSymbol,"H1",2);if(c&&c.length)price=c[c.length-1].close.toFixed(pair.dec);}catch(e){}
    const cb=isCircuitBroken(pair.symbol)?" ⛔CB":"";
    msg+=`${price!=="?"?"✅":"❌"} ${pair.symbol}: ${price!=="?"?"$"+price:"NO DATA"}${cb}\n`;
  }
  msg+=`\n🕐 ${getForexSession()}\n`;
  msg+=`🔄 Scanning 24/7 — No dead periods\n`;
  msg+=`📊 Twelve Data key: ${CONFIG.TWELVE_DATA_KEY?"✅ SET":"❌ MISSING"}\n`;
  msg+=`📅 Last scan: ${state.lastScanTime||"never"}\n`;
  msg+=`🔥 Last fired: ${state.lastScanFired||0} signals\n`;
  msg+=`⚙️ v6.1: SL buffer fixed | Bear bias removed\n\n<i>${V}</i>`;await tgSend(msg);
}
async function sendStatus(){
  let w;try{w=JSON.parse(getProp("F6_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const openCount=Object.keys(state).filter(k=>k.startsWith("FPOS6_")).length;
  await tgSend(
    `📡 <b>GWP Forex v7.0 ELITE MAX — ONLINE</b> ✅\n\n`+
    `Pairs: ${CONFIG.PAIRS.map(p=>p.symbol).join(", ")}\n`+
    `TFs: 4H + 1H + 15M (Triple Engine)\n`+
    `Gates: 4H≥${TF_CONFIG.H4.minConviction} | 1H≥${TF_CONFIG.H1.minConviction} | 15M≥${TF_CONFIG.M15.minConviction}\n`+
    `Session: 24/7 — ALWAYS ON\n`+
    `Confluence: +${CONFIG.CONFLUENCE_CONVICTION_BOOST} | Triple: +${CONFIG.TRIPLE_TF_BOOST}\n`+
    `SL: crypto min ${CONFIG.CRYPTO_MIN_SL_PCT}% | forex min ${CONFIG.FOREX_MIN_SL_PCT}%\n`+
    `Open positions: ${openCount}\n`+
    `This week: ${w.signals||0} signals | ${w.wins||0}W ${w.losses||0}L\n\n`+
    `<i>${V}</i>`
  );
}
async function sendPositions(){
  const keys=Object.keys(state).filter(k=>k.startsWith("FPOS6_"));
  if(!keys.length){await tgSend(`📭 No open positions.\n\n<i>${V}</i>`);return;}
  let msg=`📊 <b>Open GWP Positions</b>\n\n`;
  for(const k of keys){try{const p=JSON.parse(getProp(k));msg+=`${p.direction==="BULL"?"🟢":"🔴"} <b>${p.label}</b> ${p.direction} [${p.tf}]\n  Entry: ${p.entry}  SL: ${p.sl}  TP2: ${p.tp2}  TP3: ${p.tp3}  Conv: ${p.conviction}/105\n\n`;}catch(e){}}
  await tgSend(msg+`<i>${V}</i>`);
}
async function sendHelp(){
  await tgSend(
    `👻 <b>GWP FOREX v7.0 ELITE MAX™</b>\n`+
    `<b>Money Printing Machine — 24/7 Always On</b>\n\n`+
    `<b>Commands:</b>\n`+
    `/scan — full scan (4H+1H+15M)\n`+
    `/xauusd · /eurusd · /gbpusd · /usdjpy · /gbpjpy · /btc\n`+
    `/daily · /weekly · /health · /positions · /status · /reset · /help\n\n`+
    `<b>v6.1 Fixes:</b>\n`+
    `▸ 🛑 SL: crypto min 0.35% | forex min 0.10%\n`+
    `▸ ⚖️ Bear bias removed: trendBull bonus gone\n`+
    `▸ ➕ MS scoring additive: CHoCH + BOS both score\n`+
    `▸ 📉 Z-Score thresholds lowered for better detection\n`+
    `▸ 📊 RSI oversold/overbought bonus added\n`+
    `▸ 🇯🇵 USDJPY + GBPJPY added (6 pairs total)\n\n`+
    `<i>Every candle. Every session. Zero downtime.</i>\n\n`+
    `<i>${V}</i>`
  );
}
async function resetCooldowns(){
  let n=0;for(const k of Object.keys(state)){if(k.startsWith("fcd6_")||k.startsWith("FPOS6_")||k.startsWith("FCB6_")||k.startsWith("FCBL6_")||k.startsWith("FDUP6_")){delProp(k);n++;}}
  await tgSend(`✅ Cleared ${n} cooldowns/positions/dedups/circuit-breakers.\n\n<i>${V}</i>`);
}

// ── SINGLE PAIR SCAN ──────────────────────────────────────────────────────────
async function scanSingle(pair){
  const c4h=await fetchCandles(pair,"H4",TF_CONFIG.H4.vpLookback+20);
  const c1h=await fetchCandles(pair,"H1",TF_CONFIG.H1.vpLookback+20);
  const c15m=await fetchCandles(pair,"M15",TF_CONFIG.M15.vpLookback+20);
  const vp4h=c4h?computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback):null;
  const vp1h=c1h?computeVolumeProfile(c1h,TF_CONFIG.H1.vpLookback):null;
  const vp15m=c15m?computeVolumeProfile(c15m,TF_CONFIG.M15.vpLookback):null;
  const m4h=c4h?runMathEngine(c4h):null,m1h=c1h?runMathEngine(c1h):null,m15m=c15m?runMathEngine(c15m):null;
  const isCrypto=pair.crypto||false;
  const r4h=c4h&&vp4h?detectGWP(c4h,vp4h,computeAVWAP(c4h,TF_CONFIG.H4.avwapLookback),m4h,pair.dec,TF_CONFIG.H4,isCrypto):null;
  const r1h=c1h&&vp1h?detectGWP(c1h,vp1h,computeAVWAP(c1h,TF_CONFIG.H1.avwapLookback),m1h,pair.dec,TF_CONFIG.H1,isCrypto):null;
  const r15m=c15m&&vp15m?detectGWP(c15m,vp15m,computeAVWAP(c15m,TF_CONFIG.M15.avwapLookback),m15m,pair.dec,TF_CONFIG.M15,isCrypto):null;
  const ms4h=r4h?analyzeMarketStructure(c4h,r4h.direction,TF_CONFIG.H4):null;
  const ms1h=r1h?analyzeMarketStructure(c1h,r1h.direction,TF_CONFIG.H1):null;
  const ms15m=r15m?analyzeMarketStructure(c15m,r15m.direction,TF_CONFIG.M15):null;
  if(r4h&&r1h&&r15m&&r4h.direction===r1h.direction&&r1h.direction===r15m.direction){
    const c4=computeConviction(r4h,m4h,ms4h,"H4",false,true),c1=computeConviction(r1h,m1h,ms1h,"H1",false,true),c15=computeConviction(r15m,m15m,ms15m,"M15",false,true);
    await tgSend(formatTripleSignal(r4h,r1h,r15m,pair,c4,c1,c15,ms4h,ms1h,ms15m));
  }else if(r4h&&r1h&&r4h.direction===r1h.direction){
    const c4=computeConviction(r4h,m4h,ms4h,"H4",true),c1=computeConviction(r1h,m1h,ms1h,"H1",true);
    await tgSend(formatConfluenceSignal(r4h,r1h,pair,c4,c1,ms4h,ms1h));
  }else if(r4h){
    const cv=computeConviction(r4h,m4h,ms4h,"H4",false);
    await tgSend(formatSingleSignal(r4h,pair,cv,ms4h,""));
  }else if(r1h){
    const cv=computeConviction(r1h,m1h,ms1h,"H1",false);
    await tgSend(formatSingleSignal(r1h,pair,cv,ms1h,"⚡ <b>SCALP</b> —"));
  }else{
    await tgSend(`⬜ <b>No GWP — ${pair.label}</b>\n4H VP: ${vp4h?vp4h.valBandBot.toFixed(pair.dec)+"–"+vp4h.valBandTop.toFixed(pair.dec):"fail"}\n${getForexSession()}\n\n<i>${V}</i>`);
  }
}

// ── COMMAND HANDLER ────────────────────────────────────────────────────────────
async function handleCommand(cmd){
  cmd=cmd.trim().toLowerCase().split(" ")[0];
  if(cmd==="/scan")      {await runBot();return;}
  if(cmd==="/daily")     {await sendDailySummary();return;}
  if(cmd==="/weekly")    {await sendWeeklySummary();return;}
  if(cmd==="/health")    {await sendHealth();return;}
  if(cmd==="/positions") {await sendPositions();return;}
  if(cmd==="/status")    {await sendStatus();return;}
  if(cmd==="/reset")     {await resetCooldowns();return;}
  if(cmd==="/help")      {await sendHelp();return;}
  const pairCmd=CONFIG.PAIRS.find(p=>cmd==="/"+p.symbol.toLowerCase());
  if(pairCmd){await scanSingle(pairCmd);return;}
  if(cmd==="/jpy")   {const p=CONFIG.PAIRS.find(x=>x.symbol==="USDJPY");if(p)await scanSingle(p);return;}
  if(cmd==="/gbpjpy"){const p=CONFIG.PAIRS.find(x=>x.symbol==="GBPJPY");if(p)await scanSingle(p);return;}
}

// ── MAIN RUNNER ────────────────────────────────────────────────────────────────
async function runBot(){
  console.log(`\n═══ GWP FOREX v7.0 ELITE MAX ═══ ${new Date().toISOString()}`);
  console.log(`  Running 24/7 — ${getForexSession()}`);
  if(!CONFIG.TWELVE_DATA_KEY)console.error("⚠️  TWELVE_DATA_KEY not set — forex pairs will fail.");

  await checkOpenPositions();
  let fired=0;

  for(const pair of CONFIG.PAIRS){
    try{
      console.log(`\n▶ ${pair.symbol} (${pair.crypto?"crypto":"forex"})`);
      if(isCircuitBroken(pair.symbol)){console.log("  ⛔ Circuit breaker");continue;}

      const c4h  = await fetchCandles(pair,"H4", TF_CONFIG.H4.vpLookback+20);
      const c1h  = await fetchCandles(pair,"H1", TF_CONFIG.H1.vpLookback+20);
      const c15m = await fetchCandles(pair,"M15",TF_CONFIG.M15.vpLookback+20);
      if(!c4h||c4h.length<30){console.log("  No 4H data");continue;}

      const vp4h=computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback);
      const vp1h=c1h&&c1h.length>=20?computeVolumeProfile(c1h,TF_CONFIG.H1.vpLookback):null;
      const vp15m=c15m&&c15m.length>=15?computeVolumeProfile(c15m,TF_CONFIG.M15.vpLookback):null;
      if(!vp4h){console.log("  4H VP failed");continue;}

      const av4h=computeAVWAP(c4h,TF_CONFIG.H4.avwapLookback);
      const av1h=c1h?computeAVWAP(c1h,TF_CONFIG.H1.avwapLookback):null;
      const av15m=c15m?computeAVWAP(c15m,TF_CONFIG.M15.avwapLookback):null;

      const m4h=runMathEngine(c4h),m1h=c1h?runMathEngine(c1h):null,m15m=c15m?runMathEngine(c15m):null;
      const isCrypto=pair.crypto||false;

      console.log(`  4H: ${vp4h.valBandBot.toFixed(pair.dec)}–${vp4h.valBandTop.toFixed(pair.dec)} | RSI:${m4h?m4h.rsi.toFixed(1):"?"} | Hurst:${m4h?m4h.hurst.toFixed(3):"?"}`);

      const r4h=detectGWP(c4h,vp4h,av4h,m4h,pair.dec,TF_CONFIG.H4,isCrypto);
      const r1h=vp1h?detectGWP(c1h,vp1h,av1h,m1h,pair.dec,TF_CONFIG.H1,isCrypto):null;
      const r15m=vp15m?detectGWP(c15m,vp15m,av15m,m15m,pair.dec,TF_CONFIG.M15,isCrypto):null;

      const ms4h=r4h?analyzeMarketStructure(c4h,r4h.direction,TF_CONFIG.H4):null;
      const ms1h=r1h?analyzeMarketStructure(c1h,r1h.direction,TF_CONFIG.H1):null;
      const ms15m=r15m?analyzeMarketStructure(c15m,r15m.direction,TF_CONFIG.M15):null;

      console.log(`  4H:${r4h?r4h.direction+" "+r4h.score:"—"}  1H:${r1h?r1h.direction+" "+r1h.score:"—"}  15M:${r15m?r15m.direction+" "+r15m.score:"—"}`);

      // ─ TRIPLE CONFLUENCE ──────────────────────────────────────────────────
      if(r4h&&r1h&&r15m&&r4h.direction===r1h.direction&&r1h.direction===r15m.direction){
        const dir=r4h.direction;
        if(!isDuplicate(pair.symbol,dir,"TRIPLE")){
          const conv4h=computeConviction(r4h,m4h,ms4h,"H4",false,true);
          const conv1h=computeConviction(r1h,m1h,ms1h,"H1",false,true);
          const conv15m=computeConviction(r15m,m15m,ms15m,"M15",false,true);
          const gate=TF_CONFIG.H4.minConviction-CONFIG.CONFLUENCE_GATE_REDUCTION;
          if(parseFloat(conv4h.score)>=gate){
            console.log(`  🔥🔥🔥 TRIPLE! ${dir} Conv4H=${conv4h.score}`);
            await tgSend(formatTripleSignal(r4h,r1h,r15m,pair,conv4h,conv1h,conv15m,ms4h,ms1h,ms15m));
            storePosition(pair,r4h,conv4h,"H4");storePosition(pair,r1h,conv1h,"H1");
            setCooldown(pair.symbol,dir,"H4");setCooldown(pair.symbol,dir,"H1");setCooldown(pair.symbol,dir,"M15");
            markFired(pair.symbol,dir,"TRIPLE");
            trackFired(pair,r4h,"TRIPLE");fired++;continue;
          }
        }
      }

      // ─ 4H + 1H CONFLUENCE ─────────────────────────────────────────────────
      if(r4h&&r1h&&r4h.direction===r1h.direction){
        const dir=r4h.direction;
        if(isOnCooldown(pair.symbol,dir,"H4")&&isOnCooldown(pair.symbol,dir,"H1")){console.log("  🔒 Both TF cooldowns");continue;}
        if(!isDuplicate(pair.symbol,dir,"CONF")){
          const conv4h=computeConviction(r4h,m4h,ms4h,"H4",true,false);
          const conv1h=computeConviction(r1h,m1h,ms1h,"H1",true,false);
          const gate=TF_CONFIG.H4.minConviction-CONFIG.CONFLUENCE_GATE_REDUCTION;
          console.log(`  🔥🔥 CONFLUENCE! ${dir} 4H Conv=${conv4h.score} gate=${gate}`);
          if(parseFloat(conv4h.score)>=gate){
            await tgSend(formatConfluenceSignal(r4h,r1h,pair,conv4h,conv1h,ms4h,ms1h));
            storePosition(pair,r4h,conv4h,"H4");storePosition(pair,r1h,conv1h,"H1");
            setCooldown(pair.symbol,dir,"H4");setCooldown(pair.symbol,dir,"H1");
            markFired(pair.symbol,dir,"CONF");
            trackFired(pair,r4h,"CONFLUENCE");fired++;continue;
          }
        }
      }

      // ─ 4H SOLO ────────────────────────────────────────────────────────────
      if(r4h){
        if(isOnCooldown(pair.symbol,r4h.direction,"H4")){console.log("  🔒 4H cooldown");}
        else{
          const conv=computeConviction(r4h,m4h,ms4h,"H4",false,false);
          console.log(`  4H conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H4.minConviction&&!isDuplicate(pair.symbol,r4h.direction,"H4")){
            await tgSend(formatSingleSignal(r4h,pair,conv,ms4h,""));
            storePosition(pair,r4h,conv,"H4");setCooldown(pair.symbol,r4h.direction,"H4");
            markFired(pair.symbol,r4h.direction,"H4");
            trackFired(pair,r4h,"H4");fired++;
          }else{console.log(`  ⚠️ 4H conv ${conv.score} below ${TF_CONFIG.H4.minConviction}`);}
        }
      }

      // ─ 1H SOLO ────────────────────────────────────────────────────────────
      if(r1h){
        if(isOnCooldown(pair.symbol,r1h.direction,"H1")){console.log("  🔒 1H cooldown");}
        else{
          const conv=computeConviction(r1h,m1h,ms1h,"H1",false,false);
          console.log(`  1H conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H1.minConviction&&!isDuplicate(pair.symbol,r1h.direction,"H1")){
            await tgSend(formatSingleSignal(r1h,pair,conv,ms1h,"⚡ <b>SCALP</b> —"));
            storePosition(pair,r1h,conv,"H1");setCooldown(pair.symbol,r1h.direction,"H1");
            markFired(pair.symbol,r1h.direction,"H1");
            trackFired(pair,r1h,"H1");fired++;
          }else{console.log(`  ⚠️ 1H conv ${conv.score} below ${TF_CONFIG.H1.minConviction}`);}
        }
      }

      // ─ 15M MICRO (only with higher TF present for context) ────────────────
      if(r15m&&(r4h||r1h)){
        const parentDir=(r4h||r1h).direction;
        if(r15m.direction===parentDir&&!isOnCooldown(pair.symbol,r15m.direction,"M15")){
          const conv=computeConviction(r15m,m15m,ms15m,"M15",true,false);
          console.log(`  15M conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.M15.minConviction&&!isDuplicate(pair.symbol,r15m.direction,"M15")){
            await tgSend(formatSingleSignal(r15m,pair,conv,ms15m,"🔬 <b>MICRO SNIPER</b> —"));
            storePosition(pair,r15m,conv,"M15");
            setCooldown(pair.symbol,r15m.direction,"M15");
            markFired(pair.symbol,r15m.direction,"M15");
            trackFired(pair,r15m,"M15");fired++;
          }
        }
      }

    }catch(e){console.error(`ERROR [${pair.symbol}]:`,e.message,e.stack);}
  }

  state.lastScanTime=new Date().toISOString();
  state.lastScanFired=fired;
  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);
}

// ── ENTRY POINT ────────────────────────────────────────────────────────────────
(async()=>{
  loadState();
  const mode=process.argv[2]||"scan";
  console.log(`GWP Forex v7.0 ELITE MAX | mode: ${mode} | ${new Date().toISOString()}`);
  console.log(`Running 24/7 — SL buffer fixed — Bear bias removed`);
  if(!CONFIG.TWELVE_DATA_KEY)console.error("⚠️  TWELVE_DATA_KEY not set — forex pairs will fail.");

  const updates=await pollTelegram();
  if(updates&&updates.length){for(const u of updates){if(u.message&&u.message.text){console.log(`Command: ${u.message.text}`);await handleCommand(u.message.text);}}}

  if(mode==="scan")   await runBot();
  if(mode==="daily")  await sendDailySummary();
  if(mode==="weekly") await sendWeeklySummary();
  if(mode==="health") await sendHealth();

  saveState();
  console.log("State saved → forex_state.json");
})();

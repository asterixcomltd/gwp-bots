"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — FOREX EDITION  v3.1  MONEY PRINTING MACHINE ELITE MAX™
// Strategy : Ghost Wick Protocol™ (GWP) — 4H + 1H + 15M Triple Timeframe Engine
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Assets   : XAUUSD · EURUSD · GBPUSD · USDJPY · GBPJPY (Twelve Data)
// Platform : GitHub Actions (Node.js 22+) · forex_state.json persistence
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// v3.1 CHANGES (on top of v3.0):
//   ✅ FIX: D1 AVWAP lookback 20 candles → 3 candles (eliminates 10+ day lag)
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
// v3.0 CHANGES (on top of v8.0):
//   ✅ FIX 1: D1 bias BACKWARDS — counter-trend was getting +6. Fix: aligned=+6, counter=−4
//   ✅ FIX 2: LIQ SWEEP shown twice (ms.label + msLine) — removed ms.label from single format
//   ✅ FIX 3: D1 bias note showed bare "D1: BEAR" — now shows ✅ or ⚠️ CT context
//   ✅ FIX 4: Opposite-direction signals could fire same scan — added firedDir lock
//   ✅ SPEED: httpGet had NO TIMEOUT — added 15s req.destroy() timeout
//
// v8.0 CHANGES (on top of v7.0):
//   ✅ FIX: BTC REMOVED from forex bot — BTC belongs in altcoin bot only
//   ✅ FIX: CRYPTO_MIN_SL_PCT 0.35 → 1.2 (crypto SL too tight, critical fix)
//   ✅ FIX: ATR floor on SL — SL always ≥ 1.5× ATR from entry (prevents hairline SL)
//   ✅ FIX: Vol+AVWAP gate — at least ONE of (volumeSpike OR avwapTrap) must pass
//   ✅ FIX: Age penalty multiplier adjusted: 0.5 → 0.75 (older signals penalised more)
//   ✅ FIX: D1 context filter — D1 close vs AVWAP sets directional bias gate
//   ✅ FIX: Symmetric counter-trend bonus — BULL/BEAR treated equally in conviction
//   ✅ FIX: TP3_MULT: 2.2 → 3.0 (wider runner target for big moves)
//   ✅ FIX: minRR H4: 1.8 → 2.0 (higher quality H4 setups only)
//   ✅ REMOVED: EMA-50 trend bias — lagging indicator, not institutional
//   ✅ REMOVED: RSI bonus/penalty — lagging indicator, replaced by pure price action
//   ✅ VERSION: All display strings updated to v8.0
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── TF CONFIGS ────────────────────────────────────────────────────────────────
const TF_CONFIG = {
  H4: {
    tf:"H4", label:"4H",
    vpLookback:100, avwapLookback:30,
    minRR:2.0,          // v8.0: raised 1.8 → 2.0
    minConviction:52, cooldownHrs:4,
    atrBufMult:0.55, maxAge:2, avwapProx:0.003,
    msLookback:80, swingStrength:3, volSpikeMult:1.2,
    minSlPct:0.10,
  },
  H1: {
    tf:"H1", label:"1H",
    vpLookback:60, avwapLookback:20,
    minRR:1.6, minConviction:52, cooldownHrs:2,
    atrBufMult:0.65, maxAge:1, avwapProx:0.004,
    msLookback:60, swingStrength:3, volSpikeMult:1.3,
    minSlPct:0.15,
  },
  M15: {
    tf:"M15", label:"15M",
    vpLookback:40, avwapLookback:12,
    minRR:1.5, minConviction:54, cooldownHrs:1,
    atrBufMult:0.60, maxAge:1, avwapProx:0.005,
    msLookback:40, swingStrength:2, volSpikeMult:1.5,
    minSlPct:0.10,
  },
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN  : process.env.FOREX_TG_TOKEN   || "",
  CHAT_ID         : process.env.FOREX_CHAT_ID    || "",
  TWELVE_DATA_KEY : process.env.TWELVE_DATA_KEY  || "",

  // v8.0: BTC REMOVED — forex bot is pure forex/gold only
  PAIRS: [
    { symbol:"XAUUSD", label:"XAU/USD 🥇", source:"twelve", twelveSymbol:"XAU/USD",  dec:2, crypto:false },
    { symbol:"EURUSD", label:"EUR/USD 💶", source:"twelve", twelveSymbol:"EUR/USD",  dec:5, crypto:false },
    { symbol:"GBPUSD", label:"GBP/USD 💷", source:"twelve", twelveSymbol:"GBP/USD",  dec:5, crypto:false },
    { symbol:"USDJPY", label:"USD/JPY 🇯🇵", source:"twelve", twelveSymbol:"USD/JPY", dec:3, crypto:false },
    { symbol:"GBPJPY", label:"GBP/JPY 🇯🇵", source:"twelve", twelveSymbol:"GBP/JPY", dec:3, crypto:false },
  ],

  CAPITAL:100, RISK_PCT:1.5, LEVERAGE:30,
  VP_ROWS:24, MIN_WICK_DEPTH_PCT:0.12, MIN_BODY_GAP_PCT:0.08,

  SESSION_FILTER: false,  // 24/7 — NO DEAD PERIODS

  CIRCUIT_BREAKER:true, CIRCUIT_BREAKER_LOSSES:3, CIRCUIT_BREAKER_HRS:24,
  TD_SLEEP_MS:1500,
  CONFLUENCE_CONVICTION_BOOST:18,
  TRIPLE_TF_BOOST:25,
  CONFLUENCE_GATE_REDUCTION:6,

  // v8.0: TP3 raised 2.2 → 3.0 for bigger runner targets
  TP3_MULT:3.0,

  MAX_RETRIES:2, RETRY_DELAY_MS:3000,
  DEDUP_WINDOW_MS:3600000,

  // v8.0: CRYPTO_MIN_SL_PCT raised 0.35 → 1.2 (critical fix — hairline SL)
  CRYPTO_MIN_SL_PCT: 1.2,
  FOREX_MIN_SL_PCT:  0.10,

  // v8.0: ATR floor multiplier — SL must be ≥ this multiple of ATR from entry
  ATR_SL_FLOOR_MULT: 1.5,
};

const V = "GWP Forex v3.0 | Elite Max™ | 24/7 | Asterix.COM | Abdin";

// ── STATE ─────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "forex_state.json");
let state = {};
function loadState()  { try { state = JSON.parse(fs.readFileSync(STATE_FILE,"utf8")); } catch(e) { state = {}; } }
function saveState()  { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function getProp(k)   { return state[k] || null; }
function setProp(k,v) { state[k] = v; }
function delProp(k)   { delete state[k]; }

// ── SIGNAL FILE WRITER ────────────────────────────────────────────────────────
function appendSignalToFile(pair, r, conv, tfKey) {
  try {
    const rawLabel = (pair.label || pair.symbol || 'UNKNOWN');
    const displayPair = rawLabel.replace(/[^\x20-\x7E]/g, '').trim();
    const ts   = Date.now();
    const d    = new Date(ts);
    const time = d.getUTCHours().toString().padStart(2,'0') + ':' + d.getUTCMinutes().toString().padStart(2,'0');
    const conviction = parseFloat(conv && conv.score) || 50;
    const score = Math.min(Math.round(55 + (conviction - 50) / 73 * 45), 100);
    const sig = {
      pair: displayPair, bot: 'forex',
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
    const sigFile = path.join(__dirname, 'forex_signals.json');
    let sigs = [];
    try { sigs = JSON.parse(fs.readFileSync(sigFile, 'utf8')); } catch(e) {}
    if (!Array.isArray(sigs)) sigs = [];
    sigs.unshift(sig);
    if (sigs.length > 25) sigs = sigs.slice(0, 25);
    fs.writeFileSync(sigFile, JSON.stringify(sigs, null, 2));
    console.log(`  📝 Signal written to forex_signals.json → ${displayPair} ${sig.dir} [${tfKey}]`);
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
const TD_TF = { H4:"4h", H1:"1h", M15:"15min", D1:"1day" };

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
  if(pair.source==="twelve")return fetchTwelveData(pair.twelveSymbol,tf,limit);
  return null;
}

// ── MATH ENGINE ───────────────────────────────────────────────────────────────
// v8.0: RSI REMOVED — lagging indicator. EMA REMOVED — lagging indicator.
// Kept: ATR, Hurst, Z-Score, Kalman, ATR%, Volume ratio (all non-lagging or structural)
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
  return avgRange>0&&(candles[sigIdx].high-candles[sigIdx].low)>=avgRange*1.5;
}
function calcZoneRevisit(candles,bBot,bTop){
  return candles.slice(-12,-1).filter(c=>c.low<=bTop*1.005&&c.high>=bBot*0.995).length>=2;
}
function runMathEngine(candles){
  if(!candles||candles.length<30)return null;
  const closes=candles.map(c=>c.close);
  // v8.0: RSI and EMA removed — pure non-lagging engine
  const atr=calcATR(candles,14),hurst=calcHurst(closes);
  const zScore=calcZScore(closes,20),kalman=kalmanFilter(closes);
  const atrPct=calcATRPercentile(candles,14),volRatio=calcVolumeRatio(candles,20);
  return{atr,hurst,zScore,kalman,atrPct,volRatio,cur:closes[closes.length-1],cycle:calcSineOscillator(closes),candleCount:closes.length};
}

// ── D1 CONTEXT FILTER ─────────────────────────────────────────────────────────
// v3.1: 3-candle micro-AVWAP — responds within 1 session of structural flip.
// Returns: 'BULL' | 'BEAR' | 'NEUTRAL'
// 20-candle (20-day) was lagging so badly it fired NEUTRAL/wrong bias while
// 4H+1H already printed 3 valid entries. D1 is now a soft whisper, not a gate.
function getD1Bias(d1Candles) {
  if(!d1Candles||d1Candles.length<3) return 'NEUTRAL';
  // v3.1: 3-candle micro-AVWAP (was 20 — eliminates 10+ day lag)
  const lookback = d1Candles.slice(-3);
  let tv=0,v=0;
  lookback.forEach(c=>{const tp=(c.high+c.low+c.close)/3;tv+=tp*c.vol;v+=c.vol;});
  const avwap = v>0?tv/v:null;
  if(!avwap) return 'NEUTRAL';
  const lastClose = d1Candles[d1Candles.length-1].close;
  // Also check last 3 days trend via swing structure
  const last3 = d1Candles.slice(-4);
  const recentTrendUp = last3[last3.length-1].close > last3[0].close;
  if(lastClose > avwap*1.002 && recentTrendUp)  return 'BULL';
  if(lastClose < avwap*0.998 && !recentTrendUp) return 'BEAR';
  return 'NEUTRAL';
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
    label:`📐 EW: 78.6%=${level786.toFixed(4)} · 61.8%=${level618.toFixed(4)}`};
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
function hasVolumeSpike(sigCandle, allCandles, sigIdx, lookback, mult) {
  const start=Math.max(0,sigIdx-lookback),vols=allCandles.slice(start,sigIdx).map(c=>c.vol||0);
  if(!vols.length) return true;
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
    if(choch.detected&&choch.toBull) {confirmed=true;label="🔄 CHoCH→BULL";strength=3;}
    else if(bos.bullBOS)              {confirmed=true;label="⬆️ BOS BULL";  strength=2;}
    else if(liqSweep.lowSweep)        {confirmed=true;label="💧 LIQ SWEEP↓";strength=2;}
    else if(fvg.present)               {confirmed=true;label="🟦 FVG BULL";  strength=1;}
  }
  if(direction==="BEAR"){
    if(choch.detected&&choch.toBear) {confirmed=true;label="🔄 CHoCH→BEAR";strength=3;}
    else if(bos.bearBOS)              {confirmed=true;label="⬇️ BOS BEAR";  strength=2;}
    else if(liqSweep.highSweep)       {confirmed=true;label="💧 LIQ SWEEP↑";strength=2;}
    else if(fvg.present)               {confirmed=true;label="🟥 FVG BEAR";  strength=1;}
  }
  const prevStr=choch.prevTrend?`Prev:${choch.prevTrend}`:"Trend:unclear";
  return{confirmed,label,strength,bos,choch,liqSweep,fvg,swings,prevStr};
}

// ── CONVICTION ENGINE ─────────────────────────────────────────────────────────
// v8.0: RSI removed. EMA trend bias removed. Symmetric BULL/BEAR scoring.
// v8.0: D1 bias bonus added. Counter-trend = symmetric scoring for both directions.
function computeConviction(gwp,math,ms,tfKey,isConfluence=false,isTriple=false,d1Bias='NEUTRAL'){
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

  // MATH ENGINE — v8.0: no RSI, no EMA. Pure Hurst+ZScore+Kalman+ATR%+Vol
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

    // Z-Score — SYMMETRIC: both BULL and BEAR get same bonus logic
    const z=math.zScore;
    if(gwp.direction==="BULL"&&z.extremeLow)  score+=7;  // v8.0: raised 6→7
    if(gwp.direction==="BEAR"&&z.extremeHigh) score+=7;  // symmetric
    if(gwp.direction==="BULL"&&z.mildLow)     score+=3;
    if(gwp.direction==="BEAR"&&z.mildHigh)    score+=3;

    // Kalman velocity reversal (price action momentum flip)
    if(math.kalman){
      const rev=(gwp.direction==="BULL"&&!math.kalman.bullish)||(gwp.direction==="BEAR"&&math.kalman.bullish);
      if(rev)score+=6;
    }

    // ATR percentile sweet zone (not too quiet, not too volatile)
    if(math.atrPct>=25&&math.atrPct<=75)     score+=4;
    else if(math.atrPct>=15&&math.atrPct<=85)score+=2;

    // Volume ratio
    if(math.volRatio>=2.0)      score+=4;
    else if(math.volRatio>=1.5) score+=3;
    else if(math.volRatio>=1.2) score+=1;
  }

  // WYCKOFF STRUCTURAL CONFIRMATION (0–10) — Institutional cycle analysis
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

  // v3.1: D1 BIAS — soft whisper (+2 aligned / −1 counter).
  // D1 is now context-only. 4H+1H+15M is the primary signal engine.
  // 20-day AVWAP lag = up to 10-point penalty on live valid setups. Now fixed.
  if(d1Bias==='BULL'&&gwp.direction==='BULL') score+=2;
  if(d1Bias==='BEAR'&&gwp.direction==='BEAR') score+=2;
  if(d1Bias==='BULL'&&gwp.direction==='BEAR') score-=1;
  if(d1Bias==='BEAR'&&gwp.direction==='BULL') score-=1;

  // CONFLUENCE BOOSTS
  if(isTriple)  score+=CONFIG.TRIPLE_TF_BOOST;
  else if(isConfluence)score+=CONFIG.CONFLUENCE_CONVICTION_BOOST;

  score=Math.max(0,Math.min(score,123));
  const grade=score>=108?"🏆 SUPREME★★★★":score>=96?"🏆 SUPREME★★★":score>=84?"⚡ SUPREME★★":score>=72?"🔥 SUPREME★":score>=58?"🔥 ELITE":score>=50?"✅ SOLID":"⚠️ MARGINAL";
  return{score:score.toFixed(1),grade};
}

// ── DEDUP ─────────────────────────────────────────────────────────────────────
function isDuplicate(symbol,direction,tag){
  const key=`FDUP8_${tag}_${symbol}_${direction}`;const last=getProp(key);
  return last&&(Date.now()-parseInt(last))<CONFIG.DEDUP_WINDOW_MS;
}
function markFired(symbol,direction,tag){setProp(`FDUP8_${tag}_${symbol}_${direction}`,Date.now().toString());}

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
// v8.0: ATR floor on SL, Vol+AVWAP gate, age penalty 0.5→0.75, TP3_MULT 3.0
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
    // v3.1 Fix #9: Session-adjusted vol multiplier
    const sessionVolMult = getSessionVolMult(tfCfg.volSpikeMult);
    const volumeSpike = hasVolumeSpike(sig, candles, sigIdx, 20, sessionVolMult);
    const momentumBurst=calcMomentumBurst(candles,sigIdx);
    const zoneRevisit=calcZoneRevisit(candles,bBot,bTop);
    const wyckoff=detectWyckoff(candles,direction);
    const fib=calcFib786(candles,direction);
    const cycle=math?math.cycle:null;

    const bodyGapPct=(bodyGap/bH)*100,isPathB=bodyGapPct<35;

    // v8.0: Vol+AVWAP institutional gate — at least ONE must pass
    // Raw GWP (wick+body) with ZERO vol or AVWAP = too weak for institutional precision
    if(!volumeSpike&&!avwapTrap){
      console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: REJECTED — no vol spike AND no AVWAP trap (institutional gate)`);
      continue;
    }

    // ── v8.0 SL: Multi-layer + ATR floor ─────────────────────────────────────
    const sigCandleRange=sig.high-sig.low;
    const rangeBuffer=sigCandleRange*0.15;

    let sl;
    if(direction==="BEAR"){
      const slBase=Math.max(sig.high+atrBuf, sig.high+rangeBuffer);
      sl=isPathB?slBase+(slBase-cur.close)*0.30:slBase;
    }else{
      const slBase=Math.min(sig.low-atrBuf, sig.low-rangeBuffer);
      sl=isPathB?slBase-(cur.close-slBase)*0.30:slBase;
    }

    // Layer 3: enforce minimum SL % by asset class
    const entry=cur.close;
    const minSlPct = isCrypto ? CONFIG.CRYPTO_MIN_SL_PCT : (tfCfg.minSlPct||CONFIG.FOREX_MIN_SL_PCT);
    const minSlDist = entry * minSlPct / 100;
    if(direction==="BEAR"&&(sl-entry)<minSlDist) sl=entry+minSlDist;
    if(direction==="BULL"&&(entry-sl)<minSlDist) sl=entry-minSlDist;

    // v8.0: ATR floor — SL must be ≥ ATR_SL_FLOOR_MULT × ATR from entry
    const atrFloor = atr * CONFIG.ATR_SL_FLOOR_MULT;
    if(direction==="BEAR"&&(sl-entry)<atrFloor) sl=entry+atrFloor;
    if(direction==="BULL"&&(entry-sl)<atrFloor) sl=entry-atrFloor;
    // ─────────────────────────────────────────────────────────────────────────

    const tp2=bMid;
    // v3.1 Fix #6: Structural TP1 — use nearest swing level between entry and TP2
    // Falls back to VP band edge if no swing exists in range
    const msSlice = candles.slice(-Math.min(tfCfg.msLookback, candles.length));
    const msSwings = detectSwings(msSlice, tfCfg.swingStrength);
    let tp1;
    if (direction === "BEAR") {
      // Find nearest swing low between entry (exclusive) and tp2 (inclusive)
      const candidateLows = msSwings.lows
        .map(s => s.price)
        .filter(p => p < entry && p > tp2)
        .sort((a, b) => b - a); // descending — nearest to entry first
      tp1 = candidateLows.length > 0 ? candidateLows[0] : bBot; // fallback to VAL band edge
    } else {
      // Find nearest swing high between entry and tp2
      const candidateHighs = msSwings.highs
        .map(s => s.price)
        .filter(p => p > entry && p < tp2)
        .sort((a, b) => a - b); // ascending — nearest to entry first
      tp1 = candidateHighs.length > 0 ? candidateHighs[0] : bTop;
    }
    // Safety: if structural TP1 is too close (< 0.3% from entry), fallback to 35% of TP2 distance
    if (Math.abs(entry - tp1) / entry < 0.003) {
      tp1 = direction === "BEAR" ? entry - Math.abs(entry - tp2) * 0.35 : entry + Math.abs(tp2 - entry) * 0.35;
    }
    const risk=Math.abs(entry-sl);if(risk<=0)continue;
    let rr=Math.abs(entry-tp2)/risk;
    if(rr<tfCfg.minRR){tp1=direction==="BEAR"?bBot:bTop;rr=Math.abs(entry-tp2)/risk;}
    if(rr<tfCfg.minRR){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: R:R=${rr.toFixed(2)} below gate ${tfCfg.minRR}`);continue;}

    // v8.0: TP3_MULT = 3.0 (wider runner)
    const tp3=direction==="BEAR"?entry-Math.abs(entry-tp2)*CONFIG.TP3_MULT:entry+Math.abs(tp2-entry)*CONFIG.TP3_MULT;

    // v8.0: age penalty raised 0.5 → 0.75 (older signals penalised harder)
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

    const fmt=v=>Number(v).toFixed(dec);
    const tp4=fib.level786?fmt(fib.level786):null;
    const reEntry=isPathB?fmt(direction==="BEAR"?entry+Math.abs(entry-sl)*0.8:entry-Math.abs(entry-sl)*0.8):null;
    console.log(`  ✅ GWP [${tfCfg.label}]: ${direction} age=${age} ${grade} score=${adjustedScore.toFixed(1)} R:R=${rr.toFixed(2)} SL=${fmt(sl)} (${(Math.abs(entry-sl)/entry*100).toFixed(3)}%) | VolSpike=${volumeSpike} AvwapTrap=${avwapTrap}`);

    return{
      direction,grade,score:adjustedScore.toFixed(1),rawScore,age,tf:tfCfg.tf,tfLabel:tfCfg.label,
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
      zoneFreshness, zoneTouches,
    };
  }
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

// ── SESSION LABEL ────────────────────────────────────────────────────────────
function getForexSession(){
  const h=new Date().getUTCHours();
  // Check for upcoming macro event
  const macro = isNearMacroEvent();
  if (macro.blocked) return `⛔ MACRO EVENT: ${macro.event} — CAUTION`;
  if(h>=7&&h<12)  return "🇬🇧 London (24/7 ✅)";
  if(h>=12&&h<17) return "🌍 London/NY (24/7 ✅)";
  if(h>=17&&h<21) return "🇺🇸 New York (24/7 ✅)";
  if(h>=0&&h<6)   return "🌏 Asia (24/7 ✅)";
  return "🌙 Off-hours (24/7 ✅)";
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
function isOnCooldown(symbol,direction,tfKey){
  const last=getProp(`fcd8_${tfKey}_${symbol}_${direction}`);
  return last&&(Date.now()-parseInt(last))/3600000<TF_CONFIG[tfKey].cooldownHrs;
}
function setCooldown(symbol,direction,tfKey){setProp(`fcd8_${tfKey}_${symbol}_${direction}`,Date.now().toString());}

// ── CIRCUIT BREAKER ────────────────────────────────────────────────────────────
function isCircuitBroken(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return false;
  const raw=getProp("FCB8_"+symbol);if(!raw)return false;
  try{const cb=JSON.parse(raw);if(Date.now()-cb.ts<CONFIG.CIRCUIT_BREAKER_HRS*3600000)return true;delProp("FCB8_"+symbol);}catch(e){}
  return false;
}
async function recordLoss(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return;
  const key="FCBL8_"+symbol,n=parseInt(getProp(key)||"0")+1;setProp(key,n.toString());
  if(n>=CONFIG.CIRCUIT_BREAKER_LOSSES){setProp("FCB8_"+symbol,JSON.stringify({ts:Date.now(),losses:n}));delProp(key);await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol}</b>\n${n} losses. Paused ${CONFIG.CIRCUIT_BREAKER_HRS}h.\n\n<i>${V}</i>`);}
}
function recordWin(symbol){if(CONFIG.CIRCUIT_BREAKER)delProp("FCBL8_"+symbol);}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(pair,r,conv,tfKey){
  setProp("FPOS8_"+pair.symbol+"_"+r.direction+"_"+tfKey,JSON.stringify({
    symbol:pair.symbol,label:pair.label,source:pair.source,
    twelveSymbol:pair.twelveSymbol||null,
    dec:pair.dec,direction:r.direction,entry:parseFloat(r.entry),sl:parseFloat(r.sl),
    tp1:parseFloat(r.tp1),tp2:parseFloat(r.tp2),tp3:parseFloat(r.tp3),
    rr:r.rr,grade:r.grade,tf:tfKey,conviction:conv?conv.score:"?",
    isPathB:r.isPathB,reEntry:r.reEntry,state:"OPEN",tp1hit:false,tp2hit:false,ts:Date.now(),
  }));
  appendSignalToFile(pair, r, conv, tfKey);
}
async function checkOpenPositions(){
  const posKeys=Object.keys(state).filter(k=>k.startsWith("FPOS8_"));
  for(const key of posKeys){
    let p;try{p=JSON.parse(getProp(key));}catch(e){continue;}
    if(!p||p.state!=="OPEN")continue;
    let candles=null;
    candles=await fetchTwelveData(p.twelveSymbol,"M15",10);
    if(!candles||!candles.length)continue;
    const price=candles[candles.length-1].close,isL=p.direction==="BULL";
    const pnl=((isL?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(3);
    const f=n=>Number(n).toFixed(p.dec);let msg=null;
    if(!p.tp1hit&&(isL?price>=p.tp1:price<=p.tp1)){p.tp1hit=true;msg=`🎯 <b>GWP TP1 HIT — ${p.label} [${p.tf}]</b>\n40% exit. Move SL to BE.\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;}
    if(!p.tp2hit&&(isL?price>=p.tp2:price<=p.tp2)){p.tp2hit=true;msg=`🏆 <b>GWP TP2 HIT — ${p.label} [${p.tf}]</b> 🔥\nHold 20% for TP3: <code>${f(p.tp3)}</code>\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;}
    if(p.tp2hit&&(isL?price>=p.tp3:price<=p.tp3)){msg=`🏅 <b>GWP TP3 HIT! — ${p.label} [${p.tf}]</b> 💎\nFull exit. P&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,true,null);}
    if(isL?price<=p.sl:price>=p.sl){const pbN=p.isPathB?`\n⚡ Path B re-entry: <code>${p.reEntry||"zone"}</code>`:"";msg=`❌ <b>GWP SL HIT — ${p.label} [${p.tf}]</b>\n${p.direction} ${f(p.entry)} → SL ${f(p.sl)}\nP&L: <b>${pnl}%</b>${pbN}\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,false,null);}
    if(msg){await tgSend(msg);if(p.state==="CLOSED")delProp(key);else setProp(key,JSON.stringify(p));}else{setProp(key,JSON.stringify(p));}
  }
}

// ── TRACKING ───────────────────────────────────────────────────────────────────
function getDateKey(){return new Date().toISOString().slice(0,10);}
function getWeekKey(){const now=new Date(),s=new Date(now.getFullYear(),0,1);return now.getFullYear()+"_W"+String(Math.ceil(((now-s)/86400000+s.getDay()+1)/7)).padStart(2,"0");}
function trackFired(pair,r,mode){
  const dk="F8_D_"+getDateKey();let d;try{d=JSON.parse(getProp(dk)||"[]");}catch(e){d=[];}
  d.push({sym:pair.symbol,dir:r.direction,grade:r.grade,tf:r.tf,mode,rr:r.rr,ts:Date.now()});setProp(dk,JSON.stringify(d));
  const wk="F8_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  w.signals=(w.signals||0)+1;if(mode==="TRIPLE")w.triple=(w.triple||0)+1;else if(mode==="CONFLUENCE")w.confluence=(w.confluence||0)+1;setProp(wk,JSON.stringify(w));
}
// v3.1 Fix #10: Enhanced performance tracker with conviction score + weekly report
async function trackClose(symbol, direction, pnlPct, isWin, convScore = null) {
  const wk = "F8_W_" + getWeekKey(); let w; try { w = JSON.parse(getProp(wk) || "{}"); } catch(e) { w = {}; }
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
  let w; try { w = JSON.parse(getProp("F8_W_" + getWeekKey()) || "{}"); } catch(e) { w = {}; }
  const closed = (w.wins || 0) + (w.losses || 0);
  const wr = closed > 0 ? ((w.wins || 0) / closed * 100).toFixed(1) + "%" : "—";
  const avgWinConv = w.winConvN  ? (w.winConvSum  / w.winConvN).toFixed(1)  : "—";
  const avgLossConv= w.lossConvN ? (w.lossConvSum / w.lossConvN).toFixed(1) : "—";
  let msg = `📊 <b>GWP FOREX — WEEKLY PERFORMANCE REPORT</b>\n`;
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
  if(!ms||!ms.confirmed)return"🟡 MS: UNCONFIRMED";
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
// Replaces verbose layout with a clean, scannable card.
// All core data preserved: direction, conviction, R:R, entry/SL/TPs, key tags, MS.
function formatSingleSignal(r,pair,conv,ms,_label,d1Bias='NEUTRAL',math=null){
  const isBull=r.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dir=isBull?"LONG ▲":"SHORT ▼";
  const tags=confBox(r);
  const tp4Note=r.tp4?`  ·  <b>TP4</b> <code>${r.tp4}</code>`:"";
  const pbNote=r.isPathB?`\n⚠️  <b>PATH B</b>  Re-enter: <code>${r.reEntry}</code>`:"";
  const _isAl=(d1Bias==='BULL'&&r.direction==='BULL')||(d1Bias==='BEAR'&&r.direction==='BEAR');
  const biasNote=d1Bias!=='NEUTRAL'?`  ·  D1: <b>${d1Bias}</b> ${_isAl?'✅':'⚠️ CT'}`:'' ;
  const ageNote=r.age>0?`  ·  <i>${r.age}b ago</i>`:"";
  // v3.1 Fix #12: Signal quality score
  const sq=computeSignalQuality(r,ms,math);
  const sqLine=`🏅  Quality: <b>${sq.pct}%</b> ${sq.grade} (${sq.passed}/${sq.total} criteria)\n`;
  return(
    `\n`+
    `🎯  <b>GWP · ${pair.label} · ${dir} [${r.tfLabel}]</b>\n`+
    `${dirEmoji}  <b>${conv.score}/105</b>  ·  ${conv.grade}  ·  R:R <b>${r.rr}:1</b>${ageNote}${biasNote}\n`+
    `─────────────────────────────\n`+
    `<b>ENTRY</b>  <code>${r.entry}</code>   <b>SL</b>  <code>${r.sl}</code>  (-${r.slPct}%)\n`+
    `<b>TP1</b>  <code>${r.tp1}</code>  ·  <b>TP2</b>  <code>${r.tp2}</code>  ·  <b>TP3</b>  <code>${r.tp3}</code>${tp4Note}\n`+
    `─────────────────────────────\n`+
    `📐  Size: <b>${getSizeMult(parseFloat(conv.score)).label}</b>\n`+
    sqLine+
    (tags?`🔑  ${tags}\n`:"")+
    `  ${msLine(ms,r.direction)||"🟡 MS: UNCONFIRMED"}\n`+
    `${pbNote}\n`+
    `⏰  ${new Date().toUTCString()}\n`+
    `<i>${V}</i>`
  );
}
function formatConfluenceSignal(r4h,r1h,pair,conv4h,conv1h,ms4h,ms1h,d1Bias){
  const isBull=r4h.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dirWord =isBull?"LONG  ▲":"SHORT  ▼";
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const conf=confBox(r4h)||confBox(r1h);
  const biasNote=d1Bias!=='NEUTRAL'?`  ·  📅 D1: <b>${d1Bias}</b>`:"";
  const pbNote=r4h.isPathB?`\n⚠️  <b>PATH B</b> — sweep zone · Re-enter: <code>${r4h.reEntry}</code>`:"";
  return(
    `\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `🔥🔥  <b>CONFLUENCE  ·  ${pair.label}</b>  🔥🔥\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `\n`+
    `${dirEmoji}  <b>${dirWord}</b>   🔥🔥 CONFLUENCE SWING   [4H+1H]\n`+
    `\n`+
    `⚡  Conviction 4H:  <b>${conv4h.score} / 105</b>   —   ${conv4h.grade}\n`+
    `⚡  Conviction 1H:  <b>${conv1h.score} / 105</b>\n`+
    `🕐  ${getForexSession()}${biasNote}\n`+
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
    `💼  Risk: $${riskUSD.toFixed(2)}   ·   Pos: $${posUSD.toFixed(0)}   (${CONFIG.LEVERAGE}×)\n`+
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
function formatTripleSignal(r4h,r1h,r15m,pair,c4h,c1h,c15m,ms4h,ms1h,ms15m,d1Bias){
  const isBull=r4h.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dirWord =isBull?"LONG  ▲":"SHORT  ▼";
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const conf=confBox(r4h)||confBox(r1h)||confBox(r15m);
  const biasNote=d1Bias!=='NEUTRAL'?`  ·  📅 D1: <b>${d1Bias}</b>`:"";
  return(
    `\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `🔥🔥🔥  <b>TRIPLE TF  ·  ${pair.label}</b>  🔥🔥🔥\n`+
    `<b>★★ INSTITUTIONAL PRIME — ELITE MAX™ v8.0 ★★</b>\n`+
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`+
    `\n`+
    `${dirEmoji}  <b>${dirWord}</b>   🔥🔥🔥 INSTITUTIONAL PRIME   [4H+1H+15M]\n`+
    `\n`+
    `⚡  Conviction 4H:   <b>${c4h.score} / 105</b>   —   ${c4h.grade}\n`+
    `⚡  Conviction 1H:   <b>${c1h.score} / 105</b>\n`+
    `⚡  Conviction 15M:  <b>${c15m.score} / 105</b>\n`+
    `🕐  ${getForexSession()}${biasNote}\n`+
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
    `💼  Risk: $${riskUSD.toFixed(2)}   ·   Pos: $${posUSD.toFixed(0)}   (${CONFIG.LEVERAGE}×)\n`+
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
  const today=getDateKey();let d;try{d=JSON.parse(getProp("F8_D_"+today)||"[]");}catch(e){d=[];}
  let msg=`📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if(!d.length)msg+=`📊 <b>Signals: 0</b>\nScanning 24/7. No setups triggered today.\n\n`;
  else{msg+=`📊 <b>Signals: ${d.length}</b>\n`;d.forEach(s=>{msg+=`  ${s.dir==="BULL"?"🟢":"🔴"} ${s.sym} [${s.tf}] ${s.mode||""} | ${s.grade} | R:R ${s.rr}\n`;});msg+="\n";}
  msg+=`⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendWeeklySummary(){
  let w;try{w=JSON.parse(getProp("F8_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const closed=(w.wins||0)+(w.losses||0),wr=closed>0?((w.wins||0)/closed*100).toFixed(0)+"%":"—";
  let msg=`📆 <b>WEEKLY SUMMARY — ${getWeekKey().replace("_"," ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg+=`📊 Signals: ${w.signals||0}  Confluences: ${w.confluence||0}  Triples: ${w.triple||0}\n`;
  if(closed>0)msg+=`✅ ${w.wins||0}W  ❌ ${w.losses||0}L  Win Rate: <b>${wr}</b>\n💰 P&L: <b>${(w.pnl||0)>=0?"+":""}${w.pnl||0}%</b>\n`;
  else msg+=`  No closed trades yet.\n`;
  msg+=`\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendHealth(){
  let msg=`💚 <b>GWP Forex v8.0 ELITE MAX — HEALTH</b>\n\n`;
  for(const pair of CONFIG.PAIRS){
    let price="?";
    try{const c=await fetchTwelveData(pair.twelveSymbol,"H1",10);if(c&&c.length)price=c[c.length-1].close.toFixed(pair.dec);}catch(e){}
    const cb=isCircuitBroken(pair.symbol)?" ⛔CB":"";
    msg+=`${price!=="?"?"✅":"❌"} ${pair.symbol}: ${price!=="?"?"$"+price:"NO DATA"}${cb}\n`;
  }
  msg+=`\n🕐 ${getForexSession()}\n`;
  msg+=`🔄 Scanning 24/7 — No dead periods\n`;
  msg+=`📊 Twelve Data key: ${CONFIG.TWELVE_DATA_KEY?"✅ SET":"❌ MISSING"}\n`;
  msg+=`📅 Last scan: ${state.lastScanTime||"never"}\n`;
  msg+=`🔥 Last fired: ${state.lastScanFired||0} signals\n`;
  msg+=`⚙️ v8.0: No lagging indicators | ATR SL floor | Vol+AVWAP gate\n\n<i>${V}</i>`;await tgSend(msg);
}
async function sendStatus(){
  let w;try{w=JSON.parse(getProp("F8_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const openCount=Object.keys(state).filter(k=>k.startsWith("FPOS8_")).length;
  await tgSend(
    `📡 <b>GWP Forex v8.0 ELITE MAX — ONLINE</b> ✅\n\n`+
    `Pairs: ${CONFIG.PAIRS.map(p=>p.symbol).join(", ")}\n`+
    `TFs: 4H + 1H + 15M (Triple Engine)\n`+
    `Gates: 4H≥${TF_CONFIG.H4.minConviction} | 1H≥${TF_CONFIG.H1.minConviction} | 15M≥${TF_CONFIG.M15.minConviction}\n`+
    `Session: 24/7 — ALWAYS ON\n`+
    `Confluence: +${CONFIG.CONFLUENCE_CONVICTION_BOOST} | Triple: +${CONFIG.TRIPLE_TF_BOOST}\n`+
    `SL: forex min ${CONFIG.FOREX_MIN_SL_PCT}% | ATR floor ${CONFIG.ATR_SL_FLOOR_MULT}×ATR\n`+
    `TP3 mult: ${CONFIG.TP3_MULT}× | minRR 4H: ${TF_CONFIG.H4.minRR}\n`+
    `Open positions: ${openCount}\n`+
    `This week: ${w.signals||0} signals | ${w.wins||0}W ${w.losses||0}L\n\n`+
    `<i>${V}</i>`
  );
}
async function sendPositions(){
  const keys=Object.keys(state).filter(k=>k.startsWith("FPOS8_"));
  if(!keys.length){await tgSend(`📭 No open positions.\n\n<i>${V}</i>`);return;}
  let msg=`📊 <b>Open GWP Positions</b>\n\n`;
  for(const k of keys){try{const p=JSON.parse(getProp(k));msg+=`${p.direction==="BULL"?"🟢":"🔴"} <b>${p.label}</b> ${p.direction} [${p.tf}]\n  Entry: ${p.entry}  SL: ${p.sl}  TP2: ${p.tp2}  TP3: ${p.tp3}  Conv: ${p.conviction}/105\n\n`;}catch(e){}}
  await tgSend(msg+`<i>${V}</i>`);
}
async function sendHelp(){
  await tgSend(
    `👻 <b>GWP FOREX v8.0 ELITE MAX™</b>\n`+
    `<b>Money Printing Machine — 24/7 Always On</b>\n\n`+
    `<b>Commands:</b>\n`+
    `/scan — full scan (4H+1H+15M)\n`+
    `/xauusd · /eurusd · /gbpusd · /usdjpy · /gbpjpy\n`+
    `/daily · /weekly · /health · /positions · /status · /reset · /help\n\n`+
    `<b>v8.0 Engine:</b>\n`+
    `▸ 👻 GWP — VAL band wick (king)\n`+
    `▸ 📐 Math — Hurst · Z · Kalman · ATR% · Volume (NO lagging)\n`+
    `▸ 🏛 MS — CHoCH · BOS · LiqSweep · FVG (additive)\n`+
    `▸ 📅 D1 Bias — daily AVWAP context filter\n`+
    `▸ 🔥 Triple TF: 4H+1H+15M alignment = MAX conviction\n`+
    `▸ 💎 TP3 = 3.0× VAL band (wider runner)\n`+
    `▸ 🛑 ATR floor: SL always ≥ 1.5× ATR\n`+
    `▸ 🚪 Vol+AVWAP gate: at least 1 must pass\n`+
    `▸ ✂️ BTC removed — altcoin bot handles crypto\n\n`+
    `<i>Every candle. Every session. Zero downtime.</i>\n\n`+
    `<i>${V}</i>`
  );
}
async function resetCooldowns(){
  let n=0;for(const k of Object.keys(state)){if(k.startsWith("fcd8_")||k.startsWith("FPOS8_")||k.startsWith("FCB8_")||k.startsWith("FCBL8_")||k.startsWith("FDUP8_")){delProp(k);n++;}}
  await tgSend(`✅ Cleared ${n} cooldowns/positions/dedups/circuit-breakers.\n\n<i>${V}</i>`);
}

// ── SINGLE PAIR SCAN ──────────────────────────────────────────────────────────
async function scanSingle(pair){
  const c4h=await fetchCandles(pair,"H4",TF_CONFIG.H4.vpLookback+20);
  const c1h=await fetchCandles(pair,"H1",TF_CONFIG.H1.vpLookback+20);
  const c15m=await fetchCandles(pair,"M15",TF_CONFIG.M15.vpLookback+20);
  const cd1=await fetchCandles(pair,"D1",30);
  const d1Bias=getD1Bias(cd1);
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
    const c4=computeConviction(r4h,m4h,ms4h,"H4",false,true,d1Bias),c1=computeConviction(r1h,m1h,ms1h,"H1",false,true,d1Bias),c15=computeConviction(r15m,m15m,ms15m,"M15",false,true,d1Bias);
    await tgSend(formatTripleSignal(r4h,r1h,r15m,pair,c4,c1,c15,ms4h,ms1h,ms15m,d1Bias));
  }else if(r4h&&r1h&&r4h.direction===r1h.direction){
    const c4=computeConviction(r4h,m4h,ms4h,"H4",true,false,d1Bias),c1=computeConviction(r1h,m1h,ms1h,"H1",true,false,d1Bias);
    await tgSend(formatConfluenceSignal(r4h,r1h,pair,c4,c1,ms4h,ms1h,d1Bias));
  }else if(r4h){
    const cv=computeConviction(r4h,m4h,ms4h,"H4",false,false,d1Bias);
    await tgSend(formatSingleSignal(r4h,pair,cv,ms4h,"",d1Bias,m4h));
  }else if(r1h){
    const cv=computeConviction(r1h,m1h,ms1h,"H1",false,false,d1Bias);
    await tgSend(formatSingleSignal(r1h,pair,cv,ms1h,"⚡ <b>SCALP</b> —",d1Bias,m1h));
  }else{
    await tgSend(`⬜ <b>No GWP — ${pair.label}</b>\n4H VP: ${vp4h?vp4h.valBandBot.toFixed(pair.dec)+"–"+vp4h.valBandTop.toFixed(pair.dec):"fail"}\n📅 D1 Bias: ${d1Bias}\n${getForexSession()}\n\n<i>${V}</i>`);
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
  console.log(`\n═══ GWP FOREX v8.0 ELITE MAX ═══ ${new Date().toISOString()}`);
  console.log(`  Running 24/7 — ${getForexSession()}`);
  if(!CONFIG.TWELVE_DATA_KEY)console.error("⚠️  TWELVE_DATA_KEY not set — forex pairs will fail.");

  await checkOpenPositions();
  let fired=0;

  // v3.1 Fix #5: Macro event blackout check (once before pair loop)
  const macroCheck = isNearMacroEvent();
  if (macroCheck.blocked) {
    console.log(`  ⛔ MACRO BLACKOUT — ${macroCheck.event} (${macroCheck.date}) — skipping all signals`);
    await tgSend(`⛔ <b>MACRO BLACKOUT</b> — ${macroCheck.event} event detected.\nAll signals paused ±1h for safety.\n\n<i>${V}</i>`);
    return; // Skip this entire scan
  }

  for(const pair of CONFIG.PAIRS){
    try{
      console.log(`\n▶ ${pair.symbol} (forex)`);
      if(isCircuitBroken(pair.symbol)){console.log("  ⛔ Circuit breaker");continue;}

      const c4h  = await fetchCandles(pair,"H4", TF_CONFIG.H4.vpLookback+20);
      const c1h  = await fetchCandles(pair,"H1", TF_CONFIG.H1.vpLookback+20);
      const c15m = await fetchCandles(pair,"M15",TF_CONFIG.M15.vpLookback+20);
      const cd1  = await fetchCandles(pair,"D1", 30);  // v8.0: D1 for bias context
      if(!c4h||c4h.length<30){console.log("  No 4H data");continue;}

      const d1Bias = getD1Bias(cd1);
      console.log(`  D1 Bias: ${d1Bias}`);

      const vp4h=computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback);
      const vp1h=c1h&&c1h.length>=20?computeVolumeProfile(c1h,TF_CONFIG.H1.vpLookback):null;
      const vp15m=c15m&&c15m.length>=15?computeVolumeProfile(c15m,TF_CONFIG.M15.vpLookback):null;
      if(!vp4h){console.log("  4H VP failed");continue;}

      const av4h=computeAVWAP(c4h,TF_CONFIG.H4.avwapLookback);
      const av1h=c1h?computeAVWAP(c1h,TF_CONFIG.H1.avwapLookback):null;
      const av15m=c15m?computeAVWAP(c15m,TF_CONFIG.M15.avwapLookback):null;

      const m4h=runMathEngine(c4h),m1h=c1h?runMathEngine(c1h):null,m15m=c15m?runMathEngine(c15m):null;
      const isCrypto=false;  // v8.0: no crypto in forex bot

      console.log(`  4H: ${vp4h.valBandBot.toFixed(pair.dec)}–${vp4h.valBandTop.toFixed(pair.dec)} | Hurst:${m4h?m4h.hurst.toFixed(3):"?"}`);

      const r4h=detectGWP(c4h,vp4h,av4h,m4h,pair.dec,TF_CONFIG.H4,isCrypto);
      const r1h=vp1h?detectGWP(c1h,vp1h,av1h,m1h,pair.dec,TF_CONFIG.H1,isCrypto):null;
      const r15m=vp15m?detectGWP(c15m,vp15m,av15m,m15m,pair.dec,TF_CONFIG.M15,isCrypto):null;

      const ms4h=r4h?analyzeMarketStructure(c4h,r4h.direction,TF_CONFIG.H4):null;
      const ms1h=r1h?analyzeMarketStructure(c1h,r1h.direction,TF_CONFIG.H1):null;
      const ms15m=r15m?analyzeMarketStructure(c15m,r15m.direction,TF_CONFIG.M15):null;

      console.log(`  4H:${r4h?r4h.direction+" "+r4h.score:"—"}  1H:${r1h?r1h.direction+" "+r1h.score:"—"}  15M:${r15m?r15m.direction+" "+r15m.score:"—"}`);

      // v3.0: directional lock
      let firedDir=null;

      // ─ TRIPLE CONFLUENCE ──────────────────────────────────────────────────
      if(r4h&&r1h&&r15m&&r4h.direction===r1h.direction&&r1h.direction===r15m.direction){
        const dir=r4h.direction;
        if(!isDuplicate(pair.symbol,dir,"TRIPLE")){
          const conv4h=computeConviction(r4h,m4h,ms4h,"H4",false,true,d1Bias);
          const conv1h=computeConviction(r1h,m1h,ms1h,"H1",false,true,d1Bias);
          const conv15m=computeConviction(r15m,m15m,ms15m,"M15",false,true,d1Bias);
          const gate=TF_CONFIG.H4.minConviction-CONFIG.CONFLUENCE_GATE_REDUCTION;
          if(parseFloat(conv4h.score)>=gate){
            console.log(`  🔥🔥🔥 TRIPLE! ${dir} Conv4H=${conv4h.score}`);
            await tgSend(formatTripleSignal(r4h,r1h,r15m,pair,conv4h,conv1h,conv15m,ms4h,ms1h,ms15m,d1Bias));
            storePosition(pair,r4h,conv4h,"H4");storePosition(pair,r1h,conv1h,"H1");
            setCooldown(pair.symbol,dir,"H4");setCooldown(pair.symbol,dir,"H1");setCooldown(pair.symbol,dir,"M15");
            markFired(pair.symbol,dir,"TRIPLE");
            firedDir=dir;
            trackFired(pair,r4h,"TRIPLE");fired++;continue;
          }
        }
      }

      // ─ 4H + 1H CONFLUENCE ─────────────────────────────────────────────────
      if(r4h&&r1h&&r4h.direction===r1h.direction){
        const dir=r4h.direction;
        if(isOnCooldown(pair.symbol,dir,"H4")&&isOnCooldown(pair.symbol,dir,"H1")){console.log("  🔒 Both TF cooldowns");continue;}
        if(!isDuplicate(pair.symbol,dir,"CONF")){
          const conv4h=computeConviction(r4h,m4h,ms4h,"H4",true,false,d1Bias);
          const conv1h=computeConviction(r1h,m1h,ms1h,"H1",true,false,d1Bias);
          const gate=TF_CONFIG.H4.minConviction-CONFIG.CONFLUENCE_GATE_REDUCTION;
          console.log(`  🔥🔥 CONFLUENCE! ${dir} 4H Conv=${conv4h.score} gate=${gate}`);
          if(parseFloat(conv4h.score)>=gate){
            await tgSend(formatConfluenceSignal(r4h,r1h,pair,conv4h,conv1h,ms4h,ms1h,d1Bias));
            storePosition(pair,r4h,conv4h,"H4");storePosition(pair,r1h,conv1h,"H1");
            setCooldown(pair.symbol,dir,"H4");setCooldown(pair.symbol,dir,"H1");
            markFired(pair.symbol,dir,"CONF");
            firedDir=dir;
            trackFired(pair,r4h,"CONFLUENCE");fired++;continue;
          }
        }
      }

      // ─ 4H SOLO ────────────────────────────────────────────────────────────
      if(r4h&&(!firedDir||r4h.direction===firedDir)){
        if(isOnCooldown(pair.symbol,r4h.direction,"H4")){console.log("  🔒 4H cooldown");}
        else{
          const conv=computeConviction(r4h,m4h,ms4h,"H4",false,false,d1Bias);
          console.log(`  4H conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H4.minConviction&&!isDuplicate(pair.symbol,r4h.direction,"H4")){
            await tgSend(formatSingleSignal(r4h,pair,conv,ms4h,"",d1Bias,m4h));
            storePosition(pair,r4h,conv,"H4");setCooldown(pair.symbol,r4h.direction,"H4");
            markFired(pair.symbol,r4h.direction,"H4");
            firedDir=r4h.direction;
            trackFired(pair,r4h,"H4");fired++;
          }else{console.log(`  ⚠️ 4H conv ${conv.score} below ${TF_CONFIG.H4.minConviction}`);}
        }
      }

      // ─ 1H SOLO ────────────────────────────────────────────────────────────
      if(r1h&&(!firedDir||r1h.direction===firedDir)){
        if(isOnCooldown(pair.symbol,r1h.direction,"H1")){console.log("  🔒 1H cooldown");}
        else{
          const conv=computeConviction(r1h,m1h,ms1h,"H1",false,false,d1Bias);
          console.log(`  1H conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H1.minConviction&&!isDuplicate(pair.symbol,r1h.direction,"H1")){
            await tgSend(formatSingleSignal(r1h,pair,conv,ms1h,"⚡ <b>SCALP</b> —",d1Bias,m1h));
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
          const conv=computeConviction(r15m,m15m,ms15m,"M15",true,false,d1Bias);
          console.log(`  15M conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.M15.minConviction&&!isDuplicate(pair.symbol,r15m.direction,"M15")){
            await tgSend(formatSingleSignal(r15m,pair,conv,ms15m,"🔬 <b>MICRO SNIPER</b> —",d1Bias,m15m));
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
  console.log(`GWP Forex v8.0 ELITE MAX | mode: ${mode} | ${new Date().toISOString()}`);
  console.log(`Running 24/7 | No lagging indicators | ATR SL floor | Vol+AVWAP gate | BTC removed`);
  if(!CONFIG.TWELVE_DATA_KEY)console.error("⚠️  TWELVE_DATA_KEY not set — forex pairs will fail.");

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
  console.log("State saved → forex_state.json");
})();

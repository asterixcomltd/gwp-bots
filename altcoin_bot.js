"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — ALTCOIN EDITION  v5.0  MONEY PRINTING MACHINE™
// Strategy : Ghost Wick Protocol™ (GWP) — 4H + 1H Dual Timeframe Engine
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Exchange : KuCoin (Public REST API — no auth key needed)
// Pairs    : DEXE · UNI · SUSHI · SOL · AVAX · BTC · ETH
// Platform : GitHub Actions (Node.js 22) · altcoin_state.json persistence
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
//
// v5.0 MONEY PRINTING MACHINE UPGRADES:
//   ✅ MARKET STRUCTURE ENGINE   — BOS · CHoCH · Liquidity Sweeps · FVG
//   ✅ SWING DETECTION           — institutional pivot points (strength=3)
//   ✅ CHoCH = TOP SIGNAL        — structure flipping = highest conviction
//   ✅ LIQUIDITY SWEEP CONFIRM   — smart money prints = stop-hunt confirmed
//   ✅ FAIR VALUE GAP (FVG)      — price returning to fill imbalance
//   ✅ MATH ENGINE +2 LAYERS     — ATR percentile + volume surge ratio
//   ✅ CONVICTION OVERHAULED     — EMA/RSI replaced by pure MS + math
//   ✅ STRICTER GATES            — 4H≥57 · 1H≥60 · fewer but ELITE signals
//   ✅ 4H + 1H DUAL TF           — 1H confirms intraday crypto precision
//   ✅ TF CONFLUENCE OPTION C    — one combined message when both TFs align
//   ✅ AVWAP TRAP                — institutional liquidity sweep reference
//   ✅ HURST EXPONENT            — mean-reversion probability engine
//   ✅ KALMAN VELOCITY           — momentum decay = imminent reversal
//   ✅ Z-SCORE EXTREMES          — statistical outlier entry filter
//   ✅ VOLUME SPIKE FILTER       — smart money volume footprint
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── TF CONFIGS ────────────────────────────────────────────────────────────────
const TF_CONFIG = {
  H4: {
    tf: "H4", label: "4H",
    vpLookback: 100, avwapLookback: 30,
    minRR: 2.0, minConviction: 57, cooldownHrs: 4,
    atrBufMult: 0.45, maxAge: 2, avwapProx: 0.004,
    volLookback: 20,
    msLookback: 80, swingStrength: 3,
  },
  H1: {
    tf: "H1", label: "1H",
    vpLookback: 60, avwapLookback: 20,
    minRR: 1.8, minConviction: 60, cooldownHrs: 2,
    atrBufMult: 0.35, maxAge: 1, avwapProx: 0.005,
    volLookback: 20,
    msLookback: 60, swingStrength: 3,
  },
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  TELEGRAM_TOKEN : process.env.ALTCOIN_TG_TOKEN || "",
  CHAT_ID        : process.env.ALTCOIN_CHAT_ID  || "",

  PAIRS: ["DEXE-USDT","UNI-USDT","SUSHI-USDT","SOL-USDT","AVAX-USDT","BTC-USDT","ETH-USDT"],

  CAPITAL: 5, RISK_PCT: 1.5, LEVERAGE: 20,
  VP_ROWS: 24, MIN_WICK_DEPTH_PCT: 0.15, MIN_BODY_GAP_PCT: 0.10,

  VOLUME_FILTER: true, VOLUME_SPIKE_MULT: 1.2,  // kept for GWP checklist

  SESSION_FILTER: true, SESSION_DEAD_START: 1, SESSION_DEAD_END: 6,

  CIRCUIT_BREAKER: true, CIRCUIT_BREAKER_LOSSES: 3, CIRCUIT_BREAKER_HRS: 24,

  CONFLUENCE_CONVICTION_BOOST: 15,
};

const V = "GWP Altcoin v5.0 | Money Printing Machine™ | Asterix.COM | Abdin";

// ── STATE ─────────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "altcoin_state.json");
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
    const req=https.request({hostname,path:pth,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(payload)}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>res(d));});
    req.on("error",rej); req.write(payload); req.end();
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TELEGRAM ──────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!CONFIG.TELEGRAM_TOKEN||!CONFIG.CHAT_ID) return;
  try { await httpPost("api.telegram.org",`/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`,{chat_id:CONFIG.CHAT_ID,text,parse_mode:"HTML"}); }
  catch(e) { console.error("TG error:",e.message); }
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
const KU_TF = { H4:"4hour", H1:"1hour", M15:"15min", D1:"1day" };

async function fetchKlines(symbol, tf, limit) {
  const url=`https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]||tf}&symbol=${symbol}&limit=${Math.min(limit||150,300)}`;
  try {
    const raw=await httpGet(url); const json=JSON.parse(raw);
    if(!json.data||json.data.length<5) return null;
    return json.data.reverse().map(c=>({t:parseInt(c[0])*1000,open:parseFloat(c[1]),close:parseFloat(c[2]),high:parseFloat(c[3]),low:parseFloat(c[4]),vol:parseFloat(c[5])}));
  } catch(e) { return null; }
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
  if(candles.length<p+10)return 50;
  const atrs=[];
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
  const rsVals=lags.map(lag=>{const chunks=Math.floor(rets.length/lag);let rsSum=0;for(let c=0;c<chunks;c++){const sub=rets.slice(c*lag,(c+1)*lag),mean=sub.reduce((a,b)=>a+b,0)/sub.length,dem=sub.map(r=>r-mean);let cum=0;const cumDev=dem.map(d=>(cum+=d,cum)),R=Math.max(...cumDev)-Math.min(...cumDev),variance=sub.reduce((a,b)=>a+b*b,0)/sub.length-mean*mean;rsSum+=R/Math.sqrt(Math.max(variance,1e-15));}return rsSum/chunks;});
  const logN=lags.map(l=>Math.log(l)),logRS=rsVals.map(rs=>Math.log(Math.max(rs,1e-10)));
  const nP=logN.length,mLN=logN.reduce((a,b)=>a+b)/nP,mLRS=logRS.reduce((a,b)=>a+b)/nP;
  const num=logN.reduce((a,x,i)=>a+(x-mLN)*(logRS[i]-mLRS),0),den=logN.reduce((a,x)=>a+(x-mLN)**2,0);
  return den===0?0.5:Math.min(Math.max(num/den,0.1),0.9);
}
function calcZScore(closes,p=20){
  if(closes.length<p)return{z:0,extremeHigh:false,extremeLow:false,mildHigh:false,mildLow:false};
  const win=closes.slice(-p),mean=win.reduce((a,b)=>a+b,0)/p,std=Math.sqrt(win.reduce((a,b)=>a+(b-mean)**2,0)/p);
  const z=std===0?0:(closes[closes.length-1]-mean)/std;
  return{z,extremeHigh:z>2,extremeLow:z<-2,mildHigh:z>1,mildLow:z<-1};
}
function kalmanFilter(closes){
  if(closes.length<5)return null;const Q=0.01,R=0.5;let x=closes[0],v=0,P=1;
  for(let i=1;i<closes.length;i++){const xP=x+v,PP=P+Q,K=PP/(PP+R);x=xP+K*(closes[i]-xP);v=v+0.1*(closes[i]-x);P=(1-K)*PP;}
  return{fairValue:x,velocity:v,bullish:v>0};
}
function runMathEngine(candles){
  if(!candles||candles.length<30)return null;
  const closes=candles.map(c=>c.close);
  const atr=calcATR(candles,14),rsi=calcRSI(closes,14);
  const hurst=calcHurst(closes),zScore=calcZScore(closes,20),kalman=kalmanFilter(closes);
  const atrPct=calcATRPercentile(candles,14),volRatio=calcVolumeRatio(candles,20);
  return{atr,rsi4h:rsi,hurst,zScore,kalman,atrPct,volRatio,cur:closes[closes.length-1]};
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

// ── VOLUME SPIKE CHECK (GWP checklist item) ───────────────────────────────────
function hasVolumeSpike(sigCandle, allCandles, sigIdx, volLookback) {
  if (!CONFIG.VOLUME_FILTER) return true;
  const start=Math.max(0,sigIdx-volLookback),vols=allCandles.slice(start,sigIdx).map(c=>c.vol||0);
  if(!vols.length) return true;
  const avg=vols.reduce((a,b)=>a+b,0)/vols.length;
  return avg===0?true:(sigCandle.vol||0)>=avg*CONFIG.VOLUME_SPIKE_MULT;
}

// ── MARKET STRUCTURE ENGINE ───────────────────────────────────────────────────
// ICT/SMC concepts: Swing Detection → BOS → CHoCH → Liquidity Sweeps → FVG
// Replaces EMA/RSI-based checkLowerTF completely

function detectSwings(candles, strength) {
  const highs=[], lows=[];
  const str=strength||3;
  for(let i=str;i<candles.length-str;i++){
    let isHigh=true,isLow=true;
    for(let j=i-str;j<=i+str;j++){
      if(j===i)continue;
      if(candles[j].high>=candles[i].high)isHigh=false;
      if(candles[j].low <=candles[i].low) isLow =false;
    }
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
  const last5=candles.slice(-5);
  let toBull=false,toBear=false;
  if(prevTrend==="BEAR"){
    const refHigh=swings.highs.filter(s=>s.idx<candles.length-5).slice(-1)[0];
    if(refHigh&&last5.some(c=>c.close>refHigh.price))toBull=true;
  }
  if(prevTrend==="BULL"){
    const refLow=swings.lows.filter(s=>s.idx<candles.length-5).slice(-1)[0];
    if(refLow&&last5.some(c=>c.close<refLow.price))toBear=true;
  }
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
  const cur=candles[candles.length-1];
  let found=false,fvgHigh=null,fvgLow=null;
  for(let i=candles.length-1;i>=Math.max(2,candles.length-12);i--){
    const c1=candles[i-2],c3=candles[i];
    if(direction==="BULL"&&c3.low>c1.high){
      const prox=Math.abs(cur.close-c1.high)/cur.close;
      if((cur.close>=c1.high&&cur.close<=c3.low)||prox<0.007){found=true;fvgHigh=c3.low;fvgLow=c1.high;break;}
    }
    if(direction==="BEAR"&&c3.high<c1.low){
      const prox=Math.abs(cur.close-c1.low)/cur.close;
      if((cur.close<=c1.low&&cur.close>=c3.high)||prox<0.007){found=true;fvgHigh=c1.low;fvgLow=c3.high;break;}
    }
  }
  return{present:found,fvgHigh,fvgLow};
}

function analyzeMarketStructure(candles,direction,tfCfg){
  if(!candles||candles.length<20){return{confirmed:false,label:"⬜ INSUFFICIENT DATA",strength:0,bos:null,choch:null,liqSweep:null,fvg:null};}
  const slice=candles.slice(-Math.min(tfCfg.msLookback,candles.length));
  const swings   =detectSwings(slice,tfCfg.swingStrength);
  const bos      =detectBOS(slice,swings);
  const choch    =detectCHoCH(slice,swings);
  const liqSweep =detectLiquiditySweep(slice,swings);
  const fvg      =detectFVG(slice,direction);
  let confirmed=false,label="❌ NO MS CONFIRM",strength=0;
  if(direction==="BULL"){
    if(choch.detected&&choch.toBull) {confirmed=true;label="🔄 CHoCH → BULL";   strength=3;}
    else if(bos.bullBOS)              {confirmed=true;label="⬆️ BOS BULL";       strength=2;}
    else if(liqSweep.lowSweep)        {confirmed=true;label="💧 LIQ SWEEP LOW";  strength=2;}
    else if(fvg.present)               {confirmed=true;label="🟦 BULL FVG FILL"; strength=1;}
  }
  if(direction==="BEAR"){
    if(choch.detected&&choch.toBear) {confirmed=true;label="🔄 CHoCH → BEAR";   strength=3;}
    else if(bos.bearBOS)              {confirmed=true;label="⬇️ BOS BEAR";       strength=2;}
    else if(liqSweep.highSweep)       {confirmed=true;label="💧 LIQ SWEEP HIGH"; strength=2;}
    else if(fvg.present)               {confirmed=true;label="🟥 BEAR FVG FILL"; strength=1;}
  }
  const prevStr=choch.prevTrend?`Prev trend: ${choch.prevTrend}`:"Trend: unclear";
  return{confirmed,label,strength,bos,choch,liqSweep,fvg,swings,prevStr};
}

// ── BAYESIAN CONVICTION ────────────────────────────────────────────────────────
// GWP core + Math (H/Z/K/ATR%/Vol) + Market Structure (BOS/CHoCH/LS/FVG)
// EMA/RSI confirmation removed. Every point earned on pure math and structure.
function computeConviction(gwp,math,ms,tfKey,isConfluence=false){
  let score=0;

  // GWP CORE (0-30)
  const gs=parseFloat(gwp.score);score+=gs>=7.5?30:gs>=6.5?24:gs>=5.5?16:8;

  // AVWAP TRAP (12)
  if(gwp.avwapTrap)  score+=12;

  // VOLUME SPIKE on signal candle (5)
  if(gwp.volumeSpike) score+=5;

  // PATH A BONUS (4)
  if(!gwp.isPathB)   score+=4;

  // MATH ENGINE (0-22)
  if(math){
    if(math.hurst<0.45)      score+=8;
    else if(math.hurst<0.55) score+=4;

    const z=math.zScore;
    if(gwp.direction==="BULL"&&z.extremeLow) score+=6;
    if(gwp.direction==="BEAR"&&z.extremeHigh)score+=6;
    if(gwp.direction==="BULL"&&z.mildLow)    score+=3;
    if(gwp.direction==="BEAR"&&z.mildHigh)   score+=3;

    if(math.kalman){const rev=(gwp.direction==="BULL"&&!math.kalman.bullish)||(gwp.direction==="BEAR"&&math.kalman.bullish);if(rev)score+=6;}

    if(math.atrPct>=25&&math.atrPct<=75)     score+=4;
    else if(math.atrPct>=15&&math.atrPct<=85)score+=2;

    if(math.volRatio>=2.0)      score+=4;
    else if(math.volRatio>=1.5) score+=3;
    else if(math.volRatio>=1.2) score+=1;
  }

  // MARKET STRUCTURE (0-22)
  if(ms){
    if(ms.choch&&ms.choch.detected){
      if((gwp.direction==="BULL"&&ms.choch.toBull)||(gwp.direction==="BEAR"&&ms.choch.toBear))score+=14;
    }else if(ms.bos){
      if((gwp.direction==="BULL"&&ms.bos.bullBOS)||(gwp.direction==="BEAR"&&ms.bos.bearBOS))score+=8;
    }
    const lsConf=(gwp.direction==="BULL"&&ms.liqSweep&&ms.liqSweep.lowSweep)||(gwp.direction==="BEAR"&&ms.liqSweep&&ms.liqSweep.highSweep);
    if(lsConf)score+=5;
    if(ms.fvg&&ms.fvg.present)score+=3;
  }

  // CONFLUENCE BOOST (15)
  if(isConfluence)score+=CONFIG.CONFLUENCE_CONVICTION_BOOST;

  score=Math.min(score,100);
  const grade=score>=88?"🏆 SUPREME★★★":score>=80?"⚡ SUPREME★★":score>=72?"🔥 SUPREME★":score>=62?"🔥 ELITE":score>=52?"✅ SOLID":"❌ BELOW GATE";
  return{score:score.toFixed(1),grade};
}

// ── CORE GWP DETECTOR (parameterized — works for any TF) ──────────────────────
function detectGWP(candles,vp,avwap,math,tfCfg){
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

    if(direction==="BEAR"&&cur.close<=bMid){console.log(`  GWP BEAR ${tfCfg.label} age=${age}: stale`);continue;}
    if(direction==="BULL"&&cur.close>=bMid){console.log(`  GWP BULL ${tfCfg.label} age=${age}: stale`);continue;}

    let avwapTrap=false;
    if(avwap){const prox=tfCfg.avwapProx;avwapTrap=Math.abs(sig.high-avwap)/avwap<=prox||Math.abs(sig.low-avwap)/avwap<=prox;}

    const sigIdx=n-2-age;
    const volumeSpike=hasVolumeSpike(sig,candles,sigIdx,tfCfg.volLookback);

    const bodyGapPct=(bodyGap/bH)*100,isPathB=bodyGapPct<35;
    let sl;
    if(direction==="BEAR"){const slBase=sig.high+atrBuf;sl=isPathB?slBase+(slBase-cur.close)*0.30:slBase;}
    else{const slBase=sig.low-atrBuf;sl=isPathB?slBase-(cur.close-slBase)*0.30:slBase;}

    const entry=cur.close,tp2=bMid;
    let tp1=direction==="BEAR"?entry-Math.abs(entry-tp2)*0.5:entry+Math.abs(tp2-entry)*0.5;
    const risk=Math.abs(entry-sl);if(risk<=0)continue;
    let rr=Math.abs(entry-tp2)/risk;
    if(rr<tfCfg.minRR){tp1=direction==="BEAR"?bBot:bTop;rr=Math.abs(entry-tp2)/risk;}
    if(rr<tfCfg.minRR){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: R:R=${rr.toFixed(2)} below gate`);continue;}

    const agePenalty=age*0.5;
    const checks=[
      {item:`${tfCfg.label} candle CLOSED${age>0?` [${age} bars ago]`:""}`,    pass:true},
      {item:"Wick penetrated INTO VAL band",                                      pass:true},
      {item:"Body OUTSIDE band with clear gap ≥10%",                              pass:bodyGapPct>=10},
      {item:"Wick depth ≥15% of band height",                                     pass:(wickDepth/bH)>=CONFIG.MIN_WICK_DEPTH_PCT},
      {item:"AVWAP Trap — institutional liquidity confluence",                     pass:avwapTrap},
      {item:`Volume spike ≥${CONFIG.VOLUME_SPIKE_MULT}× avg`,                    pass:volumeSpike},
      {item:`R:R ≥ ${tfCfg.minRR}:1`,                                            pass:rr>=tfCfg.minRR},
      {item:"Target not yet hit (smart stale check)",                              pass:true},
    ];
    const rawScore=checks.filter(c=>c.pass).length,score=Math.max(0,rawScore-agePenalty);
    const grade=score>=7.5?"A+★ SUPREME":score>=6.5?"A+ ELITE":score>=5.5?"A SOLID":"B+ VALID";
    if(score<5.0){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: score=${score.toFixed(1)} below threshold`);continue;}

    const dp=v=>v<0.01?6:v<1?5:v<10?4:v<1000?3:2,f=v=>Number(v).toFixed(dp(Math.abs(v)));
    const reEntry=isPathB?f(direction==="BEAR"?entry+Math.abs(entry-sl)*0.8:entry-Math.abs(entry-sl)*0.8):null;
    console.log(`  ✅ GWP FOUND [${tfCfg.label}]: ${direction} | age=${age} | ${grade} | score=${score.toFixed(1)} | R:R=${rr.toFixed(2)}`);

    return{
      direction,grade,score:score.toFixed(1),rawScore,age,
      tf:tfCfg.tf,tfLabel:tfCfg.label,
      path:isPathB?"B — Sweep + Return ⚠️":"A — Direct Return 🎯",
      isPathB,volumeSpike,avwapTrap,
      entry:f(entry),sl:f(sl),tp1:f(tp1),tp2:f(tp2),rr:rr.toFixed(2),
      slPct:(Math.abs(entry-sl)/entry*100).toFixed(2),
      tp1Pct:(Math.abs(entry-tp1)/entry*100).toFixed(2),
      tp2Pct:(Math.abs(entry-tp2)/entry*100).toFixed(2),
      wickDepthPct:(wickDepth/bH*100).toFixed(1),bodyGapPct:bodyGapPct.toFixed(1),
      avwap:avwap?f(avwap):null,
      vp:{val:f(bBot),mid:f(bMid),top:f(bTop),poc:f(vp.poc)},
      checks,reEntry,signalTime:new Date(sig.t).toUTCString(),
    };
  }
  return null;
}

// ── SIGNAL FORMATTERS ─────────────────────────────────────────────────────────
function symLabel(symbol){return symbol.replace("-USDT","");}

function fmtMS(ms,direction){
  if(!ms)return"⬜ MS: no data";
  const chochStr=ms.choch&&ms.choch.detected?`CHoCH→${ms.choch.prevTrend==="BEAR"?"BULL":"BEAR"}✅`:"CHoCH:—";
  const bosStr  =ms.bos?(direction==="BULL"&&ms.bos.bullBOS?"BOS↑✅":direction==="BEAR"&&ms.bos.bearBOS?"BOS↓✅":"BOS:—"):"BOS:—";
  const lsStr   =ms.liqSweep?(direction==="BULL"&&ms.liqSweep.lowSweep?"LiqSwp↓✅":direction==="BEAR"&&ms.liqSweep.highSweep?"LiqSwp↑✅":"LiqSwp:—"):"LiqSwp:—";
  const fvgStr  =ms.fvg&&ms.fvg.present?"FVG✅":"FVG:—";
  return`${ms.label}\n  ${chochStr}  ${bosStr}  ${lsStr}  ${fvgStr}`;
}

function formatConfluenceSignal(r4h,r1h,symbol,conv4h,conv1h,ms4h,ms1h){
  const dir=r4h.direction==="BULL"?"🟢 LONG  ▲":"🔴 SHORT ▼";
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;
  const trap4h=r4h.avwapTrap?"\n🪤 <b>AVWAP TRAP [4H]</b> — institutional stop-hunt":"";
  const trap1h=r1h.avwapTrap?"\n🪤 <b>AVWAP TRAP [1H]</b> — intraday liquidity swept":"";
  const pathB=r4h.isPathB?`\n⚠️ <b>PATH B</b> — sweep expected. Re-enter near <b>${r4h.reEntry}</b>`:"";
  const age4h=r4h.age>0?` [${r4h.age} bars ago]`:"";
  const age1h=r1h.age>0?` [${r1h.age} bars ago]`:"";
  const check4h=r4h.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");
  const check1h=r1h.checks.map(c=>`${c.pass?"✅":"⬜"} ${c.item}`).join("\n");

  return(
    `🔥🔥 <b>TF CONFLUENCE — ${symLabel(symbol)}/USDT</b> 🔥🔥\n` +
    `<b>★ MONEY PRINTING MACHINE™ SIGNAL ★</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${dir}  |  <b>4H + 1H ALIGNED</b>\n` +
    `⚡ Conviction: <b>${conv4h.score}/100</b> — ${conv4h.grade}\n` +
    `🕐 Session: ${isInSession()?"✅ ACTIVE":"💤 Low volume"}${trap4h}${trap1h}\n\n` +
    `━━━━━ 📐 4H STRUCTURE ━━━━━\n` +
    `Grade: <b>${r4h.grade}</b>  |  Score: ${r4h.score}/8${age4h}\n` +
    `🏛 MS: ${fmtMS(ms4h,r4h.direction)}\n` +
    `Band:   <code>${r4h.vp.val} – ${r4h.vp.top}</code>\n` +
    `Target: <code>${r4h.vp.mid}</code>  ← 4H VAL Midpoint\n` +
    `Wick: ${r4h.wickDepthPct}% | Gap: ${r4h.bodyGapPct}%\n` +
    `${r4h.avwap?`AVWAP: <code>${r4h.avwap}</code>\n`:""}\n` +
    `━━━━━ ⚡ 1H ENTRY ZONE ━━━━━\n` +
    `Grade: <b>${r1h.grade}</b>  |  Score: ${r1h.score}/8${age1h}\n` +
    `🏛 MS: ${fmtMS(ms1h,r1h.direction)}\n` +
    `Band:   <code>${r1h.vp.val} – ${r1h.vp.top}</code>\n` +
    `Target: <code>${r1h.vp.mid}</code>  ← 1H VAL Midpoint\n` +
    `Wick: ${r1h.wickDepthPct}% | Gap: ${r1h.bodyGapPct}%\n` +
    `${r1h.avwap?`AVWAP: <code>${r1h.avwap}</code>\n`:""}\n` +
    `━━━━━ 💼 TRADE LEVELS ━━━━━\n` +
    `🎯 <b>Entry:</b>   <code>${r4h.entry}</code>  (4H close)\n` +
    `⚡ <b>Precise:</b> <code>${r1h.entry}</code>  (1H — use for limit order)\n` +
    `🛑 <b>SL:</b>      <code>${r4h.sl}</code>  (-${r4h.slPct}%)  [4H ATR]\n` +
    `✅ <b>TP1:</b>     <code>${r4h.tp1}</code>  (+${r4h.tp1Pct}% — 50% exit · BE)\n` +
    `🏆 <b>TP2:</b>     <code>${r4h.tp2}</code>  (+${r4h.tp2Pct}% — 4H VAL Mid)\n` +
    `📐 <b>R:R:</b>     ${r4h.rr}:1 (4H)  |  ${r1h.rr}:1 (1H)\n` +
    `💼 <b>Risk:</b>    $${riskUSD.toFixed(2)} | Pos: $${posUSD.toFixed(0)} (${CONFIG.LEVERAGE}× lev)\n` +
    `${pathB}\n\n` +
    `━━━━━ ✅ 4H GWP CHECKLIST ━━━━━\n${check4h}\n` +
    `\n━━━━━ ✅ 1H GWP CHECKLIST ━━━━━\n${check1h}\n\n` +
    `⏰ ${new Date().toUTCString()}\n<i>${V}</i>`
  );
}

function formatSingleSignal(r,symbol,conv,ms,isScalp=false){
  const dir=r.direction==="BULL"?"🟢 LONG  ▲":"🔴 SHORT ▼";
  const tag=isScalp?"⚡ <b>SCALP</b> — ":"";
  const trap=r.avwapTrap?"\n🪤 <b>AVWAP TRAP</b> — liquidity stop-hunt confirmed":"";
  const pathB=r.isPathB?`\n⚠️ <b>PATH B</b> — sweep expected. Re-enter near <b>${r.reEntry}</b>`:"";
  const ageN=r.age>0?`\n⏱ Signal: ${r.age} bars ago (${r.signalTime})`:"";
  const check=r.checks.map((c,i)=>`${c.pass?"✅":"⬜"} ${i+1}. ${c.item}`).join("\n");
  const riskUSD=CONFIG.CAPITAL*CONFIG.RISK_PCT/100,posUSD=riskUSD*CONFIG.LEVERAGE;

  return(
    `👻 <b>GHOST WICK PROTOCOL — ${symLabel(symbol)}/USDT</b>  [${r.tfLabel}]\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${tag}${dir}  |  Grade: <b>${r.grade}</b>  |  ${r.score}/8\n` +
    `⚡ Conviction: <b>${conv.score}/100</b> — ${conv.grade}${ageN}\n` +
    `🕐 Session: ${isInSession()?"✅ ACTIVE":"💤"}${trap}\n\n` +
    `🏛 <b>Market Structure [${r.tfLabel}]</b>\n` +
    `  ${fmtMS(ms,r.direction)}\n\n` +
    `🎯 <b>Entry:</b>  <code>${r.entry}</code>\n` +
    `🛑 <b>SL:</b>     <code>${r.sl}</code>  (-${r.slPct}%)  [ATR · full wick]\n` +
    `✅ <b>TP1:</b>    <code>${r.tp1}</code>  (${r.direction==="BEAR"?"-":"+"}${r.tp1Pct}% — 50% exit)\n` +
    `🏆 <b>TP2:</b>    <code>${r.tp2}</code>  (${r.direction==="BEAR"?"-":"+"}${r.tp2Pct}% — VAL Midpoint)\n` +
    `📐 <b>R:R:</b>    ${r.rr}:1\n` +
    `💼 <b>Risk:</b>   $${riskUSD.toFixed(2)} | Pos: $${posUSD.toFixed(0)} (${CONFIG.LEVERAGE}× lev)\n\n` +
    `📊 <b>VAL Band [${r.tfLabel}]</b>\n` +
    `  Band: <code>${r.vp.val} – ${r.vp.top}</code>  Target: <code>${r.vp.mid}</code>\n` +
    `  POC: <code>${r.vp.poc}</code>  Wick: ${r.wickDepthPct}%  Gap: ${r.bodyGapPct}%\n` +
    `${r.avwap?`  AVWAP: <code>${r.avwap}</code>\n`:""}\n` +
    `🛤️ Path: <b>${r.path}</b>${pathB}\n\n` +
    `✅ <b>GWP Checklist v5.0 [${r.tfLabel}]</b>\n${check}\n\n` +
    `⏰ ${new Date().toUTCString()}\n<i>${V}</i>`
  );
}

// ── SESSION ────────────────────────────────────────────────────────────────────
function isInSession(){
  if(!CONFIG.SESSION_FILTER)return true;
  const h=new Date().getUTCHours();return!(h>=CONFIG.SESSION_DEAD_START&&h<CONFIG.SESSION_DEAD_END);
}

// ── COOLDOWNS ──────────────────────────────────────────────────────────────────
function isOnCooldown(symbol,direction,tfKey){
  const last=getProp(`acd5_${tfKey}_${symbol}_${direction}`);
  return last&&(Date.now()-parseInt(last))/3600000<TF_CONFIG[tfKey].cooldownHrs;
}
function setCooldown(symbol,direction,tfKey){setProp(`acd5_${tfKey}_${symbol}_${direction}`,Date.now().toString());}

// ── CIRCUIT BREAKER ────────────────────────────────────────────────────────────
function isCircuitBroken(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return false;
  const raw=getProp("ACB5_"+symbol);if(!raw)return false;
  try{const cb=JSON.parse(raw);if(Date.now()-cb.ts<CONFIG.CIRCUIT_BREAKER_HRS*3600000)return true;delProp("ACB5_"+symbol);}catch(e){}
  return false;
}
async function recordLoss(symbol){
  if(!CONFIG.CIRCUIT_BREAKER)return;
  const key="ACBL5_"+symbol,n=parseInt(getProp(key)||"0")+1;setProp(key,n.toString());
  if(n>=CONFIG.CIRCUIT_BREAKER_LOSSES){setProp("ACB5_"+symbol,JSON.stringify({ts:Date.now(),losses:n}));delProp(key);await tgSend(`⛔ <b>CIRCUIT BREAKER — ${symbol}</b>\n${n} losses. Paused ${CONFIG.CIRCUIT_BREAKER_HRS}h.\n\n<i>${V}</i>`);}
}
function recordWin(symbol){if(CONFIG.CIRCUIT_BREAKER)delProp("ACBL5_"+symbol);}

// ── POSITION TRACKER ──────────────────────────────────────────────────────────
function storePosition(symbol,r,conv,tfKey){
  setProp("APOS5_"+symbol+"_"+r.direction+"_"+tfKey,JSON.stringify({
    symbol,direction:r.direction,entry:parseFloat(r.entry),sl:parseFloat(r.sl),
    tp1:parseFloat(r.tp1),tp2:parseFloat(r.tp2),rr:r.rr,grade:r.grade,tf:tfKey,
    conviction:conv?conv.score:"?",isPathB:r.isPathB,reEntry:r.reEntry,
    state:"OPEN",tp1hit:false,ts:Date.now(),
  }));
}
async function checkOpenPositions(){
  const posKeys=Object.keys(state).filter(k=>k.startsWith("APOS5_"));
  for(const key of posKeys){
    let p;try{p=JSON.parse(getProp(key));}catch(e){continue;}
    if(!p||p.state!=="OPEN")continue;
    const candles=await fetchKlines(p.symbol,"M15",3);if(!candles||!candles.length)continue;
    const price=candles[candles.length-1].close,isL=p.direction==="BULL";
    const pnl=((isL?(price-p.entry)/p.entry:(p.entry-price)/p.entry)*100).toFixed(3);
    const dp=v=>v<0.01?6:v<1?5:v<10?4:v<1000?3:2,f=v=>Number(v).toFixed(dp(Math.abs(v)));
    let msg=null;
    if(!p.tp1hit&&(isL?price>=p.tp1:price<=p.tp1)){p.tp1hit=true;msg=`🎯 <b>GWP TP1 HIT — ${p.symbol} [${p.tf}]</b>\nExit 50% · Move SL to BE.\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;}
    if(isL?price>=p.tp2:price<=p.tp2){msg=`🏆 <b>GWP TP2 HIT! — ${p.symbol} [${p.tf}]</b> 🔥\n${p.direction} ${f(p.entry)} → ${f(p.tp2)}\nP&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,true);}
    if(isL?price<=p.sl:price>=p.sl){const pbN=p.isPathB?`\n⚡ Path B re-entry: <code>${p.reEntry||"zone"}</code>`:"";msg=`❌ <b>GWP SL HIT — ${p.symbol} [${p.tf}]</b>\n${p.direction} ${f(p.entry)} → SL ${f(p.sl)}\nP&L: <b>${pnl}%</b>${pbN}\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,false);}
    if(msg){await tgSend(msg);if(p.state==="CLOSED")delProp(key);else setProp(key,JSON.stringify(p));}else{setProp(key,JSON.stringify(p));}
  }
}

// ── TRACKING ───────────────────────────────────────────────────────────────────
function getDateKey(){return new Date().toISOString().slice(0,10);}
function getWeekKey(){const now=new Date(),s=new Date(now.getFullYear(),0,1);return now.getFullYear()+"_W"+String(Math.ceil(((now-s)/86400000+s.getDay()+1)/7)).padStart(2,"0");}
function trackFired(symbol,r,isConfluence){
  const dk="A5_D_"+getDateKey();let d;try{d=JSON.parse(getProp(dk)||"[]");}catch(e){d=[];}
  d.push({sym:symbol,dir:r.direction,grade:r.grade,tf:r.tf,confluence:isConfluence,rr:r.rr,ts:Date.now()});setProp(dk,JSON.stringify(d));
  const wk="A5_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  w.signals=(w.signals||0)+1;if(isConfluence)w.confluence=(w.confluence||0)+1;setProp(wk,JSON.stringify(w));
}
async function trackClose(symbol,direction,pnlPct,isWin){
  const wk="A5_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  if(isWin){w.wins=(w.wins||0)+1;recordWin(symbol);}else{w.losses=(w.losses||0)+1;await recordLoss(symbol);}
  w.pnl=parseFloat(((w.pnl||0)+parseFloat(pnlPct||0)).toFixed(3));setProp(wk,JSON.stringify(w));
}

// ── SUMMARIES / INFO ──────────────────────────────────────────────────────────
async function sendDailySummary(){
  const today=getDateKey();let d;try{d=JSON.parse(getProp("A5_D_"+today)||"[]");}catch(e){d=[];}
  let msg=`📅 <b>DAILY SUMMARY — ${today} UTC</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if(!d.length)msg+=`📊 <b>Signals: 0</b>\n  No GWP setups today. The machine is patient.\n\n`;
  else{msg+=`📊 <b>Signals: ${d.length}</b>\n`;d.forEach(s=>{const tag=s.confluence?" 🔥CONFLUENCE":` [${s.tf}]`;msg+=`  ${s.dir==="BULL"?"🟢":"🔴"} ${s.sym}${tag} | ${s.grade} | R:R ${s.rr}\n`;});msg+="\n";}
  msg+=`⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendWeeklySummary(){
  let w;try{w=JSON.parse(getProp("A5_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const closed=(w.wins||0)+(w.losses||0),wr=closed>0?((w.wins||0)/closed*100).toFixed(0)+"%":"—";
  let msg=`📆 <b>WEEKLY SUMMARY — ${getWeekKey().replace("_"," ")}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg+=`📊 Signals: ${w.signals||0}  |  Confluences: ${w.confluence||0}\n`;
  if(closed>0)msg+=`✅ ${w.wins||0}W  ❌ ${w.losses||0}L  |  Win Rate: <b>${wr}</b>\n💰 Net P&L: <b>${(w.pnl||0)>=0?"+":""}${w.pnl||0}%</b>\n`;
  else msg+=`  No closed trades yet.\n`;
  msg+=`\n⏰ ${new Date().toUTCString()}\n<i>${V}</i>`;await tgSend(msg);
}
async function sendHealth(){
  let msg=`💚 <b>GWP Altcoin v5.0 — HEALTH</b>\n<i>Money Printing Machine™</i>\n\n`;
  for(const symbol of CONFIG.PAIRS){
    let price="?";
    try{const c=await fetchKlines(symbol,"H1",2);if(c&&c.length)price=c[c.length-1].close;}catch(e){}
    const cb=isCircuitBroken(symbol)?" ⛔CB":"";
    msg+=`${price!=="?"?"✅":"❌"} ${symbol}: ${price!=="?"?"$"+price:"NO DATA"}${cb}\n`;
  }
  msg+=`\n🕐 Session: ${isInSession()?"✅ ACTIVE":"💤 Dead zone"}\n`;
  msg+=`🏛 Confluence engine: GWP + Math + Market Structure\n`;
  msg+=`📅 Last scan: ${state.lastScanTime||"never"}\n\n<i>${V}</i>`;await tgSend(msg);
}
async function sendStatus(){
  let w;try{w=JSON.parse(getProp("A5_W_"+getWeekKey())||"{}");}catch(e){w={};}
  const openCount=Object.keys(state).filter(k=>k.startsWith("APOS5_")).length;
  await tgSend(
    `📡 <b>GWP Altcoin Bot v5.0 — ONLINE</b> ✅\n<b>Money Printing Machine™</b>\n\n` +
    `Pairs: ${CONFIG.PAIRS.map(s=>s.replace("-USDT","")).join(", ")}\n` +
    `Timeframes: 4H + 1H dual scan\n` +
    `4H: R:R≥${TF_CONFIG.H4.minRR} Conv≥${TF_CONFIG.H4.minConviction} CD${TF_CONFIG.H4.cooldownHrs}h\n` +
    `1H: R:R≥${TF_CONFIG.H1.minRR} Conv≥${TF_CONFIG.H1.minConviction} CD${TF_CONFIG.H1.cooldownHrs}h\n` +
    `Signal engine: GWP + Math (H/Z/K/ATR%/Vol) + Market Structure (BOS/CHoCH/LS/FVG)\n` +
    `Confluence boost: +${CONFIG.CONFLUENCE_CONVICTION_BOOST}\n` +
    `Open positions: ${openCount}\n` +
    `This week: ${w.signals||0} signals | ${w.confluence||0} confluences | ${w.wins||0}W ${w.losses||0}L\n\n` +
    `<i>${V}</i>`
  );
}
async function sendPositions(){
  const keys=Object.keys(state).filter(k=>k.startsWith("APOS5_"));
  if(!keys.length){await tgSend(`📭 No open GWP positions.\n\n<i>${V}</i>`);return;}
  let msg=`📊 <b>Open GWP Positions</b>\n\n`;
  for(const k of keys){try{const p=JSON.parse(getProp(k));msg+=`${p.direction==="BULL"?"🟢":"🔴"} <b>${p.symbol}</b> ${p.direction} [${p.tf}]\n  Entry: ${p.entry}  SL: ${p.sl}  TP2: ${p.tp2}  Conv: ${p.conviction}/100\n\n`;}catch(e){}}
  await tgSend(msg+`<i>${V}</i>`);
}
async function sendHelp(){
  await tgSend(
    `👻 <b>GWP ALTCOIN BOT v5.0 — MONEY PRINTING MACHINE™</b>\n\n` +
    `<b>Commands:</b>\n` +
    `/scan — full scan all pairs (4H + 1H)\n` +
    `/${CONFIG.PAIRS.map(s=>s.replace("-USDT","").toLowerCase()).join(" · /")}\n` +
    `/daily · /weekly · /health · /positions · /status · /reset · /help\n\n` +
    `<b>v5.0 Engine Stack:</b>\n` +
    `▸ 👻 GWP — VAL band wick protocol (king)\n` +
    `▸ 📐 Math — Hurst · Z-Score · Kalman · ATR% · Volume\n` +
    `▸ 🏛 MS — BOS · CHoCH · Liquidity Sweeps · FVG\n` +
    `▸ 🔥 Confluence — 4H + 1H aligned = combined message\n\n` +
    `<b>Gates:</b> 4H conv≥${TF_CONFIG.H4.minConviction} | 1H conv≥${TF_CONFIG.H1.minConviction} | R:R≥2.0\n\n` +
    `<i>Patience. Every alert = money. No noise.</i>\n\n` +
    `<i>${V}</i>`
  );
}
async function resetCooldowns(){
  let n=0;for(const k of Object.keys(state)){if(k.startsWith("acd5_")||k.startsWith("APOS5_")||k.startsWith("ACB5_")||k.startsWith("ACBL5_")){delProp(k);n++;}}
  await tgSend(`✅ Cleared ${n} cooldowns/positions/circuit-breakers.\n\n<i>${V}</i>`);
}

// ── SINGLE PAIR SCAN ──────────────────────────────────────────────────────────
async function scanSingle(symbol){
  const c4h=await fetchKlines(symbol,"H4",TF_CONFIG.H4.vpLookback+20);
  const c1h=await fetchKlines(symbol,"H1",TF_CONFIG.H1.vpLookback+20);
  const vp4h=c4h?computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback):null;
  const vp1h=c1h?computeVolumeProfile(c1h,TF_CONFIG.H1.vpLookback):null;
  const m4h=c4h?runMathEngine(c4h):null,m1h=c1h?runMathEngine(c1h):null;
  const r4h=c4h&&vp4h?detectGWP(c4h,vp4h,computeAVWAP(c4h,TF_CONFIG.H4.avwapLookback),m4h,TF_CONFIG.H4):null;
  const r1h=c1h&&vp1h?detectGWP(c1h,vp1h,computeAVWAP(c1h,TF_CONFIG.H1.avwapLookback),m1h,TF_CONFIG.H1):null;
  const ms4h=c4h&&r4h?analyzeMarketStructure(c4h,r4h.direction,TF_CONFIG.H4):null;
  const ms1h=c1h&&r1h?analyzeMarketStructure(c1h,r1h.direction,TF_CONFIG.H1):null;

  if(r4h&&r1h&&r4h.direction===r1h.direction){
    const conv4h=computeConviction(r4h,m4h,ms4h,"H4",true),conv1h=computeConviction(r1h,m1h,ms1h,"H1",true);
    await tgSend(formatConfluenceSignal(r4h,r1h,symbol,conv4h,conv1h,ms4h,ms1h));
  }else if(r4h){
    const conv=computeConviction(r4h,m4h,ms4h,"H4",false);
    await tgSend(formatSingleSignal(r4h,symbol,conv,ms4h,false));
  }else if(r1h){
    const conv=computeConviction(r1h,m1h,ms1h,"H1",false);
    await tgSend(formatSingleSignal(r1h,symbol,conv,ms1h,true));
  }else{
    await tgSend(`⬜ <b>No GWP — ${symLabel(symbol)}/USDT</b>\n4H: ${vp4h?vp4h.valBandBot.toFixed(4)+" – "+vp4h.valBandTop.toFixed(4):"VP fail"}\n1H: ${vp1h?vp1h.valBandBot.toFixed(4)+" – "+vp1h.valBandTop.toFixed(4):"VP fail"}\nSession: ${isInSession()?"✅ ACTIVE":"💤"}\n\n<i>${V}</i>`);
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
  const match=CONFIG.PAIRS.find(s=>cmd===("/"+s.replace("-USDT","").toLowerCase()));
  if(match){await scanSingle(match);return;}
}

// ── MAIN RUNNER ────────────────────────────────────────────────────────────────
async function runBot(){
  console.log(`\n═══ GWP ALTCOIN v5.0 MONEY PRINTING MACHINE ═══ ${new Date().toISOString()}`);
  console.log(`  Session active: ${isInSession()?"YES":"NO (dead zone)"}`);
  if(!isInSession()){console.log("  💤 SESSION FILTER: dead zone — skip.");return;}

  await checkOpenPositions();
  let fired=0;

  for(const symbol of CONFIG.PAIRS){
    try{
      console.log(`\n▶ ${symbol}`);
      if(isCircuitBroken(symbol)){console.log("  ⛔ Circuit breaker");continue;}

      const c4h=await fetchKlines(symbol,"H4",TF_CONFIG.H4.vpLookback+20);
      const c1h=await fetchKlines(symbol,"H1",TF_CONFIG.H1.vpLookback+20);
      if(!c4h||c4h.length<30){console.log("  No 4H data");continue;}

      const vp4h=computeVolumeProfile(c4h,TF_CONFIG.H4.vpLookback);
      const vp1h=c1h&&c1h.length>=20?computeVolumeProfile(c1h,TF_CONFIG.H1.vpLookback):null;
      const av4h=computeAVWAP(c4h,TF_CONFIG.H4.avwapLookback);
      const av1h=c1h?computeAVWAP(c1h,TF_CONFIG.H1.avwapLookback):null;
      const m4h=runMathEngine(c4h),m1h=c1h?runMathEngine(c1h):null;
      if(!vp4h){console.log("  4H VP failed");continue;}

      console.log(`  4H: ${vp4h.valBandBot.toFixed(4)} – ${vp4h.valBandTop.toFixed(4)} | RSI: ${m4h?m4h.rsi4h.toFixed(1):"?"} | Hurst: ${m4h?m4h.hurst.toFixed(3):"?"} | ATR%: ${m4h?m4h.atrPct:"?"}`);
      if(vp1h)console.log(`  1H: ${vp1h.valBandBot.toFixed(4)} – ${vp1h.valBandTop.toFixed(4)} | VolRatio: ${m1h?m1h.volRatio.toFixed(2):"?"}`);

      const r4h=detectGWP(c4h,vp4h,av4h,m4h,TF_CONFIG.H4);
      const r1h=vp1h?detectGWP(c1h,vp1h,av1h,m1h,TF_CONFIG.H1):null;

      const ms4h=r4h?analyzeMarketStructure(c4h,r4h.direction,TF_CONFIG.H4):null;
      const ms1h=r1h?analyzeMarketStructure(c1h,r1h.direction,TF_CONFIG.H1):null;

      console.log(`  4H: ${r4h?r4h.direction+" score="+r4h.score+" MS="+(ms4h?ms4h.label:"—"):"none"}`);
      console.log(`  1H: ${r1h?r1h.direction+" score="+r1h.score+" MS="+(ms1h?ms1h.label:"—"):"none"}`);

      // ─ CONFLUENCE ──────────────────────────────────────────────────────────
      if(r4h&&r1h&&r4h.direction===r1h.direction){
        const dir=r4h.direction;
        if(isOnCooldown(symbol,dir,"H4")&&isOnCooldown(symbol,dir,"H1")){console.log("  🔒 Both TF cooldowns — skip");continue;}
        const conv4h=computeConviction(r4h,m4h,ms4h,"H4",true);
        const conv1h=computeConviction(r1h,m1h,ms1h,"H1",true);
        console.log(`  🔥🔥 CONFLUENCE! ${dir} | 4H Conv=${conv4h.score} 1H Conv=${conv1h.score}`);
        if(parseFloat(conv4h.score)<TF_CONFIG.H4.minConviction){console.log("  ⚠️ 4H conviction below gate");continue;}
        await tgSend(formatConfluenceSignal(r4h,r1h,symbol,conv4h,conv1h,ms4h,ms1h));
        storePosition(symbol,r4h,conv4h,"H4");storePosition(symbol,r1h,conv1h,"H1");
        setCooldown(symbol,dir,"H4");setCooldown(symbol,dir,"H1");
        trackFired(symbol,r4h,true);fired++;continue;
      }

      // ─ 4H ONLY ─────────────────────────────────────────────────────────────
      if(r4h){
        if(isOnCooldown(symbol,r4h.direction,"H4")){console.log(`  🔒 4H cooldown (${r4h.direction})`);}
        else{
          const conv=computeConviction(r4h,m4h,ms4h,"H4",false);
          console.log(`  4H conv: ${conv.score}/100 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H4.minConviction){
            console.log(`  🔥 4H SIGNAL: ${r4h.direction} | R:R=${r4h.rr}`);
            await tgSend(formatSingleSignal(r4h,symbol,conv,ms4h,false));
            storePosition(symbol,r4h,conv,"H4");setCooldown(symbol,r4h.direction,"H4");
            trackFired(symbol,r4h,false);fired++;
          }else{console.log(`  ⚠️ 4H conviction ${conv.score} below gate`);}
        }
      }

      // ─ 1H ONLY ─────────────────────────────────────────────────────────────
      if(r1h){
        if(isOnCooldown(symbol,r1h.direction,"H4")){console.log(`  🔒 4H cooldown blocks 1H (${r1h.direction})`);}
        else if(isOnCooldown(symbol,r1h.direction,"H1")){console.log(`  🔒 1H cooldown (${r1h.direction})`);}
        else{
          const conv=computeConviction(r1h,m1h,ms1h,"H1",false);
          console.log(`  1H conv: ${conv.score}/100 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H1.minConviction){
            console.log(`  ⚡ 1H SCALP: ${r1h.direction} | R:R=${r1h.rr}`);
            await tgSend(formatSingleSignal(r1h,symbol,conv,ms1h,true));
            storePosition(symbol,r1h,conv,"H1");setCooldown(symbol,r1h.direction,"H1");
            trackFired(symbol,r1h,false);fired++;
          }else{console.log(`  ⚠️ 1H conviction ${conv.score} below gate`);}
        }
      }

    }catch(e){console.error(`ERROR [${symbol}]:`,e.message);}
  }

  state.lastScanTime=new Date().toISOString();
  console.log(`\n═══ Done — ${fired} signal(s) fired. ═══`);
}

// ── ENTRY POINT ────────────────────────────────────────────────────────────────
(async()=>{
  loadState();
  const mode=process.argv[2]||"scan";
  console.log(`GWP Altcoin v5.0 MONEY PRINTING MACHINE | mode: ${mode}`);

  const updates=await pollTelegram();
  if(updates&&updates.length){for(const u of updates){if(u.message&&u.message.text){console.log(`Command: ${u.message.text}`);await handleCommand(u.message.text);}}}

  if(mode==="scan")   await runBot();
  if(mode==="daily")  await sendDailySummary();
  if(mode==="weekly") await sendWeeklySummary();
  if(mode==="health") await sendHealth();

  saveState();
  console.log("State saved → altcoin_state.json");
})();

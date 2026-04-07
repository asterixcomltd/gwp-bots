"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GHOST WICK PROTOCOL — FOREX EDITION  v8.0  MONEY PRINTING MACHINE ELITE MAX™
// Strategy : Ghost Wick Protocol™ (GWP) — 4H + 1H + 15M Triple Timeframe Engine
// Author   : Abdin · asterixcomltd@gmail.com · Asterix.COM Ltd. · Accra, Ghana
// Assets   : XAUUSD · EURUSD · GBPUSD · USDJPY · GBPJPY (Twelve Data)
// Platform : GitHub Actions (Node.js 22+) · forex_state.json persistence
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
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

const V = "GWP Forex v8.0 | Elite Max™ | 24/7 | Asterix.COM | Abdin";

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
  return{atr,hurst,zScore,kalman,atrPct,volRatio,cur:closes[closes.length-1],cycle:calcSineOscillator(closes)};
}

// ── D1 CONTEXT FILTER ─────────────────────────────────────────────────────────
// v8.0: Uses daily close vs daily AVWAP for directional bias (institutional anchor)
// Returns: 'BULL' | 'BEAR' | 'NEUTRAL'
function getD1Bias(d1Candles) {
  if(!d1Candles||d1Candles.length<10) return 'NEUTRAL';
  // Daily AVWAP over last 20 sessions
  const lookback = d1Candles.slice(-20);
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
    // Hurst (mean-reverting = counter-trend ideal)
    if(math.hurst<0.45)      score+=8;
    else if(math.hurst<0.55) score+=4;

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
    if(ms.choch&&ms.choch.detected){
      if((gwp.direction==="BULL"&&ms.choch.toBull)||(gwp.direction==="BEAR"&&ms.choch.toBear))score+=14;
    }
    if(ms.bos){
      if((gwp.direction==="BULL"&&ms.bos.bullBOS)||(gwp.direction==="BEAR"&&ms.bos.bearBOS))score+=8;
    }
    const lsConf=(gwp.direction==="BULL"&&ms.liqSweep&&ms.liqSweep.lowSweep)||(gwp.direction==="BEAR"&&ms.liqSweep&&ms.liqSweep.highSweep);
    if(lsConf)score+=5;
    if(ms.fvg&&ms.fvg.present)score+=3;
  }

  // v8.0: D1 BIAS ALIGNMENT BONUS (+6) — counter-trend into D1 AVWAP is ideal
  // Bonus when D1 bias is OPPOSITE to signal direction (price returning to value)
  if(d1Bias==='BEAR'&&gwp.direction==='BULL') score+=6;  // BULL into D1 bearish = value buy
  if(d1Bias==='BULL'&&gwp.direction==='BEAR') score+=6;  // BEAR into D1 bullish = value sell
  // No penalty for neutral — GWP fires in ranging too

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
    const volumeSpike=hasVolumeSpike(sig,candles,sigIdx,20,tfCfg.volSpikeMult);
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
    let tp1=direction==="BEAR"?entry-Math.abs(entry-tp2)*0.5:entry+Math.abs(tp2-entry)*0.5;
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
    const grade=score>=7.5?"A+★ SUPREME":score>=6.5?"A+ ELITE":score>=5.5?"A SOLID":"B+ VALID";
    if(score<4.5){console.log(`  GWP ${direction} ${tfCfg.label} age=${age}: score=${score.toFixed(1)} below threshold`);continue;}

    const fmt=v=>Number(v).toFixed(dec);
    const tp4=fib.level786?fmt(fib.level786):null;
    const reEntry=isPathB?fmt(direction==="BEAR"?entry+Math.abs(entry-sl)*0.8:entry-Math.abs(entry-sl)*0.8):null;
    console.log(`  ✅ GWP [${tfCfg.label}]: ${direction} age=${age} ${grade} score=${score.toFixed(1)} R:R=${rr.toFixed(2)} SL=${fmt(sl)} (${(Math.abs(entry-sl)/entry*100).toFixed(3)}%) | VolSpike=${volumeSpike} AvwapTrap=${avwapTrap}`);

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
    if(p.tp2hit&&(isL?price>=p.tp3:price<=p.tp3)){msg=`🏅 <b>GWP TP3 HIT! — ${p.label} [${p.tf}]</b> 💎\nFull exit. P&L: <b>+${pnl}%</b>\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,true);}
    if(isL?price<=p.sl:price>=p.sl){const pbN=p.isPathB?`\n⚡ Path B re-entry: <code>${p.reEntry||"zone"}</code>`:"";msg=`❌ <b>GWP SL HIT — ${p.label} [${p.tf}]</b>\n${p.direction} ${f(p.entry)} → SL ${f(p.sl)}\nP&L: <b>${pnl}%</b>${pbN}\n\n<i>${V}</i>`;p.state="CLOSED";await trackClose(p.symbol,p.direction,pnl,false);}
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
async function trackClose(symbol,direction,pnlPct,isWin){
  const wk="F8_W_"+getWeekKey();let w;try{w=JSON.parse(getProp(wk)||"{}");}catch(e){w={};}
  if(isWin){w.wins=(w.wins||0)+1;recordWin(symbol);}else{w.losses=(w.losses||0)+1;await recordLoss(symbol);}
  w.pnl=parseFloat(((w.pnl||0)+parseFloat(pnlPct||0)).toFixed(3));setProp(wk,JSON.stringify(w));
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
  return tags.length?tags.join("  ·  "):"";
}
function checklistBlock(checks){
  return checks.map((c,i)=>`${c.pass?"✅":"⬜"}  ${c.item}`).join("\n");
}

// ── COMPACT SIGNAL FORMAT v8.0 ────────────────────────────────────────────────
// Replaces verbose layout with a clean, scannable card.
// All core data preserved: direction, conviction, R:R, entry/SL/TPs, key tags, MS.
function formatSingleSignal(r,pair,conv,ms,_label,d1Bias='NEUTRAL'){
  const isBull=r.direction==="BULL";
  const dirEmoji=isBull?"🟢":"🔴";
  const dir=isBull?"LONG ▲":"SHORT ▼";
  const tags=confBox(r);
  const tp4Note=r.tp4?`  ·  <b>TP4</b> <code>${r.tp4}</code>`:"";
  const pbNote=r.isPathB?`\n⚠️  <b>PATH B</b>  Re-enter: <code>${r.reEntry}</code>`:"";
  const biasNote=d1Bias!=="NEUTRAL"?`  ·  D1: <b>${d1Bias}</b>`:"";
  const ageNote=r.age>0?`  ·  <i>${r.age}b ago</i>`:"";
  return(
    `\n`+
    `🎯  <b>GWP · ${pair.label} · ${dir} [${r.tfLabel}]</b>\n`+
    `${dirEmoji}  <b>${conv.score}/105</b>  ·  ${conv.grade}  ·  R:R <b>${r.rr}:1</b>${ageNote}${biasNote}\n`+
    `─────────────────────────────\n`+
    `<b>ENTRY</b>  <code>${r.entry}</code>   <b>SL</b>  <code>${r.sl}</code>  (-${r.slPct}%)\n`+
    `<b>TP1</b>  <code>${r.tp1}</code>  ·  <b>TP2</b>  <code>${r.tp2}</code>  ·  <b>TP3</b>  <code>${r.tp3}</code>${tp4Note}\n`+
    `─────────────────────────────\n`+
    (tags?`🔑  ${tags}\n`:"")+
    `  ${ms?ms.label:"⬜ UNCONFIRMED"}   ${msLine(ms,r.direction)}\n`+
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
    await tgSend(formatSingleSignal(r4h,pair,cv,ms4h,"",d1Bias));
  }else if(r1h){
    const cv=computeConviction(r1h,m1h,ms1h,"H1",false,false,d1Bias);
    await tgSend(formatSingleSignal(r1h,pair,cv,ms1h,"⚡ <b>SCALP</b> —",d1Bias));
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
            trackFired(pair,r4h,"CONFLUENCE");fired++;continue;
          }
        }
      }

      // ─ 4H SOLO ────────────────────────────────────────────────────────────
      if(r4h){
        if(isOnCooldown(pair.symbol,r4h.direction,"H4")){console.log("  🔒 4H cooldown");}
        else{
          const conv=computeConviction(r4h,m4h,ms4h,"H4",false,false,d1Bias);
          console.log(`  4H conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H4.minConviction&&!isDuplicate(pair.symbol,r4h.direction,"H4")){
            await tgSend(formatSingleSignal(r4h,pair,conv,ms4h,"",d1Bias));
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
          const conv=computeConviction(r1h,m1h,ms1h,"H1",false,false,d1Bias);
          console.log(`  1H conv: ${conv.score}/105 ${conv.grade}`);
          if(parseFloat(conv.score)>=TF_CONFIG.H1.minConviction&&!isDuplicate(pair.symbol,r1h.direction,"H1")){
            await tgSend(formatSingleSignal(r1h,pair,conv,ms1h,"⚡ <b>SCALP</b> —",d1Bias));
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
            await tgSend(formatSingleSignal(r15m,pair,conv,ms15m,"🔬 <b>MICRO SNIPER</b> —",d1Bias));
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

  if(mode==="scan")   await runBot();
  if(mode==="daily")  await sendDailySummary();
  if(mode==="weekly") await sendWeeklySummary();
  if(mode==="health") await sendHealth();

  saveState();
  console.log("State saved → forex_state.json");
})();

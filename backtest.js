"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GWP BACKTESTER v1.0 — Historical Simulation Engine
// Reuses ALL core logic from crypto_bot.js (GWP detection, conviction scoring,
// market structure, math engine) against real KuCoin historical data.
//
// Usage:  node backtest.js [--pair BTC-USDT] [--days 90] [--tf H4]
//
// © 2026 Asterix.COM Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");

// ─── CLI ARGS ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf("--" + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const BT_PAIR     = getArg("pair", "ALL");  // ALL or specific pair
const BT_DAYS     = parseInt(getArg("days", "90"));
const BT_TF_FOCUS = getArg("tf", "ALL");   // ALL, H4, H1, M15

// ─── CONFIG (mirrors crypto_bot.js v3.4) ─────────────────────────────────────
const TF_CONFIG = {
  H4: {
    tf:"H4", label:"4H",
    vpLookback:100, avwapLookback:30,
    minRR:1.5, minConviction:68, cooldownHrs:3,
    atrBufMult:0.55, maxAge:2, avwapProx:0.004,
    volLookback:20, msLookback:80, swingStrength:3,
    volSpikeMult:1.2,
  },
  H1: {
    tf:"H1", label:"1H",
    vpLookback:60, avwapLookback:20,
    minRR:1.4, minConviction:58, cooldownHrs:2,
    atrBufMult:0.65, maxAge:1, avwapProx:0.005,
    volLookback:20, msLookback:60, swingStrength:3,
    volSpikeMult:1.3,
  },
  M15: {
    tf:"M15", label:"15M",
    vpLookback:40, avwapLookback:12,
    minRR:1.5, minConviction:62, cooldownHrs:1,
    atrBufMult:0.60, maxAge:1, avwapProx:0.006,
    volLookback:15, msLookback:40, swingStrength:2,
    volSpikeMult:1.5,
  },
};

const CONFIG = {
  PAIRS: ["DEXE-USDT","UNI-USDT","COMP-USDT","SOL-USDT","BTC-USDT","LINK-USDT","ETH-USDT","NEAR-USDT","AVAX-USDT","AAVE-USDT","ARB-USDT","INJ-USDT","DOT-USDT","FIL-USDT","SUI-USDT","ATOM-USDT"],  // v3.6: 16 pairs
  CAPITAL: 5, RISK_PCT: 1.5, LEVERAGE: 20,
  VP_ROWS: 24, MIN_WICK_DEPTH_PCT: 0.12, MIN_BODY_GAP_PCT: 0.08,
  VOLUME_FILTER: true,
  CONFLUENCE_CONVICTION_BOOST: 18,
  TRIPLE_TF_BOOST: 25,
  CONFLUENCE_GATE_REDUCTION: 6,
  TP3_MULT: 2.0,
  CRYPTO_MIN_SL_PCT: 1.5,
  ATR_SL_FLOOR_MULT: 1.0,
};

const PAIR_VOL_MULT = {
  "BTC-USDT":0.8, "SOL-USDT":1.5, "DEXE-USDT":1.8, "UNI-USDT":1.3,
  "COMP-USDT":1.3, "LINK-USDT":1.2,
  "ETH-USDT":0.9, "NEAR-USDT":1.4,
  "AVAX-USDT":1.4, "AAVE-USDT":1.3, "ARB-USDT":1.5, "INJ-USDT":1.6,
  "DOT-USDT":1.3, "FIL-USDT":1.5, "SUI-USDT":1.5, "ATOM-USDT":1.2,
};

// ─── HTTP ────────────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((res, rej) => {
    const opts = new URL(url);
    const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search }, r => {
      let d = ""; r.on("data", c => d += c); r.on("end", () => res(d));
    });
    req.on("error", rej);
    req.setTimeout(15000, () => { req.destroy(new Error("Timeout")); });
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── KUCOIN DATA FETCHER (with pagination for long history) ──────────────────
const KU_TF = { H4: "4hour", H1: "1hour", M15: "15min", D1: "1day" };
const TF_MS = { H4: 4*3600000, H1: 3600000, M15: 900000, D1: 86400000 };

async function fetchKlinesRange(symbol, tf, startMs, endMs) {
  // KuCoin returns max 1500 candles. Paginate from startMs to endMs.
  const allCandles = [];
  let cursor = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const batchSize = 1500;

  while (cursor < endSec) {
    const url = `https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]}&symbol=${symbol}&startAt=${cursor}&endAt=${endSec}`;
    try {
      const raw = await httpGet(url);
      const json = JSON.parse(raw);
      if (!json.data || json.data.length === 0) break;
      // KuCoin returns newest first → reverse
      const batch = json.data.reverse().map(c => ({
        t: parseInt(c[0]) * 1000, open: parseFloat(c[1]), close: parseFloat(c[2]),
        high: parseFloat(c[3]), low: parseFloat(c[4]), vol: parseFloat(c[5]),
      }));
      for (const c of batch) {
        if (!allCandles.length || c.t > allCandles[allCandles.length - 1].t) {
          allCandles.push(c);
        }
      }
      if (batch.length < 100) break; // no more data
      cursor = Math.floor(allCandles[allCandles.length - 1].t / 1000) + 1;
    } catch (e) {
      console.error(`  Fetch error ${symbol} ${tf}: ${e.message}`);
      break;
    }
    await sleep(250); // rate limit courtesy
  }
  return allCandles;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE GWP FUNCTIONS (extracted from crypto_bot.js — identical logic)
// ═══════════════════════════════════════════════════════════════════════════════

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
  if(closes.length<120)return 0.5;
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
function calcSineOscillator(closes){
  const p=20;
  if(closes.length<p*2)return{sine:0,leadSine:0,domPeriod:p,expansion:false,contraction:false};
  const win=closes.slice(-(p*2)),mean=win.reduce((a,b)=>a+b,0)/win.length;
  const detr=win.map(c=>c-mean);
  let maxCorr=-Infinity,domPeriod=p;
  for(let lag=8;lag<=p;lag++){
    let corr=0;for(let i=lag;i<detr.length;i++)corr+=detr[i]*detr[i-lag];
    if(corr>maxCorr){maxCorr=corr;domPeriod=lag;}
  }
  const cycPos=(closes.length%domPeriod)/domPeriod;
  const sine=Math.sin(2*Math.PI*cycPos),leadSine=Math.sin(2*Math.PI*cycPos+Math.PI/4);
  const expansion=Math.abs(sine)<0.25&&Math.abs(leadSine)>Math.abs(sine);
  const contraction=Math.abs(sine)>0.70;
  return{sine:parseFloat(sine.toFixed(3)),leadSine:parseFloat(leadSine.toFixed(3)),domPeriod,expansion,contraction};
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
  const atr=calcATR(candles,14),hurst=calcHurst(closes),zScore=calcZScore(closes,20);
  const kalman=kalmanFilter(closes),atrPct=calcATRPercentile(candles,14);
  const volRatio=calcVolumeRatio(candles,20);
  return{atr,hurst,zScore,kalman,atrPct,volRatio,cur:closes[closes.length-1],cycle:calcSineOscillator(closes),candleCount:closes.length};
}

// ─── VOLUME PROFILE + AVWAP ──────────────────────────────────────────────────
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
function hasVolumeSpike(sigCandle,allCandles,sigIdx,volLookback,mult){
  if(!CONFIG.VOLUME_FILTER)return true;
  const start=Math.max(0,sigIdx-volLookback),vols=allCandles.slice(start,sigIdx).map(c=>c.vol||0);
  if(!vols.length)return true;
  const avg=vols.reduce((a,b)=>a+b,0)/vols.length;
  return avg===0?true:(sigCandle.vol||0)>=avg*mult;
}

// ─── MARKET STRUCTURE ────────────────────────────────────────────────────────
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
  const volArr=candles.slice(-20).map(c=>c.vol||0);
  const avgVol=volArr.length?volArr.reduce((a,b)=>a+b,0)/volArr.length:1;
  let bullBOS=false,bearBOS=false,bullLevel=null,bearLevel=null;
  let bullBOSVolConfirmed=false,bearBOSVolConfirmed=false;
  for(const c of last5){
    const volOk=(c.vol||0)>=avgVol*1.2;
    for(const sh of safeHighs){if(c.close>sh.price){bullBOS=true;bullLevel=sh.price;bullBOSVolConfirmed=volOk;break;}}
    for(const sl of safeLows){if(c.close<sl.price){bearBOS=true;bearLevel=sl.price;bearBOSVolConfirmed=volOk;break;}}
  }
  return{bullBOS,bearBOS,bullLevel,bearLevel,bullBOSVolConfirmed,bearBOSVolConfirmed};
}
function detectCHoCH(candles,swings){
  const highs=swings.highs.slice(-4),lows=swings.lows.slice(-4);
  if(highs.length<2||lows.length<2)return{detected:false,toBull:false,toBear:false,prevTrend:null,doubleConfirmed:false};
  const hh=highs[highs.length-1].price>highs[highs.length-2].price;
  const hl=lows[lows.length-1].price  >lows[lows.length-2].price;
  const lh=highs[highs.length-1].price<highs[highs.length-2].price;
  const ll=lows[lows.length-1].price  <lows[lows.length-2].price;
  let prevTrend=null;
  if(hh&&hl)prevTrend="BULL";if(lh&&ll)prevTrend="BEAR";
  if(!prevTrend)return{detected:false,toBull:false,toBear:false,prevTrend:null,doubleConfirmed:false};
  const last5=candles.slice(-5);let toBull=false,toBear=false,doubleConfirmed=false;
  if(prevTrend==="BEAR"){
    const refHigh=swings.highs.filter(s=>s.idx<candles.length-5).slice(-1)[0];
    if(refHigh){const crosses=last5.filter(c=>c.close>refHigh.price);if(crosses.length>=1)toBull=true;
      for(let i=0;i<last5.length-1;i++){if(last5[i].close>refHigh.price&&last5[i+1].close>refHigh.price){doubleConfirmed=true;break;}}}
  }
  if(prevTrend==="BULL"){
    const refLow=swings.lows.filter(s=>s.idx<candles.length-5).slice(-1)[0];
    if(refLow){const crosses=last5.filter(c=>c.close<refLow.price);if(crosses.length>=1)toBear=true;
      for(let i=0;i<last5.length-1;i++){if(last5[i].close<refLow.price&&last5[i+1].close<refLow.price){doubleConfirmed=true;break;}}}
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
    for(const sl of safeLows){if(c.low<sl.price&&c.close>sl.price){lowSweep=true;lowLevel=sl.price;break;}}
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
  if(!candles||candles.length<20)return{confirmed:false,strength:0,bos:null,choch:null,liqSweep:null,fvg:null};
  const slice=candles.slice(-Math.min(tfCfg.msLookback,candles.length));
  const swings=detectSwings(slice,tfCfg.swingStrength);
  const bos=detectBOS(slice,swings),choch=detectCHoCH(slice,swings);
  const liqSweep=detectLiquiditySweep(slice,swings),fvg=detectFVG(slice,direction);
  let confirmed=false,strength=0;
  if(direction==="BULL"){
    if(choch.detected&&choch.toBull){confirmed=true;strength=3;}
    else if(bos.bullBOS){confirmed=true;strength=2;}
    else if(liqSweep.lowSweep){confirmed=true;strength=2;}
    else if(fvg.present){confirmed=true;strength=1;}
  }
  if(direction==="BEAR"){
    if(choch.detected&&choch.toBear){confirmed=true;strength=3;}
    else if(bos.bearBOS){confirmed=true;strength=2;}
    else if(liqSweep.highSweep){confirmed=true;strength=2;}
    else if(fvg.present){confirmed=true;strength=1;}
  }
  return{confirmed,strength,bos,choch,liqSweep,fvg,swings};
}

// ─── WYCKOFF ─────────────────────────────────────────────────────────────────
function detectWyckoff(candles,direction){
  if(candles.length<30)return{spring:false,upthrust:false};
  const lookback=candles.slice(-30,-1);
  const rangeHigh=Math.max(...lookback.map(c=>c.high));
  const rangeLow =Math.min(...lookback.map(c=>c.low));
  const sig=candles[candles.length-2];
  const spring  =sig.low <rangeLow *0.9995&&sig.close>rangeLow;
  const upthrust=sig.high>rangeHigh*1.0005&&sig.close<rangeHigh;
  return{spring,upthrust};
}

// ─── D1 BIAS (v3.4: 1-candle) ───────────────────────────────────────────────
function getD1Bias(d1Candles){
  if(!d1Candles||d1Candles.length<2)return 'NEUTRAL';
  const yesterday=d1Candles[d1Candles.length-1];
  const bodyPct=Math.abs(yesterday.close-yesterday.open)/yesterday.open;
  if(bodyPct<0.003)return 'NEUTRAL';
  return yesterday.close>yesterday.open?'BULL':'BEAR';
}

// ─── ZONE TOUCH COUNT ────────────────────────────────────────────────────────
function getZoneTouchCount(candles,bBot,bTop){
  const lookback=candles.slice(-50);
  let touches=0;
  for(const c of lookback){if(c.high>=bBot&&c.low<=bTop)touches++;}
  return touches;
}

// ─── CORE GWP DETECTOR (for backtest — no session vol, uses static mult) ─────
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

    const staleZone=atr*(tfCfg.tf==="M15"?0.3:0.5);
    if(direction==="BEAR"&&cur.close<=(bMid-staleZone))continue;
    if(direction==="BULL"&&cur.close>=(bMid+staleZone))continue;

    let avwapTrap=false;
    if(avwap){const prox=tfCfg.avwapProx;avwapTrap=Math.abs(sig.high-avwap)/avwap<=prox||Math.abs(sig.low-avwap)/avwap<=prox;}

    const sigIdx=n-2-age;
    // In backtest: use base volSpikeMult (no session adjustment — historical testing)
    const volumeSpike=hasVolumeSpike(sig,candles,sigIdx,tfCfg.volLookback,tfCfg.volSpikeMult);
    const momentumBurst=calcMomentumBurst(candles,sigIdx);
    const zoneRevisit=calcZoneRevisit(candles,bBot,bTop);
    const wyckoff=detectWyckoff(candles,direction);

    const bodyGapPct=(bodyGap/bH)*100,isPathB=bodyGapPct<35;

    if(!volumeSpike&&!avwapTrap)continue;

    // SL computation — mirrors crypto_bot.js exactly
    const sigCandleRange=sig.high-sig.low,rangeBuffer=sigCandleRange*0.15;
    let sl;
    if(direction==="BEAR"){const slBase=Math.max(sig.high+atrBuf,sig.high+rangeBuffer);sl=isPathB?slBase+(slBase-cur.close)*0.30:slBase;}
    else{const slBase=Math.min(sig.low-atrBuf,sig.low-rangeBuffer);sl=isPathB?slBase-(cur.close-slBase)*0.30:slBase;}

    const pairVolMult=PAIR_VOL_MULT[symbol]||1.0;
    const minSlDist=(cur.close*CONFIG.CRYPTO_MIN_SL_PCT*pairVolMult/100);
    if(direction==="BEAR"&&(sl-cur.close)<minSlDist)sl=cur.close+minSlDist;
    if(direction==="BULL"&&(cur.close-sl)<minSlDist)sl=cur.close-minSlDist;

    const atrFloor=atr*CONFIG.ATR_SL_FLOOR_MULT;
    if(direction==="BEAR"&&(sl-cur.close)<atrFloor)sl=cur.close+atrFloor;
    if(direction==="BULL"&&(cur.close-sl)<atrFloor)sl=cur.close-atrFloor;
    if(math&&math.atrPct>80){const boost=Math.abs(sl-cur.close)*0.20;sl=direction==="BEAR"?sl+boost:sl-boost;}

    const entry=cur.close,tp2=bMid;
    const tp2Dist=Math.abs(entry-tp2);
    let tp1=direction==="BEAR"?entry-tp2Dist*0.40:entry+tp2Dist*0.40;
    const risk=Math.abs(entry-sl);if(risk<=0)continue;
    let rr=Math.abs(entry-tp2)/risk;
    if(rr<tfCfg.minRR){tp1=direction==="BEAR"?bBot:bTop;rr=Math.abs(entry-tp2)/risk;}
    if(rr<tfCfg.minRR)continue;

    const tp3=direction==="BEAR"?entry-Math.abs(entry-tp2)*CONFIG.TP3_MULT:entry+Math.abs(tp2-entry)*CONFIG.TP3_MULT;

    const agePenalty=age*0.75;
    const checks=[true,true,bodyGapPct>=8,(wickDepth/bH)>=CONFIG.MIN_WICK_DEPTH_PCT,avwapTrap,volumeSpike,rr>=tfCfg.minRR,true];
    const rawScore=checks.filter(c=>c).length;
    const score=Math.max(0,rawScore-agePenalty);
    const zoneTouches=getZoneTouchCount(candles,bBot,bTop);
    const touchPenalty=zoneTouches>=3?(zoneTouches>=5?2.0:1.0):0;
    const adjustedScore=Math.max(0,score-touchPenalty);
    if(adjustedScore<4.5)continue;

    return{
      direction,score:adjustedScore.toFixed(1),age,isPathB,volumeSpike,avwapTrap,
      momentumBurst,zoneRevisit,wyckoff,
      entry,sl,tp1,tp2,tp3,rr,
      slPct:Math.abs(entry-sl)/entry*100,
      tp1Pct:Math.abs(entry-tp1)/entry*100,
      tp2Pct:Math.abs(entry-tp2)/entry*100,
      zoneTouches,
      signalTime:new Date(sig.t).toISOString(),
    };
  }
  return null;
}

// ─── CONVICTION ENGINE (identical to crypto_bot.js v3.4) ─────────────────────
function computeConviction(gwp,math,ms,tfKey,isConfluence=false,isTriple=false,d1Bias='NEUTRAL',candleHour=12){
  let score=0;
  const gs=parseFloat(gwp.score);score+=gs>=7.5?32:gs>=6.5?26:gs>=5.5?18:10;
  if(gwp.avwapTrap)score+=12;
  if(gwp.volumeSpike)score+=6;
  if(!gwp.isPathB)score+=4;
  if(gwp.momentumBurst)score+=4;
  if(gwp.zoneRevisit)score+=3;

  if(math){
    const hurstReliable=math.candleCount&&math.candleCount>=120;
    if(hurstReliable){if(math.hurst<0.45)score+=8;else if(math.hurst<0.55)score+=4;}
    else{if(math.volRatio>=1.5)score+=2;}

    const z=math.zScore;
    if(gwp.direction==="BULL"&&z.extremeLow)score+=7;
    if(gwp.direction==="BEAR"&&z.extremeHigh)score+=7;
    if(gwp.direction==="BULL"&&z.mildLow)score+=3;
    if(gwp.direction==="BEAR"&&z.mildHigh)score+=3;

    if(math.kalman){
      const rev=(gwp.direction==="BULL"&&!math.kalman.bullish)||(gwp.direction==="BEAR"&&math.kalman.bullish);
      if(rev)score+=6;
    }

    if(math.atrPct>=25&&math.atrPct<=75)score+=4;
    else if(math.atrPct>=15&&math.atrPct<=85)score+=2;

    if(math.volRatio>=2.0)score+=4;
    else if(math.volRatio>=1.5)score+=3;
    else if(math.volRatio>=1.2)score+=1;
  }

  if(gwp.wyckoff){
    if(gwp.direction==="BULL"&&gwp.wyckoff.spring)score+=10;
    if(gwp.direction==="BEAR"&&gwp.wyckoff.upthrust)score+=10;
  }

  if(math&&math.cycle&&math.cycle.contraction)score+=8;

  if(ms){
    if(ms.choch&&ms.choch.detected){
      const chochDir=(gwp.direction==="BULL"&&ms.choch.toBull)||(gwp.direction==="BEAR"&&ms.choch.toBear);
      if(chochDir)score+=ms.choch.doubleConfirmed?16:10;
    }
    if(ms.bos){
      const bullOk=gwp.direction==="BULL"&&ms.bos.bullBOS;
      const bearOk=gwp.direction==="BEAR"&&ms.bos.bearBOS;
      if(bullOk)score+=ms.bos.bullBOSVolConfirmed?8:3;
      if(bearOk)score+=ms.bos.bearBOSVolConfirmed?8:3;
    }
    if(ms.liqSweep){
      const bullLS=gwp.direction==="BULL"&&ms.liqSweep.lowSweep;
      const bearLS=gwp.direction==="BEAR"&&ms.liqSweep.highSweep;
      if(bullLS||bearLS){
        const inZone=gwp.avwapTrap||gwp.zoneRevisit;
        const zoneWeak=gwp.zoneTouches>=3;
        score+=inZone&&!zoneWeak?10:inZone?5:4;
      }
    }
    if(ms.fvg&&ms.fvg.present)score+=3;
  }

  // D1 bias scoring
  if(d1Bias==='BULL'&&gwp.direction==='BULL')score+=8;
  if(d1Bias==='BEAR'&&gwp.direction==='BEAR')score+=8;
  if(d1Bias==='BULL'&&gwp.direction==='BEAR')score-=12;
  if(d1Bias==='BEAR'&&gwp.direction==='BULL')score-=12;

  // Session bonus (use candle hour for historical accuracy)
  const h = candleHour;
  if(h>=12&&h<=16)score+=3;
  else if(h>=7&&h<12)score+=1;
  else if(h>=0&&h<7)score-=2;

  // Vol regime
  if(math&&math.atrPct<15)score-=4;
  if(math&&math.atrPct>85)score+=2;

  if(isTriple) score+=CONFIG.TRIPLE_TF_BOOST;
  else if(isConfluence)score+=CONFIG.CONFLUENCE_CONVICTION_BOOST;

  score=Math.max(0,Math.min(score,123));
  const grade=score>=108?"SUPREME★★★★":score>=96?"SUPREME★★★":score>=84?"SUPREME★★":score>=72?"SUPREME★":score>=58?"ELITE":score>=50?"SOLID":"MARGINAL";
  return{score,grade};
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST TRADE SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════════

function simulateTrade(signal, futureCandles) {
  // Walk forward through future candles checking TP1/TP2/TP3/SL hits
  const isLong = signal.direction === "BULL";
  const entry = signal.entry;
  let sl = signal.sl;
  let tp1Hit = false, tp2Hit = false, tp3Hit = false;
  let exitPrice = null, exitReason = null, exitBar = 0;
  let sizeRemaining = 1.0;
  let totalPnlPct = 0;

  for (let i = 0; i < futureCandles.length; i++) {
    const c = futureCandles[i];
    const hi = c.high, lo = c.low;

    // Check SL first (worst case)
    const slHit = isLong ? lo <= sl : hi >= sl;
    // Check TPs
    const tp1Check = !tp1Hit && (isLong ? hi >= signal.tp1 : lo <= signal.tp1);
    const tp2Check = !tp2Hit && (isLong ? hi >= signal.tp2 : lo <= signal.tp2);
    const tp3Check = tp2Hit && (isLong ? hi >= signal.tp3 : lo <= signal.tp3);

    if (tp1Check && !slHit) {
      tp1Hit = true;
      const pnl = isLong ? (signal.tp1 - entry) / entry * 100 : (entry - signal.tp1) / entry * 100;
      totalPnlPct += pnl * 0.40; // 40% exit
      sizeRemaining = 0.60;
      sl = entry; // move to BE
    }

    if (tp2Check && !slHit) {
      tp2Hit = true;
      const pnl = isLong ? (signal.tp2 - entry) / entry * 100 : (entry - signal.tp2) / entry * 100;
      totalPnlPct += pnl * 0.40; // 40% exit
      sizeRemaining = 0.20;
      sl = signal.tp1; // trail to TP1
    }

    if (tp3Check) {
      const pnl = isLong ? (signal.tp3 - entry) / entry * 100 : (entry - signal.tp3) / entry * 100;
      totalPnlPct += pnl * 0.20; // final 20%
      tp3Hit = true;
      exitPrice = signal.tp3;
      exitReason = "TP3";
      exitBar = i + 1;
      return { tp1Hit, tp2Hit, tp3Hit, totalPnlPct, exitPrice, exitReason, exitBar, sizeRemaining: 0 };
    }

    if (slHit) {
      if (tp1Hit || tp2Hit) {
        // Partial profit already taken
        const slPnl = isLong ? (sl - entry) / entry * 100 : (entry - sl) / entry * 100;
        totalPnlPct += slPnl * sizeRemaining;
      } else {
        // Full SL hit
        const slPnl = isLong ? (sl - entry) / entry * 100 : (entry - sl) / entry * 100;
        totalPnlPct = slPnl;
      }
      exitPrice = sl;
      exitReason = tp2Hit ? "SL@TP1" : tp1Hit ? "SL@BE" : "SL";
      exitBar = i + 1;
      return { tp1Hit, tp2Hit, tp3Hit, totalPnlPct, exitPrice, exitReason, exitBar, sizeRemaining: 0 };
    }
  }

  // Still open after all candles — mark to market
  const lastClose = futureCandles[futureCandles.length - 1].close;
  const mtmPnl = isLong ? (lastClose - entry) / entry * 100 : (entry - lastClose) / entry * 100;
  totalPnlPct += mtmPnl * sizeRemaining;
  return { tp1Hit, tp2Hit, tp3Hit: false, totalPnlPct, exitPrice: lastClose, exitReason: "OPEN", exitBar: futureCandles.length, sizeRemaining };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BACKTEST LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function runBacktest() {
  const startTime = Date.now();
  const endMs = Date.now();
  const startMs = endMs - BT_DAYS * 86400000;
  const pairs = BT_PAIR === "ALL" ? CONFIG.PAIRS : [BT_PAIR];
  const tfs = BT_TF_FOCUS === "ALL" ? ["H4", "H1", "M15"] : [BT_TF_FOCUS];

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  GWP BACKTESTER v1.0 — ${BT_DAYS}-DAY HISTORICAL SIMULATION`);
  console.log(`  Pairs: ${pairs.join(", ")}  |  Timeframes: ${tfs.join(", ")}`);
  console.log(`  Period: ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`);
  console.log(`${"═".repeat(70)}\n`);

  const allTrades = [];
  const tradesByPair = {};
  const tradesByTf = {};
  const tradesByGrade = {};
  const convictionBuckets = {};
  let totalSignals = 0, passedGate = 0, blockedByConv = 0, blockedByRR = 0;

  for (const symbol of pairs) {
    console.log(`\n▶ Fetching ${symbol} historical data...`);
    tradesByPair[symbol] = [];

    // Fetch all timeframe data + D1
    const dataPromises = {};
    for (const tf of tfs) {
      dataPromises[tf] = fetchKlinesRange(symbol, tf, startMs - TF_MS[tf] * 200, endMs);
    }
    dataPromises.D1 = fetchKlinesRange(symbol, "D1", startMs - 86400000 * 60, endMs);

    const data = {};
    for (const [k, p] of Object.entries(dataPromises)) {
      data[k] = await p;
      console.log(`  ${k}: ${data[k].length} candles fetched`);
    }

    // Walk through each TF
    for (const tf of tfs) {
      const candles = data[tf];
      const d1Candles = data.D1;
      if (!candles || candles.length < 160) {
        console.log(`  ⚠️ ${tf}: insufficient data (${candles ? candles.length : 0} candles)`);
        continue;
      }
      if (!tradesByTf[tf]) tradesByTf[tf] = [];

      const tfCfg = TF_CONFIG[tf];
      const windowSize = tfCfg.vpLookback + 50;
      const cooldowns = {}; // symbol_direction_tf -> last fire timestamp

      // Step size: H4=1 (check every candle), H1=2 (every other), M15=4 (every 4th)
      // This is realistic: bots run every 15min for M15, every hour for H1, every 4h for H4
      const stepSize = tf === "M15" ? 4 : tf === "H1" ? 2 : 1;

      // Slide window through candles
      for (let i = windowSize; i < candles.length - 5; i += stepSize) {
        const window = candles.slice(Math.max(0, i - windowSize), i + 1);
        const cur = window[window.length - 1];

        // Find D1 candles up to this point
        const d1Window = d1Candles.filter(d => d.t < cur.t);
        const d1Bias = getD1Bias(d1Window.length >= 2 ? d1Window.slice(-5) : null);

        // Cooldown check
        const coolKey = `${symbol}_${tf}`;
        if (cooldowns[coolKey] && (cur.t - cooldowns[coolKey]) < tfCfg.cooldownHrs * 3600000) continue;

        // Compute indicators
        const vp = computeVolumeProfile(window, tfCfg.vpLookback);
        if (!vp) continue;
        const avwap = computeAVWAP(window, tfCfg.avwapLookback);
        const math = runMathEngine(window);

        // Detect GWP
        const gwp = detectGWP(window, vp, avwap, math, tfCfg, symbol);
        if (!gwp) continue;
        totalSignals++;

        // Market structure
        const ms = analyzeMarketStructure(window, gwp.direction, tfCfg);

        // Conviction
        const candleHour = new Date(cur.t).getUTCHours();
        const conv = computeConviction(gwp, math, ms, tf, false, false, d1Bias, candleHour);

        // Gate check
        if (conv.score < tfCfg.minConviction) {
          blockedByConv++;
          continue;
        }

        // v3.6: D1 counter-trend hard block for conv < 78 (raised from 72 — v3.5 leakers at 74-75)
        const isCounterTrend = (d1Bias==='BULL'&&gwp.direction==='BEAR')||(d1Bias==='BEAR'&&gwp.direction==='BULL');
        if (isCounterTrend && conv.score < 78) {
          blockedByConv++;
          continue;
        }
        passedGate++;

        // Set cooldown
        cooldowns[coolKey] = cur.t;
        const dirKey = `${symbol}_${gwp.direction}_${tf}`;
        cooldowns[dirKey] = cur.t;

        // Simulate trade with future candles
        const futureStart = i + 1;
        const futureEnd = Math.min(candles.length, futureStart + 100); // max 100 bars forward
        const futureCandles = candles.slice(futureStart, futureEnd);
        if (futureCandles.length < 3) continue;

        const result = simulateTrade(gwp, futureCandles);

        const trade = {
          symbol,
          tf,
          direction: gwp.direction,
          entry: gwp.entry,
          sl: gwp.sl,
          tp1: gwp.tp1,
          tp2: gwp.tp2,
          tp3: gwp.tp3,
          rr: gwp.rr,
          conviction: conv.score,
          grade: conv.grade,
          d1Bias,
          d1Aligned: (d1Bias === gwp.direction) || d1Bias === 'NEUTRAL',
          signalTime: new Date(cur.t).toISOString(),
          ...result,
        };

        allTrades.push(trade);
        tradesByPair[symbol].push(trade);
        tradesByTf[tf].push(trade);

        // Bucket by conviction
        const convBucket = Math.floor(conv.score / 10) * 10;
        const bucketKey = `${convBucket}-${convBucket + 9}`;
        if (!convictionBuckets[bucketKey]) convictionBuckets[bucketKey] = [];
        convictionBuckets[bucketKey].push(trade);

        // Bucket by grade
        if (!tradesByGrade[conv.grade]) tradesByGrade[conv.grade] = [];
        tradesByGrade[conv.grade].push(trade);
      }
    }
    await sleep(500); // rate limit between pairs
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESULTS & ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  GWP BACKTEST RESULTS — ${BT_DAYS} DAYS`);
  console.log(`  ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`);
  console.log(`  Runtime: ${elapsed}s`);
  console.log(`${"═".repeat(70)}\n`);

  // ─── SIGNAL FUNNEL ─────────────────────────────────────────────────────────
  console.log(`📊 SIGNAL FUNNEL:`);
  console.log(`  Raw GWP detections:    ${totalSignals}`);
  console.log(`  Blocked by conviction: ${blockedByConv} (${totalSignals ? ((blockedByConv/totalSignals)*100).toFixed(1) : 0}%)`);
  console.log(`  Passed gate → traded:  ${passedGate} (${totalSignals ? ((passedGate/totalSignals)*100).toFixed(1) : 0}%)`);
  console.log();

  if (!allTrades.length) {
    console.log("❌ NO TRADES GENERATED. Possible issues:");
    console.log("  - Conviction gates too high for the data period");
    console.log("  - GWP detection criteria too strict");
    console.log("  - Insufficient data fetched");
    return;
  }

  // ─── OVERALL METRICS ───────────────────────────────────────────────────────
  const closedTrades = allTrades.filter(t => t.exitReason !== "OPEN");
  const wins = closedTrades.filter(t => t.totalPnlPct > 0);
  const losses = closedTrades.filter(t => t.totalPnlPct <= 0);
  const totalPnl = closedTrades.reduce((a, t) => a + t.totalPnlPct, 0);
  const avgPnl = closedTrades.length ? totalPnl / closedTrades.length : 0;
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.totalPnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.totalPnlPct, 0) / losses.length : 0;
  const grossProfit = wins.reduce((a, t) => a + t.totalPnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.totalPnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const winRate = closedTrades.length ? (wins.length / closedTrades.length * 100) : 0;
  const tp1Rate = closedTrades.filter(t => t.tp1Hit).length / (closedTrades.length || 1) * 100;
  const tp2Rate = closedTrades.filter(t => t.tp2Hit).length / (closedTrades.length || 1) * 100;
  const tp3Rate = closedTrades.filter(t => t.tp3Hit).length / (closedTrades.length || 1) * 100;

  // Max drawdown
  let peak = 0, maxDD = 0, running = 0;
  const equity = [0];
  for (const t of closedTrades) {
    running += t.totalPnlPct;
    equity.push(running);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }

  // Expectancy
  const expectancy = closedTrades.length
    ? (winRate/100 * avgWin) + ((1 - winRate/100) * avgLoss)
    : 0;

  // Avg bars held
  const avgBarsHeld = closedTrades.length ? closedTrades.reduce((a, t) => a + t.exitBar, 0) / closedTrades.length : 0;

  console.log(`${"─".repeat(50)}`);
  console.log(`📈 OVERALL PERFORMANCE (${closedTrades.length} closed trades)`);
  console.log(`${"─".repeat(50)}`);
  console.log(`  Win Rate:       ${winRate.toFixed(1)}%  (${wins.length}W / ${losses.length}L)`);
  console.log(`  TP1 Hit Rate:   ${tp1Rate.toFixed(1)}%`);
  console.log(`  TP2 Hit Rate:   ${tp2Rate.toFixed(1)}%`);
  console.log(`  TP3 Hit Rate:   ${tp3Rate.toFixed(1)}%`);
  console.log(`  Total P&L:      ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%`);
  console.log(`  Avg P&L/trade:  ${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(3)}%`);
  console.log(`  Avg Win:        +${avgWin.toFixed(3)}%`);
  console.log(`  Avg Loss:       ${avgLoss.toFixed(3)}%`);
  console.log(`  Profit Factor:  ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}`);
  console.log(`  Expectancy:     ${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(4)}% per trade`);
  console.log(`  Max Drawdown:   -${maxDD.toFixed(2)}%`);
  console.log(`  Avg Bars Held:  ${avgBarsHeld.toFixed(1)}`);
  console.log(`  Still Open:     ${allTrades.filter(t => t.exitReason === "OPEN").length}`);
  console.log();

  // ─── BY PAIR ───────────────────────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`📊 PERFORMANCE BY PAIR`);
  console.log(`${"─".repeat(50)}`);
  console.log(`${"Pair".padEnd(14)} ${"Trades".padStart(7)} ${"WR%".padStart(7)} ${"TP1%".padStart(7)} ${"P&L%".padStart(9)} ${"PF".padStart(6)} ${"AvgConv".padStart(8)}`);
  for (const [sym, trades] of Object.entries(tradesByPair)) {
    const ct = trades.filter(t => t.exitReason !== "OPEN");
    if (!ct.length) { console.log(`  ${sym.padEnd(12)}: no closed trades`); continue; }
    const w = ct.filter(t => t.totalPnlPct > 0);
    const l = ct.filter(t => t.totalPnlPct <= 0);
    const pnl = ct.reduce((a, t) => a + t.totalPnlPct, 0);
    const gp = w.reduce((a, t) => a + t.totalPnlPct, 0);
    const gl = Math.abs(l.reduce((a, t) => a + t.totalPnlPct, 0));
    const pf = gl > 0 ? gp / gl : gp > 0 ? 99.9 : 0;
    const wr = (w.length / ct.length * 100);
    const tp1 = ct.filter(t => t.tp1Hit).length / ct.length * 100;
    const avgC = ct.reduce((a, t) => a + t.conviction, 0) / ct.length;
    console.log(`${sym.padEnd(14)} ${String(ct.length).padStart(7)} ${wr.toFixed(1).padStart(7)} ${tp1.toFixed(0).padStart(7)} ${(pnl >= 0 ? "+" : "") + pnl.toFixed(2).padStart(pnl >= 0 ? 8 : 9)} ${pf.toFixed(2).padStart(6)} ${avgC.toFixed(1).padStart(8)}`);
  }
  console.log();

  // ─── BY TIMEFRAME ──────────────────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`📊 PERFORMANCE BY TIMEFRAME`);
  console.log(`${"─".repeat(50)}`);
  for (const [tf, trades] of Object.entries(tradesByTf)) {
    const ct = trades.filter(t => t.exitReason !== "OPEN");
    if (!ct.length) continue;
    const w = ct.filter(t => t.totalPnlPct > 0);
    const pnl = ct.reduce((a, t) => a + t.totalPnlPct, 0);
    const wr = w.length / ct.length * 100;
    const tp1 = ct.filter(t => t.tp1Hit).length / ct.length * 100;
    const tp2 = ct.filter(t => t.tp2Hit).length / ct.length * 100;
    console.log(`  ${tf}: ${ct.length} trades | WR: ${wr.toFixed(1)}% | TP1: ${tp1.toFixed(0)}% | TP2: ${tp2.toFixed(0)}% | P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
  }
  console.log();

  // ─── BY CONVICTION BUCKET ──────────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`🧠 PERFORMANCE BY CONVICTION BUCKET`);
  console.log(`${"─".repeat(50)}`);
  const sortedBuckets = Object.entries(convictionBuckets).sort((a, b) => {
    const aNum = parseInt(a[0]);
    const bNum = parseInt(b[0]);
    return aNum - bNum;
  });
  console.log(`${"Bucket".padEnd(12)} ${"Trades".padStart(7)} ${"WR%".padStart(7)} ${"TP1%".padStart(7)} ${"AvgPnL".padStart(9)} ${"TotalPnL".padStart(10)}`);
  for (const [bucket, trades] of sortedBuckets) {
    const ct = trades.filter(t => t.exitReason !== "OPEN");
    if (!ct.length) continue;
    const w = ct.filter(t => t.totalPnlPct > 0);
    const wr = w.length / ct.length * 100;
    const pnl = ct.reduce((a, t) => a + t.totalPnlPct, 0);
    const avg = pnl / ct.length;
    const tp1 = ct.filter(t => t.tp1Hit).length / ct.length * 100;
    console.log(`${bucket.padEnd(12)} ${String(ct.length).padStart(7)} ${wr.toFixed(1).padStart(7)} ${tp1.toFixed(0).padStart(7)} ${(avg >= 0 ? "+" : "") + avg.toFixed(3).padStart(avg >= 0 ? 8 : 9)} ${(pnl >= 0 ? "+" : "") + pnl.toFixed(2).padStart(pnl >= 0 ? 9 : 10)}`);
  }
  console.log();

  // ─── BY D1 ALIGNMENT ──────────────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`📅 D1 BIAS ALIGNMENT ANALYSIS`);
  console.log(`${"─".repeat(50)}`);
  const aligned = closedTrades.filter(t => t.d1Aligned);
  const counter = closedTrades.filter(t => !t.d1Aligned);
  if (aligned.length) {
    const aw = aligned.filter(t => t.totalPnlPct > 0);
    const ap = aligned.reduce((a, t) => a + t.totalPnlPct, 0);
    console.log(`  D1 Aligned:      ${aligned.length} trades | WR: ${(aw.length/aligned.length*100).toFixed(1)}% | P&L: ${ap >= 0 ? "+" : ""}${ap.toFixed(2)}%`);
  }
  if (counter.length) {
    const cw = counter.filter(t => t.totalPnlPct > 0);
    const cp = counter.reduce((a, t) => a + t.totalPnlPct, 0);
    console.log(`  D1 Counter:      ${counter.length} trades | WR: ${(cw.length/counter.length*100).toFixed(1)}% | P&L: ${cp >= 0 ? "+" : ""}${cp.toFixed(2)}%`);
  }
  console.log();

  // ─── EXIT REASON DISTRIBUTION ──────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`🚪 EXIT REASON DISTRIBUTION`);
  console.log(`${"─".repeat(50)}`);
  const exitReasons = {};
  for (const t of closedTrades) {
    exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(exitReasons).sort((a, b) => b[1] - a[1])) {
    const trades = closedTrades.filter(t => t.exitReason === reason);
    const pnl = trades.reduce((a, t) => a + t.totalPnlPct, 0);
    console.log(`  ${reason.padEnd(10)}: ${String(count).padStart(5)} trades | P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
  }
  console.log();

  // ─── DIRECTION ANALYSIS ────────────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`🔄 DIRECTION ANALYSIS`);
  console.log(`${"─".repeat(50)}`);
  for (const dir of ["BULL", "BEAR"]) {
    const dt = closedTrades.filter(t => t.direction === dir);
    if (!dt.length) continue;
    const dw = dt.filter(t => t.totalPnlPct > 0);
    const dp = dt.reduce((a, t) => a + t.totalPnlPct, 0);
    console.log(`  ${dir}: ${dt.length} trades | WR: ${(dw.length / dt.length * 100).toFixed(1)}% | P&L: ${dp >= 0 ? "+" : ""}${dp.toFixed(2)}%`);
  }
  console.log();

  // ─── BEST/WORST TRADES ─────────────────────────────────────────────────────
  console.log(`${"─".repeat(50)}`);
  console.log(`🏆 BEST & WORST TRADES`);
  console.log(`${"─".repeat(50)}`);
  const sorted = [...closedTrades].sort((a, b) => b.totalPnlPct - a.totalPnlPct);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();
  console.log(`  TOP 5:`);
  for (const t of top5) {
    console.log(`    +${t.totalPnlPct.toFixed(3)}% | ${t.symbol} ${t.direction} [${t.tf}] | Conv: ${t.conviction} | ${t.signalTime.slice(0, 10)} | ${t.exitReason}`);
  }
  console.log(`  BOTTOM 5:`);
  for (const t of bottom5) {
    console.log(`    ${t.totalPnlPct.toFixed(3)}% | ${t.symbol} ${t.direction} [${t.tf}] | Conv: ${t.conviction} | ${t.signalTime.slice(0, 10)} | ${t.exitReason}`);
  }
  console.log();

  // ─── GAP ANALYSIS ──────────────────────────────────────────────────────────
  console.log(`${"═".repeat(70)}`);
  console.log(`  🔍 GAP ANALYSIS & RECOMMENDATIONS`);
  console.log(`${"═".repeat(70)}\n`);

  const gaps = [];

  // 1. Win rate check
  if (winRate < 50) {
    gaps.push({
      severity: "HIGH",
      issue: `Win rate ${winRate.toFixed(1)}% is below 50%`,
      suggestion: "Consider raising conviction gates or tightening TP1 distance (currently 40% of TP2 dist)"
    });
  }

  // 2. TP1 hit rate
  if (tp1Rate < 60) {
    gaps.push({
      severity: "HIGH",
      issue: `TP1 hit rate ${tp1Rate.toFixed(1)}% — most trades never reach first target`,
      suggestion: "TP1 distance may still be too far. Consider 30% instead of 40% of TP2 distance."
    });
  }

  // 3. Profit factor
  if (profitFactor < 1.2) {
    gaps.push({
      severity: "HIGH",
      issue: `Profit factor ${profitFactor.toFixed(2)} is thin — barely profitable`,
      suggestion: "Review SL sizing. ATR_SL_FLOOR_MULT or CRYPTO_MIN_SL_PCT may be creating SLs too far from entry."
    });
  }

  // 4. D1 counter-trend performance
  if (counter.length >= 3) {
    const counterWR = counter.filter(t => t.totalPnlPct > 0).length / counter.length * 100;
    if (counterWR < 35) {
      gaps.push({
        severity: "MEDIUM",
        issue: `D1 counter-trend trades have ${counterWR.toFixed(1)}% WR (${counter.length} trades)`,
        suggestion: "D1 penalty of -12 may not be enough. Consider -15 or adding a hard block for conv < 72 counter-trend."
      });
    }
  }

  // 5. Max drawdown
  if (maxDD > 10) {
    gaps.push({
      severity: "MEDIUM",
      issue: `Max drawdown -${maxDD.toFixed(2)}% exceeds 10% threshold`,
      suggestion: "Consider tightening circuit breaker (3 losses → 2 losses) or reducing RISK_PCT."
    });
  }

  // 6. Conviction bucket analysis
  for (const [bucket, trades] of sortedBuckets) {
    const ct = trades.filter(t => t.exitReason !== "OPEN");
    if (ct.length < 3) continue;
    const bWR = ct.filter(t => t.totalPnlPct > 0).length / ct.length * 100;
    const bucketStart = parseInt(bucket);
    if (bWR < 40 && bucketStart >= 60) {
      gaps.push({
        severity: "MEDIUM",
        issue: `Conviction ${bucket} has ${bWR.toFixed(0)}% WR with ${ct.length} trades — signals passing gate but losing`,
        suggestion: `Raise minConviction to ${bucketStart + 10} or add extra filters for this conviction range.`
      });
    }
  }

  // 7. Per-pair performance
  for (const [sym, trades] of Object.entries(tradesByPair)) {
    const ct = trades.filter(t => t.exitReason !== "OPEN");
    if (ct.length < 3) continue;
    const wr = ct.filter(t => t.totalPnlPct > 0).length / ct.length * 100;
    const pnl = ct.reduce((a, t) => a + t.totalPnlPct, 0);
    if (wr < 35 || pnl < -5) {
      gaps.push({
        severity: "LOW",
        issue: `${sym}: WR ${wr.toFixed(0)}%, P&L ${pnl.toFixed(2)}% — underperforming`,
        suggestion: `Consider removing ${sym} from PAIRS or separate PAIR_VOL_MULT tuning.`
      });
    }
  }

  // 8. SL distance check
  const avgSlPct = closedTrades.reduce((a, t) => a + (t.slPct || 0), 0) / (closedTrades.length || 1);
  if (avgSlPct > 3.5) {
    gaps.push({
      severity: "MEDIUM",
      issue: `Average SL distance ${avgSlPct.toFixed(2)}% is wide — reducing R:R potential`,
      suggestion: "Lower CRYPTO_MIN_SL_PCT from 1.5% to 1.2% or lower pair vol multipliers."
    });
  }

  // 9. Balance BULL vs BEAR
  const bullTrades = closedTrades.filter(t => t.direction === "BULL");
  const bearTrades = closedTrades.filter(t => t.direction === "BEAR");
  if (bullTrades.length && bearTrades.length) {
    const bullWR = bullTrades.filter(t => t.totalPnlPct > 0).length / bullTrades.length * 100;
    const bearWR = bearTrades.filter(t => t.totalPnlPct > 0).length / bearTrades.length * 100;
    if (Math.abs(bullWR - bearWR) > 20) {
      const weaker = bullWR < bearWR ? "BULL" : "BEAR";
      gaps.push({
        severity: "LOW",
        issue: `${weaker} signals underperform: BULL ${bullWR.toFixed(0)}% vs BEAR ${bearWR.toFixed(0)}% WR`,
        suggestion: `Investigate ${weaker} signal quality — may need directional conviction adjustments.`
      });
    }
  }

  // 10. Trade frequency
  const tradesPerDay = closedTrades.length / BT_DAYS;
  if (tradesPerDay < 0.5) {
    gaps.push({
      severity: "LOW",
      issue: `Only ${tradesPerDay.toFixed(2)} trades/day — low signal frequency for compounding`,
      suggestion: "Consider lowering minConviction by 2-3 points or reducing cooldown hours."
    });
  }

  if (!gaps.length) {
    console.log("  ✅ No major gaps detected! The strategy is performing well across all dimensions.");
  } else {
    for (const g of gaps) {
      const icon = g.severity === "HIGH" ? "🔴" : g.severity === "MEDIUM" ? "🟡" : "🟢";
      console.log(`  ${icon} [${g.severity}] ${g.issue}`);
      console.log(`     → ${g.suggestion}\n`);
    }
  }

  // ─── SAVE DETAILED RESULTS ─────────────────────────────────────────────────
  const reportFile = `/workspace/project/backtest_results_${new Date().toISOString().slice(0,10)}.json`;
  const report = {
    meta: {
      pairs, tfs, days: BT_DAYS,
      period: `${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`,
      runtime: elapsed + "s",
      generated: new Date().toISOString(),
    },
    summary: {
      totalSignals, passedGate, blockedByConv,
      closedTrades: closedTrades.length,
      winRate: parseFloat(winRate.toFixed(1)),
      tp1Rate: parseFloat(tp1Rate.toFixed(1)),
      tp2Rate: parseFloat(tp2Rate.toFixed(1)),
      tp3Rate: parseFloat(tp3Rate.toFixed(1)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      avgPnl: parseFloat(avgPnl.toFixed(3)),
      avgWin: parseFloat(avgWin.toFixed(3)),
      avgLoss: parseFloat(avgLoss.toFixed(3)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      expectancy: parseFloat(expectancy.toFixed(4)),
      maxDrawdown: parseFloat(maxDD.toFixed(2)),
      avgBarsHeld: parseFloat(avgBarsHeld.toFixed(1)),
    },
    gaps,
    trades: allTrades,
    equity,
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n💾 Full report saved: ${reportFile}`);
  console.log(`   ${allTrades.length} trades logged with full details.\n`);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────
runBacktest().catch(e => {
  console.error("Backtest failed:", e);
  process.exit(1);
});

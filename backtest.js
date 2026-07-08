"use strict";
// ════════════════════════════════════════════════════════════════════════════
// GWP BACKTESTER v1.0 — Historical Simulation Engine
// Reuses ALL core logic from crypto_bot.js (GWP detection, conviction scoring,
// market structure, math engine) against real KuCoin historical data.
//
// Usage:  node backtest.js [--pair BTC-USDT] [--days 90] [--tf H4]
//
// © 2026 Asterix Holdings Ltd. / Abdin. Ghost Wick Protocol™ is proprietary.
// ════════════════════════════════════════════════════════════════════════════
//
// v4.0 CHANGES (ported from MVS bot, data-validated in MVS's own backtests
// before porting — see crypto_bot.js's v4.0 header note for full rationale):
//   ✅ POC prominence + migration scoring — identical logic to crypto_bot.js,
//      kept in lockstep here so live and backtest can't drift apart.
//   ✅ SLIPPAGE SIMULATION (new) — every fill (entry + every TP/SL exit) is
//      now executed at CONFIG.SLIPPAGE_PCT (default 0.05%/side) worse than
//      the theoretical signal level, same direction real order execution
//      slips. Every P&L number in this report already has this baked in;
//      set SLIPPAGE_PCT to 0 to reproduce the old (unrealistic) numbers.
//   ✅ Max-drawdown fix — the running equity walk now sorts closedTrades by
//      signalTime first. It was previously walked in per-pair/per-tf loop
//      order, which could net an early loss against a later, unrelated win
//      instead of experiencing them in the order they actually happened —
//      the same class of ordering bug MVS's v10.9 changelog fixed for its
//      own equity-curve.json.
// ════════════════════════════════════════════════════════════════════════════

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ─── CLI ARGS ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf("--" + name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const BT_PAIR       = getArg("pair", "ALL");  // ALL or specific pair
const BT_PAIRS_LIST = getArg("pairs", "");    // comma-separated override, e.g. for running one chunk of the full pair list in parallel
const BT_DAYS       = parseInt(getArg("days", "90"));
const BT_TF_FOCUS   = getArg("tf", "ALL");    // ALL, D1, H4, H1, M30, M15
const BT_MAX_MINUTES = parseInt(getArg("max-minutes", "60")); // hard wall-clock budget for the whole run

// ─── CONFIG (mirrors crypto_bot.js v5.0) ─────────────────────────────────────
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
    minRR:1.5, minConviction:62, cooldownHrs:1,
    atrBufMult:0.60, maxAge:1, avwapProx:0.006,
    volLookback:15, msLookback:40, swingStrength:2,
    volSpikeMult:1.5,
  },
};

const CONFIG = {
  PAIRS: ["DEXE-USDT","UNI-USDT","COMP-USDT","SOL-USDT","BTC-USDT","LINK-USDT","ETH-USDT","NEAR-USDT","AVAX-USDT","AAVE-USDT","ARB-USDT","INJ-USDT","DOT-USDT","FIL-USDT","SUI-USDT","ATOM-USDT","MNT-USDT"],  // v4.0: added MNT (Mantle) — 17 pairs, kept in sync with crypto_bot.js
  CAPITAL: 50, RISK_PCT: 1.5, LEVERAGE: 20,  // kept in sync with crypto_bot.js v3.5 (5→50 USD); currently unused in PnL math but here for consistency
  VP_ROWS: 24, MIN_WICK_DEPTH_PCT: 0.12, MIN_BODY_GAP_PCT: 0.08,
  VOLUME_FILTER: true,
  CONFLUENCE_CONVICTION_BOOST: 18,
  TRIPLE_TF_BOOST: 25,
  CONFLUENCE_GATE_REDUCTION: 6,
  TP3_MULT: 2.0,
  CRYPTO_MIN_SL_PCT: 1.5,
  ATR_SL_FLOOR_MULT: 1.0,
  // v4.0 (ported from MVS): realistic fill slippage, applied against the
  // trader on every fill (entry + every exit). 0.05% per side is a
  // conservative estimate for KuCoin spot on the liquid pairs this bot
  // trades at modest size — not a worst-case, not a best-case number.
  // Set to 0 to reproduce the old (unrealistic, zero-slippage) numbers.
  SLIPPAGE_PCT: 0.05,
};

const PAIR_VOL_MULT = {
  "BTC-USDT":0.8, "SOL-USDT":1.5, "DEXE-USDT":1.8, "UNI-USDT":1.3,
  "COMP-USDT":1.3, "LINK-USDT":1.2,
  "ETH-USDT":0.9, "NEAR-USDT":1.4,
  "AVAX-USDT":1.4, "AAVE-USDT":1.3, "ARB-USDT":1.5, "INJ-USDT":1.6,
  "DOT-USDT":1.3, "FIL-USDT":1.5, "SUI-USDT":1.5, "ATOM-USDT":1.2,
  // v4.0: MNT (Mantle) — L2 infra token, volatility comparable to ARB/AVAX class
  "MNT-USDT":1.4,
};

// ─── HTTP ────────────────────────────────────────────────────────────────────
// Returns {status, headers, body} instead of a bare string, so callers can
// actually see 429/5xx and react instead of treating every non-2xx response
// as "no data" (which used to silently truncate the dataset).
function httpGet(url) {
  return new Promise((res, rej) => {
    const opts = new URL(url);
    const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search }, r => {
      let d = ""; r.on("data", c => d += c);
      r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: d }));
    });
    req.on("error", rej);
    req.setTimeout(15000, () => { req.destroy(new Error("Timeout")); });
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── KUCOIN DATA FETCHER (with pagination for long history) ──────────────────
const KU_TF = { H4: "4hour", H1: "1hour", M30: "30min", M15: "15min", D1: "1day" };
const TF_MS = { H4: 4*3600000, H1: 3600000, M30: 1800000, M15: 900000, D1: 86400000 };

const FETCH_MAX_RETRIES = 6;         // per page, before giving up on that page
const FETCH_BASE_BACKOFF_MS = 1000;  // doubles each retry, capped below
const FETCH_MAX_BACKOFF_MS = 20000;
const PAGE_LOG_INTERVAL = 5;         // log progress every N pages so a long
                                      // pull never looks "frozen" in the logs
const FETCH_STREAM_MAX_MS = 8 * 60000; // hard ceiling per pair/timeframe stream (8 min)

// Global adaptive governor (shared across every pair/timeframe stream in this
// process). Per-page retry/backoff alone wasn't enough: once KuCoin starts
// throttling a sustained run, EVERY stream kept independently retrying at its
// own pace and re-triggering more 429s. Instead, the first throttle signal
// slows down ALL subsequent requests process-wide, easing off gradually once
// things flow again — much closer to how a well-behaved client should react
// to a sustained rate limit rather than a one-off blip.
let globalCooldownUntil = 0;
let throttleStrikes = 0;
async function respectGlobalCooldown() {
  const wait = globalCooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
}
function registerThrottleHit() {
  throttleStrikes++;
  const cooldown = Math.min(1500 * throttleStrikes, 15000);
  globalCooldownUntil = Math.max(globalCooldownUntil, Date.now() + cooldown);
}
function registerThrottleClear() {
  if (throttleStrikes > 0) throttleStrikes--; // ease off gradually, don't snap back to full speed
}

async function fetchKlinesRange(symbol, tf, startMs, endMs) {
  // KuCoin returns max 1500 candles per call. Paginate from startMs to endMs.
  const allCandles = [];
  let cursor = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);
  const fetchStart = Date.now();
  let page = 0;

  while (cursor < endSec) {
    const url = `https://api.kucoin.com/api/v1/market/candles?type=${KU_TF[tf]}&symbol=${symbol}&startAt=${cursor}&endAt=${endSec}`;
    let batch = null;

    for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
      await respectGlobalCooldown();
      try {
        const { status, headers, body } = await httpGet(url);

        if (status === 429 || status === 403) {
          registerThrottleHit();
          // Rate-limited/blocked — back off (respect Retry-After if KuCoin sends one)
          const retryAfterSec = parseInt(headers["retry-after"] || "0", 10);
          const backoff = retryAfterSec > 0
            ? retryAfterSec * 1000
            : Math.min(FETCH_BASE_BACKOFF_MS * 2 ** attempt, FETCH_MAX_BACKOFF_MS);
          console.warn(`  ⏳ ${symbol} ${tf}: HTTP ${status} (rate limited), backing off ${backoff}ms (attempt ${attempt + 1}/${FETCH_MAX_RETRIES + 1}, global throttle strikes: ${throttleStrikes})`);
          await sleep(backoff);
          continue;
        }
        if (status >= 500) {
          const backoff = Math.min(FETCH_BASE_BACKOFF_MS * 2 ** attempt, FETCH_MAX_BACKOFF_MS);
          console.warn(`  ⏳ ${symbol} ${tf}: HTTP ${status} (server error), retrying in ${backoff}ms`);
          await sleep(backoff);
          continue;
        }
        if (status !== 200) {
          console.error(`  ❌ ${symbol} ${tf}: HTTP ${status} — ${body.slice(0, 200)}`);
          batch = [];
          break;
        }

        const json = JSON.parse(body);
        if (json.code && json.code !== "200000") {
          // KuCoin's own error envelope can come back with a 200 status too
          console.error(`  ❌ ${symbol} ${tf}: KuCoin error ${json.code} — ${json.msg || ""}`);
          batch = [];
          break;
        }
        registerThrottleClear();
        if (!json.data || json.data.length === 0) { batch = []; break; }

        // KuCoin returns newest first → reverse
        batch = json.data.reverse().map(c => ({
          t: parseInt(c[0]) * 1000, open: parseFloat(c[1]), close: parseFloat(c[2]),
          high: parseFloat(c[3]), low: parseFloat(c[4]), vol: parseFloat(c[5]),
        }));
        break; // success
      } catch (e) {
        const backoff = Math.min(FETCH_BASE_BACKOFF_MS * 2 ** attempt, FETCH_MAX_BACKOFF_MS);
        console.warn(`  ⏳ ${symbol} ${tf}: ${e.message}, retrying in ${backoff}ms (attempt ${attempt + 1}/${FETCH_MAX_RETRIES + 1})`);
        await sleep(backoff);
        batch = null;
      }
    }

    if (batch === null) {
      // Exhausted retries on this page — stop here rather than spin forever,
      // but keep whatever candles we already collected instead of discarding them.
      console.error(`  🛑 ${symbol} ${tf}: giving up after ${FETCH_MAX_RETRIES + 1} attempts on one page — keeping ${allCandles.length} candles collected so far`);
      break;
    }
    if (batch.length === 0) break; // clean end of available data

    const beforeCount = allCandles.length;
    for (const c of batch) {
      if (!allCandles.length || c.t > allCandles[allCandles.length - 1].t) {
        allCandles.push(c);
      }
    }
    if (allCandles.length === beforeCount) {
      // Non-empty batch, but every candle in it was <= what we already have —
      // no forward progress. Without this check, cursor recomputes to the
      // exact same value and we'd request the identical page forever. This
      // happens in practice when the requested range starts before a pair's
      // actual listing date: KuCoin keeps handing back its earliest available
      // window instead of an empty response.
      console.warn(`  ⚠️  ${symbol} ${tf}: batch returned no new candles beyond what we already have (likely hit the pair's actual history limit) — stopping with ${allCandles.length} candles`);
      break;
    }
    if (batch.length < 100) break; // no more data
    cursor = Math.floor(allCandles[allCandles.length - 1].t / 1000) + 1;
    page++;
    if (page % PAGE_LOG_INTERVAL === 0) {
      const elapsedS = ((Date.now() - fetchStart) / 1000).toFixed(0);
      console.log(`    …${symbol} ${tf}: ${page} pages, ${allCandles.length} candles so far (${elapsedS}s elapsed)`);
    }
    if (Date.now() - fetchStart > FETCH_STREAM_MAX_MS) {
      // Defense in depth against the outer per-pair time-budget check: that
      // check only runs BETWEEN pairs, so one stream that's legitimately slow
      // (heavy sustained throttling on this specific pair/tf) could otherwise
      // eat the whole job's time budget before the outer check ever gets a turn.
      console.warn(`  ⏱️  ${symbol} ${tf}: hit the ${FETCH_STREAM_MAX_MS / 60000}m per-stream ceiling — moving on with ${allCandles.length} candles`);
      break;
    }
    await sleep(400); // rate limit courtesy (bumped from 250ms — gentler steady-state pace)
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

  // v4.0 (ported from MVS v10.13, data-validated): POC PROMINENCE + MIGRATION.
  // Kept identical to crypto_bot.js's v4.0 addition — same drift-prevention
  // discipline this repo already uses for every other live/backtest gate.
  let secondVol=0; for(let i=0;i<rows;i++){ if(i===pocIdx) continue; if(buck[i]>secondVol) secondVol=buck[i]; }
  const prominenceRatio = secondVol>0 ? buck[pocIdx]/secondVol : 99;
  const pocDecisive = prominenceRatio >= 1.5;
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
function hasVolumeSpike(sigCandle,allCandles,sigIdx,volLookback,mult){
  if(!CONFIG.VOLUME_FILTER)return true;
  const start=Math.max(0,sigIdx-volLookback),vols=allCandles.slice(start,sigIdx).map(c=>c.vol||0);
  if(!vols.length)return true;
  const avg=vols.reduce((a,b)=>a+b,0)/vols.length;
  return avg===0?true:(sigCandle.vol||0)>=avg*mult;
}

// ─── MARKET STRUCTURE ────────────────────────────────────────────────────────
// ── TIMEFRAME BIAS VOTE (ported from the MVS bot's proven 2-of-3 design) ──────
// Mirrors crypto_bot.js exactly — see that file for the full explanation.
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
function resolveVoteDirection(votes, minAgree = 3) {
  const usable = votes.filter(v => v.result && v.result.bias !== "NEUTRAL");
  const total = votes.length;
  const bulls = usable.filter(v => v.result.bias === "BULLISH").map(v => v.tf);
  const bears = usable.filter(v => v.result.bias === "BEARISH").map(v => v.tf);
  if (bulls.length >= minAgree) return { direction: "BULL", agreeing: bulls, tally: `${bulls.length}/${total}` };
  if (bears.length >= minAgree) return { direction: "BEAR", agreeing: bears, tally: `${bears.length}/${total}` };
  return null;
}

// ── ENTRY CONFIRMATION COUNT — mirrors crypto_bot.js exactly ──────────────────
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

    const staleZone=atr*((tfCfg.tf==="M15"||tfCfg.tf==="M30")?0.3:0.5);
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

    // v4.0 (ported from MVS v10.13): resolve POC migration relative to THIS
    // trade's direction. Small drift (<1 row) is treated as static/noise.
    let pocMigration="STATIC";
    if (Math.abs(vp.pocMigrationRows||0) >= 1) {
      const migratingUp=(vp.pocMigrationRows||0)>0;
      const withTrade=(direction==="BULL"&&migratingUp)||(direction==="BEAR"&&!migratingUp);
      pocMigration=withTrade?"WITH":"AGAINST";
    }

    return{
      direction,score:adjustedScore.toFixed(1),age,isPathB,volumeSpike,avwapTrap,
      pocDecisive:vp.pocDecisive,pocProminenceRatio:vp.prominenceRatio,pocMigration,
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

  // v4.0 POC QUALITY (ported from MVS v10.13 — see crypto_bot.js for the full
  // rationale comment; kept identical here for live/backtest parity).
  if(gwp.pocDecisive===true)score+=5;
  else if(gwp.pocDecisive===false)score-=3;
  if(gwp.pocMigration==="WITH")score-=4;

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

  // v4.0 (ported from MVS): slippage — every fill (entry + every exit) is
  // executed at a slightly worse price than the theoretical signal level.
  // Trigger levels (whether a candle's hi/lo touched TP/SL) are untouched;
  // only the REALIZED fill price used in PnL math is adjusted, exactly like
  // real order execution vs. a chart level.
  const slip = CONFIG.SLIPPAGE_PCT / 100;
  const entryFill = isLong ? entry * (1 + slip) : entry * (1 - slip);
  const fillPrice = (level, isExitFavorable) => {
    // isExitFavorable=true → TP-style exit (worse for the trader = smaller gain).
    // isExitFavorable=false → SL-style exit (worse for the trader = bigger loss).
    if (isLong) return isExitFavorable ? level * (1 - slip) : level * (1 - slip);
    return isExitFavorable ? level * (1 + slip) : level * (1 + slip);
  };

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
      const tp1Fill = fillPrice(signal.tp1, true);
      const pnl = isLong ? (tp1Fill - entryFill) / entryFill * 100 : (entryFill - tp1Fill) / entryFill * 100;
      totalPnlPct += pnl * 0.40; // 40% exit
      sizeRemaining = 0.60;
      sl = entry; // move to BE
    }

    if (tp2Check && !slHit) {
      tp2Hit = true;
      const tp2Fill = fillPrice(signal.tp2, true);
      const pnl = isLong ? (tp2Fill - entryFill) / entryFill * 100 : (entryFill - tp2Fill) / entryFill * 100;
      totalPnlPct += pnl * 0.40; // 40% exit
      sizeRemaining = 0.20;
      sl = signal.tp1; // trail to TP1
    }

    if (tp3Check) {
      const tp3Fill = fillPrice(signal.tp3, true);
      const pnl = isLong ? (tp3Fill - entryFill) / entryFill * 100 : (entryFill - tp3Fill) / entryFill * 100;
      totalPnlPct += pnl * 0.20; // final 20%
      tp3Hit = true;
      exitPrice = tp3Fill;
      exitReason = "TP3";
      exitBar = i + 1;
      return { tp1Hit, tp2Hit, tp3Hit, totalPnlPct, exitPrice, exitReason, exitBar, sizeRemaining: 0 };
    }

    if (slHit) {
      const slFill = fillPrice(sl, false);
      if (tp1Hit || tp2Hit) {
        // Partial profit already taken
        const slPnl = isLong ? (slFill - entryFill) / entryFill * 100 : (entryFill - slFill) / entryFill * 100;
        totalPnlPct += slPnl * sizeRemaining;
      } else {
        // Full SL hit
        const slPnl = isLong ? (slFill - entryFill) / entryFill * 100 : (entryFill - slFill) / entryFill * 100;
        totalPnlPct = slPnl;
      }
      exitPrice = slFill;
      exitReason = tp2Hit ? "SL@TP1" : tp1Hit ? "SL@BE" : "SL";
      exitBar = i + 1;
      return { tp1Hit, tp2Hit, tp3Hit, totalPnlPct, exitPrice, exitReason, exitBar, sizeRemaining: 0 };
    }
  }

  // Still open after all candles — mark to market
  const lastClose = futureCandles[futureCandles.length - 1].close;
  const lastCloseFill = fillPrice(lastClose, true);
  const mtmPnl = isLong ? (lastCloseFill - entryFill) / entryFill * 100 : (entryFill - lastCloseFill) / entryFill * 100;
  totalPnlPct += mtmPnl * sizeRemaining;
  return { tp1Hit, tp2Hit, tp3Hit: false, totalPnlPct, exitPrice: lastClose, exitReason: "OPEN", exitBar: futureCandles.length, sizeRemaining };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BACKTEST LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function checkKucoinConnectivity() {
  // Quick single-attempt probe (not the full retry ladder) so a genuinely
  // blocked/throttled API is obvious in ~5s instead of discovered 3 hours in.
  const url = "https://api.kucoin.com/api/v1/market/candles?type=1hour&symbol=BTC-USDT&startAt=" +
    (Math.floor(Date.now() / 1000) - 3600 * 5) + "&endAt=" + Math.floor(Date.now() / 1000);
  try {
    const { status, body } = await httpGet(url);
    if (status === 200) {
      const json = JSON.parse(body);
      if (json.data && json.data.length > 0) {
        console.log(`✅ KuCoin API reachable (got ${json.data.length} test candles for BTC-USDT).\n`);
        return true;
      }
      console.warn(`⚠️  KuCoin API returned 200 but no candle data (${JSON.stringify(json).slice(0,150)}). Proceeding anyway, but expect gaps.\n`);
      return true;
    }
    console.error(`\n${"!".repeat(70)}`);
    console.error(`🛑 KuCoin preflight check FAILED: HTTP ${status}`);
    console.error(`   This almost always means the runner's IP is being rate-limited or`);
    console.error(`   blocked by KuCoin. The full run will very likely spend its entire`);
    console.error(`   time budget retrying instead of producing data.`);
    console.error(`${"!".repeat(70)}\n`);
    return false;
  } catch (e) {
    console.error(`\n🛑 KuCoin preflight check FAILED: ${e.message} — network may be unreachable from this runner.\n`);
    return false;
  }
}

async function runBacktest() {
  const startTime = Date.now();
  const endMs = Date.now();
  const startMs = endMs - BT_DAYS * 86400000;
  const pairs = BT_PAIRS_LIST
    ? BT_PAIRS_LIST.split(",").map(p => p.trim()).filter(Boolean)
    : (BT_PAIR === "ALL" ? CONFIG.PAIRS : [BT_PAIR]);
  const tfs = BT_TF_FOCUS === "ALL" ? ["D1", "H4", "H1", "M30", "M15"] : [BT_TF_FOCUS];

  const kucoinOk = await checkKucoinConnectivity();
  if (!kucoinOk) {
    console.error("Aborting before burning the time budget on a connection that's already failing.");
    console.error("Re-run later, or from a different network/runner, once this clears.");
    process.exitCode = 1;
    return;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  GWP BACKTESTER v1.0 — ${BT_DAYS}-DAY HISTORICAL SIMULATION`);
  console.log(`  Pairs: ${pairs.join(", ")}  |  Timeframes: ${tfs.join(", ")}`);
  console.log(`  Period: ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`);
  console.log(`  Time budget: ${BT_MAX_MINUTES} minutes (partial results are saved if this is hit)`);
  console.log(`${"═".repeat(70)}\n`);

  const allTrades = [];
  const tradesByPair = {};
  const tradesByTf = {};
  const tradesByGrade = {};
  const convictionBuckets = {};
  let totalSignals = 0, passedGate = 0, blockedByConv = 0, blockedByRR = 0;
  const blockedScores = []; // {tf, signalType, score, gate} for every blocked signal — lets
                             // future tuning see the real score distribution near the gate
                             // instead of guessing at a new threshold blind.
  const runStart = Date.now();
  let pairIdx = 0;
  let ranOutOfTime = false;
  const skippedPairs = [];

  for (const symbol of pairs) {
    pairIdx++;
    const totalElapsedMin = (Date.now() - runStart) / 60000;
    if (totalElapsedMin >= BT_MAX_MINUTES) {
      console.log(`\n⏱️  Time budget of ${BT_MAX_MINUTES}m reached before ${symbol} — stopping fetch, saving results from ${pairIdx - 1}/${pairs.length} pairs already processed.`);
      ranOutOfTime = true;
      skippedPairs.push(...pairs.slice(pairIdx - 1));
      break;
    }
    const symbolStart = Date.now();
    console.log(`\n▶ [${pairIdx}/${pairs.length}] Fetching ${symbol} historical data... (${totalElapsedMin.toFixed(1)}m elapsed overall)`);
    tradesByPair[symbol] = [];

    // Fetch each timeframe SEQUENTIALLY (not as concurrent streams). KuCoin's
    // public rate limit is per-IP; firing D1+H4+H1+M30+M15 all at once from a
    // shared GitHub Actions IP was triggering repeated throttling that a burst
    // of retries couldn't outrun. One stream at a time is slower per-pair in
    // isolation but avoids the throttling that was making the overall run
    // take 3+ hours.
    const data = {};
    for (const tf of tfs) {
      data[tf] = await fetchKlinesRange(symbol, tf, startMs - TF_MS[tf] * 200, endMs);
      console.log(`  ${tf}: ${data[tf].length} candles fetched`);
    }

    const symbolFetchS = ((Date.now() - symbolStart) / 1000).toFixed(1);
    console.log(`  ✓ ${symbol} data ready in ${symbolFetchS}s`);

    // ─── PHASE 1: build raw signal timelines per TF ──────────────────────────
    // One pass per TF, recording every raw GWP detection (pre-gate) with full
    // context. This both feeds the existing solo paths AND lets us look up
    // "what was H1/M15 showing at this H4 bar's close" for TRIPLE/CONFLUENCE
    // detection in phase 2 — without ever looking at a future bar (the lookup
    // is a binary search bounded to entries with t <= the anchor's timestamp).
    //
    // ALSO builds a separate, denser "bias timeline" per TF (computed at every
    // bar with a valid volume profile, regardless of whether a GWP trigger
    // fired) — the 2-of-3 vote (ported from the MVS bot) is a continuous
    // structural read, not a trigger event, so it needs its own timeline.
    const timelines = {};
    const biasTimelines = {};
    for (const tf of tfs) {
      const candles = data[tf];
      if (!candles || candles.length < 160) {
        console.log(`  ⚠️ ${tf}: insufficient data (${candles ? candles.length : 0} candles)`);
        timelines[tf] = [];
        biasTimelines[tf] = [];
        continue;
      }
      if (!tradesByTf[tf]) tradesByTf[tf] = [];
      const tfCfg = TF_CONFIG[tf];
      const windowSize = tfCfg.vpLookback + 50;
      const stepSize = tf === "M15" ? 4 : tf === "M30" ? 3 : tf === "H1" ? 2 : 1;
      const tl = [];
      const bl = [];
      for (let i = windowSize; i < candles.length - 5; i += stepSize) {
        const window = candles.slice(Math.max(0, i - windowSize), i + 1);
        const cur = window[window.length - 1];
        const d1Window = data.D1.filter(d => d.t < cur.t);
        const d1Bias = getD1Bias(d1Window.length >= 2 ? d1Window.slice(-5) : null);
        const vp = computeVolumeProfile(window, tfCfg.vpLookback);
        if (!vp) continue;

        const bias = computeTfBias(window, vp);
        if (bias) bl.push({ t: cur.t, bias: bias.bias });

        const avwap = computeAVWAP(window, tfCfg.avwapLookback);
        const math = runMathEngine(window);
        const gwp = detectGWP(window, vp, avwap, math, tfCfg, symbol);
        if (!gwp) continue;
        totalSignals++;
        const ms = analyzeMarketStructure(window, gwp.direction, tfCfg);
        tl.push({
          i, t: cur.t, direction: gwp.direction, gwp, ms, math, d1Bias,
          candleHour: new Date(cur.t).getUTCHours(),
        });
      }
      timelines[tf] = tl;
      biasTimelines[tf] = bl;
    }

    // Binary search into the dense bias timeline: what was this TF's compressed
    // vote showing at or before time atT? (never looks ahead)
    function biasAsOf(tf, atT) {
      const bl = biasTimelines[tf];
      if (!bl || !bl.length) return null;
      let lo = 0, hi = bl.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bl[mid].t <= atT) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans >= 0 ? bl[ans].bias : null;
    }
    // Resolve the 3-of-5 vote as of a given anchor timestamp, using whichever
    // TFs are actually in `tfs` (mirrors crypto_bot.js's live vote, which also
    // only uses whichever of D1/H4/H1/M30/M15 it has data for).
    function resolveVoteAsOf(atT) {
      const votes = [];
      for (const tf of ["D1", "H4", "H1", "M30", "M15"]) {
        if (!tfs.includes(tf)) continue;
        const bias = biasAsOf(tf, atT);
        votes.push({ tf, result: bias ? { bias } : null });
      }
      return resolveVoteDirection(votes, 3);
    }

    // Binary search: most recent timeline entry at or before `atT` (never looks ahead).
    function currentStateAsOf(tf, atT) {
      const tl = timelines[tf];
      if (!tl || !tl.length) return null;
      let lo = 0, hi = tl.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tl[mid].t <= atT) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans >= 0 ? tl[ans] : null;
    }
    // Is `tf` currently (as of atT) showing the same direction, and recently enough
    // to count as "live" rather than a stale leftover read? The freshness bound
    // reuses that TF's own (already-tuned) cooldown window rather than inventing
    // a new arbitrary constant.
    function checkAgreement(tf, direction, atT, maxAgeMs) {
      const s = currentStateAsOf(tf, atT);
      if (!s || s.direction !== direction) return null;
      if (atT - s.t > maxAgeMs) return null;
      return s;
    }

    // Shared across all TFs for this symbol so a fired CONFLUENCE/TRIPLE trade's
    // cooldown suppresses the solo loops from also firing on the same underlying
    // move — mirrors crypto_bot.js calling setCooldown() for every TF involved.
    const cooldowns = {}; // `${direction}_${tf}` -> last-fired timestamp

    function recordTrade(tf, evt, conv, signalType, voteTally) {
      const candles = data[tf];
      const futureStart = evt.i + 1;
      const futureEnd = Math.min(candles.length, futureStart + 100);
      const futureCandles = candles.slice(futureStart, futureEnd);
      if (futureCandles.length < 3) return;
      const result = simulateTrade(evt.gwp, futureCandles);
      const trade = {
        symbol,
        tf: signalType, // triggering TF ("D1"/"H4"/"H1"/"M30"/"M15")
        voteTally: voteTally || null, // e.g. "3/5" — how many TFs agreed on direction
        direction: evt.direction,
        entry: evt.gwp.entry, sl: evt.gwp.sl, tp1: evt.gwp.tp1, tp2: evt.gwp.tp2, tp3: evt.gwp.tp3,
        rr: evt.gwp.rr,
        conviction: conv.score,
        grade: conv.grade,
        d1Bias: evt.d1Bias,
        d1Aligned: (evt.d1Bias === evt.direction) || evt.d1Bias === 'NEUTRAL',
        signalTime: new Date(evt.t).toISOString(),
        slPct: evt.gwp.slPct !== undefined ? evt.gwp.slPct : Math.abs(evt.gwp.entry - evt.gwp.sl) / evt.gwp.entry * 100,
        ...result,
      };
      allTrades.push(trade);
      tradesByPair[symbol].push(trade);
      (tradesByTf[tf] = tradesByTf[tf] || []).push(trade);
      const convBucket = Math.floor(conv.score / 10) * 10;
      const bucketKey = `${convBucket}-${convBucket + 9}`;
      (convictionBuckets[bucketKey] = convictionBuckets[bucketKey] || []).push(trade);
      (tradesByGrade[conv.grade] = tradesByGrade[conv.grade] || []).push(trade);
    }

    // ─── PHASE 2: unified entry trigger — walk each TF's raw GWP timeline,
    // fastest TF first. An event only converts into a trade if the 5-TF vote
    // (as of that event's own timestamp, via resolveVoteAsOf — no lookahead)
    // has ≥3-of-5 agreement in the SAME direction as the event, AND the event
    // clears checkEntryConfirmations + its own TF's minConviction floor
    // (after a vote-strength boost). Mirrors crypto_bot.js's live
    // "fastest-TF-first" entry-trigger search exactly. Supersedes the old
    // separate D1-counter-trend hard block — D1 is now one of five voters.
    for (const tf of ["M15", "M30", "H1", "H4", "D1"]) {
      if (!timelines[tf] || !timelines[tf].length) continue;
      for (const evt of timelines[tf]) {
        const { t, direction, gwp, ms, math, d1Bias, candleHour } = evt;
        if (cooldowns[`${direction}_${tf}`] && (t - cooldowns[`${direction}_${tf}`]) < TF_CONFIG[tf].cooldownHrs * 3600000) continue;

        const vote = resolveVoteAsOf(t);
        if (!vote || vote.direction !== direction) continue;

        const gateCheck = checkEntryConfirmations(gwp, ms);
        if (!gateCheck.valid) { blockedByConv++; blockedScores.push({ tf, signalType: tf, score: gateCheck.count, gate: 2 }); continue; }

        const conv = computeConviction(gwp, math, ms, tf, false, false, d1Bias, candleHour);
        const voteBoost = vote.agreeing.length >= 5 ? 25 : vote.agreeing.length === 4 ? 18 : 10;
        conv.score = Math.min(conv.score + voteBoost, 123);

        if (conv.score < TF_CONFIG[tf].minConviction) { blockedByConv++; blockedScores.push({ tf, signalType: tf, score: conv.score, gate: "minConviction" }); continue; }
        passedGate++;

        cooldowns[`${direction}_${tf}`] = t;
        recordTrade(tf, evt, conv, tf, vote.tally);
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
  if (ranOutOfTime) {
    console.log(`  ⚠️  PARTIAL RUN — hit the ${BT_MAX_MINUTES}m time budget. Skipped: ${skippedPairs.join(", ")}`);
    console.log(`     Results below only reflect the ${pairIdx - 1}/${pairs.length} pairs that finished. Re-run with a higher`);
    console.log(`     --max-minutes, or narrow --pair/--tf, to cover the rest.`);
  }
  console.log(`${"═".repeat(70)}\n`);
  const partialNotice = ranOutOfTime
    ? `\n> ⚠️ **PARTIAL RUN** — hit the ${BT_MAX_MINUTES}-minute time budget. Only ${pairIdx - 1}/${pairs.length} pairs finished (skipped: ${skippedPairs.join(", ")}). Numbers below are real but not the full ${BT_DAYS}-day/${pairs.length}-pair picture.\n`
    : "";

  // ─── SIGNAL FUNNEL ─────────────────────────────────────────────────────────
  console.log(`📊 SIGNAL FUNNEL:`);
  console.log(`  Raw GWP detections:    ${totalSignals}`);
  console.log(`  Blocked by conviction: ${blockedByConv} (${totalSignals ? ((blockedByConv/totalSignals)*100).toFixed(1) : 0}%)`);
  console.log(`  Passed gate → traded:  ${passedGate} (${totalSignals ? ((passedGate/totalSignals)*100).toFixed(1) : 0}%)`);
  const nearMisses = blockedScores.filter(b => b.gate - b.score <= 5);
  if (nearMisses.length) {
    console.log(`  Near-misses (within 5 pts of gate): ${nearMisses.length}`);
    const byTf = {};
    for (const nm of nearMisses) (byTf[nm.signalType] = byTf[nm.signalType] || []).push(nm.gate - nm.score);
    for (const [tf, gaps] of Object.entries(byTf)) {
      console.log(`    ${tf}: ${gaps.length} near-misses, avg gap ${(gaps.reduce((a,b)=>a+b,0)/gaps.length).toFixed(1)} pts`);
    }
  }
  console.log();

  // ─── REPORT PATHS (set up before any early return so every run — even a
  // zero-trade one — produces an artifact instead of vanishing silently) ────
  const reportDir = path.join(__dirname, "backtest-reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const tagBits = [
    BT_PAIR === "ALL" ? "ALL" : BT_PAIR,
    BT_TF_FOCUS === "ALL" ? "ALL" : BT_TF_FOCUS,
    `${BT_DAYS}d`,
  ].join("_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportFile = path.join(reportDir, `backtest_${tagBits}_${stamp}.json`);
  const summaryFile = path.join(reportDir, `backtest_${tagBits}_${stamp}.md`);

  if (!allTrades.length) {
    console.log("❌ NO TRADES GENERATED. Possible issues:");
    console.log("  - Conviction gates too high for the data period");
    console.log("  - GWP detection criteria too strict");
    console.log("  - Insufficient data fetched");
    console.log("  - Window/pair/tf too narrow for confluence setups to occur (e.g. a short diagnostic run)");

    const minimalReport = {
      meta: {
        pairs, tfs, days: BT_DAYS,
        period: `${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`,
        runtime: elapsed + "s",
        generated: new Date().toISOString(),
        partialRun: ranOutOfTime,
        skippedPairs,
      },
      summary: { totalSignals, passedGate, blockedByConv, closedTrades: 0, nearMisses: nearMisses.length },
      blockedScores,
      trades: [],
    };
    fs.writeFileSync(reportFile, JSON.stringify(minimalReport, null, 2));

    const minimalMd = [
      `# GWP Backtest — ${BT_DAYS}-day window`,
      ``,
      `**Pairs:** ${pairs.join(", ")}  `,
      `**Timeframes:** ${tfs.join(", ")}  `,
      `**Period:** ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}  `,
      `**Runtime:** ${elapsed}s  `,
      `**Generated:** ${new Date().toISOString()}`,
      partialNotice,
      ``,
      `## ❌ No trades generated`,
      ``,
      `- Raw GWP detections: ${totalSignals}`,
      `- Blocked by conviction: ${blockedByConv}`,
      `- Passed gate: ${passedGate}`,
      ``,
      `Possible causes: conviction gates too strict for this window, GWP criteria too strict, insufficient candles fetched, or the window/pair/tf combo is too narrow (common for short diagnostic runs) for confluence setups to occur.`,
      ``,
    ].join("\n");
    fs.writeFileSync(summaryFile, minimalMd);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, minimalMd + "\n");
    }
    console.log(`\n💾 Report saved (zero-trade run): ${reportFile}`);
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
  // v4.0 fix (same class of bug MVS's v10.9 changelog fixed for its own
  // equity-curve.json): closedTrades is in per-pair/per-tf loop order, not
  // chronological order, so walking it directly can understate drawdown by
  // netting an early loss against a later, unrelated win instead of the
  // other way around. Sort a copy by signalTime first.
  let peak = 0, maxDD = 0, running = 0;
  const equity = [0];
  const chronoTrades = [...closedTrades].sort((a, b) => new Date(a.signalTime) - new Date(b.signalTime));
  for (const t of chronoTrades) {
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
  console.log(`  Equity Curve:   start 0.00% → end ${running >= 0 ? "+" : ""}${running.toFixed(2)}% (peak +${peak.toFixed(2)}%, ${chronoTrades.length} pts, chronological)`);
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
  // (reportDir/reportFile/summaryFile were already set up above, before the
  // zero-trade early return, so both paths write to the same place.)
  const report = {
    meta: {
      pairs, tfs, days: BT_DAYS,
      period: `${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`,
      runtime: elapsed + "s",
      generated: new Date().toISOString(),
      partialRun: ranOutOfTime,
      skippedPairs,
    },
    summary: {
      totalSignals, passedGate, blockedByConv, nearMisses: nearMisses.length,
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
      slippagePctPerFill: CONFIG.SLIPPAGE_PCT, // v4.0: all P&L above already has this baked in
    },
    gaps,
    trades: allTrades,
    equity,
    blockedScores,
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // ─── MARKDOWN SUMMARY (human-readable, GitHub Actions job summary friendly) ─
  const gradeLines = Object.entries(tradesByGrade).map(([g, trades]) => {
    const ct = trades.filter(t => t.exitReason !== "OPEN");
    if (!ct.length) return null;
    const w = ct.filter(t => t.totalPnlPct > 0).length;
    return `| ${g} | ${ct.length} | ${(w / ct.length * 100).toFixed(1)}% |`;
  }).filter(Boolean).join("\n");

  const md = [
    `# GWP Backtest — ${BT_DAYS}-day window`,
    ``,
    `**Pairs:** ${pairs.join(", ")}  `,
    `**Timeframes:** ${tfs.join(", ")}  `,
    `**Period:** ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}  `,
    `**Runtime:** ${elapsed}s  `,
    `**Generated:** ${new Date().toISOString()}`,
    partialNotice,
    ``,
    `## Overall performance (${closedTrades.length} closed trades)`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Win Rate | ${winRate.toFixed(1)}% (${wins.length}W / ${losses.length}L) |`,
    `| TP1 / TP2 / TP3 Hit Rate | ${tp1Rate.toFixed(1)}% / ${tp2Rate.toFixed(1)}% / ${tp3Rate.toFixed(1)}% |`,
    `| Total P&L | ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}% |`,
    `| Avg P&L / trade | ${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(3)}% |`,
    `| Profit Factor | ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)} |`,
    `| Expectancy | ${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(4)}% per trade |`,
    `| Max Drawdown | -${maxDD.toFixed(2)}% |`,
    `| Still Open (unresolved at window end) | ${allTrades.filter(t => t.exitReason === "OPEN").length} |`,
    ``,
    `## By conviction grade`,
    ``,
    `| Grade | Trades | Win Rate |`,
    `|---|---|---|`,
    gradeLines || "| — | — | — |",
    ``,
    `## Gap analysis`,
    ``,
    gaps.length
      ? gaps.map(g => `- **[${g.severity}]** ${g.issue}\n  → ${g.suggestion}`).join("\n")
      : "- ✅ No major gaps detected.",
    ``,
    `Full machine-readable report: \`${path.basename(reportFile)}\``,
    ``,
  ].join("\n");

  fs.writeFileSync(summaryFile, md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }

  console.log(`\n💾 Full report saved: ${reportFile}`);
  console.log(`📝 Summary saved:    ${summaryFile}`);
  console.log(`   ${allTrades.length} trades logged with full details.\n`);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────
runBacktest().catch(e => {
  console.error("Backtest failed:", e);
  process.exit(1);
});

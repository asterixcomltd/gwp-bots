/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — KUCOIN DATA CLIENT (shared/kucoin.js) — used by the CRYPTO bot
 *
 *  Ported directly from MVS-bot's strategy.js (getKlines) and backtest.js
 *  (fetchKlines/fetchHistory). Real candle volume — no synthetic-volume
 *  handling needed here (see shared/twelvedata.js for why Forex/Stocks
 *  need that).
 * ═══════════════════════════════════════════════════════════════════════
 */
const axios = require('axios');

module.exports = function createKucoinClient(config) {
  const BASE_URL = config.BASE_URL || 'https://api.kucoin.com/api/v1';
  const BAR_SECONDS = { '15min': 900, '30min': 1800, '1hour': 3600, '2hour': 7200, '4hour': 14400, '1day': 86400 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Live fetch — most recent N candles (v10.4-style retry) ────────────
  const getKlines = async (symbol, interval, limit, maxRetries = 2) => {
    const safeLimit = Math.min(limit + 20, 1500); // buffer for ATR/VP warmup
    const url = `${BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&limit=${safeLimit}`;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
        if (res.data.code !== '200000') {
          console.error(`  ❌ KuCoin API error (${interval}, attempt ${attempt}/${maxRetries}): ${res.data.code} — ${res.data.msg || 'Unknown'}`);
          if (attempt === maxRetries) return [];
          await sleep(800);
          continue;
        }
        const sorted = (res.data.data || []).reverse();
        return sorted.slice(-limit).map(k => ({
          time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]),
          high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]),
        }));
      } catch (e) {
        console.error(`  ❌ KuCoin fetch error for ${symbol} (${interval}, attempt ${attempt}/${maxRetries}):`, e.message);
        if (attempt === maxRetries) return [];
        await sleep(800);
      }
    }
    return [];
  };

  // ── Paged history fetch — used by backtest.js ──────────────────────────
  const FETCH_MAX_RETRIES = 5;
  const fetchKlinesRange = async (symbol, interval, startAt, endAt) => {
    const url = `${BASE_URL}/market/candles?symbol=${symbol}&type=${interval}&startAt=${startAt}&endAt=${endAt}`;
    for (let attempt = 1; attempt <= FETCH_MAX_RETRIES; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 20000 });
        if (res.data.code !== '200000') {
          console.error(`\n  ⚠️  KuCoin ${res.data.code} for ${symbol} ${interval} (attempt ${attempt}/${FETCH_MAX_RETRIES}): ${res.data.msg || 'unknown'}`);
          if (attempt === FETCH_MAX_RETRIES) return { ok: false, bars: [] };
          await sleep(500 * attempt);
          continue;
        }
        const bars = (res.data.data || [])
          .map(k => ({ time: parseInt(k[0]), open: parseFloat(k[1]), close: parseFloat(k[2]), high: parseFloat(k[3]), low: parseFloat(k[4]), volume: parseFloat(k[5]) }))
          .sort((a, b) => a.time - b.time);
        return { ok: true, bars };
      } catch (e) {
        console.error(`\n  ⚠️  Fetch error for ${symbol} ${interval} (attempt ${attempt}/${FETCH_MAX_RETRIES}): ${e.message}`);
        if (attempt === FETCH_MAX_RETRIES) return { ok: false, bars: [] };
        await sleep(500 * attempt);
      }
    }
    return { ok: false, bars: [] };
  };

  const fetchHistory = async (symbol, interval, historyDays) => {
    const barSeconds = BAR_SECONDS[interval] || 3600;
    const endAt = Math.floor(Date.now() / 1000);
    const startAt = endAt - historyDays * 86400;
    let allBars = [];
    let chunkEnd = endAt;
    const chunkSize = 1500 * barSeconds;
    let hadGap = false;

    process.stdout.write(`  Fetching ${interval} history for ${symbol}...`);
    while (chunkEnd > startAt) {
      const chunkStart = Math.max(chunkEnd - chunkSize, startAt);
      const { ok, bars } = await fetchKlinesRange(symbol, interval, chunkStart, chunkEnd);
      if (!ok) {
        hadGap = true;
        console.error(`  ⚠️  Giving up on ${symbol} ${interval} chunk [${new Date(chunkStart * 1000).toISOString()} – ${new Date(chunkEnd * 1000).toISOString()}] after ${FETCH_MAX_RETRIES} retries — data will have a gap here, continuing further back.`);
        chunkEnd = chunkStart - 1;
        continue;
      }
      if (!bars.length) break; // genuine end of history — safe to stop
      allBars = [...bars, ...allBars];
      chunkEnd = bars[0].time - 1;
      process.stdout.write('.');
      await sleep(250);
    }
    const seen = new Set();
    allBars = allBars.filter(b => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
    console.log(` ${allBars.length} bars${hadGap ? '  ⚠️  INCOMPLETE — see warnings above' : ''}`);
    return allBars;
  };

  return { getKlines, fetchHistory, BAR_SECONDS };
};

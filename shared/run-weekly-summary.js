/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED WEEKLY SUMMARY (shared/run-weekly-summary.js)
 *
 *  Ported directly from MVS-bot's weekly-summary.js. Reads
 *  signals.log.json, summarises the last 7 days, sends to Telegram, and
 *  maintains equity-curve.json. Triggered every Monday 07:00 UTC by each
 *  sub-bot's own GitHub Actions workflow.
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');

const TELEGRAM_SAFE_LEN = 3800;
const splitIntoChunks = (text, maxLen = TELEGRAM_SAFE_LEN) => {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length > maxLen && current) { chunks.push(current); current = p; }
    else current = candidate;
    while (current.length > maxLen) { chunks.push(current.slice(0, maxLen)); current = current.slice(maxLen); }
  }
  if (current) chunks.push(current);
  return chunks;
};

module.exports = async function runWeeklySummary({ config, telegram, botLabel, dir }) {
  const { mdSafe, sendSafe } = telegram;

  const send = async (text) => {
    const chunks = splitIntoChunks(text);
    let lastRes = null;
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `_(${i + 1}/${chunks.length})_\n` : '';
      const res = await sendSafe(config.TELEGRAM_CHAT_ID, prefix + chunks[i], { parse_mode: 'Markdown' });
      lastRes = res;
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    return lastRes;
  };

  const LOG_FILE    = path.join(dir, 'signals.log.json');
  const EQUITY_FILE = path.join(dir, 'equity-curve.json');

  const loadJSON = (file, fallback) => {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return fallback; }
  };

  const updateEquityCurve = (log) => {
    const curve   = loadJSON(EQUITY_FILE, []);
    const RISK    = config.RISK_PER_TRADE_PCT || 1.5;
    const SLIP    = config.SLIPPAGE_PCT       || 0.001;
    const START   = 1000;

    const closedEntries = log
      .filter(e => e.rr !== undefined && e.rr !== null && e.exitTime)
      .slice()
      .sort((a, b) => a.exitTime - b.exitTime);
    if (!closedEntries.length) return curve;

    let capital = START;
    let peak    = capital;
    let maxDD   = 0;
    const points = [{ date: null, capital, cumulativeR: 0, tradeN: 0, drawdownPct: 0 }];

    for (const [i, t] of closedEntries.entries()) {
      const riskAmt  = capital * (RISK / 100);
      const slipCost = capital * SLIP;
      capital += riskAmt * t.rr - slipCost;
      if (capital > peak) peak = capital;
      const dd = (peak - capital) / peak * 100;
      if (dd > maxDD) maxDD = dd;
      points.push({
        date:          t.exitTime ? new Date(t.exitTime * 1000).toISOString().slice(0, 10) : null,
        capital:       parseFloat(capital.toFixed(2)),
        cumulativeR:   parseFloat(closedEntries.slice(0, i + 1).reduce((s, x) => s + (x.rr || 0), 0).toFixed(2)),
        tradeN:        i + 1,
        drawdownPct:   parseFloat(dd.toFixed(2)),
        result:        t.signal || t.result,
        symbol:        t.symbol,
      });
    }

    const weekLabel = new Date().toISOString().slice(0, 10);
    const latest    = points[points.length - 1];
    const snapshot  = {
      week:          weekLabel,
      totalTrades:   closedEntries.length,
      capital:       latest.capital,
      totalReturn:   parseFloat(((latest.capital - START) / START * 100).toFixed(1)),
      cumulativeR:   latest.cumulativeR,
      maxDrawdownPct: parseFloat(maxDD.toFixed(2)),
      equityPoints:  points,
    };

    const idx = curve.findIndex(s => s.week === weekLabel);
    if (idx >= 0) curve[idx] = snapshot;
    else curve.unshift(snapshot);

    fs.writeFileSync(EQUITY_FILE, JSON.stringify(curve, null, 2));
    console.log(`✅ Equity curve updated → ${EQUITY_FILE} (${closedEntries.length} trades, capital $${latest.capital})`);
    return curve;
  };

  const log    = loadJSON(LOG_FILE, []);
  const curve  = updateEquityCurve(log);
  const latest = curve.length ? curve[0] : null;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent  = log.filter(e => new Date(e.time).getTime() >= weekAgo);

  if (!recent.length) {
    const equityLine = latest
      ? `\n\n📊 *Live Equity:* $${latest.capital} | +${latest.totalReturn}% total | ${latest.cumulativeR}R | Max DD ${latest.maxDrawdownPct}%`
      : '';
    await send(`📅 *${botLabel} Weekly Summary*\n\nNo signals logged in the last 7 days.${equityLine}`);
    console.log('✅ Weekly summary sent (no signals).');
    return;
  }

  const counts = {};
  for (const e of recent) counts[e.signal] = (counts[e.signal] || 0) + 1;

  let msg = `📅 *${botLabel} Weekly Summary*\n${recent.length} total events across ${config.SYMBOLS.join(', ')}\n`;
  for (const [signal, count] of Object.entries(counts)) {
    msg += `\n• ${signal}: ${count}`;
  }

  const entries = recent.filter(e => e.signal === 'FIRED');
  if (entries.length) {
    const groups = [];
    for (const e of entries) {
      const key = `${e.symbol}|${e.direction}|${Number(e.entryPrice).toFixed(4)}|${Number(e.tp1Price).toFixed(4)}|${Number(e.tp2Price).toFixed(4)}|${(e.patterns || []).join('+')}`;
      let g = groups.find(g => g.key === key);
      if (!g) { g = { key, sample: e, times: [] }; groups.push(g); }
      g.times.push(e.time);
    }

    msg += `\n\n🎯 *Entries (${entries.length}${groups.length !== entries.length ? `, ${groups.length} unique setup${groups.length === 1 ? '' : 's'}` : ''}):*`;
    for (const g of groups.slice(0, 10)) {
      const e = g.sample;
      const n = g.times.length;
      msg += `\n\n${e.symbol} ${e.direction} @ $${Number(e.entryPrice).toFixed(4)}${n > 1 ? `  ×${n}` : ''}`;
      msg += `\n  SL $${Number(e.slPrice).toFixed(4)} · TP1 $${Number(e.tp1Price).toFixed(4)} · TP2 (runner) $${Number(e.tp2Price).toFixed(4)}`;
      msg += `\n  Patterns: ${(e.patterns || []).map(mdSafe).join(' + ')} · R:R ${e.rr1}/${e.rr2}`;
      if (n > 1) {
        const oldest = g.times[g.times.length - 1];
        const newest = g.times[0];
        msg += `\n  Fired ${n}× between ${new Date(oldest).toISOString().slice(0, 16).replace('T', ' ')} and ${new Date(newest).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      } else {
        msg += `\n  ${new Date(e.time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      }
    }
  }

  if (latest) {
    msg += `\n\n━━━━━━━━━━━━━━━━━━━━`;
    msg += `\n📊 *Live Equity Snapshot:*`;
    msg += `\n  Capital:     $${latest.capital}`;
    msg += `\n  Total return: +${latest.totalReturn}%`;
    msg += `\n  Cum. R:      ${latest.cumulativeR}R`;
    msg += `\n  Max drawdown: ${latest.maxDrawdownPct}%`;
    msg += `\n  Total trades: ${latest.totalTrades}`;
  }

  await send(msg);
  console.log('✅ Weekly summary sent.');
};

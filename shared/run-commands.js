/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED TELEGRAM COMMAND HANDLER (shared/run-commands.js)
 *
 *  Ported directly from MVS-bot's commands.js. Runs every 5 minutes via
 *  each sub-bot's own GitHub Actions workflow (e.g. crypto-commands.yml).
 *  Polls Telegram getUpdates, executes any recognised command, saves
 *  offset — one shared implementation, each bot's own commands.js just
 *  supplies its config/dataClient/health-check/label.
 *
 *  Commands handled:
 *    /scan       → run strategy.js right now, then reply with /status output
 *    /status     → last saved scan result from state.json
 *    /health     → data-source ping + last run timestamp
 *    /positions  → open positions (tracked automatically until close)
 *    /pairs      → tracked symbols
 *    /about      → strategy overview + how to run your own backtest
 *    /signal     → how to read a signal
 *    /source     → GitHub link
 *    /help       → command menu
 *    /start      → same as /help
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');

const TELEGRAM_SAFE_LEN = 3800; // margin under Telegram's real 4096 limit

const splitIntoChunks = (text, maxLen = TELEGRAM_SAFE_LEN) => {
  if (text.length <= maxLen) return [text];
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = p;
    } else {
      current = candidate;
    }
    while (current.length > maxLen) {
      chunks.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const BIAS_ICON = { BULLISH: '🟢', BEARISH: '🔴', NEUTRAL: '⚪' };
const biasStr = (b) => b ? `${BIAS_ICON[b] || ''}${b}` : '—';

module.exports = async function runCommands({ config, telegram, healthCheck, botLabel, version, exchangeName, sourceUrl, dir }) {
  const { mdSafe, getUpdates } = telegram;
  const TG = telegram.TG;
  const axios = require('axios');

  const tgCall = async (method, params = {}, ms = 12000) => {
    try {
      const res = await Promise.race([
        axios.post(`${TG}/${method}`, params),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${method} timed out`)), ms)),
      ]);
      return res.data;
    } catch (e) {
      console.error(`⚠️  Telegram ${method} failed: ${e.message}`);
      return null;
    }
  };

  const send = async (text) => {
    const chunks = splitIntoChunks(text);
    let lastRes = null;
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `_(${i + 1}/${chunks.length})_\n` : '';
      lastRes = await tgCall('sendMessage', { chat_id: config.TELEGRAM_CHAT_ID, text: prefix + chunks[i], parse_mode: 'Markdown' });
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    return lastRes;
  };

  const STATE_FILE          = path.join(dir, 'state.json');
  const OPEN_POSITIONS_FILE = path.join(dir, 'open-positions.json');
  const OFFSET_FILE         = path.join(dir, 'tg-offset.json');

  const loadJSON = (file, fallback) => {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return fallback; }
  };
  const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

  const cmdHelp = async () => {
    await send(
`🤖 *${botLabel} Command Menu*

/scan — run a fresh scan now
/status — last saved scan result
/health — data connectivity + last run time
/positions — open positions, tracked automatically until close
/pairs — tracked symbols
/about — strategy overview
/signal — how to read a signal
/source — GitHub link
/help — this menu`
    );
  };

  const cmdStatus = async () => {
    const state = loadJSON(STATE_FILE, null);
    if (!state) return send('⚠️ No saved state yet. Run /scan or wait for the next scheduled scan.');

    let msg = `📊 *${botLabel} Status*\nLast run: ${state._lastRunAt || 'unknown'}`;

    for (const sym of config.SYMBOLS) {
      const s = state[sym];
      msg += `\n\n━━━━━━━━━━━━━━━━━━━━\n*${sym}*`;
      if (!s) { msg += `\nno data yet`; continue; }

      msg += ` — ${mdSafe(s.signal || 'unknown')}`;
      if (s.direction) msg += ` (${s.direction})`;
      if (s.price != null) msg += `\nPrice: $${Number(s.price).toFixed(4)}`;

      if (s.poc) {
        msg += `\nPOC $${Number(s.poc).toFixed(4)} · VAH $${Number(s.vah).toFixed(4)} · VAL $${Number(s.val).toFixed(4)}`;
      }

      if (s.bias2h || s.bias30m || s.bias15m) {
        msg += `\nBias — 2H:${biasStr(s.bias2h)} 30M:${biasStr(s.bias30m)} 15M:${biasStr(s.bias15m)}`;
      }
      if (s.voteTally) {
        msg += `\nVote: ${s.voteTally}${s.agreeing ? ` (${s.agreeing.join('+')} agree)` : ''}`;
      }

      if (s.entryPrice) {
        msg += `\nEntry: $${Number(s.entryPrice).toFixed(4)} · SL: $${Number(s.slPrice).toFixed(4)}`;
        msg += `\nTP1 (${Math.round((config.PARTIAL_EXIT_PCT || 0.5) * 100)}% exit): $${Number(s.tp1Price).toFixed(4)} (R:R ${s.rr1}) · TP2 (runner): $${Number(s.tp2Price).toFixed(4)} (R:R ${s.rr2})`;
      }

      if (s.signal === 'FIRED' && s.alertDelivered === false) {
        msg += `\n⚠️ *Alert was NOT delivered when this fired — queued for retry next scan.*`;
      }
      msg += `\nUpdated: ${s.updatedAt}`;
      if (s.updatedAt) {
        const ageMin = (Date.now() - new Date(s.updatedAt).getTime()) / 60000;
        if (ageMin > 45) {
          msg += `\n⚠️ *Stale — last updated ${Math.round(ageMin / 60)}min ago* (expected every ~15min)`;
        }
      }
    }
    await send(msg);
  };

  const cmdHealth = async () => {
    const state = loadJSON(STATE_FILE, {});
    let ok = false;
    try { ok = await healthCheck(); } catch { ok = false; }
    await send(
`🩺 *${botLabel} Health Check*

Data source (${exchangeName}): ${ok ? '✅ reachable' : '❌ unreachable'}
Last scan run: ${state._lastRunAt || 'never'}
Symbols tracked: ${config.SYMBOLS.join(', ')}`
    );
  };

  const cmdPositions = async () => {
    const state = loadJSON(STATE_FILE, {});
    const openPositions = loadJSON(OPEN_POSITIONS_FILE, {});
    let msg = `📌 *${botLabel} Positions*\n_Signals fire as alerts; open positions are then tracked automatically (SL/TP1/TP2) on every scan until they close — see /status for exit details once closed._\n`;
    for (const sym of config.SYMBOLS) {
      const s = state[sym];
      const open = openPositions[sym];
      if (open) {
        msg += `\n*${sym}*: 🟢 OPEN — ${open.direction} @ $${Number(open.entryPrice).toFixed(4)} (since ${new Date(open.entryTime * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
      } else if (s && s.signal && s.signal.startsWith('CLOSED_')) {
        const rrStr = s.rr !== undefined ? `${s.rr > 0 ? '+' : ''}${s.rr}R` : '';
        msg += `\n*${sym}*: ${mdSafe(s.signal.replace('CLOSED_', ''))} ${rrStr}`.trimEnd();
      } else {
        msg += `\n*${sym}*: ${s ? mdSafe(s.signal) : 'no data'}${s && s.entryPrice ? ` @ $${Number(s.entryPrice).toFixed(2)}` : ''}`;
      }
    }
    await send(msg);
  };

  const cmdScan = async () => {
    await send('🔍 Running a fresh scan now, one moment...');
    const { execSync } = require('child_process');
    try {
      execSync('node strategy.js', { cwd: dir, stdio: 'inherit', timeout: 5 * 60 * 1000 });
    } catch (e) {
      await send(`⚠️ Scan finished with an error: ${e.message}`);
    }
    await cmdStatus();
  };

  const cmdAbout = async () => {
    await send(
`📊 *${botLabel}* (v${version}) — Ghost Wick Protocol

Signal bot built on one tendency: *price tends to revisit where the most volume was traded.* That's a real market pattern, not a guarantee about any single trade.

*Strategy:* Volume Profile (POC + VAH + VAL) + Fibonacci (61.8-78.6% pocket) across three timeframes, each with one job — 2H macro bias, 30M structure (zone/Fib pocket/SL anchor), 15M trigger. Needs 2-of-3 timeframes to agree on direction before anything fires.

No hardcoded win-rate claim here. This bot does not target or achieve a 100% win rate — no trading system does. Run \`node backtest.js\` in the repo yourself for current, honest numbers over a window you haven't tuned against, and read the full funnel diagnostics, not just the headline win rate.

Zero lagging indicators. No EMA, no RSI. Pure structure.`
    );
  };

  const cmdPairs = async () => {
    const pairList = config.SYMBOLS.map(s => `• *${s}*`).join('\n');
    await send(
`💱 *Tracked Symbols (${config.SYMBOLS.length} total)*

${pairList}

Per-symbol win rate / R stats aren't hardcoded here — they change every
time the strategy logic changes, and a stale number in a bot response is
worse than no number. Run \`node backtest.js\` for current per-symbol stats.

Data source: *${exchangeName}*.`
    );
  };

  const cmdSignal = async () => {
    await send(
`📡 *How to Read a Signal*

When ${botLabel} fires, you'll receive:

🟢 *BUY* (or 🔴 *SELL*)
• *TF Vote:* which of 2H/30M/15M agreed, and the tally (2/3 or 3/3)
• *Entry:* the 30M Fib/POC/VAH/VAL confluence level
• *SL:* stop loss — 30M swing wick ± 0.25×ATR
• *TP1 / TP2:* a 2-stage exit — TP1 closes ${Math.round((config.PARTIAL_EXIT_PCT||0.5)*100)}% and moves the rest to breakeven; TP2 (the value-area edge) is the runner's target for the remaining ${Math.round((1-(config.PARTIAL_EXIT_PCT||0.5))*100)}%
• *15M trigger:* which rejection pattern(s) fired the signal

This is a probability-favored setup with a defined stop, not a guarantee.
Decide your own position size in advance — before an alert arrives, not
in the moment. A string of 3-4 losses in a row is normal variance, even
for a genuinely good strategy; size so that doesn't meaningfully hurt you.`
    );
  };

  const cmdSource = async () => {
    await send(
`🔗 *${botLabel} Source Code*

${sourceUrl ? `GitHub: ${sourceUrl}` : 'Ask the operator for the repo link.'}

Built by Abdin | Asterix Holdings Ltd | Accra, Ghana`
    );
  };

  const COMMANDS = {
    '/scan':      cmdScan,
    '/status':    cmdStatus,
    '/health':    cmdHealth,
    '/positions': cmdPositions,
    '/help':      cmdHelp,
    '/start':     cmdHelp,
    '/about':     cmdAbout,
    '/pairs':     cmdPairs,
    '/signal':    cmdSignal,
    '/source':    cmdSource,
  };

  // ── MAIN ───────────────────────────────────────────────────────────────
  const dwRes = await tgCall('deleteWebhook', { drop_pending_updates: false });
  if (dwRes && dwRes.ok) console.log('✅ deleteWebhook OK');
  else console.warn('⚠️  deleteWebhook returned unexpected result — continuing anyway');

  const offsetData = loadJSON(OFFSET_FILE, { offset: 0 });
  let currentOffset = offsetData.offset || 0;
  console.log(`📌 Starting from offset: ${currentOffset}`);

  // GitHub Actions cron scheduling is best-effort — GitHub's own docs
  // note schedule triggers "can be delayed during periods of high load,"
  // and a repo running MANY scheduled workflows (this one has 3 bots ×
  // scan/commands/weekly/backtest, plus keepalive) makes that worse. A
  // single instant getUpdates check per run means a command sent right
  // after this run finishes could sit unanswered until the NEXT run
  // actually fires — which, per GitHub's own caveat, isn't guaranteed to
  // be on time. Instead of one instant check, this run stays actively
  // listening via Telegram's own long-poll for several minutes, so a
  // command sent any time during this window gets caught by THIS run
  // rather than waiting on the next (possibly delayed) cron tick.
  const POLL_WINDOW_MS = 4.5 * 60 * 1000; // stays comfortably under the workflow's 6min timeout-minutes
  const LONG_POLL_SECONDS = 25;           // Telegram holds the connection open this long per call if idle
  const pollDeadline = Date.now() + POLL_WINDOW_MS;
  let totalProcessed = 0;

  while (Date.now() < pollDeadline) {
    const remainingS = Math.floor((pollDeadline - Date.now()) / 1000);
    const thisTimeout = Math.max(1, Math.min(LONG_POLL_SECONDS, remainingS - 2));
    if (thisTimeout < 3) break; // not enough time left for a meaningful long-poll — stop cleanly

    const updRes = await tgCall('getUpdates', { offset: currentOffset, timeout: thisTimeout, limit: 100 }, (thisTimeout + 10) * 1000);
    if (!updRes || !updRes.ok) {
      console.error('❌ getUpdates failed this cycle:', JSON.stringify(updRes), '— stopping this run cleanly (will retry next scheduled run).');
      break;
    }

    const updates = updRes.result;
    if (!updates.length) continue; // long-poll already waited ~thisTimeout seconds — loop straight back in

    const newOffset = updates[updates.length - 1].update_id + 1;
    saveJSON(OFFSET_FILE, { offset: newOffset });
    currentOffset = newOffset;
    console.log(`📨 Received ${updates.length} update(s). Offset advanced to ${newOffset} (saved before processing).`);

    for (const update of updates) {
      const msg = update.message || update.edited_message;
      const rawText = (msg && msg.text || '').trim();
      const chatId = msg && msg.chat && msg.chat.id;

      if (!rawText) continue;
      if (String(chatId) !== String(config.TELEGRAM_CHAT_ID)) {
        console.log(`  Ignored update ${update.update_id} from chat ${chatId} (not our chat)`);
        continue;
      }

      const cmd = rawText.toLowerCase().split(' ')[0].split('@')[0];
      if (COMMANDS[cmd]) {
        console.log(`▶️  Executing: ${cmd} (update_id ${update.update_id})`);
        await COMMANDS[cmd]();
      } else {
        console.log(`  Unknown command/text: "${rawText}" — ignored`);
      }
    }
    totalProcessed += updates.length;
  }

  console.log(`✅ Done. Processed ${totalProcessed} update(s) across this ~${(POLL_WINDOW_MS / 60000).toFixed(1)}min listening window. Offset is now ${currentOffset}.`);
};

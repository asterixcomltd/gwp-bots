/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — GIST PUBLISHER (shared/publish-gist.js)
 *
 *  Reads THIS bot's own signals.log.json (written by shared/run-live.js
 *  via shared/persistence.js, newest-first) and publishes any still-open,
 *  unexpired FIRED signals to the public GitHub Gist that AxTrader
 *  (axtrader.vercel.app) polls for its signal feed.
 *
 *  Run as a separate step AFTER strategy.js in each bot's *-scan.yml
 *  workflow, from that bot's own working-directory (bots/<name>), so
 *  __dirname-relative paths below resolve correctly via cwd.
 *
 *  Does a READ → MERGE → WRITE against the Gist rather than a blind
 *  overwrite, so it never clobbers signals published by any other
 *  source (e.g. AxTrader's own scripts/signal_bot.py) writing to the
 *  same file. Every entry this script writes is tagged source:"gwp-bots"
 *  so re-runs replace only this bot's own prior batch, never anyone
 *  else's.
 *
 *  Env vars:
 *    GIST_PAT   — GitHub PAT with 'gist' scope (required)
 *    GIST_ID    — defaults to the live AxTrader feed gist below
 *
 *  Usage: node ../../shared/publish-gist.js <crypto|forex|stocks>
 * ═══════════════════════════════════════════════════════════════════════
 */
const fs = require('fs');
const path = require('path');

const BOT = process.argv[2];
if (!['crypto', 'forex', 'stocks'].includes(BOT)) {
  console.error('❌ publish-gist.js: pass bot key as arg — crypto | forex | stocks');
  process.exit(1);
}

const GIST_ID = process.env.GIST_ID || 'a4caaf2993eea50322f31478391743b0';
const GIST_PAT = process.env.GIST_PAT || '';
const FILE_NAME = `${BOT}_signals.json`;

// How long a fired-but-unresolved GWP signal stays "live" on the frontend.
// GWP's structure timeframes (2H struct / 30M+15M trigger) are shorter-lived
// than a daily bias, so a generous-but-bounded window keeps the feed honest.
const EXPIRY_HOURS = BOT === 'stocks' ? 48 : 16;
const TF_LABEL = BOT === 'stocks' ? '1D' : '2H';

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bots', BOT, file), 'utf8'));
  } catch {
    return fallback;
  }
}

// ── Load this bot's own signal log (newest-first) ─────────────────────────
const log = readJSON('signals.log.json', []);

const nowMs = Date.now();
const expiryMs = EXPIRY_HOURS * 3600 * 1000;

const HUMANIZE = {
  POC_RECLAIM: 'POC reclaim',
  VAH_VAL_RECLAIM: 'VAH/VAL reclaim',
  PIN_BAR: 'Pin bar rejection',
  CLOSE_REJECTION: 'Close rejection',
  ENGULFING: 'Engulfing candle',
  LIQUIDITY_SWEEP: 'Liquidity sweep + reclaim',
};

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtTime(entryTimeSec) {
  const d = new Date(entryTimeSec * 1000);
  return d.toISOString().slice(11, 16); // "HH:MM" UTC
}

function scoreOf(sig) {
  const [agree, total] = String(sig.voteTally || '0/4').split('/').map(Number);
  const voteFrac = total ? agree / total : 0;
  const patternCount = Array.isArray(sig.patterns) ? sig.patterns.length : 0;
  const pocAligned = sig.multiTFPOC && sig.multiTFPOC.anyAligned;
  const fibAligned = sig.multiTFFib && sig.multiTFFib.anyAligned;
  let s = 55 + voteFrac * 35 + Math.min(patternCount, 3) * 3;
  if (pocAligned) s += 3;
  if (fibAligned) s += 3;
  return Math.max(45, Math.min(96, Math.round(s)));
}

function gradeOf(score) {
  if (score >= 85) return 'A+';
  if (score >= 72) return 'A';
  if (score >= 60) return 'B';
  return 'C';
}

function toAxTraderSignal(sig) {
  const score = scoreOf(sig);
  const pair = BOT === 'crypto' ? String(sig.symbol).replace('-', '/') : sig.symbol;
  const dir = sig.direction === 'SELL' ? 'SHORT' : 'LONG';
  const patterns = Array.isArray(sig.patterns) ? sig.patterns : [];
  const reasons = [
    ...patterns.map(p => HUMANIZE[p] || p),
    sig.confluencePivot && sig.fibPct ? `${sig.confluencePivot} · Fib ${sig.fibPct}` : null,
    Array.isArray(sig.agreeing) && sig.agreeing.length ? `${sig.agreeing.join('+')} agree (${sig.voteTally})` : null,
  ].filter(Boolean);

  const entryTs = (sig.entryTime || 0) * 1000;

  return {
    pair,
    dir,
    entry: fmtPrice(sig.entryPrice),
    sl: fmtPrice(sig.slPrice),
    tp1: fmtPrice(sig.tp1Price),
    tp2: fmtPrice(sig.tp2Price),
    tp: fmtPrice(sig.tp2Price),
    tp3: fmtPrice(sig.tp2Price),
    score,
    tf: TF_LABEL,
    grade: gradeOf(score),
    // v1.2.1 FIX: this used to prefer rr2 (TP2's ratio) whenever
    // available — but the AxTrader frontend's Signal Archive card only
    // ever renders tp1, never tp2/tp3 (no such row exists in that
    // template at all), and even the "smarter" live-feed card ends up
    // TP1-only for every GWP signal specifically: tp3 above is set to
    // tp2Price as a placeholder (GWP only ever computes two real
    // targets), which makes tp3 === tp2 === the frontend's normalized
    // `tp` field, so that card's "show TP2/TP3" condition
    // (s.tp3 !== s.tp) is always false for us. Net effect: users were
    // shown a TP2-based R:R number sitting next to a TP1 price it
    // didn't correspond to — e.g. a real signal could show "R:R 6.5"
    // next to a TP1 that only yields ~3R on its own. rr now matches
    // rr1, the ratio that actually belongs to the one price every card
    // layout displays. AxTrader's own scripts/signal_bot.py had the
    // identical bug (rr computed from its tp2) and got the same fix.
    rr: sig.rr1 != null ? String(Math.round(sig.rr1 * 10) / 10) : (sig.rr2 != null ? String(Math.round(sig.rr2 * 10) / 10) : ''),
    time: fmtTime(sig.entryTime || 0),
    ts: entryTs,
    expiresAt: entryTs + expiryMs,
    bot: BOT,
    structure: sig.biasD1 || '',
    event: sig.confluencePivot || 'GWP',
    reasons,
    hasOB: false,
    hasFVG: false,
    hasSweep: false,
    confirmations: patterns.length,
    htfBias: sig.biasD1 === 'BULLISH' ? 1 : sig.biasD1 === 'BEARISH' ? -1 : 0,
    inKillZone: false,
    source: 'gwp-bots',
  };
}

const fresh = log
  .filter(s => s.signal === 'FIRED' && !s.result) // still open, not yet resolved
  .filter(s => nowMs - (s.entryTime || 0) * 1000 < expiryMs)
  .slice(0, 20)
  .map(toAxTraderSignal);

console.log(`📤 GWP ${BOT}: ${fresh.length} live signal(s) to publish to Gist.`);

if (!GIST_PAT) {
  console.error('❌ No GIST_PAT secret — skipping Gist publish (signals stay Telegram-only this run).');
  process.exit(0); // don't fail the whole scan job over this
}

async function main() {
  // ── 1. Read current Gist file so we merge instead of clobber ────────────
  let existing = [];
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GIST_PAT}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (res.ok) {
      const gist = await res.json();
      const f = gist.files && gist.files[FILE_NAME];
      if (f && f.content) existing = JSON.parse(f.content);
    } else {
      console.warn(`⚠ Could not read existing Gist (${res.status}) — proceeding with fresh-only merge.`);
    }
  } catch (e) {
    console.warn('⚠ Gist read failed:', e.message);
  }
  if (!Array.isArray(existing)) existing = [];

  // ── 2. Merge: drop this bot's own stale gwp-bots entries + anything
  //      expired (any source), keep everything else (e.g. other engines),
  //      then append the fresh batch. ────────────────────────────────────
  const kept = existing.filter(s => {
    if (s.source === 'gwp-bots') return false; // replaced by fresh batch below
    if (s.expiresAt && s.expiresAt < nowMs) return false; // prune expired
    return true;
  });
  const merged = [...kept, ...fresh].slice(0, 40);

  // ── 3. Write back ─────────────────────────────────────────────────────
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      Authorization: `token ${GIST_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: { [FILE_NAME]: { content: JSON.stringify(merged, null, 2) } } }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Gist update failed (${res.status}): ${text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✅ Gist ${FILE_NAME} updated — ${merged.length} total signal(s) (${fresh.length} from gwp-bots).`);
}

main().catch(err => {
  console.error('❌ Fatal error in publish-gist.js:', err);
  process.exit(1);
});

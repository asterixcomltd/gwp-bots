/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED LIVE RUNNER (shared/run-live.js)
 *
 *  Ported directly from MVS-bot's strategy.js BOOT section and main IIFE.
 *  Each sub-bot's own strategy.js is just a few lines: build its data
 *  client (KuCoin or Twelve Data), then hand off to this one shared
 *  runner. Keeps the live-run sequencing (duplicate-run guard → flush
 *  pending alerts → check open positions → scan every symbol) identical
 *  across all three bots.
 * ═══════════════════════════════════════════════════════════════════════
 */
const core = require('./core');
const createTelegram = require('./telegram');
const createPersistence = require('./persistence');
const createEngine = require('./engine');
const createPositionTracker = require('./position-tracker');

const DUPLICATE_RUN_GUARD_MS = 5 * 60 * 1000; // 5 min — well under the 15 min cadence
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function runLive({ config, dataClient, botLabel, version, dir }) {
  const telegram = createTelegram(config);
  const persistence = createPersistence(dir);
  const engine = createEngine({ config, core, dataClient, telegram, persistence, botLabel, version });
  const positionTracker = createPositionTracker({ config, core, dataClient, telegram, persistence });

  console.log('');
  const boxBorder = '╔══════════════════════════════════════════════════════════════╗';
  console.log(boxBorder);
  {
    const interiorWidth = [...boxBorder].length - 2;
    const line1 = `${botLabel} v${version}`;
    const line2 = 'D1+2H+30M+15M — 3-of-4 vote (30M zone, 15M trigger)';
    const pad = (s) => '   ' + s + ' '.repeat(Math.max(0, interiorWidth - 3 - [...s].length));
    console.log(`║${pad(line1)}║`);
    console.log(`║${pad(line2)}║`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`   Assets  : ${config.SYMBOLS.join(', ')}`);
  console.log(`   TFs     : D1(${config.DAILY_VP_LOOKBACK}) / 2H(${config.BIAS_VP_LOOKBACK}) / 30M(${config.STRUCT_VP_LOOKBACK}) / 15M(${config.TRIGGER_VP_LOOKBACK})`);
  console.log(`   Trigger : ${config.REJECTION_MIN_PATTERNS}-of-5 patterns min | solo=${config.ALLOW_SOLO_TRIGGER}`);
  console.log(`   Cooldown: ${config.SIGNAL_COOLDOWN_BARS} × 30M bars`);
  console.log('');

  if (persistence.isDuplicateRun(DUPLICATE_RUN_GUARD_MS)) {
    console.log(`⏸️  Skipping: a scan already ran within the last ${DUPLICATE_RUN_GUARD_MS / 60000} min. Exiting cleanly, no state changed.`);
    process.exit(0);
  }

  await engine.flushPendingAlerts();

  try {
    await positionTracker.checkOpenPositions();
  } catch (e) {
    console.error('  ❌ position-tracker failed this run (non-fatal, new-signal scanning continues):', e.message);
  }

  for (const sym of config.SYMBOLS) {
    await engine.runStrategy(sym);
    if (config.SYMBOLS.indexOf(sym) < config.SYMBOLS.length - 1) {
      await sleep(2000);
    }
  }

  persistence.touchLastRun();
  console.log('\n✅ Scan complete. Exiting.');
  process.exit(0);
};

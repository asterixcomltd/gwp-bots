// Local smoke test — NOT part of the shipped repo. Verifies the engine
// pipeline runs end-to-end against synthetic candle data with no runtime
// errors, for all three sub-bots' configs.
const path = require('path');

function genCandles(n, startTime, barSeconds, startPrice, seedBase) {
  const bars = [];
  let price = startPrice;
  let seed = seedBase;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.48) * price * 0.004;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + rand() * price * 0.002;
    const low = Math.min(open, close) - rand() * price * 0.002;
    const volume = 100 + rand() * 900;
    bars.push({ time: startTime + i * barSeconds, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

async function testBot(botDir, botName, tfSeconds) {
  const config = require(path.join(botDir, 'config.js'));
  const core = require('../shared/core.js');
  const createEngine = require('../shared/engine.js');
  const createTelegram = require('../shared/telegram.js');
  const createPersistence = require('../shared/persistence.js');

  const now = Math.floor(Date.now() / 1000);
  const fakeGetKlines = async (symbol, interval, limit) => {
    const bs = interval === config.DAILY_TIMEFRAME ? tfSeconds.daily
      : interval === config.BIAS_TIMEFRAME ? tfSeconds.bias
      : interval === config.STRUCT_TIMEFRAME ? tfSeconds.struct
      : tfSeconds.trigger;
    const startTime = now - (limit + 5) * bs;
    return genCandles(limit + 5, startTime, bs, 100 + Math.random() * 50, symbol.length * 7 + 13);
  };

  const dataClient = { getKlines: fakeGetKlines };
  const telegram = createTelegram(config);
  telegram.sendSafe = async () => ({ success: true }); // stub network send

  const tmpDir = path.join('/tmp', 'gwp-smoke-' + botName);
  require('fs').mkdirSync(tmpDir, { recursive: true });
  const persistence = createPersistence(tmpDir);

  const engine = createEngine({ config, core, dataClient, telegram, persistence, botLabel: botName, version: '1.0.0' });

  let errors = 0;
  for (const sym of config.SYMBOLS.slice(0, 5)) {
    try {
      await engine.runStrategy(sym);
    } catch (e) {
      errors++;
      console.error(`[${botName}] ERROR on ${sym}:`, e.stack);
    }
  }
  console.log(`[${botName}] completed ${config.SYMBOLS.slice(0,5).length} symbols, ${errors} error(s).`);
  return errors;
}

(async () => {
  let totalErrors = 0;
  // v1.1.6 FIX: this used to pass ONE shared, hardcoded
  // { daily: 86400, bias: 7200, struct: 1800, trigger: 900 } to all three
  // bots — the PRE-v1.1.4-RE-ROLE mapping (bias=2H/struct=30M). Since the
  // RE-ROLE, production is bias=30M(1800s)/struct=2H(7200s) — exactly
  // backwards from what this test fed fakeGetKlines(). It never crashed
  // (fakeGetKlines just generates bars at whatever interval it's told,
  // valid either way), so this "smoke test" was silently exercising the
  // OLD physical-TF wiring — a false green checkmark, same bug as the
  // backtest smoke test. Deriving tfSeconds from each bot's own config
  // (which is what a real GH Actions run does — config.BIAS_BAR_SECONDS/
  // STRUCT_BAR_SECONDS are already generic and role-based) means this
  // can never drift out of sync with config-base.js again.
  for (const [dir, name] of [['../bots/crypto', 'GWP-Crypto'], ['../bots/forex', 'GWP-Forex'], ['../bots/stocks', 'GWP-Stocks']]) {
    const botConfig = require(path.join(__dirname, dir, 'config.js'));
    const tfSeconds = {
      daily: botConfig.DAILY_BAR_SECONDS,
      bias: botConfig.BIAS_BAR_SECONDS,
      struct: botConfig.STRUCT_BAR_SECONDS,
      trigger: botConfig.TRIGGER_BAR_SECONDS,
    };
    totalErrors += await testBot(path.join(__dirname, dir), name, tfSeconds);
  }
  console.log(totalErrors === 0 ? '\n✅ ALL SMOKE TESTS PASSED' : `\n❌ ${totalErrors} error(s) total`);
  process.exit(totalErrors === 0 ? 0 : 1);
})();

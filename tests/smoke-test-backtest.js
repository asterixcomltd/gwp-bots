const path = require('path');

// Generates ONE base 15M random walk, then aggregates it UP into
// 30M/2H/D1 bars (open=first, close=last, high=max, low=min, volume=
// sum) — exactly how real exchange data works (a 2H candle IS eight 15M
// candles combined). Earlier smoke-test data generated a fully
// INDEPENDENT random walk per timeframe, which made the multi-TF
// alignment gates untestable (and briefly hid a real tolerance-scale bug
// — see core.js's v1.1.1 fix notes on computeMultiTFPOCAlignment).
function genBase15m(n, startTime, startPrice, seedBase) {
  const bars = [];
  let price = startPrice;
  let seed = seedBase;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.5) * price * 0.004;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + rand() * price * 0.0015;
    const low = Math.min(open, close) - rand() * price * 0.0015;
    const volume = 100 + rand() * 900;
    bars.push({ time: startTime + i * 900, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

function aggregate(bars15m, groupBarSeconds) {
  const groupSize = groupBarSeconds / 900;
  const out = [];
  for (let i = 0; i < bars15m.length; i += groupSize) {
    const chunk = bars15m.slice(i, i + groupSize);
    if (!chunk.length) continue;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open, close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map(b => b.high)), low: Math.min(...chunk.map(b => b.low)),
      volume: chunk.reduce((s, b) => s + b.volume, 0),
    });
  }
  return out;
}

async function testBacktest(botDir, botName) {
  const config = require(path.join(botDir, 'config.js'));
  const core = require('../shared/core.js');
  const createBacktestEngine = require('../shared/backtest-engine.js');

  const days = 60;
  const now = Math.floor(Date.now() / 1000);
  // D1 needs its own much longer history to satisfy DAILY_VP_LOOKBACK's
  // warmup (~205 daily bars) — independent of the 60-day evaluation
  // window, same as a real backtest always fetches extra warmup history.
  const dailyDays = config.DAILY_VP_LOOKBACK + days + 10;
  const n15m = dailyDays * 96; // 96 × 15min bars per day
  const base15m = genBase15m(n15m, now - n15m * 900, 100, 11);

  const trigger = base15m;
  const struct  = aggregate(base15m, 1800);
  const bias    = aggregate(base15m, 7200);
  const daily   = aggregate(base15m, 86400);

  const { backtestSymbol, generateReport } = createBacktestEngine({ config, core, version: '1.0.0', botLabel: botName });
  const evalWindowStartTime = now - days * 86400;

  const { trades, funnel } = await backtestSymbol('TESTSYM', trigger, struct, bias, daily, evalWindowStartTime);
  console.log(`[${botName}] backtest trades=${trades.length}, funnel=`, JSON.stringify(funnel));

  const { lines } = generateReport(trades, days, { TESTSYM: funnel });
  console.log(`[${botName}] report generated, ${lines.length} lines. Sample:\n` + lines.slice(0, 12).join('\n'));
  return 0;
}

(async () => {
  let errors = 0;
  for (const [dir, name] of [['bots/crypto','GWP-Crypto'],['bots/forex','GWP-Forex'],['bots/stocks','GWP-Stocks']]) {
    try {
      await testBacktest(path.join(__dirname, '..', dir), name);
    } catch (e) {
      errors++;
      console.error(`[${name}] BACKTEST ERROR:`, e.stack);
    }
  }
  console.log(errors === 0 ? '\n✅ BACKTEST SMOKE TEST PASSED' : `\n❌ ${errors} error(s)`);
  process.exit(errors === 0 ? 0 : 1);
})();

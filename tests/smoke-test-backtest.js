const path = require('path');

function genCandles(n, startTime, barSeconds, startPrice, seedBase) {
  const bars = [];
  let price = startPrice;
  let seed = seedBase;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.5) * price * 0.006;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + rand() * price * 0.003;
    const low = Math.min(open, close) - rand() * price * 0.003;
    const volume = 100 + rand() * 900;
    bars.push({ time: startTime + i * barSeconds, open, high, low, close, volume });
    price = close;
  }
  return bars;
}

async function testBacktest(botDir, botName) {
  const config = require(path.join(botDir, 'config.js'));
  const core = require('../shared/core.js');
  const createBacktestEngine = require('../shared/backtest-engine.js');

  const days = 60;
  const now = Math.floor(Date.now() / 1000);
  const struct = genCandles(Math.ceil(days * 86400 / 1800) + 100, now - (Math.ceil(days*86400/1800)+100)*1800, 1800, 100, 11);
  const bias   = genCandles(Math.ceil(days * 86400 / 7200) + 50, now - (Math.ceil(days*86400/7200)+50)*7200, 7200, 100, 22);
  const trigger= genCandles(Math.ceil(days * 86400 / 900) + 100, now - (Math.ceil(days*86400/900)+100)*900, 900, 100, 33);

  const { backtestSymbol, generateReport } = createBacktestEngine({ config, core, version: '1.0.0', botLabel: botName });
  const evalWindowStartTime = now - days * 86400;

  const { trades, funnel } = await backtestSymbol('TESTSYM', trigger, struct, bias, evalWindowStartTime);
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

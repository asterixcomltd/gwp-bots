/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED BOT SETUP (shared/run-setup-bot.js)
 *
 *  Ported directly from MVS-bot's setup-bot.js. Run ONCE per sub-bot to
 *  configure the Telegram bot's profile, description, and command menu.
 *
 *  HONESTY NOTE: unlike MVS-bot's own setup-bot.js (which could quote a
 *  dated, real backtest snapshot in the bot description), this is a
 *  freshly built bot with no backtest history of its own yet — no
 *  performance numbers are hardcoded here. Run `node backtest.js` in
 *  each bot's own folder first, then optionally edit the description
 *  below to add a dated snapshot, same standing rule MVS-bot's own
 *  header documents ("update this snapshot whenever config.js changes
 *  meaningfully").
 * ═══════════════════════════════════════════════════════════════════════
 */
const axios = require('axios');

module.exports = async function runSetupBot({ config, botLabel, botShortName, shortDescription, symbolsLabel, sourceUrl }) {
  const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

  const call = async (method, params = {}) => {
    try {
      const res = await axios.post(`${TG}/${method}`, params, { timeout: 10000 });
      if (res.data.ok) console.log(`✅ ${method} — OK`);
      else console.error(`❌ ${method} — ${JSON.stringify(res.data)}`);
      return res.data;
    } catch (e) {
      console.error(`❌ ${method} failed: ${e.message}`);
    }
  };

  console.log(`\n🤖 ${botLabel} Bot Setup\n`);

  await call('deleteWebhook', { drop_pending_updates: true });

  await call('setMyName', { name: botShortName });

  await call('setMyShortDescription', { short_description: shortDescription });

  await call('setMyDescription', {
    description:
`${botLabel} — Ghost Wick Protocol

Volume Profile (POC/VAH/VAL) + Fibonacci, D1/2H/30M/15M, 3-of-4 vote + dual multi-TF confirmation to fire.

No hardcoded win-rate here — run backtest.js yourself for current,
honest numbers over a window you haven't tuned against.

${symbolsLabel}
${sourceUrl ? sourceUrl : ''}`.trim()
  });

  await call('setMyCommands', {
    commands: [
      { command: 'start',     description: '🤖 Welcome — what is this bot?' },
      { command: 'about',     description: '📊 Strategy overview + how to backtest' },
      { command: 'pairs',     description: '💱 Which symbols are tracked' },
      { command: 'signal',    description: '📡 How to read a signal when it fires' },
      { command: 'positions', description: '📌 Open + last-closed positions' },
      { command: 'source',    description: '🔗 GitHub repo link' },
      { command: 'health',    description: '🩺 Data source status + last scan time' },
      { command: 'status',    description: '📈 Last saved scan result' },
    ]
  });

  await call('sendMessage', {
    chat_id: config.TELEGRAM_CHAT_ID,
    text:
`✅ *${botLabel} Bot Setup Complete*

Bot profile, description and command menu have been configured.

Tap the */* button in this chat to see the command menu. Signal alerts will fire automatically whenever a tracked symbol hits a valid 2H/30M/15M confluence zone.`,
    parse_mode: 'Markdown'
  });

  console.log('\n✅ Setup complete.\n');
};

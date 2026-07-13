/**
 * ═══════════════════════════════════════════════════════════════════════
 *  GWP — SHARED TELEGRAM CLIENT (shared/telegram.js)
 *
 *  Ported directly from MVS-bot's strategy.js Telegram section. Every GWP
 *  sub-bot (Crypto / Forex / Stocks) requires this ONE file instead of
 *  keeping its own copy — same anti-drift reasoning as core.js.
 *
 *  mdSafe(): Telegram's legacy Markdown parse mode has NO escape
 *  mechanism — a single unpaired `_`, `*`, or backtick anywhere in the
 *  message causes Telegram to reject the ENTIRE message with a 400
 *  "can't parse entities" error, silently (no exception surfaces, the
 *  GitHub Actions run still shows green). Any internal identifier with
 *  an underscore (POC_RECLAIM, EARLY_TIMEOUT, NO_AGREEMENT, etc.) would
 *  silently break any message it appears in. mdSafe() neutralizes this
 *  by replacing underscores with spaces for DISPLAY only — never touches
 *  the underlying value used in comparisons/logic elsewhere.
 *
 *  sendSafe(): retries 3x (1s/2s/3s backoff) on transient failure before
 *  giving up, and always returns an explicit { success, data|error } so
 *  the caller can react honestly instead of silently treating a dropped
 *  alert as delivered.
 * ═══════════════════════════════════════════════════════════════════════
 */
const axios = require('axios');

module.exports = function createTelegram(config) {
  const TG = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

  const mdSafe = (s) => String(s ?? '').replace(/_/g, ' ');

  const sendSafe = async (chatId, text, opts = {}, ms = 10000, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await Promise.race([
        axios.post(`${TG}/sendMessage`, { chat_id: chatId, text, ...opts }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Telegram send timed out')), ms)),
      ]).catch((e) => ({ __failed: true, message: e.message }));

      if (!result || !result.__failed) return { success: true, data: result?.data };

      console.error(`  ⚠️ Telegram send failed/timed out (attempt ${attempt}/${maxRetries}): ${result.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
    console.error(`  ❌ Telegram send FAILED after ${maxRetries} attempts — this alert was NOT delivered.`);
    return { success: false, error: 'Telegram send failed after all retries' };
  };

  const getUpdates = async (offset, timeout = 5) => {
    try {
      const res = await axios.get(`${TG}/getUpdates`, { params: { offset, timeout }, timeout: (timeout + 10) * 1000 });
      return res.data;
    } catch (e) {
      console.error('  ❌ Telegram getUpdates failed:', e.message);
      return null;
    }
  };

  return { TG, mdSafe, sendSafe, getUpdates };
};

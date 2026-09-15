import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function loadEnv(file = '.env') {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function positive(value, fallback, name) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

export function config(env = process.env, cwd = process.cwd()) {
  const requirePdf = env.REQUIRE_PDF ?? 'true';
  if (!['true', 'false'].includes(requirePdf)) throw new Error('REQUIRE_PDF must be true or false');
  for (const key of ['AUTO_WILEY_HIGHLIGHTS', 'WILEY_PDF_REDISTRIBUTION_ALLOWED']) {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key])) throw new Error(`${key} must be true or false`);
  }
  return {
    webhook: (env.DISCORD_WEBHOOK_URL || '').trim(), threadId: (env.DISCORD_THREAD_ID || '').trim(),
    mailto: env.CROSSREF_MAILTO || '', requirePdf: requirePdf === 'true',
    autoWileyHighlights: env.AUTO_WILEY_HIGHLIGHTS === 'true',
    wileyRedistributionAllowed: env.WILEY_PDF_REDISTRIBUTION_ALLOWED === 'true',
    intervalMs: positive(env.CHECK_INTERVAL_HOURS, 24, 'CHECK_INTERVAL_HOURS') * 3600000,
    maxPdfBytes: positive(env.MAX_PDF_BYTES, 9437184, 'MAX_PDF_BYTES'),
    manifest: path.resolve(cwd, env.ISSUE_MANIFEST || 'issues.json'),
    stateDir: path.resolve(cwd, env.STATE_DIR || 'data'),
  };
}

export function webhookUrl(config, messageId) {
  let url;
  try { url = new URL(config.webhook); } catch { throw new Error('Set DISCORD_WEBHOOK_URL in .env'); }
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.username || url.password || url.port ||
      !/^\/api\/(?:v10\/)?webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error('DISCORD_WEBHOOK_URL must be a Discord channel webhook URL');
  }
  if (config.threadId && !/^\d+$/.test(config.threadId)) throw new Error('DISCORD_THREAD_ID must be a numeric ID');
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  if (messageId) {
    if (!/^\d+$/.test(messageId)) throw new Error('Invalid Discord message ID');
    url.pathname += `/messages/${messageId}`;
  } else url.searchParams.set('wait', 'true');
  if (config.threadId) url.searchParams.set('thread_id', config.threadId);
  return url;
}

export function destinationId(config) {
  const url = webhookUrl(config);
  const id = url.pathname.match(/webhooks\/(\d+)/)[1];
  return createHash('sha256').update(`${id}:${config.threadId}`).digest('hex').slice(0, 16);
}

export function safeError(error, cfg) {
  let text = String(error?.message || error);
  if (cfg?.webhook) text = text.split(cfg.webhook).join('[webhook redacted]');
  return text.replace(/https:\/\/[^\s]*discord[^\s]*/gi, '[Discord URL redacted]');
}

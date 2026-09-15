import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { journals, selectIssue, discover } from '../src/journals.mjs';
import { config, destinationId, webhookUrl, safeError } from '../src/config.mjs';
import { attachmentFor } from '../src/attachments.mjs';
import { deliver, DeliveryError, payloadFor } from '../src/discord.mjs';
import { runCheck, resolvePending } from '../src/bot.mjs';
import { readState, withLock } from '../src/state.mjs';

const cfgBase = { webhook: 'https://discord.com/api/webhooks/123456/test_token', threadId: '', maxPdfBytes: 1000, requirePdf: false };
function record(volume = '104', issue = '9', extra = {}) {
  return { type: 'journal-article', volume, issue, DOI: `10.1002/example${issue}`, title: ['A test paper'], 'published-print': { 'date-parts': [[2026, 9]] }, ...extra };
}
const now = new Date('2026-09-14T12:00:00Z');
function sample(journal) { return selectIssue(journal, [record()], now); }
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-bot-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { ...cfgBase, stateDir: dir, manifest: path.join(dir, 'issues.json') };
}

test('selects numeric latest issue and skips early-view without issue assignment', () => {
  const issue = selectIssue(journals[0], [record('104', '9'), record('104', '10'), record('105', '', { title: ['Early view'] })], now);
  assert.equal(issue.key, 'cjce:104:10');
});

test('future-only issues excluded but online publication permits future cover date', () => {
  const future = record('104', '10', { 'published-print': { 'date-parts': [[2026, 10]] } });
  assert.equal(selectIssue(journals[0], [record(), future], now).number, '9');
  future['published-online'] = { 'date-parts': [[2026, 9, 8]] };
  assert.equal(selectIssue(journals[0], [record(), future], now).number, '10');
});

test('normalizes titles, excludes issue information, deduplicates DOI, uses Wiley issue record', () => {
  const issue = selectIssue(journals[0], [record(), record(), record('104', '9', { DOI: '10.x/info', title: ['Issue Information'] }),
    record('104', '9', { type: 'journal-issue', resource: { primary: { URL: 'https://onlinelibrary.wiley.com/toc/1939019x/104/9' } } })], now);
  assert.equal(issue.articles.length, 1);
  assert.match(issue.issueUrl, /\/104\/9$/);
});


test('Crossref pagination reaches assigned issues beyond first page', async () => {
  let calls = 0;
  const issue = await discover(journals[0], { now, fetchImpl: async url => {
    assert.equal(url.searchParams.get('sort'), 'indexed');
    calls++;
    return Response.json({ message: { items: calls === 1 ? Array.from({ length: 1000 }, () => ({ title: ['Early view'] })) : [record()], 'total-results': 1001, 'next-cursor': 'next' } });
  } });
  assert.equal(calls, 2); assert.equal(issue.number, '9');
});

test('configuration rejects invalid values and webhook lookalike domains', () => {
  assert.throws(() => config({ CHECK_INTERVAL_HOURS: 'NaN' }));
  assert.throws(() => config({ REQUIRE_PDF: 'yes' }));
  assert.throws(() => webhookUrl({ ...cfgBase, webhook: 'https://discord.com.evil.test/api/webhooks/123/token' }));
  assert.match(webhookUrl(cfgBase).href, /wait=true/);
  assert.notEqual(destinationId(cfgBase), destinationId({ ...cfgBase, threadId: '123' }));
  assert.equal(destinationId(cfgBase), destinationId({ ...cfgBase, webhook: cfgBase.webhook.replace('test_token', 'rotated') }));
  assert.doesNotMatch(safeError(new Error(cfgBase.webhook), cfgBase), /test_token/);
});

test('attachment requires permission and validates PDF bytes and size', async t => {
  const cfg = await temp(t), issue = sample(journals[0]);
  const file = path.join(cfg.stateDir, 'issue.pdf');
  await fs.writeFile(file, '%PDF-1.7\nfixture');
  const entry = { path: file, permissionNote: 'Permission from rightsholder', redistributionAllowed: false };
  await fs.writeFile(cfg.manifest, JSON.stringify({ [issue.key]: entry }));
  await assert.rejects(attachmentFor(issue, cfg), /permission/);
  entry.redistributionAllowed = true;
  await fs.writeFile(cfg.manifest, JSON.stringify({ [issue.key]: entry }));
  assert.equal((await attachmentFor(issue, cfg)).name, 'cjce-104-9.pdf');
  await fs.writeFile(file, '<html>Access denied</html>');
  await assert.rejects(attachmentFor(issue, cfg), /invalid/);
  await fs.writeFile(file, Buffer.alloc(1001));
  await assert.rejects(attachmentFor(issue, cfg), /exceeds/);
});

test('Discord multipart includes PDF and suppresses all mentions; rate limit obeyed', async () => {
  let calls = 0, slept = 0;
  const attachment = { bytes: Buffer.from('%PDF-1.7 fixture'), name: 'issue.pdf' };
  const payload = payloadFor(sample(journals[0]), attachment);
  const id = await deliver(cfgBase, payload, attachment, undefined, { sleep: async ms => { slept = ms; }, fetchImpl: async (url, opts) => {
    calls++;
    assert.equal(url.searchParams.get('wait'), 'true');
    assert.equal(opts.method, 'POST');
    assert.ok(opts.body instanceof FormData);
    assert.equal(await opts.body.get('files[0]').text(), '%PDF-1.7 fixture');
    assert.deepEqual(JSON.parse(opts.body.get('payload_json')).allowed_mentions, { parse: [] });
    return calls === 1 ? Response.json({ retry_after: 0.2 }, { status: 429 }) : Response.json({ id: '987654' });
  } });
  assert.equal(id, '987654'); assert.equal(calls, 2); assert.equal(slept, 300);
});

test('ambiguous Discord failure is not retried automatically', async () => {
  let calls = 0;
  await assert.rejects(deliver(cfgBase, {}, null, undefined, { fetchImpl: async () => { calls++; throw new Error('network'); } }), e => e.ambiguous);
  assert.equal(calls, 1);
});

test('persisted state prevents repeats, then adds PDF by editing the original message', async t => {
  const cfg = await temp(t); let sends = 0, pdf = null, edits = 0;
  const deps = { discoverFn: async j => sample(j), attachmentFn: async () => pdf, log: () => {}, deliverFn: async (_c, _p, _a, id) => { sends++; if (id) edits++; return id || String(sends); } };
  assert.equal(await runCheck(cfg, deps), 0);
  assert.equal(await runCheck(cfg, deps), 0);
  assert.equal(sends, 1);
  pdf = { bytes: Buffer.from('%PDF-1.7'), name: 'issue.pdf', hash: 'abc' };
  await runCheck(cfg, deps);
  assert.equal(sends, 2); assert.equal(edits, 1);
  await runCheck(cfg, deps); assert.equal(sends, 2);
});

test('required PDF delays delivery and first run only posts latest', async t => {
  const cfg = { ...await temp(t), requirePdf: true }; let sends = 0;
  await runCheck(cfg, { discoverFn: async j => sample(j), attachmentFn: async () => null, log: () => {}, deliverFn: async () => { sends++; return '1'; } });
  assert.equal(sends, 0);
});

test('uncertain delivery persists and requires resolution', async t => {
  const cfg = await temp(t); let calls = 0;
  const deps = { discoverFn: async j => sample(j), attachmentFn: async () => null, log: () => {}, deliverFn: async () => { calls++; throw new DeliveryError('uncertain', true); } };
  assert.equal(await runCheck(cfg, deps), 1);
  assert.equal(await runCheck(cfg, deps), 1); assert.equal(calls, 1);
  await resolvePending(cfg, 'cjce:104:9', '555');
  deps.deliverFn = async () => { calls++; return '556'; };
  assert.equal(await runCheck(cfg, deps), 0); assert.equal(calls, 1);
});

test('known Discord rejection restores state and allows the next check', async t => {
  const cfg = await temp(t); let calls = 0;
  const deps = { discoverFn: async j => sample(j), attachmentFn: async () => null, log: () => {}, deliverFn: async () => { calls++; throw new DeliveryError('rate limited', false); } };
  assert.equal(await runCheck(cfg, deps), 1);
  deps.deliverFn = async () => { calls++; return String(calls); };
  assert.equal(await runCheck(cfg, deps), 0);
  assert.equal(calls, 2);
});

test('metadata regression does not post older issues', async t => {
  const cfg = await temp(t); let calls = 0;
  const deps = { discoverFn: async j => sample(j), attachmentFn: async () => null, log: () => {}, deliverFn: async () => String(++calls) };
  await runCheck(cfg, deps);
  deps.discoverFn = async j => selectIssue(j, [record('104', '8')], now);
  await runCheck(cfg, deps);
  assert.equal(calls, 1);
});

test('failed discovery does not send a misleading issue announcement', async t => {
  const cfg = await temp(t); let sent = 0;
  const failures = await runCheck(cfg, { discoverFn: async j => { if (j.id === 'cjce') throw new Error('upstream unavailable'); return sample(j); }, attachmentFn: async () => null, log: () => {}, deliverFn: async () => { sent++; return '1'; } });
  assert.equal(failures, 1); assert.equal(sent, 0);
});

test('state corruption fails closed and concurrent run lock prevents double posting', async t => {
  const cfg = await temp(t);
  const file = path.join(cfg.stateDir, 'state.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(readState(file), /corrupt/);
  await withLock(cfg.stateDir, async () => { await assert.rejects(withLock(cfg.stateDir, async () => {}), /already running/); });
});

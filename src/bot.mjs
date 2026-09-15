import { journals, discover, compareIssues } from './journals.mjs';
import { attachmentFor } from './attachments.mjs';
import { payloadFor, deliver } from './discord.mjs';
import { destinationId, safeError } from './config.mjs';
import { withLock, readState, saveState } from './state.mjs';

export async function runCheck(cfg, { discoverFn = discover, attachmentFn = attachmentFor, deliverFn = deliver, log = console.log } = {}) {
  const destination = destinationId(cfg);
  return withLock(cfg.stateDir, async file => {
    const state = await readState(file);
    const target = state.destinations[destination] ??= { issues: {}, latest: {} };
    let failures = 0;
    for (const journal of journals) {
      try {
        const issue = await discoverFn(journal, { mailto: cfg.mailto });
        const previous = target.issues[issue.key];
        if (Object.entries(target.issues).some(([key, value]) => key.startsWith(`${journal.id}:`) && value.status === 'pending')) {
          throw new Error(`${journal.id}: unresolved delivery; inspect the channel then use resolve (see README)`);
        }
        if (target.latest[journal.id] && compareIssues(issue, target.latest[journal.id]) < 0) {
          log(`${issue.key}: older than last delivered issue; skipped`); continue;
        }
        const attachment = await attachmentFn(issue, cfg);
        if (previous?.status === 'sent' && (!attachment || previous.pdfHash === attachment.hash)) {
          log(`${issue.key}: already delivered`); continue;
        }
        if (!attachment && cfg.requirePdf) { log(`${issue.key}: waiting for a highlights PDF or an authorized file in issues.json`); continue; }
        const pending = { status: 'pending', volume: issue.volume, number: issue.number, messageId: previous?.messageId, pdfHash: attachment?.hash || null, startedAt: new Date().toISOString() };
        target.issues[issue.key] = pending;
        await saveState(file, state);
        let id;
        try { id = await deliverFn(cfg, payloadFor(issue, attachment), attachment, previous?.messageId); }
        catch (e) {
          if (e.ambiguous === false) {
            if (previous) target.issues[issue.key] = previous;
            else delete target.issues[issue.key];
            await saveState(file, state);
          }
          throw e;
        }
        target.issues[issue.key] = { ...pending, status: 'sent', messageId: id, sentAt: new Date().toISOString() };
        target.latest[journal.id] = { volume: issue.volume, number: issue.number };
        await saveState(file, state);
        log(`${issue.key}: ${previous?.messageId ? 'updated' : 'posted'} (message ${id})`);
      } catch (error) { failures++; log(`${journal.id}: ${safeError(error, cfg)}`); }
    }
    return failures;
  });
}

export async function resolvePending(cfg, key, result) {
  if (!/^cjce:\d+:\d+$/.test(key || '') || !(result === 'retry' || /^\d+$/.test(result || ''))) throw new Error('Usage: node src/cli.mjs resolve JOURNAL:VOLUME:ISSUE MESSAGE_ID|retry');
  return withLock(cfg.stateDir, async file => {
    const state = await readState(file);
    const target = state.destinations[destinationId(cfg)];
    const item = target?.issues[key];
    if (item?.status !== 'pending') throw new Error('No pending delivery matches that issue');
    if (result === 'retry') {
      if (item.messageId) target.issues[key] = { ...item, status: 'sent', pdfHash: null };
      else delete target.issues[key];
    } else {
      target.issues[key] = { ...item, status: 'sent', messageId: result, sentAt: new Date().toISOString() };
      const journalId = key.split(':')[0];
      if (!target.latest[journalId] || compareIssues(item, target.latest[journalId]) > 0) {
        target.latest[journalId] = { volume: item.volume, number: item.number };
      }
    }
    await saveState(file, state);
  });
}

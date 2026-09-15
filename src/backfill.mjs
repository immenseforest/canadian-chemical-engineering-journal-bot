import { compareIssues } from './journals.mjs';
import { payloadFor, deliver } from './discord.mjs';
import { destinationId } from './config.mjs';
import { withLock, readState, saveState } from './state.mjs';

export async function backfill(cfg, issues, { deliverFn = deliver, attachmentFn = async () => null, log = console.log } = {}) {
  const ordered = [...issues].sort(compareIssues);
  if (new Set(ordered.map(i => i.key)).size !== ordered.length) throw new Error('Duplicate issue in backfill plan');
  // Validate every message before changing Discord.
  const prepared = [];
  for (const issue of ordered) {
    const attachment = await attachmentFn(issue, cfg);
    prepared.push({ issue, attachment, payload: payloadFor(issue, attachment) });
  }
  return withLock(cfg.stateDir, async file => {
    const state = await readState(file);
    const target = state.destinations[destinationId(cfg)] ??= { issues: {}, latest: {} };
    if (Object.values(target.issues).some(i => i.status === 'pending')) throw new Error('Resolve pending delivery before backfilling');
    const receipts = [];
    for (const {issue, attachment, payload} of prepared) {
      const prior = target.issues[issue.key];
      if (prior?.status === 'sent' && (!attachment || prior.pdfHash === attachment.hash)) {
        receipts.push({key:issue.key,messageId:prior.messageId,action:'skipped'}); continue;
      }
      target.issues[issue.key] = {status:'pending',volume:issue.volume,number:issue.number,messageId:prior?.messageId,pdfHash:attachment?.hash || null,startedAt:new Date().toISOString()};
      await saveState(file,state);
      let id;
      try { id = await deliverFn(cfg,payload,attachment,prior?.messageId); }
      catch(e) {
        if(e.ambiguous === false) {
          if(prior) target.issues[issue.key] = prior; else delete target.issues[issue.key];
          await saveState(file,state);
        }
        throw e;
      }
      target.issues[issue.key] = {...target.issues[issue.key],status:'sent',messageId:id,sentAt:new Date().toISOString()};
      // Historical delivery must never move the live latest-issue marker backwards.
      await saveState(file,state);
      const receipt = {key:issue.key,messageId:id,action:prior ? 'updated' : 'posted'};
      receipts.push(receipt); log(JSON.stringify(receipt));
    }
    return receipts;
  });
}

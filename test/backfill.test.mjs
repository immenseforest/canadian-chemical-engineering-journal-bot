import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backfill } from '../src/backfill.mjs';
import { destinationId } from '../src/config.mjs';
import { saveState,readState } from '../src/state.mjs';
import { DeliveryError } from '../src/discord.mjs';
import { resolvePending } from '../src/bot.mjs';

async function fixture(t) {
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'cjce-backfill-'));
  t.after(()=>fs.rm(stateDir,{recursive:true,force:true}));
  const cfg={stateDir,webhook:'https://discord.com/api/webhooks/123456/test_token',threadId:''};
  const issues=Array.from({length:9},(_,i)=>({key:`cjce:104:${i+1}`,volume:'104',number:String(i+1),journalId:'cjce',articles:[]}));
  await saveState(path.join(stateDir,'state.json'),{version:1,destinations:{[destinationId(cfg)]:{issues:{},latest:{cjce:{volume:'104',number:'10'}}}}});
  return {cfg,issues};
}

test('nine historical posts are ordered, deduplicated, and do not rewind latest',async t=>{
  const {cfg,issues}=await fixture(t);const sent=[];
  const deps={log:()=>{},deliverFn:async(_c,p,_a,id)=>{assert.equal(id,undefined);sent.push(p.content);return String(100+sent.length);}};
  const receipts=await backfill(cfg,[...issues].reverse(),deps);
  assert.equal(receipts.length,9);assert.equal(sent.length,9);
  assert.match(sent[0],/Issue 1\*\*$/);assert.match(sent[8],/Issue 9\*\*$/);
  await backfill(cfg,issues,deps);assert.equal(sent.length,9);
  const state=await readState(path.join(cfg.stateDir,'state.json'));
  assert.equal(state.destinations[destinationId(cfg)].latest.cjce.number,'10');
  let edits=0;
  await backfill(cfg,issues,{log:()=>{},attachmentFn:async()=>({name:'highlights.pdf',kind:'highlights',hash:'new-pdf'}),deliverFn:async(_c,_p,_a,id)=>{assert.ok(id);edits++;return id;}});
  assert.equal(edits,9);
});

test('an uncertain historical send halts and blocks blind retry',async t=>{
  const {cfg,issues}=await fixture(t);let attempts=0;
  const deps={log:()=>{},deliverFn:async()=>{attempts++;throw new DeliveryError('unknown',true);}};
  await assert.rejects(backfill(cfg,issues,deps),/unknown/);
  await assert.rejects(backfill(cfg,issues,deps),/Resolve pending/);
  assert.equal(attempts,1);
  await resolvePending(cfg,'cjce:104:1','555');
  const state=await readState(path.join(cfg.stateDir,'state.json'));
  assert.equal(state.destinations[destinationId(cfg)].latest.cjce.number,'10');
});

test('preflight rejects oversized summaries before sending any earlier issue',async t=>{
  const {cfg,issues}=await fixture(t);let attempts=0;
  issues[8].highlightedArticles=Array.from({length:26},()=>({title:'Article',url:'https://doi.org/10.x/p'}));
  await assert.rejects(backfill(cfg,issues,{deliverFn:async()=>{attempts++;return '1';}}),/Discord limits/);
  assert.equal(attempts,0);
});

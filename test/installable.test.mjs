import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {authorNames,publicationDate,articleCredit,editorialCredit} from '../src/credits.mjs';
import {calendarIssues,monthNumber} from '../src/calendar.mjs';
import {configureGuild,scanGuild,guildState,resolveGuildDelivery} from '../src/service-core.mjs';
import {SCAN_INTERVAL_MS,inviteUrl} from '../src/installable-config.mjs';

function record(year,month){return {volume:String(year-1922),issue:String(month),type:'journal-article',title:['A study'],DOI:`10.x/${year}-${month}`,'published-print':{'date-parts':[[year,month]]},'published-online':{'date-parts':[[year,Math.max(month-1,1),2]]},author:[{given:'Alice',family:'Researcher'}]};}
const now=new Date('2026-09-15T00:00:00Z');
const records=[record(2025,11),record(2025,12),...Array.from({length:10},(_,i)=>record(2026,i+1))];
async function fixture(t){const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'cjce-installable-'));t.after(()=>fs.rm(stateDir,{recursive:true,force:true}));return {stateDir,timeZone:'America/Toronto'};}

test('original online date and full author order are preserved, never using deposit date',()=>{
  const r={author:[{given:'João B. P.',family:'Soares'},{name:'Research Consortium'}],'published-online':{'date-parts':[[2025,6,16]]},'published-print':{'date-parts':[[2026,1]]},created:{'date-parts':[[2024,1,1]]}};
  assert.deepEqual(authorNames(r),['João B. P. Soares','Research Consortium']);assert.equal(publicationDate(r).iso,'2025-06-16');
  assert.equal(publicationDate({created:r.created}),null);
  assert.deepEqual(authorNames({author:[{given:'Paulo Gonçalves',family:'de Sousa',suffix:'Junior'}]}),['Paulo Gonçalves de Sousa Junior']);
  assert.equal(publicationDate({'published-print':{'date-parts':[[2026,1]]}}).text,'January 2026');
  assert.match(articleCredit({authors:authorNames(r),firstPublished:publicationDate(r)}),/Authors:\*\* João B. P. Soares; Research Consortium$/);
  assert.match(editorialCredit(),/Editor-in-Chief: João B. P. Soares/);
});

test('calendar onboarding includes current month plus nine prior months and excludes future-cover early release',()=>{
  const selected=calendarIssues(records,{now,timeZone:'America/Toronto'});
  assert.equal(selected.length,10);assert.equal(selected[0].key,'cjce:103:12');assert.equal(selected.at(-1).key,'cjce:104:9');
  assert.equal(monthNumber(new Date('2026-10-01T02:00:00Z'),'America/Toronto'),2026*12+8);
});

test('join sends ten messages, restart preserves 24-hour due time, later month adds one',async t=>{
  const cfg=await fixture(t);await configureGuild(cfg,'guild1',{channelId:'channel1'},now);
  const sent=[];const send=async({issue,messageId})=>{sent.push(issue.key);return messageId||String(sent.length);};
  const first=await scanGuild(cfg,'guild1',records,{now,send,log:()=>{}});assert.equal(first.posted,10);
  assert.equal(Date.parse((await guildState(cfg,'guild1')).nextScanAt)-now.getTime(),SCAN_INTERVAL_MS);
  assert.equal((await scanGuild(cfg,'guild1',records,{now,send})).notDue,true);
  assert.equal((await scanGuild(cfg,'guild1',records,{now:new Date(now.getTime()+SCAN_INTERVAL_MS),send})).unchanged,10);
  assert.equal(sent.length,10);
  const next=await scanGuild(cfg,'guild1',records,{now:new Date('2026-10-02T12:00:00Z'),send,log:()=>{}});assert.equal(next.posted,1);
  await configureGuild(cfg,'guild2',{channelId:'channel2'},now);
  assert.equal((await scanGuild(cfg,'guild2',records,{now,send,log:()=>{}})).posted,10);
});

test('PDF failure does not prevent posting; only explicit refresh edits the same message',async t=>{
  const cfg=await fixture(t);await configureGuild(cfg,'g',{channelId:'c'},now);const ids=[];
  const send=async({messageId})=>{ids.push(messageId);return messageId||'555';};
  const first=await scanGuild(cfg,'g',[record(2026,9)],{now,send,attachmentFor:async()=>{throw new Error('HTTP 403');},log:()=>{}});
  assert.equal(first.posted,1);assert.equal(first.pdfUnavailable,1);
  const changed={...record(2026,9),title:['Updated publisher metadata']};
  const quiet=await scanGuild(cfg,'g',[changed],{now,force:true,send,attachmentFor:async()=>{throw new Error('Already sent issues must not fetch PDFs');},log:()=>{}});
  assert.equal(quiet.unchanged,1);assert.equal(quiet.pdfUnavailable,0);assert.equal(ids.length,1);
  const second=await scanGuild(cfg,'g',[record(2026,9)],{now,force:true,refreshExisting:true,send,attachmentFor:async()=>({hash:'pdf',name:'issue.pdf',kind:'highlights'}),log:()=>{}});
  assert.equal(second.updated,1);assert.deepEqual(ids,[undefined,'555']);
});

test('pending delivery blocks blind reposts and explicit resolution preserves recovery',async t=>{
  const cfg=await fixture(t);await configureGuild(cfg,'g',{channelId:'c'},now);let calls=0;
  const send=async()=>{calls++;throw new Error('unknown outcome');};
  await assert.rejects(scanGuild(cfg,'g',records,{now,send}),/unknown outcome/);
  await assert.rejects(scanGuild(cfg,'g',records,{now,send}),/Delivery needs review/);assert.equal(calls,1);
  await resolveGuildDelivery(cfg,'g','cjce:103:12','retry');
  assert.equal(Object.keys((await guildState(cfg,'g')).issues).length,0);
});

test('invite supports guild installation without Administrator permission',()=>{
  const u=new URL(inviteUrl());assert.match(u.searchParams.get('scope'),/bot/);
  assert.equal(BigInt(u.searchParams.get('permissions'))&8n,0n);
});

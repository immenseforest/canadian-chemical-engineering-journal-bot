import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {catalog,ieeePublication,resolveJournal} from '../src/hub-catalog.mjs';
import {journalIssues,openArticle} from '../src/hub-discovery.mjs';
import {helpText,introPayload,articlePayload,issueTitle} from '../src/hub-format.mjs';
import {hubCommand} from '../src/hub-command.mjs';
import {subscribe,scanSubscription,hubGuild,resolveHub,welcomeGuild,controlSubscription} from '../src/hub-core.mjs';
import {payloadFor,summaryFor} from '../src/discord.mjs';
const now=new Date('2026-09-15T12:00:00Z');
const article=n=>({doi:`10.x/${n}`,title:`Paper ${n}`,url:`https://doi.org/10.x/${n}`,abstract:'A concrete publisher finding with supporting evidence.',authors:['A. Researcher'],page:String(n)});
const issue=(n=1,continuous=false)=>({key:`ojcs:v7:i${n}`,journalId:'ojcs',journalName:catalog[3].name,journalUrl:catalog[3].url,issueUrl:catalog[3].url,abbreviation:'IEEE OJ-CS',publisher:'IEEE',color:123,volume:'7',number:continuous?null:String(n),continuous,coverYear:2026,coverMonth:9,articles:[1,2].map(article),highlightedArticles:[]});
async function fixture(t){const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-hub-'));t.after(()=>fs.rm(stateDir,{recursive:true,force:true}));const cfg={stateDir};await subscribe(cfg,'1',catalog[3],'10');return cfg;}
function fakeTransport(){const calls=[];let serial=100;return {calls,create:async(c,name)=>{calls.push(['thread',c,name]);return String(++serial);},ready:async()=>{},send:async(t,p)=>{calls.push(['message',t,p]);return String(++serial);}};}
const opts=(transport,issues)=>({transport,now,discover:async()=>issues,enrich:async a=>a});

test('five distinct profiles, exact known IEEE links and safe unfamiliar-link fallback',async()=>{
  assert.equal(catalog.length,5);assert.equal(catalog[0].publisher,'Wiley');assert.equal(catalog[2].publisher,'Oxford University Press');
  assert.equal((await resolveJournal(catalog[3].url)).id,'ojcs');
  for(const url of ['http://ieeexplore.ieee.org/?punumber=1','https://ieeexplore.ieee.org.evil.test/?punumber=1','https://u:p@ieeexplore.ieee.org/?punumber=1','https://ieeexplore.ieee.org/document/123'])assert.throws(()=>ieeePublication(url));
  await assert.rejects(resolveJournal('https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=999'),/ISSN/);
  const custom=await resolveJournal('https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=999',{issn:'1234-567X',fetchImpl:async()=>({ok:true,json:async()=>({message:{title:'A verified journal'}})})});assert.equal(custom.id,'ieee-999');assert.equal(custom.mappingSource,'ISSN supplied by server manager');
});
test('command guide fits one embed and includes every registered subcommand',()=>{
  const data=hubCommand.toJSON();assert.equal(data.name,'journals');assert.ok(helpText.length<=4096);
  for(const s of data.options)assert.ok(helpText.includes('/journals '+s.name),s.name);
});
test('IEEE intro does not inherit Wiley editorial names or PDF wording; article summary wording is reused',()=>{
  const p=introPayload(issue(),null);assert.doesNotMatch(JSON.stringify(p),/Soares|Wiley|Issue Highlights PDF/);
  const a=article(1),text=JSON.stringify(articlePayload(issue(),a,0));assert.ok(text.includes(summaryFor(a)));assert.match(text,/A. Researcher/);
  const cjce={...issue(),key:'cjce:104:9',journalId:'cjce',journalName:catalog[0].name,volume:'104',publisher:'Wiley'};
  assert.equal(introPayload(cjce,null).embeds[0].description,payloadFor(cjce,null).embeds[0].description);
});
test('missing dates and continuous journals are labelled without fabricated issue/month',()=>{
  const records=[{type:'journal-article',DOI:'10.x/1',title:['Study'],volume:'7',published:{'date-parts':[[2026]]}}];
  const [i]=journalIssues(catalog[3],records,{now});assert.equal(i.number,null);assert.equal(i.coverMonth,null);assert.match(issueTitle(i),/month not supplied/);
  records[0].published={'date-parts':[[2027]]};assert.equal(journalIssues(catalog[3],records,{now}).length,0);
});
test('open-access filter rejects paywall/general IEEE licences and future CC licences',()=>{
  assert.equal(openArticle({license:[{URL:'https://ieeexplore.ieee.org/license.html'}]},catalog[1],now),false);
  assert.equal(openArticle({license:[{URL:'https://creativecommons.org/licenses/by/4.0/',start:{'date-time':'2027-01-01'}}]},catalog[1],now),false);
  assert.equal(openArticle({license:[{URL:'https://creativecommons.org/licenses/by/4.0/'}]},catalog[1],now),true);
});
test('manual subscription starts latest only; intro first; restart skips confirmed issue',async t=>{
  const cfg=await fixture(t),transport=fakeTransport();
  const result=await scanSubscription(cfg,'1','ojcs',opts(transport,[issue(1),issue(2)]));
  assert.equal(result.threads,1);assert.equal(result.articles,2);assert.equal(transport.calls.length,4);assert.match(transport.calls[1][2].content,/Issue summary/);
  await scanSubscription(cfg,'1','ojcs',{...opts(transport,[issue(1),issue(2)]),force:true});assert.equal(transport.calls.length,4);
  assert.equal((await hubGuild(cfg,'1')).subscriptions.ojcs.issues[issue(1).key],undefined);
});
test('ambiguous delivery blocks duplicates; verified receipt resumes within original thread',async t=>{
  const cfg=await fixture(t),transport=fakeTransport(),send=transport.send;let count=0;
  transport.send=async(...args)=>{if(++count===2)throw new Error('timeout');return send(...args);};
  await assert.rejects(scanSubscription(cfg,'1','ojcs',opts(transport,[issue()])),/timeout/);
  await assert.rejects(scanSubscription(cfg,'1','ojcs',{...opts(transport,[issue()]),force:true}),/Uncertain/);
  await resolveHub(cfg,'1','ojcs',issue().key,'888',async()=>{});
  await scanSubscription(cfg,'1','ojcs',{...opts(transport,[issue()]),force:true});
  assert.equal(transport.calls.filter(c=>c[0]==='thread').length,1);
  assert.equal((await hubGuild(cfg,'1')).subscriptions.ojcs.issues[issue().key].messages['10.x/1'],'888');
});
test('continuous volumes append new papers without replacing existing messages',async t=>{
  const cfg=await fixture(t),transport=fakeTransport(),i=issue(1,true);
  await scanSubscription(cfg,'1','ojcs',opts(transport,[i]));i.articles.push(article(3));
  await scanSubscription(cfg,'1','ojcs',{...opts(transport,[i]),force:true});
  assert.equal(transport.calls.filter(c=>c[0]==='thread').length,1);assert.equal(transport.calls.filter(c=>c[0]==='message').length,4);
});
test('welcome is once per server and removal preserves journal history',async t=>{
  const cfg=await fixture(t);let sends=0;const send=async()=>String(++sends);
  await welcomeGuild(cfg,'1',send);await welcomeGuild(cfg,'1',send);assert.equal(sends,1);
  await scanSubscription(cfg,'1','ojcs',opts(fakeTransport(),[issue()]));await controlSubscription(cfg,'1','ojcs','remove');
  assert.equal((await hubGuild(cfg,'1')).subscriptions.ojcs.active,false);assert.ok((await hubGuild(cfg,'1')).subscriptions.ojcs.issues[issue().key]);
});

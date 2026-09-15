import {createHash} from 'node:crypto';
import {withLock,readState,saveState} from './state.mjs';
import {discoverJournal,enrichArticles} from './hub-discovery.mjs';
import {introPayload,articlePayload,issueTitle} from './hub-format.mjs';
import {attachmentFor} from './attachments.mjs';

export async function mutateGuild(cfg,guildId,fn){
  return withLock(cfg.stateDir,async file=>{const state=await readState(file);const guild=state.destinations[guildId]??={subscriptions:{}};const value=await fn(guild);await saveState(file,state);return value;});
}
export async function hubGuild(cfg,guildId){return withLock(cfg.stateDir,async file=>(await readState(file)).destinations[guildId]);}
export async function subscribe(cfg,guildId,journal,channelId,{history=0,oaOnly=false}={}){
  if(!/^\d+$/.test(channelId))throw new Error('Choose an existing text channel.');
  if(!Number.isInteger(history)||history<0||history>9)throw new Error('History must be between 0 and 9 previous issues.');
  return mutateGuild(cfg,guildId,g=>{
    const prior=g.subscriptions[journal.id];
    if(prior?.active&&prior.channelId===channelId&&prior.oaOnly===oaOnly)return prior;
    if(prior&&prior.channelId!==channelId)throw new Error('This journal already has a destination. Remove it and use its existing channel, or choose a different journal.');
    return g.subscriptions[journal.id]={...prior,journal,channelId,history,oaOnly,active:true,paused:false,nextScanAt:null,issues:prior?.issues||{}};
  });
}
export async function controlSubscription(cfg,guildId,id,action){
  return mutateGuild(cfg,guildId,g=>{const s=g.subscriptions[id];if(!s)throw new Error('Unknown subscription ID; use /journals list.');
    if(action==='remove')s.active=false;else{s.paused=action==='pause';s.nextScanAt=null;}return s;});
}
const nonce=(key)=>BigInt('0x'+createHash('sha256').update(key).digest('hex').slice(0,16)).toString();

export async function scanSubscription(cfg,guildId,id,{transport,discover=discoverJournal,enrich=enrichArticles,attachmentFn=attachmentFor,now=new Date(),force=false}={}){
  return withLock(cfg.stateDir,async file=>{
    const state=await readState(file),s=state.destinations[guildId]?.subscriptions[id];
    if(!s?.active||s.paused)return {skipped:true};
    if(!force&&s.nextScanAt&&Date.parse(s.nextScanAt)>now.getTime())return {notDue:true};
    const checkpoint=()=>saveState(file,state),result={threads:0,articles:0,unchanged:0};
    try{
      if(Object.values(s.issues).some(i=>i.operation))throw new Error('Uncertain delivery: inspect /journals status, then /journals resolve.');
      const all=await discover(s.journal,{...cfg,oaOnly:s.oaOnly},{now});
      if(!all.length)throw new Error(s.oaOnly?'No dated open-access articles were confirmed. Try again later or disable the open-access-only option for this built-in journal.':'No dated journal articles were found.');
      if(!s.initialized){s.ignoredIssues=all.slice(0,Math.max(0,all.length-s.history-1)).map(i=>i.key);s.initialized=true;await checkpoint();}
      for(const fresh of all.filter(i=>!s.ignoredIssues.includes(i.key))){
        let item=s.issues[fresh.key];
        if(item?.legacy||item?.status==='sent'&&!fresh.continuous){result.unchanged++;continue;}
        const candidates=fresh.highlightedArticles?.length?fresh.highlightedArticles:fresh.articles;
        if(!item){
          const selected=fresh.continuous?candidates.slice(-4):candidates.slice(0,4);
          if(!selected.length)continue;
          const articles=await enrich(selected,cfg);
          item=s.issues[fresh.key]={issue:{...fresh,articles,highlightedArticles:fresh.highlightedArticles?.length?articles:[]},articles,ignoredArticles:fresh.continuous?candidates.filter(a=>!selected.some(b=>b.doi===a.doi)).map(a=>a.doi):[],messages:{},status:'pending'};
          // Preflight every article before creating any thread.
          articles.forEach((a,i)=>articlePayload(item.issue,a,i));introPayload(item.issue,null);
          await checkpoint();
        }else if(item.status==='sent'&&fresh.continuous){
          const additions=candidates.filter(a=>!item.ignoredArticles.includes(a.doi)&&!item.articles.some(b=>b.doi===a.doi)).slice(0,4);
          if(!additions.length){result.unchanged++;continue;}
          item.articles.push(...await enrich(additions,cfg));item.status='pending';await checkpoint();
        }
        let attachment=null;
        if(!item.introId&&s.journal.id==='cjce'){
          try{attachment=await attachmentFn(item.issue,cfg);}catch{attachment=null;}
        }
        const intro=introPayload(item.issue,attachment),payloads=item.articles.map((a,i)=>articlePayload(item.issue,a,i));
        async function step(operation,fn,accept){
          item.operation=operation;await checkpoint();
          let receipt;
          try{receipt=await fn();if(!/^\d+$/.test(receipt||''))throw new Error('Discord did not return a delivery ID.');}
          catch(e){if(e.status>=400&&e.status<500||e.ambiguous===false){delete item.operation;await checkpoint();}throw e;}
          accept(receipt);delete item.operation;await checkpoint();return receipt;
        }
        if(!item.threadId){await step({kind:'thread'},()=>transport.create(s.channelId,issueTitle(item.issue)),id=>{item.threadId=id;});result.threads++;}
        await transport.ready(item.threadId,s.channelId);
        if(!item.introId)await step({kind:'intro'},()=>transport.send(item.threadId,intro,nonce(`${guildId}:${fresh.key}:intro`)),id=>{item.introId=id;});
        for(let i=0;i<item.articles.length;i++){
          const a=item.articles[i];if(item.messages[a.doi])continue;
          await step({kind:'article',doi:a.doi,index:i},()=>transport.send(item.threadId,payloads[i],nonce(`${guildId}:${fresh.key}:${a.doi}`)),id=>{item.messages[a.doi]=id;});result.articles++;
        }
        item.status='sent';await checkpoint();
      }
      s.lastError=null;s.lastResult=result;s.lastScanAt=now.toISOString();s.nextScanAt=new Date(now.getTime()+86400000).toISOString();await checkpoint();return result;
    }catch(e){s.lastError=String(e.message).replace(/https:\/\/\S+/g,'[source URL]').slice(0,500);s.nextScanAt=new Date(now.getTime()+3600000).toISOString();await checkpoint();throw e;}
  });
}

export async function resolveHub(cfg,guildId,id,key,receipt,validate){
  if(receipt!=='retry'&&!/^\d+$/.test(receipt))throw new Error('Use a confirmed Discord ID or retry.');
  return mutateGuild(cfg,guildId,async g=>{
    const s=g.subscriptions[id],item=s?.issues[key];if(!item?.operation)throw new Error('No uncertain operation matches that subscription and issue.');
    if(receipt!=='retry'){
      await validate(s,item,receipt);
      if(item.operation.kind==='thread')item.threadId=receipt;
      else if(item.operation.kind==='intro')item.introId=receipt;
      else item.messages[item.operation.doi]=receipt;
    }
    delete item.operation;s.nextScanAt=null;
  });
}

export async function welcomeGuild(cfg,guildId,send,{force=false}={}){
  return mutateGuild(cfg,guildId,async g=>{
    if(g.welcome&&!force)return false;
    g.welcome={status:'pending'};
    // Persist before sending to avoid duplicate welcome posts after a crash.
    return true;
  }).then(async shouldSend=>{
    if(!shouldSend)return false;
    try{const id=await send(nonce(`${guildId}:hub-welcome`));await mutateGuild(cfg,guildId,g=>{g.welcome={status:'sent',messageId:id};});return true;}
    catch(e){if(e.status>=400&&e.status<500)await mutateGuild(cfg,guildId,g=>{delete g.welcome;});throw e;}
  });
}

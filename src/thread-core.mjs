import {createHash} from 'node:crypto';
import {withLock,readState,saveState} from './state.mjs';
import {monthNumber,calendarIssues,monthLabel} from './calendar.mjs';
import {payloadFor} from './discord.mjs';
import {threadPayloads,threadTitle} from './thread-delivery.mjs';
import {SCAN_INTERVAL_MS} from './installable-config.mjs';

export function fingerprint(payload,pdfHash=null) {
  return createHash('sha256').update(JSON.stringify({content:payload.content,embeds:payload.embeds,pdfHash})).digest('hex');
}
export async function guildState(cfg,guildId) {
  return withLock(cfg.stateDir,async file=>(await readState(file)).destinations[guildId]||null);
}
export async function configureGuild(cfg,guildId,changes,now=new Date()) {
  return withLock(cfg.stateDir,async file=>{
    const state=await readState(file);
    const target=state.destinations[guildId]??={issues:{},latest:{},startMonth:monthNumber(now,cfg.timeZone)-9,paused:false,nextScanAt:null};
    Object.assign(target,changes);await saveState(file,state);return target;
  });
}

export async function scanGuild(cfg,guildId,records,{now=new Date(),force=false,refreshExisting=false,send,attachmentFor=async()=>null,log=console.log}={}) {
  return withLock(cfg.stateDir,async file=>{
    const state=await readState(file);const target=state.destinations[guildId];
    if(!target?.channelId)throw new Error('Select a channel with /journal channel');
    if(target.paused)return {paused:true,posted:0,updated:0};
    if(!force&&target.nextScanAt&&Date.parse(target.nextScanAt)>now.getTime())return {notDue:true,posted:0,updated:0};
    const channelId=target.channelId;
    if(Object.entries(target.issues).some(([key,value])=>key.startsWith(channelId+':')&&value.status==='pending'&&value.progress?.operation))throw new Error('Delivery needs review. Use /journal status and /journal resolve before retrying.');
    const issues=calendarIssues(records,{now,timeZone:cfg.timeZone,startMonth:target.startMonth});
    if(!issues.length)throw new Error('Publisher metadata has no issued journals in the calendar window');
    const result={posted:0,updated:0,unchanged:0,issues:issues.length,from:monthLabel(target.startMonth),through:monthLabel(monthNumber(now,cfg.timeZone)),pdfUnavailable:0};
    for(const issue of issues){
      const key=`${channelId}:${issue.key}`;const prior=target.issues[key];
      // Daily scans and ordinary checks never edit or repost delivered issues.
      if(prior?.status==='sent'&&!refreshExisting){result.unchanged++;continue;}
      let attachment=null;
      try{attachment=await attachmentFor(issue,cfg);}catch(e){result.pdfUnavailable++;log(`${issue.key}: PDF unavailable; posting linked summary (${e.message})`);}
      const payload=payloadFor(issue,attachment);
      threadPayloads(issue,attachment);threadTitle(issue);
      // An already-attached PDF is retained if this run cannot fetch it.
      if(!attachment&&prior?.pdfName){
        payload.embeds[0].description=payload.embeds[0].description.replace('Highlights PDF is not attached. Publisher links are provided below.','📎 Issue Highlights PDF attached.');
      }
      const pdfHash=attachment?.hash||prior?.pdfHash||null;
      const hash=fingerprint(payload,pdfHash);
      if(prior?.status==='pending'&&prior.contentHash!==hash)throw new Error('Issue content changed during partial delivery; restore the prior metadata/PDF before resuming.');
      if(prior?.status==='sent'&&prior.contentHash===hash){result.unchanged++;continue;}
      const progress=prior?.status==='pending'?prior.progress:{threadId:prior?.progress?.threadId,messageIds:prior?.progress?.messageIds||[],articleKeys:prior?.progress?.articleKeys,completed:[]};
      const pending={progress,threadName:threadTitle(issue),status:'pending',issueKey:issue.key,channelId,messageId:prior?.messageId,contentHash:hash,pdfHash,pdfName:attachment?.name||prior?.pdfName||null,startedAt:now.toISOString()};
      target.issues[key]=pending;await saveState(file,state);
      let id;
      try{
        id=await send({progress,checkpoint:()=>saveState(file,state),guildId,channelId,issue,payload,attachment,messageId:prior?.messageId,nonce:BigInt('0x'+createHash('sha256').update(`${guildId}:${key}`).digest('hex').slice(0,16)).toString()});
        if(!/^\d+$/.test(id||''))throw new Error('Discord did not confirm a message ID');
      }catch(e){
        // Keep confirmed thread and message checkpoints even after a partial failure.
        await saveState(file,state);
        throw e;
      }
      target.issues[key]={...pending,status:'sent',messageId:id,sentAt:new Date().toISOString()};
      await saveState(file,state);result[prior?.messageId?'updated':'posted']++;
      log(`${guildId}/${channelId}: ${issue.key} ${prior?.messageId?'updated':'posted'} (${id})`);
    }
    target.lastScanAt=now.toISOString();target.nextScanAt=new Date(now.getTime()+SCAN_INTERVAL_MS).toISOString();target.lastResult=result;
    await saveState(file,state);return result;
  });
}

export async function resolveGuildDelivery(cfg,guildId,issueKey,messageId){
  if(!/^cjce:\d+:\d+$/.test(issueKey)||!(messageId==='retry'||/^\d+$/.test(messageId)))throw new Error('Use an issue key such as cjce:104:9 and a message ID, or retry after checking the channel');
  return withLock(cfg.stateDir,async file=>{
    const state=await readState(file);const target=state.destinations[guildId];const key=`${target?.channelId}:${issueKey}`;const item=target?.issues[key];
    if(item?.status!=='pending')throw new Error('No pending delivery matches this issue');
    const operation=item.progress?.operation;
    if(!operation)throw new Error('No uncertain operation; use /journal check to resume');
    if(messageId!=='retry'){
      if(operation.kind==='thread')item.progress.threadId=messageId;
      else {item.progress.messageIds[operation.index]=messageId;item.progress.completed.push(operation.index);}
    }
    delete item.progress.operation;
    target.nextScanAt=null;await saveState(file,state);
  });
}

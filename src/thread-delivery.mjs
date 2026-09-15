import {createHash} from 'node:crypto';
import {ChannelType} from 'discord.js';
import {payloadFor} from './discord.mjs';

export function threadTitle(issue) {
  if (!issue.coverMonth || !issue.coverYear) throw new Error(`${issue.key}: missing issue cover date`);
  const date=new Date(Date.UTC(issue.coverYear,issue.coverMonth-1)).toLocaleDateString('en-CA',{month:'long',year:'numeric',timeZone:'UTC'});
  const title=`${issue.journalAbbreviation || 'Can. J. Chem. Eng.'} · Vol. ${issue.volume} · Issue ${issue.number} · ${date}`;
  if(title.length>100) throw new Error('Issue thread title exceeds Discord limits');
  return title;
}

// Reuse the original renderer, including all summary, selection and credit wording.
export function threadPayloads(issue,attachment) {
  const original=payloadFor(issue,attachment);
  const {fields,...intro}=original.embeds[0];
  const messages=[{...original,embeds:[intro]}];
  for(const field of fields){
    if(field.name.endsWith(' · continued')) messages.at(-1).embeds[0].fields.push(field);
    else messages.push({allowed_mentions:{parse:[]},embeds:[{color:intro.color,fields:[field],footer:intro.footer}],attachments:[]});
  }
  return messages;
}

export function threadSender(client) {
  return async ({channelId,issue,payload,attachment,progress,checkpoint})=>{
    const parent=await client.channels.fetch(channelId);
    const messages=threadPayloads(issue,attachment);
    const papers=issue.highlightedArticles?.length?issue.highlightedArticles:issue.articles.slice(0,4);
    const articleKeys=papers.map(a=>a.doi||a.url||a.title);
    if(progress.articleKeys&&JSON.stringify(progress.articleKeys)!==JSON.stringify(articleKeys)){
      throw new Error('Article selection or order changed; review the issue before refreshing existing shared messages');
    }
    progress.articleKeys=articleKeys;
    // Keep the refresh behavior that preserves a previously uploaded PDF label.
    messages[0].embeds[0].description=payload.embeds[0].description;
    async function step(operation,fn){
      progress.operation=operation;await checkpoint();
      let result;
      try{result=await fn();}catch(e){
        if(e.status>=400&&e.status<500){delete progress.operation;await checkpoint();}
        throw e;
      }
      return result;
    }
    if(!progress.threadId){
      const thread=await step({kind:'thread'},()=>parent.threads.create({name:threadTitle(issue),type:ChannelType.PublicThread,autoArchiveDuration:1440,reason:`Journal issue ${issue.key}`}));
      progress.threadId=thread.id;delete progress.operation;await checkpoint();
    }
    const thread=await client.channels.fetch(progress.threadId);
    if(thread.parentId!==channelId)throw new Error('Saved issue thread belongs to another channel');
    if(thread.archived)await thread.setArchived(false);
    if(thread.name!==threadTitle(issue))await thread.setName(threadTitle(issue));
    progress.messageIds??=[];
    progress.completed??=[];
    for(let index=0;index<messages.length;index++){
      if(progress.completed.includes(index))continue;
      const p=messages[index],id=progress.messageIds[index];
      const options={content:p.content||null,embeds:p.embeds,allowedMentions:{parse:[]},
        ...(index===0&&attachment?{files:[{attachment:attachment.bytes,name:attachment.name,description:p.attachments[0].description}],attachments:[]}:{}),
        ...(!id?{nonce:BigInt('0x'+createHash('sha256').update(`${thread.id}:${index}`).digest('hex').slice(0,16)).toString(),enforceNonce:true}:{})};
      const message=await step({kind:'message',index},()=>id?thread.messages.edit(id,options):thread.send(options));
      progress.messageIds[index]=message.id;progress.completed.push(index);delete progress.operation;await checkpoint();
    }
    return progress.messageIds[0];
  };
}

import {summaryFor,payloadFor} from './discord.mjs';
import {articleCredit} from './credits.mjs';

export const helpText=`**Research Journal Hub**
I organise journal updates into one thread per issue, with an introduction first and one message per selected article. Each article keeps its source link, summary, authors and publication date for easy sharing and discussion.

**Start here:** use /journals catalog, then /journals add to choose a journal and an existing text channel. I create issue threads only after a server manager subscribes. I never create channels automatically.

**Commands**
• /journals help — show this guide.
• /journals catalog — see the five ready-to-use journal profiles.
• /journals add — subscribe a journal in your chosen channel; optionally include recent issues.
• /journals add-link — opens a form for an IEEE Xplore journal link; optional ISSN helps identify unfamiliar journals without an API key.
• /journals list — show subscriptions, IDs and channels.
• /journals status — show schedule, errors and any uncertain delivery.
• /journals check — check subscribed journals now.
• /journals pause — pause a subscription's daily checks.
• /journals resume — resume a paused subscription.
• /journals remove — stop a subscription; its threads remain readable.
• /journals resolve — record a confirmed thread/message ID after an uncertain delivery, or retry after checking it was not sent.
• /journals intro — post this guide in a channel you select.

Server managers control subscriptions. Checks run every 24 hours. Summaries use the chemical-engineering bot's reviewed wording where available, otherwise a labelled publisher-abstract extract. Missing abstracts are stated plainly. Continuous journals use volume threads; missing issue metadata uses labelled publication-month collections. Open-access filtering is optional for built-in profiles and enabled for custom links.`;

export function issueTitle(issue){
  const date=issue.coverMonth?new Date(Date.UTC(issue.coverYear,issue.coverMonth-1)).toLocaleDateString('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}):`${issue.coverYear} · month not supplied`;
  return `${issue.abbreviation||issue.journalName} · ${issue.volume?'Vol. '+issue.volume:'Publication collection'}${issue.number?' · Issue '+issue.number:''} · ${date}`.slice(0,100);
}
export function introPayload(issue,attachment){
  if(issue.journalId==='cjce'){
    const p=payloadFor(issue,attachment),{fields,...intro}=p.embeds[0];
    return {content:p.content,embeds:[intro],allowedMentions:{parse:[]},...(attachment?{files:[{attachment:attachment.bytes,name:attachment.name}]}:{})};
  }
  const label=issue.number?'Issue summary':issue.volume?'Volume summary · continuous publication':'Publication collection · issue metadata unavailable';
  return {content:`**${label} · ${issue.volume?'Volume '+issue.volume+' · ':''}${issue.number?'Issue '+issue.number+' · ':''}${issue.coverMonth?new Date(Date.UTC(issue.coverYear,issue.coverMonth-1)).toLocaleDateString('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}):issue.coverYear+' (month not supplied)'}**`,allowedMentions:{parse:[]},embeds:[{title:issue.journalName,url:issue.journalUrl,color:issue.color,description:`[Open journal / publisher page](${issue.journalUrl})\n\nSelected articles follow as individual messages with their original publication dates and author credits.\n\nNo issue PDF is attached. Follow each article's publisher link for access.`,footer:{text:`${issue.publisher} · ${issue.key} · Selected articles · Summaries based on publisher abstracts`}}]};
}
export function articlePayload(issue,article,index){
  const label=issue.highlightedArticles?.length?'Highlighted article':'Selected article';
  const text=`[${article.title.slice(0,280).replace(/[\\\[\]*_~`|]/g,'\\$&')}](${article.url})\n\n${summaryFor(article)}\n\n${articleCredit(article)}`;
  const fields=[];let rest=text;
  while(rest.length>1024){let n=rest.lastIndexOf('\n',1024);if(n<1)n=rest.lastIndexOf(' ',1024);if(n<1)throw new Error('An article credit cannot fit a Discord field.');fields.push(rest.slice(0,n));rest=rest.slice(n).trimStart();}
  fields.push(rest);
  const embed={color:issue.color,fields:fields.map((value,i)=>({name:`${label} ${index+1}${i?' · continued':''}`,value})),footer:{text:`${issue.publisher} · ${issue.key} · ${article.doi}`}};
  if(fields.length>25||JSON.stringify(embed).length>5700)throw new Error('Article exceeds one Discord message; review its credits before posting.');
  return {embeds:[embed],allowedMentions:{parse:[]}};
}

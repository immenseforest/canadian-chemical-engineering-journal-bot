import fs from 'node:fs/promises';
import path from 'node:path';
import {Client,Events,GatewayIntentBits,PermissionFlagsBits as P,ChannelType,MessageFlags,ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder} from 'discord.js';
import {loadEnv} from './config.mjs';
import {installableConfig} from './installable-config.mjs';
import {withLock} from './state.mjs';
import {guardedListener} from './event-handler.mjs';
import {catalog,resolveJournal} from './hub-catalog.mjs';
import {hubCommand} from './hub-command.mjs';
import {helpText,issueTitle} from './hub-format.mjs';
import {hubGuild,mutateGuild,subscribe,controlSubscription,scanSubscription,resolveHub,welcomeGuild} from './hub-core.mjs';
import {discoverJournal} from './hub-discovery.mjs';

loadEnv();loadEnv('.env.hub');const base=installableConfig();
const cfg={...base,token:process.env.HUB_DISCORD_BOT_TOKEN||base.token,applicationId:process.env.HUB_DISCORD_APPLICATION_ID||base.applicationId,stateDir:path.resolve(process.env.HUB_BOT_STATE_DIR||'data/hub'),ieeeKey:process.env.IEEE_XPLORE_API_KEY||''};
if(!cfg.token)throw new Error('Configure a Discord bot token before starting the journal hub.');
const safe=e=>{let s=String(e.message||e);for(const secret of [cfg.token,cfg.ieeeKey])if(secret)s=s.split(secret).join('[redacted]');return s.replace(/https:\/\/\S+/g,'[source URL]').slice(0,1500);};
const client=new Client({intents:[GatewayIntentBits.Guilds],rest:{retries:0}});
let queue=Promise.resolve(),timer;
const enqueue=fn=>{const next=queue.then(fn);queue=next.catch(e=>console.error(safe(e)));return next;};
const required=[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.EmbedLinks,P.CreatePublicThreads,P.SendMessagesInThreads];
async function destination(guild,id){
  await guild.members.fetchMe();const c=await guild.channels.fetch(id);
  if(c?.type!==ChannelType.GuildText||!required.every(p=>c.permissionsFor(guild.members.me)?.has(p)))throw new Error('Choose a text channel where the bot can view, send, read history, embed links, create public threads and send in threads.');
  return c;
}
const transport={
  create:async(id,name)=>{const channel=await client.channels.fetch(id);return (await channel.threads.create({name,type:ChannelType.PublicThread,autoArchiveDuration:1440})).id;},
  ready:async(id,parent)=>{const t=await client.channels.fetch(id);if(!t?.isThread()||t.parentId!==parent)throw new Error('Saved thread is missing or belongs to a different channel.');if(t.archived)await t.setArchived(false);},
  send:async(id,payload,nonce)=>{const t=await client.channels.fetch(id);return (await t.send({...payload,nonce,enforceNonce:true})).id;},
};
const helpPayload={embeds:[{title:'Research Journal Hub — setup and commands',description:helpText,color:0x157a74}],allowedMentions:{parse:[]}};
async function welcome(guild,channelId,force=false){
  await guild.members.fetchMe();await guild.channels.fetch();
  const writable=c=>c?.type===ChannelType.GuildText&&[P.ViewChannel,P.SendMessages,P.EmbedLinks].every(p=>c.permissionsFor(guild.members.me)?.has(p));
  const channel=channelId?guild.channels.cache.get(channelId):writable(guild.systemChannel)?guild.systemChannel:guild.channels.cache.find(writable);
  if(!writable(channel))return false;
  return welcomeGuild(cfg,guild.id,async nonce=>(await channel.send({...helpPayload,nonce,enforceNonce:true})).id,{force});
}
// One source fetch per journal/filter/hour, shared across servers; delivery is still per server.
const metadata=new Map();
async function discover(j,c,options){const key=`${j.issn}:${c.oaOnly}`;const hit=metadata.get(key);if(hit&&Date.now()-hit.at<3600000)return hit.issues;const issues=await discoverJournal(j,c,options);metadata.set(key,{at:Date.now(),issues});return issues;}
async function check(guild,id,force=false){
  const state=await hubGuild(cfg,guild.id);const results=[];
  if(id&&!state?.subscriptions[id])throw new Error('Unknown subscription ID; use /journals list.');
  for(const [key,s] of Object.entries(state?.subscriptions||{})){
    if(id&&id!==key||!s.active||s.paused||!force&&s.nextScanAt&&Date.parse(s.nextScanAt)>Date.now())continue;
    try{await destination(guild,s.channelId);results.push(`${key}: ${JSON.stringify(await scanSubscription(cfg,guild.id,key,{transport,discover,force}))}`);}
    catch(e){results.push(`${key}: ${safe(e)}`);console.error(`${guild.id}/${key}: ${safe(e)}`);await mutateGuild(cfg,guild.id,g=>{g.subscriptions[key].lastError=safe(e);g.subscriptions[key].nextScanAt=new Date(Date.now()+3600000).toISOString();});}
  }
  return results.join('\n')||'No journal is due. Use /journals add to subscribe.';
}
async function validateReceipt(s,item,id){
  if(item.operation.kind==='thread'){
    const t=await client.channels.fetch(id);
    if(!t?.isThread()||t.parentId!==s.channelId||t.ownerId!==client.user.id||t.name!==issueTitle(item.issue))throw new Error('Thread does not match this bot, journal issue and channel.');
    if(Object.values(s.issues).some(other=>other!==item&&other.threadId===id))throw new Error('Thread already belongs to another issue.');
  }else{
    const t=await client.channels.fetch(item.threadId),m=await t.messages.fetch(id);
    const marker=item.operation.kind==='article'?item.operation.doi:`· ${item.issue.key} ·`;
    if(m.author.id!==client.user.id||!m.embeds.some(e=>e.footer?.text?.includes(marker)))throw new Error('Message does not match the pending article or introduction.');
    if(item.operation.kind==='intro'&&m.embeds.some(e=>e.fields.length))throw new Error('Choose the introduction message, not an article.');
  }
}
client.on(Events.InteractionCreate,guardedListener(async interaction=>{
  if(!interaction.guild)return;
  const modal=interaction.isModalSubmit()&&interaction.customId.startsWith('hub-add:');
  if(!modal&&(!interaction.isChatInputCommand()||interaction.commandName!=='journals'))return;
  const sub=modal?'add-link':interaction.options.getSubcommand();
  if(!['help','catalog','list','status'].includes(sub)&&!interaction.memberPermissions?.has(P.ManageGuild)){
    await interaction.reply({content:'Manage Server permission is required to change subscriptions.',flags:MessageFlags.Ephemeral});return;
  }
  if(!modal&&sub==='add-link'){
    const id=interaction.options.getChannel('channel',true).id;
    const form=new ModalBuilder().setCustomId(`hub-add:${id}`).setTitle('Add an IEEE Xplore journal').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('IEEE Xplore journal link (contains punumber=)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('issn').setLabel('ISSN, if known (optional, e.g. 2644-1268)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(9)));
    await interaction.showModal(form);return;
  }
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try{
    const reply=await enqueue(async()=>{
      const guild=interaction.guild;
      if(sub==='help')return helpPayload;
      if(sub==='catalog')return catalog.map(j=>`**${j.id}** — ${j.name}`).join('\n')+'\nUse /journals add and choose an existing channel.';
      if(sub==='intro'){const ok=await welcome(guild,interaction.options.getChannel('channel',true).id,true);return ok?'Introduction posted.':'No writable text channel was selected.';}
      if(sub==='add'||modal){
        const channelId=modal?interaction.customId.split(':')[1]:interaction.options.getChannel('channel',true).id;
        await destination(guild,channelId);
        const journal=modal?await resolveJournal(interaction.fields.getTextInputValue('url'),{issn:interaction.fields.getTextInputValue('issn').trim(),apiKey:cfg.ieeeKey}):catalog.find(j=>j.id===interaction.options.getString('journal',true));
        if(!journal)throw new Error('Choose a journal from /journals catalog.');
        const oaOnly=modal?true:interaction.options.getBoolean('open-access-only')??undefined;
        const subscription=await subscribe(cfg,guild.id,journal,channelId,{history:modal?0:interaction.options.getInteger('history')??undefined,oaOnly});
        return `Subscribed **${journal.name}** in <#${channelId}> (${journal.id}). ${subscription.oaOnly?'Open-access articles only.':''}\n${await check(guild,journal.id,true)}`;
      }
      if(['pause','resume','remove'].includes(sub)){const id=interaction.options.getString('subscription',true);await controlSubscription(cfg,guild.id,id,sub);return `${id}: ${sub==='remove'?'subscription removed; threads kept':sub==='pause'?'paused':'resumed'}.`+(sub==='resume'?'\n'+await check(guild,id,true):'');}
      if(sub==='check'){metadata.clear();return check(guild,interaction.options.getString('subscription'),true);}
      if(sub==='resolve'){await resolveHub(cfg,guild.id,interaction.options.getString('subscription',true),interaction.options.getString('issue',true),interaction.options.getString('receipt',true),validateReceipt);return 'Delivery state resolved. Run /journals check to continue.';}
      const state=await hubGuild(cfg,guild.id),subs=Object.entries(state?.subscriptions||{});
      if(!subs.length)return 'No journal subscriptions yet. Use /journals catalog, then /journals add.';
      return subs.map(([id,s])=>`**${id}** — ${s.journal.name} → <#${s.channelId}> · ${!s.active?'removed':s.paused?'paused':'active'}`+(sub==='status'?`\nNext: ${s.nextScanAt||'pending'}${s.lastError?'\nError: '+s.lastError:''}${Object.entries(s.issues).filter(([,i])=>i.operation).map(([key,i])=>`\nPending: ${key} · ${i.operation.kind}${i.operation.doi?' '+i.operation.doi:''} · thread ${i.threadId||'not confirmed'}`).join('')}`:'')).join('\n');
    });
    await interaction.editReply(typeof reply==='string'?{content:reply.slice(0,1900),allowedMentions:{parse:[]}}:reply);
  }catch(e){await interaction.editReply({content:safe(e),allowedMentions:{parse:[]}});}
},e=>console.error(safe(e))));
client.on(Events.GuildCreate,guardedListener(g=>enqueue(()=>welcome(g)),e=>console.error(safe(e))));
client.on(Events.Error,e=>console.error(safe(e)));
async function run(){
  const identity=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bot ${cfg.token}`},signal:AbortSignal.timeout(30000)});
  if(!identity.ok||(await identity.json()).id!==cfg.applicationId)throw new Error('Discord token and application ID did not verify.');
  await new Promise((resolve,reject)=>{
    client.once(Events.ClientReady,async()=>{
      try{
        await client.application.commands.set([hubCommand.toJSON()]);
        await fs.mkdir(cfg.stateDir,{recursive:true});await fs.writeFile(path.join(cfg.stateDir,'ready.json'),JSON.stringify({applicationId:client.application.id,username:client.user.username,registeredAt:new Date().toISOString(),guilds:[...client.guilds.cache.keys()]}));
        console.log(`Research Journal Hub online: ${client.user.username}; /journals registered; ${client.guilds.cache.size} server(s).`);
        for(const g of client.guilds.cache.values()){await enqueue(()=>welcome(g)).catch(()=>{});await enqueue(()=>check(g)).catch(()=>{});}
        timer=setInterval(()=>{for(const g of client.guilds.cache.values())enqueue(()=>check(g)).catch(()=>{});},60000);
      }catch(e){reject(e);}
    });
    const stop=async()=>{clearInterval(timer);await queue;client.destroy();resolve();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    client.login(cfg.token).catch(reject);
  });
}
const start=()=>withLock(path.join(cfg.stateDir,'runtime'),run);
// An upgrade using the original identity must never run alongside the old service.
const work=cfg.token===base.token?()=>withLock(path.join(base.stateDir,'runtime'),start):start;
work().catch(e=>{clearInterval(timer);client.destroy();console.error(safe(e));process.exitCode=1;});

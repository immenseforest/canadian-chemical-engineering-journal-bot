import fs from 'node:fs/promises';
import path from 'node:path';
import {Client,Events,GatewayIntentBits,PermissionFlagsBits,ChannelType,SlashCommandBuilder,MessageFlags} from 'discord.js';
import {loadEnv} from './config.mjs';
import {redactedError} from './installable-config.mjs';
import {threadInstallableConfig,threadInviteUrl} from './thread-config.mjs';
import {fetchRecords,journals} from './journals.mjs';
import {attachmentFor} from './attachments.mjs';
import {guildState,configureGuild,scanGuild,resolveGuildDelivery} from './thread-core.mjs';
import {withLock} from './state.mjs';
import {guardedListener} from './event-handler.mjs';

import {threadSender} from './thread-delivery.mjs';
loadEnv();loadEnv('.env.threads');const cfg=threadInstallableConfig(process.env,process.cwd());
if(!cfg.token||!cfg.applicationId){console.error('Set THREAD_DISCORD_BOT_TOKEN and THREAD_DISCORD_APPLICATION_ID in .env.threads.');process.exit(1);}
const client=new Client({intents:[GatewayIntentBits.Guilds],rest:{retries:0}});
let queue=Promise.resolve();const enqueue=fn=>{const next=queue.then(fn);queue=next.catch(e=>console.error(redactedError(e,cfg)));return next;};
let cachedRecords=null,metadataAt=0;
async function records(refresh=false){
  if(!refresh&&cachedRecords&&Date.now()-metadataAt<cfg.intervalMs)return cachedRecords;
  const fresh=await fetchRecords(journals[0],{mailto:cfg.mailto});
  cachedRecords=fresh;metadataAt=Date.now();
  await fs.mkdir(cfg.stateDir,{recursive:true});await fs.writeFile(path.join(cfg.stateDir,'metadata.json'),JSON.stringify(fresh));return fresh;
}
const required=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.CreatePublicThreads,PermissionFlagsBits.SendMessagesInThreads];
function usable(channel,guild){return channel?.type===ChannelType.GuildText&&required.every(p=>channel.permissionsFor(guild.members.me)?.has(p));}
async function ensureChannel(guild){
  const state=await guildState(cfg,guild.id);
  await guild.members.fetchMe();await guild.channels.fetch();
  if(state?.channelId){
    const channel=guild.channels.cache.get(state.channelId);
    if(!usable(channel,guild))throw new Error(`${guild.name}: configured channel unavailable. Select another with /journal-threads channel.`);
    return channel;
  }
  let channel=guild.channels.cache.find(c=>c.name===cfg.channelName&&usable(c,guild));
  if(!channel&&guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)){
    channel=await guild.channels.create({name:cfg.channelName,type:ChannelType.GuildText,topic:'The Canadian Journal of Chemical Engineering: highlighted articles, author credits and publication dates. New issues checked every 24 hours.',reason:'Journal bot automatic setup after server installation'});
  }
  channel??=(usable(guild.systemChannel,guild)?guild.systemChannel:null);
  channel??=guild.channels.cache.filter(c=>usable(c,guild)).sort((a,b)=>a.position-b.position).first();
  if(!channel)throw new Error(`${guild.name}: no writable text channel. Grant channel permissions or use /journal-threads channel.`);
  await configureGuild(cfg,guild.id,{channelId:channel.id});return channel;
}
const send=threadSender(client);
async function checkGuild(guild,force=false,refreshExisting=false){
  const target=await guildState(cfg,guild.id);
  if(target?.paused||(!force&&target?.nextScanAt&&Date.parse(target.nextScanAt)>Date.now()))return target.lastResult||{notDue:true};
  await ensureChannel(guild);
  return scanGuild(cfg,guild.id,await records(force),{force,refreshExisting,send,attachmentFor});
}
const command=new SlashCommandBuilder().setName('journal-threads').setDescription('Manage Canadian chemical engineering issue threads').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
  .addSubcommand(c=>c.setName('status').setDescription('Show channel, schedule, and any delivery needing attention'))
  .addSubcommand(c=>c.setName('check').setDescription('Check for new issues now; leave existing posts unchanged'))
  .addSubcommand(c=>c.setName('refresh').setDescription('Explicitly update existing summaries and add available PDFs'))
  .addSubcommand(c=>c.setName('pause').setDescription('Pause automatic journal posts'))
  .addSubcommand(c=>c.setName('resume').setDescription('Resume daily journal posts'))
  .addSubcommand(c=>c.setName('channel').setDescription('Choose the journal channel and initialize its history').addChannelOption(o=>o.setName('destination').setDescription('Text channel for issue posts').addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand(c=>c.setName('resolve').setDescription('Resolve uncertain delivery after checking channel history').addStringOption(o=>o.setName('issue').setDescription('For example cjce:104:9').setRequired(true)).addStringOption(o=>o.setName('result').setDescription('Confirmed thread/message ID, or retry after verifying it was not created').setRequired(true)));

client.on(Events.InteractionCreate,guardedListener(async interaction=>{
  if(!interaction.isChatInputCommand()||interaction.commandName!=='journal-threads'||!interaction.guild)return;
  if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)){
    await interaction.reply({content:'Manage Server permission is required to change this bot.',flags:MessageFlags.Ephemeral});return;
  }
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try{
    const text=await enqueue(async()=>{
      const guild=interaction.guild;const sub=interaction.options.getSubcommand();
      if(sub==='pause'){await configureGuild(cfg,guild.id,{paused:true});return 'Automatic posting paused.';}
      if(sub==='resume'){await configureGuild(cfg,guild.id,{paused:false,nextScanAt:null});const result=await checkGuild(guild,true);return `Daily scans resumed. ${JSON.stringify(result)}`;}
      if(sub==='channel'){
        const channel=interaction.options.getChannel('destination',true);await guild.members.fetchMe();
        if(!usable(channel,guild))throw new Error('The bot needs View Channel, Send Messages, Embed Links, Read Message History, Create Public Threads and Send Messages in Threads there.');
        await configureGuild(cfg,guild.id,{channelId:channel.id,nextScanAt:null,paused:false});
        const result=await checkGuild(guild,true);return `Journal channel: <#${channel.id}>. ${JSON.stringify(result)}`;
      }
      if(sub==='resolve'){
        const issue=interaction.options.getString('issue',true);const result=interaction.options.getString('result',true);
        if(result!=='retry'){
          const target=await guildState(cfg,guild.id);
          const item=target.issues[`${target.channelId}:${issue}`];
          const operation=item?.progress?.operation;
          if(!operation)throw new Error('No uncertain delivery operation for this issue');
          if(operation.kind==='thread'){
            const thread=await client.channels.fetch(result);
            if(!thread.isThread()||thread.parentId!==target.channelId||thread.ownerId!==client.user.id||thread.name!==item.threadName)throw new Error('Thread must belong to this bot and configured channel');
            if(Object.values(target.issues).some(i=>i!==item&&i.progress?.threadId===result))throw new Error('Thread already belongs to another issue');
          }else{
            const channel=await client.channels.fetch(item.progress.threadId);const message=await channel.messages.fetch(result);
            if(message.author.id!==client.user.id||!message.embeds.some(e=>e.footer?.text?.includes(`· ${issue} ·`)))throw new Error('That message does not match this bot and issue.');
          }
        }
        await resolveGuildDelivery(cfg,guild.id,issue,result);return 'Delivery state resolved. The next check will continue.';
      }
      if(sub==='check')return `Scan completed. ${JSON.stringify(await checkGuild(guild,true))}`;
      if(sub==='refresh')return `Refresh completed. ${JSON.stringify(await checkGuild(guild,true,true))}`;
      const target=await guildState(cfg,guild.id);if(!target)return 'Setup is pending. Use /journal-threads channel to select a destination.';
      const pending=Object.values(target.issues).filter(i=>i.status==='pending').map(i=>`${i.issueKey} (${i.progress?.operation?.kind||'ready to resume'}${i.progress?.threadId?', thread '+i.progress.threadId:''})`);
      return `Channel: <#${target.channelId}>\nAutomatic scans: ${target.paused?'paused':'every 24 hours'}\nNext scan: ${target.nextScanAt||'pending'}\nPending delivery: ${pending.join(', ')||'none'}\n${JSON.stringify(target.lastResult||{})}`;
    });
    await interaction.editReply(text.slice(0,1900));
  }catch(e){
    console.error(redactedError(e,cfg));
    // Expired interaction replies must not stop a running journal scan or gateway.
    await interaction.editReply(redactedError(e,cfg).slice(0,1900));
  }
},e=>console.error(`Discord command failed: ${redactedError(e,cfg)}`)));
client.on(Events.GuildCreate,guild=>{if(client.isReady())enqueue(()=>checkGuild(guild,true)).catch(()=>{});});
client.on(Events.Error,e=>console.error(redactedError(e,cfg)));
let timer;
async function run(){
  await withLock(path.join(cfg.stateDir,'runtime'),async()=>{
    const identityResponse=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bot ${cfg.token}`},signal:AbortSignal.timeout(30000)});
    if(identityResponse.status===401)throw new Error('Discord rejected the thread bot token. Update .env.threads and preserve the threaded delivery state.');
    if(!identityResponse.ok)throw new Error(`Discord credential check failed (HTTP ${identityResponse.status}).`);
    const identity=await identityResponse.json();
    if(identity.id!==cfg.applicationId)throw new Error('Bot token and application ID do not match. Run npm run setup.');
    await new Promise((resolve,reject)=>{
      client.once(Events.ClientReady,async()=>{
        try{
          if(client.application.id!==cfg.applicationId)throw new Error('Bot token and application ID do not match. Run setup again.');
          await client.application.commands.set([command.toJSON()]);
          console.log(`Online: ${client.user.username}. Invite: ${threadInviteUrl(client.application.id)}`);
          console.log(`Connected to ${client.guilds.cache.size} server(s). Scans every 24 hours; previously delivered issues are skipped.`);
          for(const guild of client.guilds.cache.values())await enqueue(()=>checkGuild(guild)).catch(()=>{});
          timer=setInterval(()=>{for(const guild of client.guilds.cache.values())enqueue(()=>checkGuild(guild)).catch(()=>{});},60000);
        }catch(e){reject(e);}
      });
      const stop=async()=>{clearInterval(timer);await queue;client.destroy();resolve();};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      client.login(cfg.token).catch(reject);
    });
  });
}
run().catch(e=>{clearInterval(timer);client.destroy();console.error(redactedError(e,cfg));process.exitCode=1;});

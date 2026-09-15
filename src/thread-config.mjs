import path from 'node:path';
import {PermissionFlagsBits} from 'discord.js';
import {installableConfig,inviteUrl} from './installable-config.mjs';

export function threadInstallableConfig(env=process.env,cwd=process.cwd()){
  const cfg=installableConfig(env,cwd);
  cfg.token=(env.THREAD_DISCORD_BOT_TOKEN||'').trim();
  cfg.applicationId=(env.THREAD_DISCORD_APPLICATION_ID||'').trim();
  if(cfg.applicationId&&!/^\d+$/.test(cfg.applicationId))throw new Error('Invalid thread bot application ID');
  cfg.stateDir=path.resolve(cwd,env.THREAD_BOT_STATE_DIR||'data/threaded');
  cfg.channelName='chemical-engineering-journal-threads';
  return cfg;
}

export function threadInviteUrl(applicationId){
  const url=new URL(inviteUrl(applicationId));
  url.searchParams.set('permissions',(BigInt(url.searchParams.get('permissions'))|PermissionFlagsBits.CreatePublicThreads|PermissionFlagsBits.SendMessagesInThreads).toString());
  return url.href;
}

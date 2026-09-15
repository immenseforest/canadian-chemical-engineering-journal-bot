import {PermissionFlagsBits as P} from 'discord.js';
export function hubInviteUrl(applicationId){
  if(!/^\d+$/.test(applicationId||''))throw new Error('Invalid application ID');
  const permissions=P.ViewChannel|P.SendMessages|P.ReadMessageHistory|P.EmbedLinks|P.AttachFiles|P.CreatePublicThreads|P.SendMessagesInThreads;
  const url=new URL('https://discord.com/oauth2/authorize');
  url.search=new URLSearchParams({client_id:applicationId,scope:'bot applications.commands',permissions:String(permissions),integration_type:'0'});
  return url.href;
}

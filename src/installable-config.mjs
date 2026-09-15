import path from 'node:path';
export const SCAN_INTERVAL_MS=24*60*60*1000;
export const APP_NAME='Canadian Chemical Eng Journal';
export const BOT_USERNAME='ccej_bot';
export const APP_ID='1549241607386046516';
export const INVITE_PERMISSIONS='117776'; // View, send, history, embeds, files, create channel. No Administrator.
export function inviteUrl(applicationId=APP_ID) {
  if(!/^\d+$/.test(applicationId)) throw new Error('Invalid application ID');
  const url=new URL('https://discord.com/oauth2/authorize');
  url.search=new URLSearchParams({client_id:applicationId,scope:'bot applications.commands',permissions:INVITE_PERMISSIONS,integration_type:'0'});
  return url.href;
}
export function installableConfig(env=process.env,cwd=process.cwd()) {
  const token=(env.DISCORD_BOT_TOKEN||'').trim();
  const timeZone=env.JOURNAL_TIME_ZONE||'America/Toronto';
  new Intl.DateTimeFormat('en-CA',{timeZone}).format();
  return {token,applicationId:env.DISCORD_APPLICATION_ID||APP_ID,timeZone,stateDir:path.resolve(cwd,env.BOT_STATE_DIR||'data/installable'),
    mailto:env.CROSSREF_MAILTO||'',manifest:path.resolve(cwd,env.ISSUE_MANIFEST||'issues.json'),
    maxPdfBytes:9437184,autoWileyHighlights:env.AUTO_WILEY_HIGHLIGHTS==='true',wileyRedistributionAllowed:env.WILEY_PDF_REDISTRIBUTION_ALLOWED==='true',
    intervalMs:SCAN_INTERVAL_MS,channelName:'chemical-engineering-journal'};
}
export function redactedError(e,cfg) {
  let message=String(e?.message||e);
  if(cfg.token) message=message.split(cfg.token).join('[bot token redacted]');
  return message.replace(/https:\/\/[^\s]*discord[^\s]*/gi,'[Discord URL redacted]');
}

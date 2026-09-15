import http from 'node:http';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {inviteUrl} from '../src/installable-config.mjs';
const route='/'+randomBytes(24).toString('hex');
let busy=false;
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options','nosniff');
  const host=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==host||req.url!==route){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.method==='GET'){
    res.end('<!doctype html><title>Set up Canadian Chemical Eng Journal</title><main style="max-width:640px;margin:60px auto;font:18px system-ui"><h1>Connect your journal bot</h1><p>Paste the bot token from Discord Developer Portal → Bot. It is stored only in this folder’s .env file.</p><form method="post"><label>Bot token <input name="token" type="password" autocomplete="off" required style="width:100%;padding:12px"></label><p><button style="padding:12px">Save and verify</button></p></form><p>The bot posts the current month plus nine previous months when added to a server, then checks every 24 hours.</p></main>');return;
  }
  if(req.method!=='POST'||req.headers.origin!==`http://${host}`||busy){res.writeHead(403).end();return;}
  busy=true;
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('size');}
    const token=new URLSearchParams(body).get('token')?.trim()||'';
    if(!/^[A-Za-z0-9._-]{30,256}$/.test(token))throw new Error('token');
    const response=await fetch('https://discord.com/api/v10/oauth2/applications/@me',{headers:{Authorization:`Bot ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('verify');const app=await response.json();
    let env=await fs.readFile('.env','utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
    for(const [key,value] of Object.entries({DISCORD_BOT_TOKEN:token,DISCORD_APPLICATION_ID:app.id,CHECK_INTERVAL_HOURS:'24',JOURNAL_TIME_ZONE:'America/Toronto'})){
      const regex=new RegExp(`^${key}=.*$`,'m');env=regex.test(env)?env.replace(regex,`${key}=${value}`):env+`\n${key}=${value}\n`;
    }
    await fs.writeFile('.env',env,{mode:0o600});
    const invite=inviteUrl(app.id);await fs.mkdir('data',{recursive:true});await fs.writeFile('data/invite-url.txt',invite+'\n');
    res.end(`<!doctype html><title>Journal bot connected</title><h1>Bot token verified and saved</h1><p><a href="${invite.replaceAll('&','&amp;')}">Add the bot to a server</a></p><p>Run START-BOT.cmd or npm start to bring it online. Windows users can run INSTALL-AUTOSTART.ps1 to start automatically at login.</p>`);
    console.log(`Bot credentials saved (secret hidden). Application ID: ${app.id}`);console.log(`Invite: ${invite}`);server.close();
  }catch{busy=false;res.writeHead(400).end('Could not verify or save this bot token. Check the token and try again.');}
});
server.listen(0,'127.0.0.1',()=>console.log(`Setup URL: http://127.0.0.1:${server.address().port}${route}`));
setTimeout(()=>{server.close();process.exit(1);},1800000).unref();

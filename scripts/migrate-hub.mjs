import fs from 'node:fs/promises';
import path from 'node:path';
import {loadEnv} from '../src/config.mjs';
import {installableConfig} from '../src/installable-config.mjs';
import {withLock,readState,saveState} from '../src/state.mjs';
import {catalog} from '../src/hub-catalog.mjs';
loadEnv();const original=installableConfig();
const source=await readState(path.join(original.stateDir,'state.json'));
const destination=path.resolve(process.env.HUB_BOT_STATE_DIR||'data/hub');
await withLock(destination,async file=>{
  const state=await readState(file);
  for(const [guildId,old] of Object.entries(source.destinations)){
    if(!old.channelId||state.destinations[guildId])continue;
    const issues={};
    for(const [key,item] of Object.entries(old.issues||{})){
      if(!key.startsWith(old.channelId+':'))continue;
      if(item.status!=='sent')throw new Error('Resolve the original bot pending delivery before migration.');
      issues[item.issueKey]={status:'sent',legacy:true,messageId:item.messageId};
    }
    state.destinations[guildId]={subscriptions:{cjce:{journal:catalog[0],channelId:old.channelId,history:0,oaOnly:false,active:true,paused:old.paused||false,nextScanAt:old.nextScanAt,issues}}};
  }
  await fs.copyFile(path.join(original.stateDir,'state.json'),path.join(destination,'original-state-backup.json'));
  await saveState(file,state);console.log('Existing chemical-engineering destination and delivery receipts preserved in hub state.');
});

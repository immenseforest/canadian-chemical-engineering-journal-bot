import fs from 'node:fs/promises';
import {loadIeeeKey} from '../src/ieee-client.mjs';
import {loadEnv} from '../src/config.mjs';
import {installableConfig} from '../src/installable-config.mjs';
import {catalog} from '../src/hub-catalog.mjs';
import {discoverJournal} from '../src/hub-discovery.mjs';
import {introPayload,articlePayload,issueTitle} from '../src/hub-format.mjs';
loadEnv();loadEnv('.env.hub');const cfg=installableConfig();cfg.ieeeKey=await loadIeeeKey(process.env.IEEE_XPLORE_API_KEY||'');
const results=[];
for(const journal of catalog){
  try{
    const issues=await discoverJournal(journal,cfg);const latest=issues.at(-1);if(!latest)throw new Error('No current issue found');
    const articles=(latest.highlightedArticles?.length?latest.highlightedArticles:latest.articles).slice(0,4);
    const result={id:journal.id,issues:issues.length,title:issueTitle(latest),articles:latest.articles.length,abstracts:articles.filter(a=>a.abstract).length,intro:introPayload(latest,null),messages:articles.map((a,i)=>articlePayload(latest,a,i))};
    console.log(JSON.stringify({id:result.id,issues:result.issues,title:result.title,articles:result.articles,abstracts:result.abstracts}));results.push(result);
  }catch(e){console.error(`${journal.id}: ${e.message}`);process.exitCode=1;results.push({id:journal.id,error:e.message});}
}
await fs.mkdir('output',{recursive:true});await fs.writeFile('output/hub-preview.json',JSON.stringify(results,null,2));

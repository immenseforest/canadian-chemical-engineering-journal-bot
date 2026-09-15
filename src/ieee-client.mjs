import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withLock,saveState} from './state.mjs';
const day=86400000;
let queue=Promise.resolve();
export function ieeeRequest(query,key,fetchImpl=fetch,{dir='data/ieee',now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const work=()=>withLock(dir,async file=>{
    let state;try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={calls:[],cache:{}};}
    const fingerprint=createHash('sha256').update(key).digest('hex');
    const cacheKey=createHash('sha256').update(fingerprint+JSON.stringify(Object.entries(query).sort())).digest('hex');
    const cached=state.cache[cacheKey];if(cached&&now()-cached.at<day)return cached.articles;
    if(state.blocked?.key===fingerprint&&now()<state.blocked.until)throw new Error(state.blocked.message);
    state.calls=state.calls.filter(c=>now()-c.at<day);
    const calls=state.calls.filter(c=>c.key===fingerprint);
    if(calls.length>=200)throw new Error('IEEE rolling 24-hour budget exhausted (200 calls); cached metadata remains available.');
    const wait=110-(now()-(calls.at(-1)?.at||0));if(wait>0)await sleep(wait);
    state.calls.push({key:fingerprint,at:now()});
    await saveState(file,state); // Reserve before sending, including failed requests and restarts.
    const url=new URL('https://ieeexploreapi.ieee.org/api/v1/search/articles');
    url.search=new URLSearchParams({format:'json',max_records:'1',...query,apikey:key});
    const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error('IEEE metadata connection failed.');});
    if(!response.ok){
      const inactive=response.status===403&&(await response.text()).includes('Developer Inactive');
      const message=inactive?'IEEE developer account is inactive; activate it at developer.ieee.org.':`IEEE metadata HTTP ${response.status}; check key and quota.`;
      if([401,403,429].includes(response.status)){state.blocked={key:fingerprint,until:now()+(response.status===429?day:3600000),message};await saveState(file,state);}
      throw new Error(message);
    }
    let data;try{data=await response.json();}catch{throw new Error('IEEE returned invalid JSON.');}
    if(!Array.isArray(data.articles))throw new Error('IEEE returned no usable article metadata.');
    state.cache=Object.fromEntries(Object.entries(state.cache).filter(([,v])=>now()-v.at<day));
    state.cache[cacheKey]={at:now(),articles:data.articles};await saveState(file,state);
    return data.articles;
  });
  const next=queue.then(work);queue=next.catch(()=>{});return next;
}
export async function loadIeeeKey(fallback='',dir='data/hub'){
  try{return JSON.parse(await fs.readFile(path.join(dir,'ieee-key.json'),'utf8')).key||fallback;}catch(e){if(e.code==='ENOENT')return fallback;throw e;}
}
export async function replaceIeeeKey(key,dir='data/hub',request=ieeeRequest){
  if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key))throw new Error('Enter a valid IEEE metadata key.');
  await request({publication_number:'8782664'},key);
  await fs.mkdir(dir,{recursive:true});await saveState(path.join(dir,'ieee-key.json'),{key});
  return key;
}

import {journals} from './journals.mjs';

export const catalog=[
  {...journals[0],abbreviation:'Can. J. Chem. Eng.',mode:'issues',oa:false},
  {id:'cjece',name:'IEEE Canadian Journal of Electrical and Computer Engineering',abbreviation:'IEEE Can. J. Electr. Comput. Eng.',issn:'2694-1783',punumber:'9349829',publisher:'IEEE',color:0x00629b,mode:'issues',oa:false},
  {id:'gji',name:'Geophysical Journal International',abbreviation:'Geophys. J. Int.',issn:'1365-246X',punumber:'8016795',publisher:'Oxford University Press',color:0x8c5030,mode:'issues',oa:true,oaSince:2024},
  {id:'ojcs',name:'IEEE Open Journal of the Computer Society',abbreviation:'IEEE OJ-CS',issn:'2644-1268',punumber:'8782664',publisher:'IEEE',color:0x7f3f98,mode:'continuous',oa:true},
  {id:'ijfp',name:'International Journal of Fluid Power',abbreviation:'Int. J. Fluid Power',issn:'2332-1180',punumber:'11478926',publisher:'River Publishers',color:0x19847a,mode:'issues',oa:false},
].map(j=>({...j,url:j.url||`https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=${j.punumber}`}));

export function ieeePublication(url){
  let parsed;try{parsed=new URL(url);}catch{throw new Error('Paste an IEEE Xplore journal link.');}
  if(parsed.protocol!=='https:'||parsed.hostname!=='ieeexplore.ieee.org'||parsed.port||parsed.username||parsed.password)throw new Error('Use an https://ieeexplore.ieee.org journal link.');
  const id=parsed.searchParams.get('punumber');
  if(!/^\d{1,12}$/.test(id||''))throw new Error('Use the journal page link containing punumber=, rather than an individual article.');
  return id;
}

export async function ieeeQuery(query,key,fetchImpl=fetch){
  const url=new URL('https://ieeexploreapi.ieee.org/api/v1/search/articles');
  url.search=new URLSearchParams({apikey:key,format:'json',max_records:'1',...query});
  // Never print a request URL: it contains the IEEE key.
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(30000)}).catch(()=>{throw new Error('IEEE metadata connection failed.');});
  if(!response.ok)throw new Error(`IEEE metadata HTTP ${response.status}; check the API key and quota.`);
  const data=await response.json();
  if(!Array.isArray(data.articles))throw new Error('IEEE returned no usable article metadata.');
  return data.articles;
}

export async function resolveJournal(url,{issn='',apiKey='',fetchImpl=fetch}={}){
  const punumber=ieeePublication(url),known=catalog.find(j=>j.punumber===punumber);
  if(known)return {...known};
  let article;
  if(apiKey){
    [article]=await ieeeQuery({publication_number:punumber},apiKey,fetchImpl);
    if(!article||String(article.publication_number)!==punumber||!/journal/i.test(article.content_type||''))throw new Error('That IEEE link did not identify a journal.');
    issn=String(article.issn||'').match(/\d{4}-\d{3}[\dX]/i)?.[0]||'';
  }
  if(!/^\d{4}-\d{3}[\dX]$/i.test(issn))throw new Error('For an unfamiliar journal, enter its ISSN from the journal page, or ask the bot owner to configure IEEE_XPLORE_API_KEY once.');
  const response=await fetchImpl(`https://api.crossref.org/journals/${issn.toUpperCase()}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('That ISSN has no accessible Crossref journal record.');
  const {message}=await response.json();
  if(!message?.title)throw new Error('Crossref did not identify the journal title.');
  const name=article?.publication_title||message.title;
  return {id:`ieee-${punumber}`,punumber,issn:issn.toUpperCase(),name,abbreviation:name.length<=42?name:name.split(/\s+/).filter(w=>!/^(of|the|and|for|on)$/i.test(w)).map(w=>w[0]).join('').slice(0,24),publisher:article?.publisher||message.publisher||'Publisher',url:`https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=${punumber}`,color:0x00629b,mode:'issues',oa:false,mappingSource:article?'IEEE API':'ISSN supplied by server manager'};
}

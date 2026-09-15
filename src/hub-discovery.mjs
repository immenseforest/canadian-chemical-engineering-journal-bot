import {fetchRecords,clean} from './journals.mjs';
import {calendarIssues} from './calendar.mjs';
import {authorNames,publicationDate} from './credits.mjs';
import {ieeeQuery} from './hub-catalog.mjs';

function parts(r){return r['published-print']?.['date-parts']?.[0]||r.published?.['date-parts']?.[0]||r['published-online']?.['date-parts']?.[0];}
export function openArticle(record,journal,now=new Date()){
  if(record.accessType==='Open Access')return true;
  if(journal.oa&&(!journal.oaSince||parts(record)?.[0]>=journal.oaSince))return true;
  return (record.license||[]).some(l=>/^https?:\/\/creativecommons\.org\/(licenses|publicdomain)\//i.test(l.URL||'')&&(!l.start?.['date-time']||Date.parse(l.start['date-time'])<=now.getTime()));
}

export function journalIssues(journal,records,{now=new Date(),oaOnly=false,timeZone='America/Toronto'}={}){
  if(journal.id==='cjce'){
    const allowed=new Set(records.filter(r=>openArticle(r,journal,now)).map(r=>r.DOI?.toLowerCase()));
    return calendarIssues(records,{now,timeZone}).map(i=>({...i,abbreviation:journal.abbreviation,continuous:false,articles:oaOnly?i.articles.filter(a=>allowed.has(a.doi.toLowerCase())):i.articles,highlightedArticles:oaOnly?i.highlightedArticles.filter(a=>allowed.has(a.doi.toLowerCase())):i.highlightedArticles})).filter(i=>i.articles.length);
  }
  const groups=new Map(),seen=new Set();
  for(const r of records){
    const p=parts(r),doi=r.DOI?.toLowerCase();
    if(r.type!=='journal-article'||!doi||seen.has(doi)||!r.title?.[0]||!p?.[0])continue;
    if(p[1]&&(p[1]<1||p[1]>12))continue;
    if(Date.UTC(p[0],(p[1]||1)-1,p[2]||1)>now.getTime())continue;
    if(/^(editorial board|front cover|back cover|table of contents|cover|correction|erratum)/i.test(clean(r.title[0])))continue;
    if(oaOnly&&!openArticle(r,journal,now))continue;
    seen.add(doi);
    const volume=/^\d+$/.test(r.volume||'')?String(r.volume):null;
    const number=volume&&/^\d+(?:[-/]\d+)?$/.test(r.issue||'')?String(r.issue):null;
    // Never invent issue numbers or cover months from DOI strings or indexing dates.
    const continuous=!number;
    const key=`${journal.id}:${volume?'v'+volume:'y'+p[0]}:${number?'i'+number:volume?'annual':'m'+(p[1]||'unknown')}`;
    const group=groups.get(key)||{key,volume,number,continuous,coverYear:p[0],coverMonth:number?p[1]||null:volume?null:p[1]||null,journalId:journal.id,journalName:journal.name,abbreviation:journal.abbreviation,publisher:journal.publisher,journalUrl:journal.url,issueUrl:journal.url,color:journal.color,articles:[],highlightedArticles:[]};
    if(number&&p[1]&&(!group.coverMonth||p[1]<group.coverMonth))group.coverMonth=p[1];
    group.articles.push({doi,title:clean(r.title[0]),url:`https://doi.org/${encodeURI(doi)}`,abstract:clean(r.abstract||''),authors:authorNames(r),firstPublished:publicationDate(r),page:r.page||'',openAccess:openArticle(r,journal,now)});
    groups.set(key,group);
  }
  return [...groups.values()].map(g=>({...g,articles:g.articles.sort((a,b)=>String(a.page).localeCompare(String(b.page),undefined,{numeric:true})||a.doi.localeCompare(b.doi))})).sort((a,b)=>a.coverYear-b.coverYear||Number(a.volume||0)-Number(b.volume||0)||Number(a.number?.split(/[-/]/)[0]||a.coverMonth||0)-Number(b.number?.split(/[-/]/)[0]||b.coverMonth||0));
}

export async function discoverJournal(journal,cfg,{now=new Date(),fetchImpl=fetch}={}){
  const records=await fetchRecords(journal,{now,fetchImpl,mailto:cfg.mailto});
  if(journal.punumber&&cfg.ieeeKey){
    try{
      const metadata=await ieeeQuery({publication_number:journal.punumber,max_records:'200',sort_field:'article_number',sort_order:'desc'},cfg.ieeeKey,fetchImpl);
      const byDoi=new Map(metadata.filter(r=>r.doi).map(r=>[r.doi.toLowerCase(),r]));
      for(const r of records){const m=byDoi.get(r.DOI?.toLowerCase());if(m){r.abstract=m.abstract||r.abstract;r.accessType=m.accessType;}}
    }catch(e){console.error(journal.id+': '+e.message+' Using Crossref metadata.');}
  }
  return journalIssues(journal,records,{now,oaOnly:cfg.oaOnly,timeZone:cfg.timeZone});
}

export async function enrichArticles(articles,cfg,{fetchImpl=fetch}={}){
  if(!cfg.ieeeKey)return articles;
  return Promise.all(articles.map(async a=>{
    if(a.abstract||!a.doi.startsWith('10.1109/'))return a;
    try{const [record]=await ieeeQuery({doi:a.doi},cfg.ieeeKey,fetchImpl);return record?.doi?.toLowerCase()===a.doi?{...a,abstract:clean(record.abstract||'')}:a;}catch{return a;}
  }));
}

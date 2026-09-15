import { journals,selectIssue,compareIssues } from './journals.mjs';
export function monthNumber(date=new Date(),timeZone='America/Toronto') {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'numeric'}).formatToParts(date).map(p=>[p.type,p.value]));
  return Number(p.year)*12+Number(p.month)-1;
}
export function monthLabel(month) {return `${Math.floor(month/12)}-${String(month%12+1).padStart(2,'0')}`;}
export function calendarIssues(records,{now=new Date(),timeZone='America/Toronto',startMonth=monthNumber(now,timeZone)-9}={}) {
  const end=monthNumber(now,timeZone);const groups=new Map();
  for(const r of records) {
    if(!/^\d+$/.test(r.volume||'')||!/^\d+$/.test(r.issue||'')) continue;
    const key=`${r.volume}:${r.issue}`;
    if(!groups.has(key)) groups.set(key,[]);groups.get(key).push(r);
  }
  return [...groups.values()].flatMap(rs=>{
    let issue;try{issue=selectIssue(journals[0],rs,now);}catch{return [];}
    if(!issue.coverYear||!issue.coverMonth)return [];
    const month=issue.coverYear*12+issue.coverMonth-1;
    return month>=startMonth&&month<=end?[issue]:[];
  }).sort(compareIssues);
}

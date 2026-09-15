export const editorialTeam = {
  verifiedOn: '2026-09-14',
  sourceUrl: 'https://onlinelibrary.wiley.com/page/journal/1939019x/homepage/editorialboard.html',
  people: [
    {role:'Editor-in-Chief',name:'João B. P. Soares'},
    {role:'Managing Editor',name:'Kyra Van Den Bos'},
    {role:'Production Editor',name:'Tiffany Noel'},
    {role:'Editorial Coordinator',name:'Jacob Lee'},
  ],
};

export function publicationDate(record) {
  // Crossref created/deposited/indexed timestamps are not publication dates.
  for (const [field,label] of [['published-online','First published online'],['published','First published (publisher metadata)'],['published-print','Print publication']]) {
    const parts=record[field]?.['date-parts']?.[0];
    if(!parts || !Number.isInteger(parts[0])) continue;
    if(parts[1] && (parts[1]<1 || parts[1]>12)) continue;
    if(parts[2] && (parts[2]<1 || parts[2]>31)) continue;
    const date=new Date(Date.UTC(parts[0],(parts[1]||1)-1,parts[2]||1));
    if(parts[2]&&date.getUTCDate()!==parts[2])continue;
    const options={year:'numeric',timeZone:'UTC'};
    if(parts[1]) options.month='long';
    if(parts[2]) options.day='numeric';
    return {label,iso:parts.map((v,i)=>i ? String(v).padStart(2,'0') : String(v)).join('-'),text:date.toLocaleDateString('en-GB',options)};
  }
  return null;
}

export function authorNames(record) {
  return (record.author || []).map(a=>a.name || [a.given,a.family,a.suffix].filter(Boolean).join(' ')).map(a=>a.replace(/\s+/g,' ').trim()).filter(Boolean);
}

export function articleCredit(article) {
  const date=article.firstPublished;
  return `**${date?.label || 'Original publication date'}:** ${date?.text || 'Not supplied by publisher'}\n**Authors:** ${article.authors?.length ? article.authors.join('; ') : 'Not supplied by publisher'}`;
}

export function editorialCredit() {
  return `**Journal editorial team** · [Wiley source](${editorialTeam.sourceUrl}) · verified ${editorialTeam.verifiedOn}\n${editorialTeam.people.map(p=>`${p.role}: ${p.name}`).join(' · ')}`;
}

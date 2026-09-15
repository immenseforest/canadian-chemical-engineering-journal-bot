import { authorNames, publicationDate } from './credits.mjs';

export const journals = [
  {
    id: 'cjce', issn: '1939-019X', publisher: 'Wiley', color: 0x157a74,
    name: 'The Canadian Journal of Chemical Engineering',
    url: 'https://onlinelibrary.wiley.com/journal/1939019x',
  },
];

export function clean(value = '') {
  return String(value).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function dateOf(record, field) {
  const p = record[field]?.['date-parts']?.[0];
  if (!p || !Number.isInteger(p[0])) return null;
  return new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1));
}

export function compareIssues(a, b) {
  return Number(a.volume) - Number(b.volume) || Number(a.number) - Number(b.number);
}

export function selectIssue(journal, records, now = new Date()) {
  const groups = new Map();
  for (const r of records) {
    // Early-view articles without issue assignments are deliberately excluded.
    if (!/^\d+$/.test(r.volume ?? '') || !/^\d+$/.test(r.issue ?? '')) continue;
    const key = `${journal.id}:${r.volume}:${r.issue}`;
    if (!groups.has(key)) groups.set(key, { key, volume: String(r.volume), number: String(r.issue), records: [] });
    groups.get(key).records.push(r);
  }
  const eligible = [...groups.values()].filter(g => g.records.some(r => {
    // An online publication can precede its issue's cover date.
    const date = dateOf(r, 'published-online') || dateOf(r, 'published-print') || dateOf(r, 'published');
    return date && date <= now;
  }));
  const latest = eligible.sort(compareIssues).at(-1);
  if (!latest) throw new Error(`${journal.id}: no dated, numbered issue found`);
  const issueRecord = latest.records.find(r => r.type === 'journal-issue');
  const highlights = latest.records.find(r => /^issue highlights$/i.test(clean(r.title?.[0])) && r.DOI);
  const highlightsPdf = highlights?.link?.find(l => l['content-type'] === 'application/pdf')?.URL;
  let issueUrl = issueRecord?.resource?.primary?.URL;
  if (!issueUrl?.startsWith('https://onlinelibrary.wiley.com/toc/')) {
    issueUrl = `https://onlinelibrary.wiley.com/toc/1939019x/${latest.volume}/${latest.number}`;
  }
  const seen = new Set();
  const articles = latest.records.filter(r => {
    const title = clean(r.title?.[0]);
    if (r.type !== 'journal-article' || !r.DOI || !title || seen.has(r.DOI.toLowerCase())) return false;
    if (/^(issue information|issue highlights|table of contents|front cover|back cover|editorial board|cover)/i.test(title)) return false;
    seen.add(r.DOI.toLowerCase());
    return true;
  }).sort((a, b) => String(a.page || '').localeCompare(String(b.page || ''), undefined, { numeric: true }) || a.DOI.localeCompare(b.DOI));
  const cover = latest.records.map(r => dateOf(r, 'published-print')).find(Boolean);
  const asArticle = r => ({ doi: r.DOI, title: clean(r.title[0]), url: `https://doi.org/${encodeURI(r.DOI)}`, abstract: clean(r.abstract || ''), authors: authorNames(r), firstPublished: publicationDate(r) });
  const normalizeName=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z]/g,'');
  const highlightedArticles = (highlights?.reference || []).flatMap(ref => {
    // Some publisher references omit DOIs. Match an unambiguous first page in this issue.
    const matches = articles.filter(r => ref.DOI
      ? r.DOI.toLowerCase() === ref.DOI.toLowerCase()
      : String(ref.volume) === latest.volume && String(ref.issue) === latest.number && (
        ref['first-page'] ? String(r.page || '').split(/[-–]/)[0] === String(ref['first-page'])
        : ref.author && r.author?.[0]?.family && normalizeName(ref.author) === normalizeName(r.author[0].family + ' ' + (r.author[0].given || '').split(/[\s‐‑–-]+/).map(n=>n[0]||'').join(''))));
    return matches.length === 1 ? [asArticle(matches[0])] : [];
  }).filter((a, i, all) => all.findIndex(b => b.url === a.url) === i);
  return {
    key: latest.key, volume: latest.volume, number: latest.number,
    journalId: journal.id, journalName: journal.name, publisher: journal.publisher,
    journalUrl: journal.url, issueUrl, coverYear: cover?.getUTCFullYear(), coverMonth: cover ? cover.getUTCMonth() + 1 : null,
    hasIssueRecord: Boolean(issueRecord),
    highlights: highlights ? { doi: highlights.DOI, title: 'Issue Highlights',
      pageUrl: `https://doi.org/${encodeURI(highlights.DOI)}`,
      pdfUrl: highlightsPdf || null } : null,
    color: journal.color, highlightedArticles,
    articles: articles.map(asArticle),
  };
}

export async function fetchRecords(journal, { fetchImpl = fetch, now = new Date(), mailto = '' } = {}) {
  const from = `${now.getUTCFullYear() - 2}-01-01`;
  let cursor = '*';
  const records = [];
  // Cursor pagination avoids silently dropping issue-assigned papers behind early view.
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://api.crossref.org/journals/${journal.issn}/works`);
    // Crossref rejects publication-date sorts with cursors. Scan indexed order,
    // then select by volume/issue locally after retrieving the complete window.
    url.search = new URLSearchParams({ filter: `from-pub-date:${from}`, sort: 'indexed', order: 'desc', rows: '1000', cursor });
    if (mailto) url.searchParams.set('mailto', mailto);
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetchImpl(url, { headers: { 'User-Agent': `CanadianEngineeringJournalClub/1.0${mailto ? ` (mailto:${mailto})` : ''}` }, signal: AbortSignal.timeout(45000) });
      if (response.status !== 429 && response.status < 500) break;
      if (attempt < 2) {
        const delay = Math.max(1, Number(response.headers.get('retry-after')) || 2 ** attempt);
        if (delay > 60) throw new Error('Crossref requested a long retry delay; retry next check');
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }
    if (!response.ok) throw new Error(`Crossref HTTP ${response.status}`);
    const data = await response.json();
    const items = data.message?.items;
    if (!Array.isArray(items)) throw new Error('Crossref returned invalid metadata');
    records.push(...items);
    if (items.length < 1000 || records.length >= data.message['total-results']) return records;
    const next = data.message['next-cursor'];
    if (!next || next === cursor) throw new Error('Crossref pagination stalled; refusing incomplete discovery');
    cursor = next;
  }
  throw new Error('Crossref scan limit reached; refusing incomplete discovery');
}

export async function discover(journal, options = {}) {
  return selectIssue(journal, await fetchRecords(journal, options), options.now || new Date());
}

import { webhookUrl } from './config.mjs';
import summaries from './article-summaries.json' with { type: 'json' };
import { articleCredit, editorialCredit } from './credits.mjs';
export const BOT_NAME = 'The Canadian Chemical Engineering Journal Bot';

export function summaryFor(article) {
  const doi = (article.doi || article.url?.replace('https://doi.org/', '') || '').toLowerCase();
  if (summaries[doi]) return summaries[doi];
  // Preserve source wording for unseen articles rather than inventing a result.
  const abstract = (article.abstract || '').replace(/^Abstract\s*/i, '').trim();
  if (!abstract) return 'A verified summary is not yet available. The article is linked above.';
  const words = abstract.split(/\s+/);
  return 'Publisher abstract extract: “' + words.slice(0, 24).join(' ') + (words.length > 24 ? '…' : '') + '”';
}

export class DeliveryError extends Error {
  constructor(message, ambiguous = false) { super(message); this.ambiguous = ambiguous; }
}

function md(text) { return text.replace(/[\\\[\]*_~`|]/g, '\\$&'); }

export function payloadFor(issue, attachment) {
  const highlighted = Boolean(issue.highlightedArticles?.length);
  const papers = highlighted ? issue.highlightedArticles : issue.articles.slice(0, 4);
  const pdfLabel = attachment?.kind === 'highlights' ? 'Issue Highlights PDF' : attachment?.kind === 'contents' ? 'Table of Contents PDF' : 'Full issue PDF';
  const payload = {
    username: BOT_NAME, allowed_mentions: { parse: [] },
    content: `**Issue summary · Volume ${issue.volume}, Issue ${issue.number}${issue.coverMonth && issue.coverYear ? ' · ' + new Date(Date.UTC(issue.coverYear, issue.coverMonth - 1)).toLocaleDateString('en-CA', {month:'long',year:'numeric',timeZone:'UTC'}) : ''}**`,
    embeds: [{
      title: issue.journalName, url: issue.issueUrl, color: issue.color,
      description: `[Open issue / publisher page](${issue.issueUrl}) · [Journal homepage](${issue.journalUrl})\n\n` +
        (attachment ? `📎 ${pdfLabel} attached.` : 'Highlights PDF is not attached. Publisher links are provided below.') +
        (issue.highlights?.pageUrl ? `\n[Read Issue Highlights](${issue.highlights.pageUrl})` : '') + `\n\n${editorialCredit()}`,
      fields: papers.flatMap((a, i) => {
        const text = `[${md(a.title.slice(0, 280))}](${a.url})\n\n${summaryFor(a)}\n\n${articleCredit(a)}`;
        // Keep all author credits even for long author lists. Continuations remain
        // immediately after their article; never silently truncate names.
        const chunks = []; let rest=text;
        while(rest.length>1024) {
          let split=rest.lastIndexOf('\n',1024);
          if(split<1) split=rest.lastIndexOf('; ',1024)+1;
          if(split<1) split=rest.lastIndexOf(' ',1024);
          if(split<1) throw new Error(`${issue.key}: article credit cannot fit a Discord field`);
          chunks.push(rest.slice(0,split));rest=rest.slice(split).trimStart();
        }
        chunks.push(rest);
        return chunks.map((value,j)=>({name:`${highlighted ? 'Highlighted article' : 'Selected article'} ${i+1}${j ? ' · continued' : ''}`,value}));
      }),
      footer: { text: `${issue.publisher} · ${issue.key} · ${highlighted ? 'Articles referenced by Issue Highlights' : 'Selected issue articles'} · Summaries based on publisher abstracts and Issue Highlights` },
    }],
    attachments: attachment ? [{ id: 0, filename: attachment.name, description: `${pdfLabel} — ${issue.journalName} — volume ${issue.volume}, issue ${issue.number}` }] : [],
  };
  const embed = payload.embeds[0];
  const length = [embed.title, embed.description, embed.footer.text, ...embed.fields.flatMap(f => [f.name, f.value])].reduce((n, s) => n + (s?.length || 0), 0);
  if (payload.content.length > 2000 || embed.fields.length > 25 || length > 6000 || embed.fields.some(f => f.value.length > 1024)) {
    throw new Error(`${issue.key}: summary exceeds Discord limits; shorten the reviewed text before posting`);
  }
  return payload;
}

export async function deliver(cfg, payload, attachment, messageId, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const url = webhookUrl(cfg, messageId);
  for (let attempt = 0; attempt < 4; attempt++) {
    let body, headers;
    if (attachment) {
      body = new FormData();
      body.set('payload_json', JSON.stringify(payload));
      body.set('files[0]', new Blob([attachment.bytes], { type: 'application/pdf' }), attachment.name);
    } else { body = JSON.stringify(payload); headers = { 'Content-Type': 'application/json' }; }
    let response;
    try {
      response = await fetchImpl(url, { method: messageId ? 'PATCH' : 'POST', body, headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch { throw new DeliveryError('Discord connection failed; delivery outcome is unknown. Check the channel and resolve pending state.', true); }
    if (response.status === 429) {
      const data = await response.json().catch(() => ({}));
      const delay = Number(data.retry_after ?? response.headers.get('retry-after') ?? 5);
      if (!Number.isFinite(delay) || delay < 0 || delay > 60 || attempt === 3) throw new DeliveryError('Discord rate limited this check; it will retry on the next run');
      await sleep(Math.ceil(delay * 1000) + 100);
      continue;
    }
    if (!response.ok) throw new DeliveryError(`Discord HTTP ${response.status}${response.status === 413 ? ': PDF exceeds channel upload limit' : ''}`, response.status >= 500);
    const message = await response.json().catch(() => null);
    if (!message?.id || !/^\d+$/.test(message.id)) throw new DeliveryError('Discord response did not confirm a message ID; check pending state', true);
    return message.id;
  }
}

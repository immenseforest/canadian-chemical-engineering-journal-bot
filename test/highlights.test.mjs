import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadHighlights, automaticHighlights } from '../src/highlights.mjs';
import { selectIssue, journals } from '../src/journals.mjs';
import { payloadFor } from '../src/discord.mjs';

const url = 'https://onlinelibrary.wiley.com/doi/pdf/10.1002/cjce.70265';
const issue = { key: 'cjce:104:10', journalId: 'cjce', highlights: { pdfUrl: url, pageUrl: 'https://doi.org/10.1002/cjce.70265' }, articles: [] };
const pdf = Buffer.from('%PDF-1.7\nfixture');

test('selects Issue Highlights within latest issue and keeps its actual PDF link', () => {
  const records = ['Issue Highlights', 'Issue Information'].map((title, i) => ({
    title: [title], DOI: `10.1002/cjce.${70265 + i}`, type: 'journal-article', volume: '104', issue: '10',
    published: { 'date-parts': [[2026, 9, 8]] }, link: [{ URL: url, 'content-type': 'application/pdf' }],
  }));
  const selected = selectIssue(journals[0], records, new Date('2026-09-14'));
  assert.equal(selected.highlights.doi, '10.1002/cjce.70265');
  assert.equal(selected.highlights.pdfUrl, url);
  assert.equal(selected.articles.length, 0);
});

test('downloads PDF bytes and does not send credentials', async () => {
  const bytes = await downloadHighlights(url, 100, { fetchImpl: async (_url, opts) => {
    assert.equal(opts.redirect, 'manual');
    assert.equal(opts.headers.Cookie, undefined);
    assert.equal(opts.headers.Authorization, undefined);
    return new Response(pdf);
  } });
  assert.deepEqual(bytes, pdf);
});

test('stops on publisher rejection without retrying or saving HTML as PDF', async () => {
  let calls = 0;
  await assert.rejects(downloadHighlights(url, 100, { fetchImpl: async () => { calls++; return new Response('Denied', { status: 403 }); } }), /HTTP 403/);
  assert.equal(calls, 1);
  await assert.rejects(downloadHighlights(url, 100, { fetchImpl: async () => new Response('<html>Sign in</html>') }), /valid PDF/);
});

test('rejects oversized streaming response even without Content-Length', async () => {
  await assert.rejects(downloadHighlights(url, 10, { fetchImpl: async () => new Response(pdf) }), /MAX_PDF_BYTES/);
});

test('does not follow foreign or login redirects', async () => {
  for (const location of ['https://other.example/file.pdf', '/action/login']) {
    await assert.rejects(downloadHighlights(url, 100, { fetchImpl: async () => new Response(null, { status: 302, headers: { location } }) }), /Wiley CJCE PDF URL/);
  }
});

test('cached highlights avoid repeated downloads and are labeled accurately', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-highlights-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cfg = { stateDir: dir, autoWileyHighlights: true, wileyRedistributionAllowed: true, maxPdfBytes: 100 };
  let downloads = 0;
  const options = { fetchImpl: async requested => {
    assert.equal(requested.href, 'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/cjce.70265?download=true');
    downloads++; return new Response(pdf);
  } };
  const file = await automaticHighlights(issue, cfg, options);
  await automaticHighlights(issue, cfg, options);
  assert.equal(downloads, 1);
  assert.equal(file.name, 'cjce-104-10-highlights.pdf');
  assert.equal(file.kind, 'highlights');
  assert.match(payloadFor(issue, file).embeds[0].description, /Issue Highlights PDF attached/);
  assert.doesNotMatch(payloadFor(issue, file).embeds[0].description, /Full issue PDF/);
});

test('requires redistribution authorization before automatic attachment', async () => {
  await assert.rejects(automaticHighlights(issue, { autoWileyHighlights: true, wileyRedistributionAllowed: false }), /permission/);
  assert.equal(await automaticHighlights({ ...issue, journalId: 'unsupported' }, { autoWileyHighlights: true }), null);
});

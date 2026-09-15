import test from 'node:test';
import assert from 'node:assert/strict';
import { journals, selectIssue } from '../src/journals.mjs';
import { payloadFor, BOT_NAME, summaryFor } from '../src/discord.mjs';

test('summaries use highlighted DOI references and unambiguous same-issue pages', () => {
  const record = (DOI, title, page, extra = {}) => ({ DOI, title: [title], page, volume: '104', issue: '10', type: 'journal-article', 'published-online': { 'date-parts': [[2026, 9, 8]] }, ...extra });
  const issue = selectIssue(journals[0], [
    record('10.x/h', 'Issue Highlights', '1', { reference: [{ DOI: '10.X/REVIEW' }, { volume: '104', issue: '10', 'first-page': '20' }, { volume: '103', issue: '10', 'first-page': '30' }] }),
    record('10.x/other', 'Unrelated paper', '2'),
    record('10.x/review', 'Responsible human judgement in peer review', '10-19'),
    record('10.x/fuel', 'Sustainable aviation fuel', '20–29'),
    record('10.x/wrong', 'Wrong reference volume', '30-39'),
  ], new Date('2026-09-14'));
  assert.equal(journals.length, 1);
  assert.deepEqual(issue.highlightedArticles.map(a => a.url), ['https://doi.org/10.x/review', 'https://doi.org/10.x/fuel']);
  const payload = payloadFor(issue, null);
  assert.equal(payload.username, BOT_NAME);
  assert.match(payload.embeds[0].fields[0].value, /verified summary is not yet available/);
  assert.doesNotMatch(JSON.stringify(payload), /pick a side|fight club|hot takes|debate/i);
  assert.match(payload.embeds[0].fields[1].value, /https:\/\/doi.org\/10.x\/fuel/);
  assert.doesNotMatch(JSON.stringify(payload), /Unrelated paper|Wrong reference volume/);
  assert.ok(payload.content.length < 2000);
  assert.ok(payload.embeds[0].fields.every(f => f.value.length <= 1024));
});

test('missing highlights references labels fallback papers honestly', () => {
  const payload = payloadFor({ volume: '1', number: '1', articles: [{ title: 'New process', url: 'https://doi.org/10.x/p' }] }, null);
  assert.match(payload.embeds[0].fields[0].name, /Selected article/);
  assert.doesNotMatch(payload.content, /Open a highlighted/);
});

test('summaries preserve experimental context and bound unreviewed quotations', () => {
  assert.match(summaryFor({doi:'10.1002/cjce.70297'}), /154 crude-distillation simulation records/);
  assert.match(summaryFor({doi:'10.1002/cjce.70080'}), /synthetic data/);
  const extract=summaryFor({abstract:'Abstract '+Array.from({length:100},(_,i)=>'word'+i).join(' ')});
  assert.match(extract,/Publisher abstract extract/);
  assert.doesNotMatch(extract,/word24/);
});

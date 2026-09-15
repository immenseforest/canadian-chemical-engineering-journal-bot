import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { automaticHighlights } from './highlights.mjs';

export async function attachmentFor(issue, cfg) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(cfg.manifest, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return automaticHighlights(issue, cfg); throw new Error('Cannot read issue manifest: check its JSON syntax and permissions'); }
  const entry = manifest[issue.key];
  if (!entry) return automaticHighlights(issue, cfg);
  const kind = entry.kind || 'full-issue';
  if (!['highlights', 'full-issue', 'contents'].includes(kind)) throw new Error(`${issue.key}: unknown PDF kind`);
  if (entry.redistributionAllowed !== true || !entry.permissionNote?.trim() || /replace with/i.test(entry.permissionNote)) {
    throw new Error(`${issue.key}: record permission covering redistribution in issues.json`);
  }
  if (typeof entry.path !== 'string' || !entry.path.toLowerCase().endsWith('.pdf')) throw new Error(`${issue.key}: a local .pdf path is required`);
  const filename = path.resolve(path.dirname(cfg.manifest), entry.path);
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > cfg.maxPdfBytes) throw new Error(`${issue.key}: PDF is not a file or exceeds MAX_PDF_BYTES`);
  const bytes = await fs.readFile(filename);
  if (bytes.length > cfg.maxPdfBytes || bytes.length < 8 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error(`${issue.key}: invalid or oversized PDF`);
  return { bytes, kind, name: `${issue.key.replaceAll(':', '-')}${kind === 'full-issue' ? '' : '-' + kind}.pdf`, hash: createHash('sha256').update(bytes).digest('hex') };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

function allowedPdfUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Wiley highlights PDF URL is missing or invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'onlinelibrary.wiley.com' || url.username || url.password || url.port ||
      !/^\/doi\/(?:pdf|pdfdirect)\/10\.1002\/cjce\.[A-Za-z0-9._-]+$/i.test(url.pathname) ||
      (url.search && url.search !== '?download=true') || url.hash) {
    throw new Error('Highlights download must use a Wiley CJCE PDF URL from publisher metadata');
  }
  return url;
}

export function checkPdf(bytes, maxBytes) {
  if (bytes.length > maxBytes || bytes.length < 8 || bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('Publisher did not return a valid PDF within the attachment size limit');
  }
}

export async function downloadHighlights(urlValue, maxBytes, { fetchImpl = fetch } = {}) {
  let url = allowedPdfUrl(urlValue);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(45000),
      headers: { Accept: 'application/pdf', 'User-Agent': 'CanadianEngineeringJournalClub/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Wiley PDF redirect has no destination');
      url = allowedPdfUrl(new URL(location, url));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Wiley highlights HTTP ${response.status}. Institutional sign-in or publisher access may be required; no PDF was saved.`);
    }
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > maxBytes) { await response.body?.cancel(); throw new Error('Wiley highlights exceeds MAX_PDF_BYTES'); }
    if (!response.body) throw new Error('Wiley highlights response is empty');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { await reader.cancel(); throw new Error('Wiley highlights exceeds MAX_PDF_BYTES'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    checkPdf(bytes, maxBytes);
    return bytes;
  }
  throw new Error('Too many Wiley PDF redirects');
}

export async function automaticHighlights(issue, cfg, options = {}) {
  if (!cfg.autoWileyHighlights || issue.journalId !== 'cjce' || !issue.highlights?.pdfUrl) return null;
  if (!cfg.wileyRedistributionAllowed) throw new Error('Confirm permission to share the highlights PDF with WILEY_PDF_REDISTRIBUTION_ALLOWED=true');
  // Crossref's /pdf route is an HTML viewer. Wiley's observed Download menu
  // links to /pdfdirect/<same DOI>?download=true for the actual file.
  const downloadUrl = allowedPdfUrl(issue.highlights.pdfUrl);
  downloadUrl.pathname = downloadUrl.pathname.replace('/doi/pdf/', '/doi/pdfdirect/');
  downloadUrl.search = '?download=true';
  const source = downloadUrl.href;
  const name = `${issue.key.replaceAll(':', '-')}-highlights.pdf`;
  const dir = path.join(cfg.stateDir, 'downloads');
  const sourceHash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const filename = path.join(dir, `${sourceHash}-${name}`);
  let bytes;
  try {
    const stat = await fs.stat(filename);
    if (stat.size > cfg.maxPdfBytes) throw new Error('Cached highlights exceeds MAX_PDF_BYTES');
    bytes = await fs.readFile(filename);
    checkPdf(bytes, cfg.maxPdfBytes);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = await downloadHighlights(source, cfg.maxPdfBytes, options);
    await fs.mkdir(dir, { recursive: true });
    const temp = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(temp, bytes, { mode: 0o600 });
    await fs.rename(temp, filename);
  }
  return { bytes, name, kind: 'highlights', sourceUrl: source,
    hash: createHash('sha256').update(bytes).digest('hex') };
}

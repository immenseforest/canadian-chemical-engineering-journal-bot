import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, config, webhookUrl, safeError } from './config.mjs';
import { journals, discover } from './journals.mjs';
import { attachmentFor } from './attachments.mjs';
import { payloadFor } from './discord.mjs';
import { runCheck, resolvePending } from './bot.mjs';

let cfg;
try {
  loadEnv();
  cfg = config();
  const command = process.argv[2] || 'preview';
  if (command === 'doctor') {
    let errors = 0;
    try { webhookUrl(cfg); console.log('Discord webhook: configured (secret hidden)'); }
    catch (e) { console.log(e.message); errors++; }
    try { JSON.parse(await fs.readFile(cfg.manifest, 'utf8')); console.log('Issue manifest: readable JSON'); }
    catch { console.log('Issue manifest: missing or invalid'); if (cfg.requirePdf) errors++; }
    console.log(`PDF policy: ${cfg.requirePdf ? 'wait for authorized PDF' : 'post links, attach PDF when supplied'}`);
    console.log(`Check interval: ${cfg.intervalMs / 3600000} hours`);
    process.exitCode = errors ? 1 : 0;
  } else if (command === 'preview') {
    const previews = [];
    for (const journal of journals) {
      try {
        const issue = await discover(journal, { mailto: cfg.mailto });
        const attachment = await attachmentFor(issue, cfg);
        previews.push({ issue, attachment: attachment ? { name: attachment.name, bytes: attachment.bytes.length } : null, waitingForPdf: cfg.requirePdf && !attachment, payload: payloadFor(issue, attachment) });
        console.log(`${issue.key}: ${issue.issueUrl} · ${issue.articles.length} indexed papers · ${attachment ? 'PDF ready' : 'no PDF supplied'}`);
      } catch (e) { console.error(`${journal.id}: ${safeError(e, cfg)}`); process.exitCode = 1; }
    }
    await fs.mkdir(cfg.stateDir, { recursive: true });
    await fs.writeFile(path.join(cfg.stateDir, 'preview.json'), JSON.stringify(previews, null, 2) + '\n');
    console.log('Preview saved to data/preview.json; no Discord messages sent.');
  } else if (command === 'check') {
    process.exitCode = (await runCheck(cfg)) ? 1 : 0;
  } else if (command === 'watch') {
    webhookUrl(cfg);
    console.log('Journal bot running. Press Ctrl+C to stop.');
    let stopping = false, wake;
    const stop = () => { stopping = true; wake?.(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    while (!stopping) {
      try { await runCheck(cfg); } catch (e) { console.error(safeError(e, cfg)); }
      if (!stopping) await new Promise(resolve => {
        const timer = setTimeout(resolve, Math.min(cfg.intervalMs, 2147483647));
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  } else if (command === 'resolve') {
    await resolvePending(cfg, process.argv[3], process.argv[4]);
    console.log('Pending delivery resolved.');
  } else throw new Error('Commands: preview, doctor, check, watch, resolve');
} catch (e) { console.error(safeError(e, cfg)); process.exitCode = 1; }

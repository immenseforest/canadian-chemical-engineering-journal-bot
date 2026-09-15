import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function saveState(file, state) {
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(temp, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(state, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temp, file);
}

export async function readState(file) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.version !== 1 || !data.destinations || typeof data.destinations !== 'object') throw new Error('invalid');
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, destinations: {} };
    throw new Error('State file is corrupt or unreadable; restore its backup before posting');
  }
}

export async function withLock(dir, fn) {
  await fs.mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, 'bot.lock');
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await fs.open(lockPath, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner;
      try { owner = JSON.parse(await fs.readFile(lockPath, 'utf8')); }
      catch { throw new Error('Unreadable run lock; check running processes before removing data/bot.lock'); }
      if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Another host owns the run lock');
      try { process.kill(owner.pid, 0); throw new Error('Another bot check is already running'); }
      catch (err) { if (err.code !== 'ESRCH') throw err; }
      await fs.unlink(lockPath);
    }
  }
  if (!handle) throw new Error('Could not acquire run lock');
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname() }));
    return await fn(path.join(dir, 'state.json'));
  } finally { await handle.close(); await fs.unlink(lockPath); }
}

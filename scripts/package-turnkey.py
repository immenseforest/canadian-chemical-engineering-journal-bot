from pathlib import Path
import hashlib
import json
import zipfile
import os
import shutil

root = Path(__file__).resolve().parents[1]
out = root / 'output'
out.mkdir(exist_ok=True)
archive = out / 'Canadian-Chemical-Engineering-Journal-Bot.zip'
prefix = 'Canadian-Chemical-Engineering-Journal-Bot/'
files = {}
for folder in ['src', 'test', 'node_modules', 'docs']:
    for file in (root / folder).rglob('*'):
        if file.is_file():
            files[file.relative_to(root).as_posix()] = file
for name in ['package.json', 'package-lock.json', 'START-BOT.cmd', 'INSTALL-AUTOSTART.ps1', 'Dockerfile', 'compose.yaml', '.dockerignore', '.env.example']:
    files[name] = root / name
for name in ['setup-bot.mjs', 'invite.mjs', 'run-service.ps1', 'run-service.mjs']:
    files['scripts/' + name] = root / 'scripts' / name
files['README.md'] = root / 'README.md'
node_binary = os.environ.get('NODE_BINARY') or shutil.which('node')
if not node_binary:
    raise RuntimeError('Install Windows Node.js or set NODE_BINARY to node.exe')
files['runtime/node.exe'] = Path(node_binary)
files['runtime/NODE-LICENSE.txt'] = root / 'licenses/NODE-LICENSE.txt'

# Explicit allowlist: no local configuration, tokens, server state or user PDFs.
secrets = []
env = root / '.env'
if env.exists():
    for line in env.read_text(encoding='utf-8-sig').splitlines():
        if line.startswith(('DISCORD_BOT_TOKEN=', 'DISCORD_WEBHOOK_URL=')):
            value = line.split('=', 1)[1].strip()
            if value:
                secrets.append(value.encode())
for name, file in files.items():
    assert name != '.env' and not name.startswith(('data/', 'pdfs/'))
    if file.suffix in ['.mjs', '.js', '.json', '.md', '.ps1', '.cmd', '.txt', '.yaml', '.example']:
        data = file.read_bytes()
        if any(secret in data for secret in secrets):
            raise RuntimeError('Secret detected in distribution input; packaging stopped')

with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name, file in sorted(files.items()):
        z.write(file, prefix + name)
    z.writestr(prefix + 'issues.json', '{}\n')
    z.writestr(prefix + 'pdfs/.gitkeep', '')
    z.writestr(prefix + '.gitignore', '.env\ndata/\nnode_modules/\npdfs/*.pdf\nissues.json\n')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert prefix + '.env' not in z.namelist()
    assert json.loads(z.read(prefix + 'issues.json')) == {}
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / 'SHA256SUMS.txt').write_text(digest + '  ' + archive.name + '\n', encoding='utf-8')
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(files) + 3, 'sha256': digest, 'secret_scan': 'passed'}))

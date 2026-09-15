import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loggedProcess} from './run-service.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.exitCode=await loggedProcess(['src/hub-service.mjs'],{cwd,logFile:path.join(cwd,'data/hub/service.log')});

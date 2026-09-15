import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loggedProcess} from './run-service.mjs';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logFile=path.join(projectDir,'data/threaded/service.log');
if(fs.existsSync(logFile)&&fs.statSync(logFile).size>2097152){
  fs.copyFileSync(logFile,logFile+'.previous');fs.truncateSync(logFile);
}
process.exitCode=await loggedProcess(['src/thread-service.mjs'],{cwd:projectDir,logFile});

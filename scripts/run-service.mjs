import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function loggedProcess(args,{cwd,logFile}){
  fs.mkdirSync(path.dirname(logFile),{recursive:true});
  const fd=fs.openSync(logFile,'a');
  fs.writeSync(fd,`\n[${new Date().toISOString()}] Starting journal process\n`);
  const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:['ignore',fd,fd]});
  return new Promise((resolve,reject)=>{
    child.once('error',e=>{fs.closeSync(fd);reject(e);});
    child.once('exit',(code,signal)=>{
      fs.writeSync(fd,`[${new Date().toISOString()}] Journal process exited: code=${code}, signal=${signal}\n`);
      fs.closeSync(fd);resolve(code??1);
    });
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const logFile=path.join(cwd,'data/installable/service.log');
  if(fs.existsSync(logFile)&&fs.statSync(logFile).size>2097152){
    fs.copyFileSync(logFile,logFile+'.previous');fs.truncateSync(logFile);
  }
  process.exitCode=await loggedProcess(['src/service.mjs'],{cwd,logFile});
}

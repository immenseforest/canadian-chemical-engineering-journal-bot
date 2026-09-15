import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {guardedListener} from '../src/event-handler.mjs';
import {loggedProcess} from '../scripts/run-service.mjs';

test('failed Discord acknowledgement or expired reply is caught and later commands work',async()=>{
  const errors=[];let calls=0;
  const handler=guardedListener(async()=>{if(++calls<3)throw new Error('Unknown interaction');return 'ok';},e=>errors.push(e.message));
  await handler();await handler();assert.equal(await handler(),'ok');assert.equal(errors.length,2);
});

test('background logger preserves stderr, continuation and child exit code',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-runtime-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));const logFile=path.join(dir,'service.log');
  const code=await loggedProcess(['-e','console.error("warning recorded");setTimeout(()=>{console.log("continued");process.exitCode=7;},20)'],{cwd:dir,logFile});
  assert.equal(code,7);const log=await fs.readFile(logFile,'utf8');
  assert.match(log,/warning recorded/);assert.match(log,/continued/);assert.match(log,/code=7/);
});

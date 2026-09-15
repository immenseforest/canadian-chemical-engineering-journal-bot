import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ieeeRequest,replaceIeeeKey,loadIeeeKey} from '../src/ieee-client.mjs';
const key='test-key-abcdefghijkl';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ieee-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('IEEE caches requests across calls and persists rolling quota across restarts',async t=>{
  const dir=await fixture(t);let time=100000000,calls=0;const starts=[];
  const options={dir,now:()=>time,sleep:async ms=>{time+=ms;}};
  const fetcher=async()=>{calls++;starts.push(time);return {ok:true,json:async()=>({articles:[{doi:'10.1109/test'}]})};};
  await Promise.all(Array.from({length:200},(_,n)=>ieeeRequest({doi:String(n)},key,fetcher,options)));
  assert.equal(calls,200);assert.ok(starts.every((s,i)=>!i||s-starts[i-1]>=110));
  await ieeeRequest({doi:'0'},key,fetcher,options);assert.equal(calls,200);
  await assert.rejects(ieeeRequest({doi:'new'},key,fetcher,options),/budget exhausted/);
  time+=86400001;await ieeeRequest({doi:'new'},key,fetcher,options);assert.equal(calls,201);
});
test('IEEE inactive credentials are counted and blocked without leaking secrets or repeat requests',async t=>{
  const dir=await fixture(t);let calls=0;
  const fetcher=async()=>{calls++;return {ok:false,status:403,text:async()=>'<h1>Developer Inactive</h1>'};};
  for(let n=0;n<2;n++)await assert.rejects(ieeeRequest({doi:String(n)},key,fetcher,{dir}),/account is inactive/);
  assert.equal(calls,1);const state=await fs.readFile(path.join(dir,'state.json'),'utf8');assert.ok(!state.includes(key));assert.equal(JSON.parse(state).calls.length,1);
});
test('replacement validates before saving, preserves old key on failure, and survives reload',async t=>{
  const dir=await fixture(t);await replaceIeeeKey(key,dir,async()=>[]);
  await assert.rejects(replaceIeeeKey('another-valid-key-123',dir,async()=>{throw new Error('invalid');}));
  assert.equal(await loadIeeeKey('',dir),key);
});

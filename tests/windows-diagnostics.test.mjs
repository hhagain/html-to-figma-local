import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { redact, probeService } = createRequire(import.meta.url)('../scripts/windows/diagnose.cjs');
async function fixture(source) {
  const root=await mkdtemp(path.join(os.tmpdir(),'h2f-startup-diagnostic-'));
  await mkdir(path.join(root,'engine/scripts'),{recursive:true});
  await writeFile(path.join(root,'runtime.json'),JSON.stringify({browserExecutable:'unused-browser'}));
  await writeFile(path.join(root,'engine/scripts/desktop-service.mjs'),source);
  return {root,close:()=>rm(root,{recursive:true,force:true})};
}
test('startup diagnostics redact user directories, credentials and bearer-shaped tokens',()=>{
  const token='ab'.repeat(32);
  const text=redact(String.raw`Failure at C:\Users\Someone\AppData\Roaming\HTML to Figma Capture; token=${token}; https://user:password@example.com`,[[String.raw`C:\Users\Someone`,'<USER>']]);
  assert.ok(text.includes('<USER>'));assert.equal(text.includes('Someone'),false);assert.equal(text.includes(token),false);assert.equal(text.includes('password'),false);
  const fallback=redact(String.raw`Error at C:\Users\Another\index.js`);assert.equal(fallback.includes('Another'),false);
});
test('startup diagnostics keep the actual early exit reason',async()=>{
  const f=await fixture(`console.error('EACCES: listen denied on 127.0.0.1:3847');process.exit(1);`);
  try{const result=await probeService({executable:process.execPath,resources:f.root,dataDirectory:f.root,timeoutMs:3000,healthyMs:50});assert.equal(result.result,'failed');assert.equal(result.exitCode,1);assert.match(result.stderr,/EACCES/);assert.equal(result.readyEventReceived,false);}finally{await f.close();}
});
test('a ready event followed by a crash is not reported as a successful startup',async()=>{
  const f=await fixture(`console.log('H2F_EVENT '+JSON.stringify({type:'ready',version:'0.8.0',token:'${'cd'.repeat(32)}'}));console.error('EPERM writing service-state.json');process.exit(1);`);
  try{const result=await probeService({executable:process.execPath,resources:f.root,dataDirectory:f.root,timeoutMs:3000,healthyMs:250});assert.equal(result.result,'failed');assert.equal(result.readyEventReceived,true);assert.match(result.stderr,/EPERM/);assert.equal(result.stdout.includes('cd'.repeat(32)),false);}finally{await f.close();}
});
test('a healthy diagnostic service is closed without retaining its token',async()=>{
  const f=await fixture(`import{createInterface}from'node:readline';console.log('H2F_EVENT '+JSON.stringify({type:'ready',version:'0.8.0',token:'${'ef'.repeat(32)}'}));createInterface({input:process.stdin}).on('line',line=>{if(JSON.parse(line).type==='shutdown')process.exit(0);});`);
  try{const result=await probeService({executable:process.execPath,resources:f.root,dataDirectory:f.root,timeoutMs:3000,healthyMs:50});assert.equal(result.result,'ready-and-stopped');assert.equal(result.exitCode,0);assert.equal(result.shutdownRequested,true);assert.equal(result.stdout.includes('ef'.repeat(32)),false);}finally{await f.close();}
});

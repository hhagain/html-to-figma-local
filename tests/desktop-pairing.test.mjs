import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDesktopPairing} from '../scripts/desktop-pairing.mjs';
import {createAppServer} from '../scripts/server.mjs';
const credential='ab'.repeat(32),clientId='figma-'+'12'.repeat(16);
test('desktop pairing requires local approval, persists hashes and survives restart',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'h2f-pairing-'));let request;
 try{
  const pairing=await createDesktopPairing({directory,onRequest:r=>{request=r;}});
  const start=pairing.start({clientId,credential},'null');assert.equal(start.status,'pending');assert.equal(pairing.authorised(credential),false);assert.equal(start.code,request.code);
  assert.equal(pairing.status({id:start.id,credential:'cd'.repeat(32)}).status,'expired');
  assert.equal(await pairing.decide(start.id,true),true);assert.equal(pairing.authorised(credential),true);assert.equal(pairing.status({id:start.id,credential}).status,'approved');
  const persisted=await readFile(path.join(directory,'paired-clients.json'),'utf8');assert.equal(persisted.includes(credential),false);
  const restarted=await createDesktopPairing({directory});assert.equal(restarted.authorised(credential),true);assert.equal(restarted.start({clientId,credential},'https://www.figma.com').status,'approved');
  await restarted.revoke();assert.equal(restarted.authorised(credential),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('pairing rejects unrelated websites, expires and does not authorise rejected requests',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'h2f-pairing-'));let clock=1000;
 try{
  const p=await createDesktopPairing({directory,now:()=>clock});assert.throws(()=>p.start({clientId,credential},'https://untrusted.example'),/来源/);
  const start=p.start({clientId,credential},'null');await p.decide(start.id,false);assert.equal(p.status({id:start.id,credential}).status,'rejected');assert.equal(p.authorised(credential),false);
  const retry=p.start({clientId,credential},'null');assert.notEqual(retry.id,start.id);
  clock+=120001;assert.equal(p.status({id:start.id,credential}).status,'expired');assert.equal(await p.decide(start.id,true),false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('desktop HTTP discovery and pairing never disclose credentials; approved plugin can capture',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'h2f-desktop-http-'));const p=await createDesktopPairing({directory});
 const app=await createAppServer({port:0,desktop:{discovery:()=>({product:'html-to-figma-capture',desktop:true,pairing:true}),startPair:(body,origin)=>p.start(body,origin),pairStatus:body=>p.status(body),authorised:req=>p.authorised(req.headers['x-h2f-token']),status:()=>({clients:p.list()})}});
 try{
  const discovery=await(await fetch(app.address+'/api/desktop/discovery')).json();assert.equal(discovery.product,'html-to-figma-capture');assert.equal(JSON.stringify(discovery).includes(app.token),false);
  assert.equal((await fetch(app.address+'/api/health')).status,401);
  const post=async(endpoint,body,origin='null')=>fetch(app.address+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  const start=await(await post('/api/desktop/pair/start',{clientId,credential})).json();assert.equal(start.status,'pending');assert.equal(JSON.stringify(start).includes(credential),false);
  assert.equal((await fetch(app.address+'/api/health',{headers:{'X-H2F-Token':credential}})).status,401);
  await p.decide(start.id,true);const health=await(await fetch(app.address+'/api/health',{headers:{'X-H2F-Token':credential}})).json();assert.equal(health.ok,true);assert.equal(health.desktop,true);
  const pairingStatus=await(await post('/api/desktop/pair/status',{id:start.id,credential})).json();assert.equal(pairingStatus.status,'approved');
  const rejected=await post('/api/desktop/pair/start',{clientId:'figma-'+'34'.repeat(16),credential},'https://untrusted.example');assert.equal(rejected.status,400);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

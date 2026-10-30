import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../scripts/browser.mjs';
import { discoverPages, validateDiscoveryRequest } from '../scripts/discover-pages.mjs';
import { inspectState } from '../scripts/interaction-inspector.mjs';
import { validateStatePlan } from '../scripts/state-capture.mjs';
import { createAppServer } from '../scripts/server.mjs';
let browser, directory, url;
const chain = `<!doctype html><meta charset="utf-8"><title>连续交互样例</title><main id="app"></main><script>let level=0;function render(){app.innerHTML='<h1>阶段 '+level+'</h1>'+(level<7?'<button id="next">展开第 '+(level+1)+' 层</button>':'<p>结束</p>');const b=document.querySelector('button');if(b)b.onclick=()=>{level++;render();};}render();</script>`;
before(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'h2f-resume-'));url=path.join(directory,'index.html');await writeFile(url,chain);browser=await launchBrowser();});
after(async()=>{await browser?.close();await rm(directory,{recursive:true,force:true});});
const options = extra=>({url,width:800,height:700,exploreInteractions:true,outputMode:'states',maxPages:null,maxActions:null,maxDepth:null,timeoutMs:null,sampling:'all',...extra});
test('global budgets accept zero/null as unlimited and allow larger finite values',()=>{
 const unlimited=validateDiscoveryRequest(options({maxDepth:0,maxActions:0,maxPages:0,timeoutMs:0}));for(const key of ['maxDepth','maxActions','maxPages','timeoutMs'])assert.equal(unlimited[key],null);
 const large=validateDiscoveryRequest(options({maxDepth:120,maxActions:50000,timeoutMs:7200000}));assert.equal(large.maxActions,50000);assert.equal(large.maxDepth,120);
 for(const key of ['maxDepth','maxActions','maxPages','timeoutMs'])assert.throws(()=>validateDiscoveryRequest(options({[key]:-1})));
 assert.throws(()=>validateDiscoveryRequest(options({timeoutMs:1})));assert.throws(()=>validateDiscoveryRequest(options({sampling:'unsafe'})));
 assert.equal(validateDiscoveryRequest({url}).timeoutMs,180000);
});
test('continuing raises depth and adds a fresh per-round budget without losing state IDs or deferred actions',async()=>{
 const first=await discoverPages(browser,options({maxDepth:1}));assert.equal(first.pages.length,2);assert.equal(first.report.depthDeferred,1);assert.deepEqual(first.report.stopReasons,['depth']);
 const second=await discoverPages(browser,options({maxDepth:4,maxActions:1}),{checkpoint:first.checkpoint});assert.equal(second.pages.length,3);assert.equal(second.report.round.attempted,1);assert.ok(second.report.stopReasons.includes('actions'));assert.deepEqual(second.pages.slice(0,2),first.pages);
 const final=await discoverPages(browser,options(),{checkpoint:second.checkpoint});assert.equal(final.pages.length,8);assert.equal(final.report.attempted,8);assert.equal(final.report.remaining,0);assert.equal(final.report.rounds,3);assert.deepEqual(final.report.stopReasons,['queue']);assert.equal(final.report.canResume,false);assert.equal(final.report.exhaustive,false);validateStatePlan(final.plan);
 assert.equal(first.pages.length,2,'completed snapshots are immutable');assert.equal(browser.contexts().length,0);
});
test('manual cancellation and global deadline retain the active work for the next round',async()=>{
 const controller=new AbortController();const cancelled=await discoverPages(browser,options(),{signal:controller.signal,onProgress:p=>{if(p.found===1)controller.abort();}});
 assert.equal(cancelled.report.cancelled,true);assert.equal(cancelled.pages.length,1);assert.ok(cancelled.report.remaining);assert.equal(browser.contexts().length,0);
 const resumed=await discoverPages(browser,options(),{checkpoint:cancelled.checkpoint});assert.equal(resumed.pages.length,8);assert.equal(resumed.report.attempted,8);assert.equal(resumed.report.failed,0);
 const timed=await discoverPages(browser,options({timeoutMs:1000}));assert.ok(timed.report.stopReasons.includes('time'));assert.ok(timed.report.remaining>0);
 const completed=await discoverPages(browser,options(),{checkpoint:timed.checkpoint});assert.equal(completed.pages.length,8);assert.equal(completed.report.failed,0);assert.equal(completed.report.attempted,8);
});
test('failed paths can be retried on continuation without deleting their historical error',async()=>{
 let fail=true;const flaky={newContext:async(...args)=>{if(fail){fail=false;throw new Error('temporary browser startup failure');}return browser.newContext(...args);}};
 const first=await discoverPages(flaky,options({maxActions:1}));assert.equal(first.pages.length,0);assert.equal(first.report.failed,1);assert.equal(first.report.retryableFailures,1);
 const resumed=await discoverPages(browser,options({retryFailures:true}),{checkpoint:first.checkpoint});assert.equal(resumed.pages.length,8);assert.equal(resumed.report.retryableFailures,0);assert.equal(resumed.report.errors.length,1);assert.equal(resumed.report.failed,1);assert.equal(resumed.report.status,'complete');
});
test('all-control mode removes representative family/option caps and can supplement a sampled session',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'h2f-sampling-'));try{
  const source=path.join(folder,'index.html');await writeFile(source,'<meta charset="utf-8"><h1 id="heading">概览</h1>'+[1,2,3,4].map(n=>`<button data-action="detail" data-id="${n}" onclick="heading.textContent=\'详情 ${n}\'">详情 ${n}</button>`).join(''));
  const sampled=await discoverPages(browser,options({url:source,sampling:'representative'}));assert.equal(sampled.pages.length,3);assert.ok(sampled.report.skippedByReason.sampling>0);assert.equal(sampled.report.canResume,true);
  const completed=await discoverPages(browser,options({url:source}),{checkpoint:sampled.checkpoint});assert.equal(completed.pages.length,5);assert.ok(completed.report.rescanned>=3);assert.deepEqual(completed.pages.slice(0,3),sampled.pages);
  const context=await browser.newContext(),page=await context.newPage();try{await page.setContent('<h1>控件样例</h1>'+Array.from({length:60},(_,i)=>`<button id="b${i}" data-action="family${i}">项目 ${i}</button>`).join('')+'<select id="choices">'+Array.from({length:8},(_,i)=>`<option value="${i}">${i}</option>`).join('')+'</select>');const limited=await inspectState(page,true),all=await inspectState(page,true,{sampling:'all'});assert.equal(limited.candidates.length,45);assert.equal(all.candidates.length,67);assert.equal(limited.fingerprint,all.fingerprint);}finally{await context.close();}
 }finally{await rm(folder,{recursive:true,force:true});}
});
const poll=async(app,id,headers)=>{for(let i=0;i<1000;i++){const r=await fetch(app.address+'/api/discover/'+id,{headers}).then(r=>r.json());if(r.status!=='running')return fetch(app.address+'/api/discover/'+id+'/result',{headers}).then(r=>r.json());await new Promise(r=>setTimeout(r,20));}throw new Error('job did not complete');};
test('server keeps opaque owner-bound checkpoints across capture-job pruning',async()=>{
 const token='resume-test-primary',app=await createAppServer({port:0,token,desktop:{authorised:req=>req.headers['x-h2f-token']==='resume-test-secondary',onActivity(){}}}),headers={'X-H2F-Token':token,'Content-Type':'application/json'};
 const post=(route,body,h=headers)=>fetch(app.address+route,{method:'POST',headers:h,body:JSON.stringify(body)});
 try{
  const created=await post('/api/discover',options({maxActions:1})).then(r=>r.json()),first=await poll(app,created.id,headers);assert.match(first.session.id,/^[a-f0-9]{24}$/);assert.ok(!('checkpoint'in first));assert.equal(first.session.canResume,true);
  const wrongOwner=await post('/api/discover',options({resumeId:first.session.id}),{...headers,'X-H2F-Token':'resume-test-secondary'});assert.equal(wrongOwner.status,410);
  const changed=await post('/api/discover',options({resumeId:first.session.id,width:900}));assert.equal(changed.status,400);
  // New discovery/capture jobs can prune results, but not the independently retained session.
  const other=await post('/api/discover',options({maxActions:1})).then(r=>r.json());await poll(app,other.id,headers);
  const resumed=await post('/api/discover',options({resumeId:first.session.id,maxActions:1})).then(r=>r.json()),next=await poll(app,resumed.id,headers);assert.equal(next.pages.length,2);assert.equal(next.report.attempted,2);assert.equal(next.session.id,first.session.id);
 }finally{await app.close();}
});
test('workbench continues after changing settings and preserves deselected states',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#url-mode').selectOption('states');await page.locator('#exploration-output').selectOption('states');await page.locator('#page-url').fill(url);await page.locator('#exploration-options summary').click();await page.locator('#exploration-preset').selectOption('unlimited');await page.locator('#exploration-actions').fill('2');await page.locator('#exploration-actions').dispatchEvent('change');
  await page.locator('#prepare').click();await page.waitForFunction(()=>!document.querySelector('#continue-exploration').hidden&&!document.querySelector('#prepare').disabled);assert.equal(await page.locator('.discovery-row').count(),2);await page.locator('.discovery-row input').first().uncheck();
  await page.locator('#exploration-actions').fill('0');await page.locator('#exploration-actions').dispatchEvent('change');assert.equal(await page.locator('.discovery-row').count(),2);
  await page.locator('#continue-exploration').click();await page.waitForFunction(()=>document.querySelectorAll('.discovery-row').length===8&&!document.querySelector('#prepare').disabled);assert.equal(await page.locator('.discovery-row input').first().isChecked(),false);assert.equal(await page.locator('#discovery-count').textContent(),'已选择 7 / 8');assert.equal(await page.locator('#continue-exploration').isVisible(),false);
 }finally{await context.close();await app.close();}
});
test('large generated plans and deep replay paths are not rejected by obsolete 80/8000 action caps',()=>{
 const states=Array.from({length:120},(_,i)=>({id:'s'+i,name:'状态 '+i,steps:Array.from({length:100},()=>({type:'wait',ms:0}))}));const plan=validateStatePlan({schemaVersion:1,name:'长路径',url,states});assert.equal(plan.states.length,120);assert.equal(plan.states[0].steps.length,100);
});

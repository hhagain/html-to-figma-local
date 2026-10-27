import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../scripts/server.mjs';
import { launchBrowser } from '../scripts/browser.mjs';
import { createPreviewStore } from '../scripts/preview-store.mjs';
let browser;
before(async()=>{browser=await launchBrowser();},{timeout:30000});
after(async()=>{await browser?.close();});
const plan=address=>({schemaVersion:1,name:'多页预览',url:address+'/source/dynamic-state-test.html',viewport:{width:800,height:700},states:[{id:'base',name:'默认页'},{id:'detail',name:'详情页',steps:[{type:'click',selector:'#open'}]},{id:'error',name:'校验提示',steps:[{type:'click',selector:'#open'},{type:'click',selector:'#save'},{type:'wait',selector:'#error'}]}]});
const headers=app=>({'X-H2F-Token':app.token,'Content-Type':'application/json'});
async function captureJob(app,recipe){
 const start=await fetch(app.address+'/api/states',{method:'POST',headers:headers(app),body:JSON.stringify(recipe)});assert.equal(start.status,202);const job=await start.json();
 for(let i=0;i<200;i++){const state=await(await fetch(`${app.address}/api/states/${job.id}`,{headers:headers(app)})).json();if(state.status!=='running')return{id:job.id,result:await(await fetch(`${app.address}/api/states/${job.id}/result`,{headers:headers(app)})).json()};await new Promise(resolve=>setTimeout(resolve,50));}
 throw new Error('Capture job timed out');
}
async function prepareUI(app,page){
 await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#url-mode').selectOption('states');
 await page.locator('#state-plan-file').setInputFiles({name:'preview.states.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plan(app.address)))});
 const response=page.waitForResponse(r=>r.url().endsWith('/result'));await page.locator('#prepare').click();await response;
 await page.locator('#ready-actions').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#remote-preview').dataset.pageIndex==='0'&&!document.querySelector('#remote-preview').hidden);
}
const waitImage=(page,index)=>page.waitForFunction(i=>document.querySelector('#remote-preview').dataset.pageIndex===String(i)&&!document.querySelector('#remote-preview').hidden,index);

test('temporary preview store covers page indices beyond 200 and removes only the evicted job',async()=>{
 const store=createPreviewStore(),a='a'.repeat(24),b='b'.repeat(24),image='data:image/jpeg;base64,/9j/2Q==';
 try{await store.save(a,0,image);await store.save(a,199,image);await store.save(b,0,image);assert.ok(await store.read(a,199));await store.save(a,999,image);assert.ok(await store.read(a,999));await assert.rejects(store.save(a,-1,image),/索引/);await assert.rejects(store.save(a,Number.MAX_SAFE_INTEGER+1,image),/索引/);await assert.rejects(store.read('../etc/passwd',0),/索引/);await store.forget(a);assert.equal(await store.read(a,0),null);assert.ok(await store.read(b,0));}finally{await store.close();}
 assert.equal(await store.read(b,0),null);
});

test('every successful page has an authenticated preview, with failures excluded from page indices',async()=>{
 const app=await createAppServer({port:0});
 try{
  const recipe=plan(app.address);recipe.states.splice(1,0,{id:'failed',name:'不存在的状态',steps:[{type:'click',selector:'#not-there',timeoutMs:100}]});
  const {id,result}=await captureJob(app,recipe);assert.equal(result.report.completed,3);assert.equal(result.report.failed,1);
  assert.deepEqual(result.previews.map(p=>[p.pageIndex,p.stateId]),[[0,'base'],[1,'detail'],[2,'error']]);
  const buffers=[];for(let i=0;i<3;i++){const response=await fetch(`${app.address}/api/states/${id}/preview/${i}`,{headers:headers(app)});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');buffers.push(Buffer.from(await response.arrayBuffer()));}
  assert.deepEqual(buffers[0],Buffer.from(result.preview.split(',')[1],'base64'));assert.notDeepEqual(buffers[0],buffers[1]);assert.notDeepEqual(buffers[1],buffers[2]);
  assert.equal((await fetch(`${app.address}/api/states/${id}/preview/1`)).status,401);
  assert.equal((await fetch(`${app.address}/api/states/${id}/preview/3`,{headers:headers(app)})).status,404);
  assert.ok(result.previews.every(p=>!('base64' in p)&&!('path' in p)));assert.ok(!('previews' in result.bundle));
  const one={...recipe,states:[recipe.states[0]]};await captureJob(app,one);await captureJob(app,one);
  assert.equal((await fetch(`${app.address}/api/states/${id}/preview/0`,{headers:headers(app)})).status,404);
 }finally{await app.close();}
});

test('preview navigation switches actual pages, caches images and leaves import selection unchanged',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:980}}),page=await context.newPage();const requests=[];
 page.on('request',r=>{if(/\/preview\/\d+$/.test(r.url()))requests.push(r.url());});
 try{
  await prepareUI(app,page);assert.equal(await page.locator('#preview-page option').count(),3);assert.equal(await page.locator('#preview-prev').isDisabled(),true);assert.equal(requests.length,0);
  await page.locator('#preview-next').click();await waitImage(page,1);assert.ok((await page.locator('#preview-caption').textContent()).includes('详情页'));assert.equal(requests.length,1);
  await page.locator('#preview-prev').click();await waitImage(page,0);await page.locator('#preview-next').click();await waitImage(page,1);assert.equal(requests.length,1);
  await page.locator('#preview-zoom-actual').click();await page.locator('#preview-page').selectOption('2');await waitImage(page,2);assert.equal(await page.locator('#preview-zoom-value').textContent(),'100%');assert.equal(await page.locator('#preview-zoom-controls').isVisible(),true);assert.equal(await page.locator('#preview-next').isDisabled(),true);assert.equal(requests.length,2);
  const checkbox=page.locator('.page-row input').nth(1);await checkbox.uncheck();await page.locator('.page-preview').nth(1).click();await waitImage(page,1);assert.equal(await checkbox.isChecked(),false);
  assert.equal(await page.locator('#preview-size').textContent(),'2 / 3 页');await page.locator('.preview-panel').screenshot({path:'artifacts/multi-page-preview.png'});
  await page.locator('#page-url').fill(app.address+'/source/dashboard.html');assert.equal(await page.locator('#preview-controls').isHidden(),true);assert.equal(await page.locator('#remote-preview').isHidden(),true);
 }finally{await context.close();await app.close();}
});

test('rapid switching ignores late previews and handles unavailable images with retry',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:980}}),page=await context.newPage();
 let release,started;const waiting=new Promise(r=>{started=r;});const gate=new Promise(r=>{release=r;});
 try{
  await prepareUI(app,page);
  await page.route('**/preview/1',async route=>{started();await gate;await route.continue().catch(()=>{});});
  await page.locator('#preview-page').selectOption('1');await waiting;await page.locator('#preview-page').selectOption('2');await waitImage(page,2);release();
  await page.waitForTimeout(100);assert.equal(await page.locator('#remote-preview').getAttribute('data-page-index'),'2');
  await page.unroute('**/preview/1');await page.route('**/preview/1',route=>route.fulfill({status:404,contentType:'application/json',body:'{"error":"expired"}'}));
  await page.locator('#preview-page').selectOption('1');await page.locator('#preview-retry').waitFor({state:'visible'});assert.equal(await page.locator('#remote-preview').isHidden(),true);assert.ok((await page.locator('#preview-message-text').textContent()).includes('已过期'));
  await page.unroute('**/preview/1');await page.locator('#preview-retry').click();await waitImage(page,1);
  await page.locator('#url-mode').selectOption('single');await page.locator('#prepare').click();await page.locator('#ready-actions').waitFor({state:'visible'});await waitImage(page,0);assert.equal(await page.locator('#preview-controls').isHidden(),true);
 }finally{release?.();await context.close();await app.close();}
});

test('cancelling a multi-state job retains previews for its completed pages',async()=>{
 const app=await createAppServer({port:0});
 try{
  const recipe=plan(app.address);recipe.states=[recipe.states[0],{id:'slow',name:'等待',steps:[{type:'wait',ms:5000}]},recipe.states[2]];
  const job=await(await fetch(app.address+'/api/states',{method:'POST',headers:headers(app),body:JSON.stringify(recipe)})).json();
  let snapshot;for(let i=0;i<200;i++){snapshot=await(await fetch(`${app.address}/api/states/${job.id}`,{headers:headers(app)})).json();if(snapshot.progress.completed>=1)break;await new Promise(r=>setTimeout(r,30));}
  await fetch(`${app.address}/api/states/${job.id}/cancel`,{method:'POST',headers:headers(app),body:'{}'});
  for(let i=0;i<100;i++){snapshot=await(await fetch(`${app.address}/api/states/${job.id}`,{headers:headers(app)})).json();if(snapshot.status!=='running')break;await new Promise(r=>setTimeout(r,30));}
  const result=await(await fetch(`${app.address}/api/states/${job.id}/result`,{headers:headers(app)})).json();assert.equal(result.report.status,'cancelled');assert.equal(result.bundle.pages.length,1);assert.equal(result.previews.length,1);
  assert.equal((await fetch(`${app.address}/api/states/${job.id}/preview/0`,{headers:headers(app)})).status,200);
  assert.equal((await fetch(`${app.address}/api/states/${job.id}/preview/1`,{headers:headers(app)})).status,404);
 }finally{await app.close();}
});

test('preview routes accept page numbers above 999 and reject unsafe numeric indices',async()=>{
 const app=await createAppServer({port:0});try{
  const base=app.address+'/api/states/'+ 'a'.repeat(24)+'/preview/';
  const missing=await fetch(base+'1000',{headers:headers(app)});assert.equal(missing.status,404);assert.ok((await missing.json()).error.includes('预览'));
  const invalid=await fetch(base+'9007199254740992',{headers:headers(app)});assert.equal(invalid.status,400);assert.ok((await invalid.json()).error.includes('索引'));
 }finally{await app.close();}
});

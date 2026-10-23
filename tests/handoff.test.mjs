import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import http from'node:http';
import vm from'node:vm';
import{readFile}from'node:fs/promises';
import{createAppServer}from'../scripts/server.mjs';
import{createHandoffStore}from'../scripts/handoff-store.mjs';
import{BundleBuilder}from'../dist/lib/bundle.js';
import{launchBrowser}from'../scripts/browser.mjs';
import{mockFigma}from'./helpers.mjs';
const makeBundle=(count=3)=>{const b=new BundleBuilder('桌面捕获 · 中文页面');for(let i=0;i<count;i++)b.add({schemaVersion:1,name:`状态 ${i+1}`,createdAt:'2026-10-23',source:{title:'示例',url:'local-html',selector:'body',viewport:{width:1440,height:900}},root:{id:'root',name:`状态 ${i+1}`,kind:'frame',x:0,y:0,width:390,height:844,opacity:1,fills:[],children:[]},assets:[],diagnostics:[],stats:{nodes:1,texts:0,images:0,vectors:0,missingAssets:0}});return b.bundle;};
const id='ab'.repeat(16),receiver='cd'.repeat(16);
let browser;before(async()=>{browser=await launchBrowser();});after(async()=>{await browser?.close();});
test('handoffs preserve 200 pages, prevent duplicate claims, isolate senders and expire',()=>{
 let now=1000;const store=createHandoffStore({now:()=>now}),payload={requestId:id,bundle:makeBundle(200),mode:'auto'};
 const sent=store.publish('sender',payload);assert.equal(sent.pages,200);assert.equal(store.publish('sender',payload).id,sent.id);assert.equal(store.latest().id,sent.id);
 const received=store.claim(sent.id,'receiver');assert.equal(received.bundle.pages.length,200);assert.equal(received.mode,'auto');assert.equal(store.latest(),null);
 assert.throws(()=>store.claim(sent.id,'other'),/另一个/);assert.throws(()=>store.progress(sent.id,'other',{status:'complete',completed:200}),/只有/);
 assert.throws(()=>store.progress(sent.id,'receiver',{status:'complete',completed:1}),/尚未/);
 store.progress(sent.id,'receiver',{status:'importing',completed:0});store.progress(sent.id,'receiver',{status:'partial',completed:199,failed:1});
 store.progress(sent.id,'receiver',{status:'importing',completed:199,failed:0});assert.equal(store.progress(sent.id,'receiver',{status:'complete',completed:200,failed:0}).status,'complete');
 assert.throws(()=>store.claim(sent.id,'receiver'),/已开始或已完成/);assert.equal(store.progress(sent.id,'receiver',{status:'importing',completed:0}).status,'complete');
 const next=store.publish('sender',{...payload,requestId:'ef'.repeat(16)});now+=31*60*1000;assert.equal(store.latest(),null);assert.throws(()=>store.status(next.id),/过期/);store.close();
});
test('HTTP handoff requires credentials and preserves UTF-8 across request chunks',async()=>{
 const app=await createAppServer({port:0}),headers={'X-H2F-Token':app.token,'Content-Type':'application/json'};
 try{
  assert.equal((await fetch(app.address+'/api/handoffs/latest')).status,401);
  assert.equal((await fetch(app.address+'/api/handoffs',{method:'POST',body:'{}'})).status,401);
  const payload=Buffer.from(JSON.stringify({requestId:id,bundle:makeBundle(),mode:'visual'}));const split=payload.indexOf(Buffer.from('中文'))+1;
  const sent=await new Promise((resolve,reject)=>{const req=http.request(app.address+'/api/handoffs',{method:'POST',headers},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,...JSON.parse(text)}));});req.on('error',reject);req.write(payload.subarray(0,split));setTimeout(()=>req.end(payload.subarray(split)),10);});
  assert.equal(sent.status,'pending');assert.equal(sent.name,'桌面捕获 · 中文页面');
  const request=body=>fetch(`${app.address}/api/handoffs/${sent.id}/claim`,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await request({receiverId:receiver})).status,200);assert.equal((await request({receiverId:'ef'.repeat(16)})).status,409);
 }finally{await app.close();}
});
test('desktop selection reaches the real plugin importer without a JSON download and reports completion back',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext(),sender=await context.newPage(),host=await context.newPage();const mock=mockFigma(),pendingPosts=[];
 try{
  await context.route(/http:\/\/127\.0\.0\.1:384[7-9]\/api\/|http:\/\/127\.0\.0\.1:385[01]\/api\//,async route=>{
   const url=new URL(route.request().url());if(url.pathname.startsWith('/api/desktop/'))return route.fulfill({status:404,body:'{}'});
   const response=await route.fetch({url:app.address+url.pathname+url.search});return route.fulfill({response});
  });
  mock.api.root={name:'传输验证文件'};mock.page.name='目标页面';mock.api.showUI=()=>{};mock.api.on=()=>{};mock.api.notify=()=>{};mock.api.clientStorage={getAsync:async key=>key==='h2f-settings-v1'?{token:app.token}:null,setAsync:async()=>{}};
  mock.api.ui={postMessage:message=>{pendingPosts.push(host.evaluate(msg=>document.querySelector('iframe')?.contentWindow.postMessage({pluginMessage:msg},'*'),message).catch(()=>{}));}};
  vm.runInNewContext(await readFile('dist/code.js','utf8'),{figma:mock.api,__html__:'',console,setTimeout,clearTimeout,Uint8Array,Buffer});
  await host.exposeFunction('receivePluginMessage',message=>mock.api.ui.onmessage(message));
  await host.setContent(`<html><body><script>window.addEventListener('message',e=>{if(e.data?.pluginMessage)window.receivePluginMessage(e.data.pluginMessage);});</script><iframe style="width:460px;height:760px"></iframe></body></html>`);
  await host.locator('iframe').evaluate((el,html)=>{el.srcdoc=html;},await readFile('dist/ui.html','utf8'));
  const plugin=host.frameLocator('iframe');await plugin.locator('#file-label').waitFor();
  await sender.goto(app.address);await sender.locator('#file-input').setInputFiles({name:'captured.h2f.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(makeBundle()))});await sender.locator('#ready-actions').waitFor({state:'visible'});
  await sender.locator('.page-row input').nth(1).uncheck();await sender.locator('#send-handoff').click();await plugin.locator('#handoff-inbox').waitFor({state:'visible',timeout:10000});
  assert.ok((await plugin.locator('#handoff-description').textContent()).includes('2 页'));assert.equal(mock.page.children.length,0);
  await plugin.locator('#receive-handoff').click();await sender.waitForFunction(()=>document.querySelector('#handoff-send-status').textContent.includes('已导入 Figma：2 / 2'),{},{timeout:15000});
  assert.deepEqual(mock.page.children.map(p=>p.name),['状态 1','状态 3']);assert.equal(await plugin.locator('#handoff-inbox').isHidden(),true);
  await sender.locator('#send-handoff').click();await sender.waitForTimeout(300);assert.equal(mock.page.children.length,2);
  await sender.waitForFunction(()=>document.querySelector('#figma-target').options.length>1,{},{timeout:10000});
  assert.ok((await sender.locator('#figma-target-help').textContent()).includes('传输验证文件 / 目标页面'));await sender.locator('#direct-import').click();
  await sender.waitForFunction(()=>document.querySelector('#handoff-send-status').textContent.includes('已导入 Figma：2 / 2'),{},{timeout:15000});
  assert.equal(mock.page.children.length,4);assert.deepEqual(mock.page.children.slice(2).map(p=>p.name),['状态 1','状态 3']);
  await Promise.allSettled(pendingPosts);
 }finally{await context.close();await app.close();}
});

test('desktop direct import binds a specific live Figma window and rejects context changes',()=>{
 let now=1000;const store=createHandoffStore({now:()=>now}),context={documentName:'文件A',pageName:'页面A',pageId:'0:1',contextVersion:'aa'.repeat(16),busy:false};
 const target=store.heartbeat('plugin-A',context);store.heartbeat('plugin-B',{...context,documentName:'文件B'});assert.equal(store.targets().length,2);
 const sent=store.publish('desktop',{requestId:id,bundle:makeBundle(1),targetId:target.id,targetContext:context.contextVersion});assert.equal(sent.autoImport,true);assert.equal(store.latest('plugin-B'),null);assert.equal(store.latest('plugin-A').id,sent.id);assert.throws(()=>store.claim(sent.id,'plugin-B',context.contextVersion),/另一个/);
 store.heartbeat('plugin-A',{...context,pageId:'0:2',contextVersion:'bb'.repeat(16)});assert.throws(()=>store.claim(sent.id,'plugin-A','bb'.repeat(16)),/页面已变化/);assert.equal(store.status(sent.id).status,'failed');
 assert.throws(()=>store.publish('desktop',{requestId:'cc'.repeat(16),bundle:makeBundle(1),targetId:target.id,targetContext:context.contextVersion}),/页面已变化/);
 const completed=store.publish('desktop',{requestId:'dd'.repeat(16),bundle:makeBundle(1),targetId:target.id,targetContext:'bb'.repeat(16)});store.claim(completed.id,'plugin-A','bb'.repeat(16));store.progress(completed.id,'plugin-A',{status:'complete',completed:1});assert.throws(()=>store.claim(completed.id,'plugin-A',context.contextVersion),/已开始或已完成/);assert.equal(store.status(completed.id).status,'complete');
 now+=16000;assert.equal(store.targets().length,0);
});

test('plugin checks the actual page immediately before desktop-triggered canvas writes',async()=>{
 const mock=mockFigma(),messages=[];mock.api.root={name:'A'};mock.api.showUI=()=>{};mock.api.on=()=>{};mock.api.ui={postMessage:m=>messages.push(m)};mock.api.notify=()=>{};
 vm.runInNewContext(await readFile('dist/code.js','utf8'),{figma:mock.api,__html__:'',console,setTimeout,clearTimeout,Uint8Array,Buffer});
 await mock.api.ui.onmessage({type:'IMPORT',expectedPageId:'different-page',document:makeBundle(1).pages[0],mode:'visual'});assert.equal(mock.page.children.length,0);assert.equal(messages.at(-1).type,'ERROR');
});

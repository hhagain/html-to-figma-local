import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import vm from'node:vm';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{launchBrowser}from'../scripts/browser.mjs';
import{createAppServer}from'../scripts/server.mjs';
import{BundleBuilder}from'../dist/lib/bundle.js';
import{mockFigma}from'./helpers.mjs';
let browser;
before(async()=>{browser=await launchBrowser();await mkdir('artifacts/large-batch',{recursive:true});},{timeout:30000});
after(async()=>{await browser?.close();});
const document=i=>({schemaVersion:1,name:'页面 '+i,createdAt:'',source:{title:'',url:'local-html',selector:'.page',viewport:{width:1440,height:900}},root:{id:'root',kind:'frame',name:'页面 '+i,x:0,y:0,width:320,height:80,opacity:1,fills:[],children:[]},assets:[],diagnostics:[],stats:{nodes:1,texts:0,images:0,vectors:0,missingAssets:0}});

test('1000-page HTML is parsed and imported through the compiled Figma plugin bridge',async()=>{
 const count=1000,context=await browser.newContext({viewport:{width:460,height:760}}),host=await context.newPage(),mock=mockFigma();let completed;
 const pending=[];
 try{
  await context.route(/^https?:\/\//,route=>route.fulfill({status:404,body:'{}',contentType:'application/json'}));
  mock.api.root={name:'1000 页验收'};mock.page.name='测试页面';mock.api.on=()=>{};mock.api.showUI=()=>{};mock.api.notify=()=>{};mock.api.openExternal=()=>{};mock.api.clientStorage={getAsync:async()=>null,setAsync:async()=>{}};
  mock.api.ui={postMessage:message=>{if(message.type==='BATCH_COMPLETE')completed=message.result;pending.push(host.evaluate(msg=>document.querySelector('iframe')?.contentWindow.postMessage({pluginMessage:msg},'*'),message).catch(()=>{}));}};
  vm.runInNewContext(await readFile('dist/code.js','utf8'),{figma:mock.api,__html__:'',console,setTimeout,clearTimeout,Uint8Array,Buffer});
  await host.exposeFunction('pluginMessage',msg=>mock.api.ui.onmessage(msg));
  await host.setContent('<style>body{margin:0}iframe{display:block;border:0;width:460px;height:760px}</style><script>addEventListener("message",e=>{if(e.data?.pluginMessage)window.pluginMessage(e.data.pluginMessage);});</script><iframe></iframe>');
  await host.locator('iframe').evaluate((el,html)=>el.srcdoc=html,await readFile('dist/ui.html','utf8'));
  const ui=host.frameLocator('iframe');
  const html='<html><head><meta charset="utf-8"><title>1000 页压力样例</title><style>body{margin:0}*{box-sizing:border-box}.page{width:320px;height:80px;padding:10px;background:white}h2,p{margin:0;font:14px/24px Arial}</style></head><body>'+Array.from({length:count},(_,i)=>`<section class="page" data-page-name="页面 ${i+1}"><h2>页面 ${i+1}</h2><p>可编辑内容</p></section>`).join('')+'</body></html>';
  await ui.locator('#file-input').setInputFiles({name:'1000-pages.html',mimeType:'text/html',buffer:Buffer.from(html)});await ui.locator('#prepare').click();
  await ui.locator('#ready-actions').waitFor({state:'visible',timeout:120000});assert.equal(await ui.locator('.page-row').count(),count);assert.match(await ui.locator('#report-title').textContent(),/1000/);
  await host.locator('iframe').screenshot({path:'artifacts/large-batch/1000-pages-prepared.png'});
  await ui.locator('#import').click();await ui.locator('#report-title').filter({hasText:'多页导入完成'}).waitFor({timeout:120000});
  assert.ok(completed);assert.equal(completed.completed,count);assert.equal(completed.failed,0);assert.equal(mock.page.children.length,count);assert.equal(new Set(mock.page.children.map(n=>`${n.x},${n.y}`)).size,count);
  await host.locator('iframe').screenshot({path:'artifacts/large-batch/1000-pages-imported.png'});
  await writeFile('artifacts/large-batch/compiled-plugin-1000.json',JSON.stringify({pagesParsed:count,pagesImported:completed.completed,failed:completed.failed,uniqueFramePositions:count,verification:'real browser parsing and compiled plugin with Figma API test host; not a real Figma client'},null,2)+'\n');
  await Promise.allSettled(pending);
 }finally{await context.close();}
},{timeout:240000});

test('more than 200 source files can be selected and prepared without a count ceiling',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(app.address);await page.locator('#file-input').setInputFiles(Array.from({length:250},(_,i)=>({name:`page-${i}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document(i)))})));
  assert.match(await page.locator('#status').textContent(),/250/);await page.locator('#prepare').click();await page.locator('#ready-actions').waitFor({state:'visible',timeout:20000});assert.equal(await page.locator('.page-row').count(),250);
 }finally{await context.close();await app.close();}
});

test('a 1000-page backup restores and previews page 1000',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();
 try{
  await page.goto(app.address);const jpeg='data:image/jpeg;base64,'+(await page.screenshot({type:'jpeg',quality:20,clip:{x:0,y:0,width:1,height:1}})).toString('base64');
  const builder=new BundleBuilder('1000 页备份');for(let i=0;i<1000;i++)builder.add(document(i));
  await page.locator('#file-input').setInputFiles({name:'1000-pages.h2f.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...builder.bundle,previewImages:Array(1000).fill(jpeg)}))});
  await page.locator('#preview-controls').waitFor({state:'visible'});await page.locator('#preview-page').selectOption('999');
  await page.waitForFunction(()=>document.querySelector('#remote-preview').dataset.pageIndex==='999'&&!document.querySelector('#remote-preview').hidden);
  assert.equal(await page.locator('#preview-size').textContent(),'1000 / 1000 页');assert.equal(await page.locator('.page-row').count(),1000);
 }finally{await context.close();await app.close();}
});

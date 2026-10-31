import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import path from'node:path';
import{readFile}from'node:fs/promises';
import{pathToFileURL}from'node:url';
import{launchBrowser}from'../scripts/browser.mjs';
import{openManualCapture,validateManualOptions}from'../scripts/manual-capture.mjs';
import{createAppServer}from'../scripts/server.mjs';
import{hydratePage}from'../dist/lib/bundle.js';
import{ImportBatch}from'../dist/lib/batch.js';
import{mockFigma}from'./helpers.mjs';
let browser;before(async()=>{browser=await launchBrowser();});after(async()=>{await browser?.close();});
const url=pathToFileURL(path.resolve('examples/manual-selection.html')).href+'#/home';
const flat=n=>[n,...(n.children||[]).flatMap(flat)],text=d=>flat(d.root).map(n=>n.text?.value||'').join('');
const click=async(s,selector)=>{const box=await s.page.locator(selector).boundingBox();assert.ok(box);await s.input({type:'click',x:box.x+box.width/2,y:box.y+box.height/2});};
const open=(options={})=>openManualCapture(browser,{url,width:800,height:900,options});
const auth=app=>({'X-H2F-Token':app.token,'Content-Type':'application/json'});
async function api(app,route,body,headers=auth(app)){const res=await fetch(app.address+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,data:await res.json()};}

test('manual options validate independent extras and layout choices',()=>{
 assert.deepEqual(validateManualOptions(),{collectExtras:true,layout:'selection'});
 assert.deepEqual(validateManualOptions({collectExtras:false,layout:'smart'}),{collectExtras:false,layout:'smart'});
 for(const invalid of [{collectExtras:1},{layout:'reverse'}])assert.throws(()=>validateManualOptions(invalid));
});

test('retains actual marked states, per-mark viewport/long choices and checkbox order without replay',async()=>{
 const original=await readFile('examples/manual-selection.html');const s=await open({collectExtras:false});
 try{
  let state=await s.mark({name:'首屏',mode:'viewport'});const first=state.marks[0];assert.ok(first.longHeight>first.viewportHeight);assert.equal(first.viewportHeight,900);
  await click(s,'#note');await s.input({type:'text',text:'手动填写的中文'});await click(s,'#records');
  state=await s.mark({name:'记录长页',mode:'long'});const second=state.marks[1];
  await s.input({type:'reload'});assert.equal(await s.page.locator('#note').inputValue(),'');
  await s.update({id:first.id,selected:false});await s.update({id:first.id,selected:true});await s.update({id:first.id,name:'首屏 · 改名'});
  const result=await s.export();assert.deepEqual(result.bundle.pages.map(p=>p.name),['记录长页','首屏 · 改名']);assert.equal(result.bundle.pages.length,2);assert.equal(result.bundle.importOptions.smartLayout,false);const named=mockFigma(),namedBatch=new ImportBatch(named.api,'names',result.bundle.pages.map(p=>({name:p.name,width:p.root.width,height:p.root.height,design:p.source.design,artifact:p.source.artifact})),'visual',false);for(let i=0;i<2;i++){const imported=await namedBatch.importPage(i,hydratePage(result.bundle,i));assert.equal((await named.api.getNodeByIdAsync(imported.nodeId)).name,result.bundle.pages[i].name);}
  assert.ok(text(hydratePage(result.bundle,0)).includes('手动填写的中文'));assert.ok(text(hydratePage(result.bundle,0)).includes('页面末尾'));assert.equal(result.bundle.pages[1].root.height,900);
  assert.equal(flat(result.bundle.pages[0].root).find(n=>n.name==='div.local-list').height,120);
  await s.update({id:second.id,mode:'viewport'});await s.update({options:{layout:'smart'}});const updated=await s.export();assert.equal(updated.bundle.pages[0].root.height,900);assert.equal(updated.bundle.importOptions.smartLayout,true);
  assert.deepEqual(await readFile('examples/manual-selection.html'),original);assert.ok(updated.bundle.pages.every(p=>p.source.url.startsWith('file:')));
 }finally{await s.close();}assert.equal(browser.contexts().length,0);
});

test('scrolling then marking current page keeps visible text at viewport coordinates and restores original scroll',async()=>{
 const s=await open({collectExtras:false});try{
  await s.input({type:'wheel',x:650,y:500,deltaX:0,deltaY:1600});await s.page.waitForFunction(()=>scrollY>600);const before=await s.page.evaluate(()=>scrollY);
  const sourceBox=await s.page.locator('main h2').boundingBox();const state=await s.mark({name:'滚动位置',mode:'viewport'});assert.equal(await s.page.evaluate(()=>scrollY),before);
  const viewport=hydratePage((await s.export()).bundle,0);assert.equal(viewport.root.height,900);const walk=(node,y=0)=>node.name==='h2'?y+node.y:(node.children||[]).map(n=>walk(n,y+node.y)).find(v=>v!==undefined);assert.ok(Math.abs(walk(viewport.root)-sourceBox.y)<1,JSON.stringify({captured:walk(viewport.root),sourceBox}));
  await s.update({id:state.marks[0].id,mode:'long'});const long=hydratePage((await s.export()).bundle,0);assert.ok(text(long).includes('概览'));assert.ok(text(long).includes('长页面底部'));assert.ok(long.root.height>1500);
 }finally{await s.close();}
});

test('unselected visited states become merged editable components/icons only when the switch is enabled',async()=>{
 const s=await open();try{
  await s.mark({name:'只保留这一整页'});await click(s,'#more summary');await s.observe();await click(s,'#note');await s.input({type:'text',text:'状态示例'});await s.observe();await click(s,'#change');await s.observe();
  const marked=await s.mark({name:'不作为整页'});await s.update({id:marked.marks[1].id,selected:false});
  const on=await s.export();assert.equal(on.report.selectedPages,1);assert.ok(on.report.components>0);assert.equal(on.report.icons,1);assert.ok(on.bundle.pages.slice(1).every(p=>['component','icon'].includes(p.source.artifact.kind)));assert.equal(on.bundle.pages.filter(p=>p.source.artifact.kind==='page').length,1);
  const components=on.bundle.pages.filter(p=>p.source.artifact.kind==='component');assert.equal(new Set(components.map(p=>p.source.artifact.familyId+':'+p.source.artifact.stateName)).size,components.length);
  const mock=mockFigma(),plan=on.bundle.pages.map(p=>({name:p.name,width:p.root.width,height:p.root.height,design:p.source.design,artifact:p.source.artifact})),batch=new ImportBatch(mock.api,'manual',plan,'visual',false);for(let i=0;i<on.bundle.pages.length;i++){const item=await batch.importPage(i,hydratePage(on.bundle,i));assert.ok(item.nodeId,item.error);}assert.equal((await batch.finish()).failed,0);assert.ok(mock.all.some(n=>n.type==='COMPONENT'));
  await s.update({options:{collectExtras:false}});const off=await s.export();assert.equal(off.bundle.pages.length,1);assert.equal(off.report.components,0);assert.equal(off.report.icons,0);
  await s.update({options:{collectExtras:true}});await s.observe();assert.ok((await s.export()).report.components>0);
 }finally{await s.close();}
});

test('manual API binds sessions to their owner and releases the capture lock on close',async()=>{
 const app=await createAppServer({port:0,desktop:{authorised:req=>req.headers['x-h2f-token']==='other',onActivity:()=>{}}});
 try{
  const created=await api(app,'/api/manual',{url,width:800,height:900,options:{collectExtras:false}});assert.equal(created.status,201,created.data.error);const base='/api/manual/'+created.data.id;
  assert.equal((await api(app,base,undefined,{'X-H2F-Token':'other'})).status,404);assert.equal((await api(app,'/api/manual/active',undefined,{'X-H2F-Token':'other'})).data.session,null);
  assert.equal((await api(app,'/api/capture',{url})).status,409);assert.equal((await api(app,base+'/export',{})).status,422);
  const frame=await api(app,base+'/frame');assert.ok(frame.data.image.startsWith('data:image/jpeg;base64,'));await api(app,base+'/mark',{name:'API 标记'});const result=await api(app,base+'/export',{});assert.equal(result.data.report.selectedPages,1);
  assert.equal((await api(app,base+'/close',{})).status,200);assert.equal((await api(app,'/api/health')).data.capturing,false);assert.equal((await api(app,base)).status,404);
 }finally{await app.close();}
});

test('workbench operates the original HTML, edits Chinese text, switches per-mark scope and exports in checked order',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();let exported;
 try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#url-mode').selectOption('states');await page.locator('#state-input-mode').selectOption('manual');await page.locator('#page-url').fill(url);await page.locator('#viewport-width').fill('800');await page.locator('#manual-extras').uncheck();await page.locator('#prepare').click();await page.locator('#manual-image').waitFor({state:'visible',timeout:30000});await page.waitForFunction(()=>document.querySelector('#manual-image').naturalWidth===800);
  const original=await context.newPage();await original.setViewportSize({width:800,height:900});await original.goto(url);const box=await original.locator('#note').boundingBox();await original.close();
  const surface=await page.locator('#manual-surface').boundingBox(),scale=surface.width/800;await page.mouse.click(surface.x+(box.x+20)*scale,surface.y+(box.y+15)*scale);await page.keyboard.insertText('中文手动输入');
  await page.locator('#manual-name').fill('第一张');await page.locator('#manual-mark').click();await page.waitForFunction(()=>document.querySelectorAll('.manual-mark-row').length===1,{},{timeout:30000});
  await page.locator('#manual-name').fill('第二张');await page.locator('input[name="manual-scope"][value="long"]').check();await page.locator('#manual-mark').click();await page.waitForFunction(()=>document.querySelectorAll('.manual-mark-row').length===2,{},{timeout:30000});
  const boxes=page.locator('.manual-mark-row input[type=checkbox]');await boxes.nth(0).uncheck();await page.waitForFunction(()=>document.querySelector('.manual-mark-row').dataset.selected==='false');await boxes.nth(0).check();await page.waitForFunction(()=>document.querySelector('.manual-order').textContent==='02');
  await page.locator('.manual-mark-row select').nth(0).selectOption('long');await page.waitForFunction(()=>document.querySelector('.manual-mark-row select').value==='long');
  const response=page.waitForResponse(r=>r.url().endsWith('/export')&&r.request().method()==='POST');await page.locator('#prepare').click();exported=await(await response).json();await page.locator('#ready-actions').waitFor({state:'visible'});
  assert.deepEqual(exported.bundle.pages.map(p=>p.name),['第二张','第一张']);assert.equal(exported.bundle.importOptions.smartLayout,false);assert.ok(exported.bundle.pages.every(p=>p.root.height>900));assert.ok(text(hydratePage(exported.bundle,0)).includes('中文手动输入'));assert.equal(await page.locator('#manual-browser').isHidden(),true);assert.equal(await page.locator('#remote-preview').isVisible(),true);
  await page.screenshot({path:'artifacts/manual-capture-workbench.png',fullPage:true});await page.locator('#manual-resume').click();await page.locator('#manual-browser').waitFor({state:'visible'});await page.locator('.manual-mark-row input[type=text]').nth(0).fill('第一张 · 改名');const renamedUpdate=page.waitForResponse(r=>r.url().endsWith('/update')&&r.request().postDataJSON()?.name==='第一张 · 改名');await page.locator('.manual-mark-row input[type=text]').nth(0).press('Tab');await renamedUpdate;const renamedResponse=page.waitForResponse(r=>r.url().endsWith('/export')&&r.request().method()==='POST');await page.locator('#prepare').click();const renamed=await(await renamedResponse).json();assert.deepEqual(renamed.bundle.pages.map(p=>p.name),['第二张','第一张 · 改名']);await page.locator('#manual-close').click();await page.locator('#manual-session').waitFor({state:'hidden'});assert.equal((await api(app,'/api/health')).data.capturing,false);
 }finally{await context.close();await app.close();}
});

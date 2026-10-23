import test,{before,after}from'node:test';import assert from'node:assert/strict';import{mkdtemp,writeFile,rm}from'node:fs/promises';import path from'node:path';import os from'node:os';import{launchBrowser}from'../scripts/browser.mjs';import{discoverPages,validateDiscoveryRequest}from'../scripts/discover-pages.mjs';import{captureStates,validateStatePlan}from'../scripts/state-capture.mjs';
let browser,root,url;
const html=`<!doctype html><html><head><meta charset="utf-8"><title>交互探索测试</title></head><body><main id="app"><h1>工作台</h1><button id="detail">查看详情</button><button id="form">新增记录</button><button id="more">展开说明</button><button id="remove">删除数据</button><button id="upload">上传文件</button><p id="expanded" hidden>更多说明已显示</p></main><section id="dialog" role="dialog" aria-modal="true" hidden></section><script>
const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');function show(content){app.inert=true;dialog.hidden=false;dialog.innerHTML=content;}
document.querySelector('#detail').onclick=()=>{show('<h2>详情面板</h2><button id="edit">编辑记录</button>');document.querySelector('#edit').onclick=openForm;};
function openForm(){show('<h2>记录表单</h2><form novalidate><label>名称<input required id="name" name="name"></label><details><summary>备注与说明</summary><textarea id="note" name="note"></textarea></details><button id="save" type="submit">保存</button><p id="error"></p></form>');dialog.querySelector('form').onsubmit=e=>{e.preventDefault();document.querySelector('#error').textContent=document.querySelector('#name').value?'已保存':'名称不能为空';};}
document.querySelector('#form').onclick=openForm;document.querySelector('#more').onclick=()=>document.querySelector('#expanded').hidden=false;document.querySelector('#remove').onclick=()=>{document.body.innerHTML='DELETED';};</script></body></html>`;
before(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'h2f-explore-'));url=path.join(root,'index.html');await writeFile(url,html);browser=await launchBrowser();});after(async()=>{await browser?.close();await rm(root,{recursive:true,force:true});});
const request=()=>({url,exploreInteractions:true,maxPages:40,maxActions:40,maxDepth:3,timeoutMs:30000,width:800,height:700});
test('explores nested detail, forms, validation and representative fill without supplied JSON',async()=>{
 const result=await discoverPages(browser,request());
 assert.ok(result.pages.length>=6,JSON.stringify(result.pages.map(p=>p.name)));assert.ok(result.pages.some(p=>p.name.includes('详情面板')));assert.ok(result.pages.some(p=>p.name.includes('记录表单')));assert.ok(result.pages.some(p=>p.name.includes('校验')));assert.ok(result.pages.some(p=>p.name.includes('填写示例')));
 assert.equal(result.report.exhaustive,false);assert.ok(result.report.duplicates>0);assert.ok(result.report.skipped.some(s=>s.name==='删除数据'));assert.ok(result.pages.every(p=>!p.steps.some(s=>s.selector==='#remove'||s.selector==='#upload')));
 validateStatePlan(result.plan);const capture=await captureStates(browser,result.plan);assert.equal(capture.report.completed,result.pages.length,JSON.stringify(capture.report.states.filter(s=>s.error)));assert.equal(capture.report.failed,0);
 assert.equal(browser.contexts().length,0);
});
test('reports unvisited controls when bounded, supports cancellation and rejects changed states on replay',async()=>{
 const bounded=await discoverPages(browser,{...request(),maxPages:2});assert.equal(bounded.pages.length,2);assert.equal(bounded.report.limited,true);assert.ok(bounded.report.remaining>0);assert.ok(bounded.report.pending.length);
 const controller=new AbortController();const cancelled=await discoverPages(browser,request(),{signal:controller.signal,onProgress:p=>{if(p.found>=1)controller.abort();}});assert.equal(cancelled.report.cancelled,true);assert.equal(browser.contexts().length,0);
 await writeFile(url,html.replace('工作台','新版工作台'));const replay=await captureStates(browser,{...bounded.plan,states:[bounded.plan.states[0]]});assert.equal(replay.report.failed,1);assert.ok(replay.report.states[0].error.includes('状态不同'));await writeFile(url,html);
 assert.throws(()=>validateDiscoveryRequest({...request(),maxDepth:100}),/探索/);
});

test('all primary navigation tabs survive representative sampling',async()=>{
 const p=path.join(root,'tabs.html');await writeFile(p,`<html><body><nav>${['a','b','c','d'].map((x,i)=>`<button role="tab" data-action="tab" data-id="${x}" id="${x}" aria-selected="${!i}">${x}</button>`).join('')}</nav><h1 id="content">A</h1><script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-selected',String(x===b)));document.querySelector('#content').textContent=b.id;});</script></body></html>`);
 const result=await discoverPages(browser,{...request(),url:p,maxDepth:1,maxActions:6});assert.ok(result.pages.some(p=>p.name==='d'),JSON.stringify(result.pages.map(p=>p.name)));
});

test('workbench defaults to interaction exploration and can capture the generated selection without importing JSON',async()=>{
 const {createAppServer}=await import('../scripts/server.mjs');const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();
 try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#url-mode').selectOption('states');assert.equal(await page.locator('#state-input-mode').inputValue(),'explore');await page.locator('#page-url').fill(url);
  await page.locator('#prepare').click();await page.waitForFunction(()=>!document.querySelector('#discovery-results').hidden&&!document.querySelector('#prepare').disabled,{},{timeout:60000});
  assert.ok((await page.locator('#discovery-title').textContent()).includes('状态'));assert.ok((await page.locator('#discovery-summary').textContent()).includes('不代表全部交互已覆盖'));assert.equal(await page.locator('#download-generated-plan').isVisible(),true);
  await page.locator('#discovery-clear').click();await page.locator('.discovery-row input').first().check();await page.locator('#prepare').click();await page.locator('#ready-actions').waitFor({state:'visible',timeout:15000});assert.ok((await page.locator('#status').textContent()).includes('成功 1 / 1'));
 }finally{await context.close();await app.close();}
});

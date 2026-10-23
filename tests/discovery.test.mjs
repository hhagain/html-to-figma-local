import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {normalizeCaptureAddress} from '../dist/lib/capture-address.js';
import {discoverPages, validateDiscoveryRequest} from '../scripts/discover-pages.mjs';
import {launchBrowser, captureURL} from '../scripts/browser.mjs';
import {captureStates, validateStatePlan} from '../scripts/state-capture.mjs';
import {createAppServer} from '../scripts/server.mjs';

let temp, root, url, browser, server, remote, writes = 0;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>导航示例</title></head><body>
<nav role="tablist"><button role="tab" id="dashboard" aria-selected="true">看板</button><button role="tab" id="ledger" aria-selected="false">明细</button><button role="tab" id="assets" aria-selected="false">资产</button><button data-action="delete-all" id="danger">清空账单</button></nav>
<h1 id="page">看板内容</h1><a href="./help.html">使用帮助</a><a href="./help.html">重复帮助链接</a><a href="#section">页内锚点</a><a href="https://external.invalid/page">外部网站</a><a href="./report.html" download>下载报告</a><a style="display:none" href="./hidden.html">隐藏页面</a><button id="submit">提交订单</button>
<script>for(const button of document.querySelectorAll('[role=tab]'))button.onclick=()=>{for(const other of document.querySelectorAll('[role=tab]'))other.setAttribute('aria-selected',String(other===button));location.hash='/'+button.id;document.querySelector('#page').textContent=button.textContent+'内容';};document.querySelector('#danger').onclick=()=>fetch('/danger');fetch('/write',{method:'POST'}).catch(()=>{});</script></body></html>`;
before(async()=>{
 temp=await mkdtemp(path.join(os.tmpdir(),'h2f-discovery-'));root=path.join(temp,'Design 项目');await mkdir(root);await writeFile(path.join(root,'index.html'),html);
 await writeFile(path.join(root,'help.html'),'<html><head><meta charset="utf-8"><title>使用帮助</title></head><body><h1>帮助页</h1><a href="./guide.html">操作指南</a></body></html>');
 await writeFile(path.join(root,'guide.html'),'<html><head><meta charset="utf-8"><title>操作指南</title></head><body><h1>指南页</h1></body></html>');
 await mkdir(path.join(root,'.private'));await writeFile(path.join(root,'.private/secret.html'),'private');await symlink(path.join(root,'.private/secret.html'),path.join(root,'symlink.html'));
 url=pathToFileURL(path.join(root,'index.html')).href+'#/dashboard';browser=await launchBrowser();
 server=http.createServer(async(req,res)=>{if(req.method==='POST'||req.url==='/danger')writes++;try{const filename=new URL(req.url,'http://local').pathname==='/'?'index.html':new URL(req.url,'http://local').pathname.slice(1);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(path.join(root,filename)));}catch{res.end('missing');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));remote=`http://127.0.0.1:${server.address().port}/`;
},{timeout:30000});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});});

test('normalizes macOS copied paths without losing percent encoding, query or hash routes',()=>{
 const expected='file:///Users/yourname/Design%20Project/index.html?mode=demo#/dashboard';
 for(const input of ['Users/yourname/Design%20Project/index.html?mode=demo#/dashboard','/Users/yourname/Design Project/index.html?mode=demo#/dashboard',"'/Users/yourname/Design%20Project/index.html?mode=demo#/dashboard'",expected])assert.equal(normalizeCaptureAddress(input),expected);
 assert.equal(normalizeCaptureAddress('/Users/me/原型 #100%/index.html#/资产'),'file:///Users/me/%E5%8E%9F%E5%9E%8B%20%23100%25/index.html#/%E8%B5%84%E4%BA%A7');
 for(const value of ['Users/me/private.json','/Users/me/%2fetc/index.html','javascript:alert(1)','https://user:secret@site.com',''])assert.throws(()=>normalizeCaptureAddress(value));
 assert.equal(normalizeCaptureAddress('https://example.com/path?q=1#/a'),'https://example.com/path?q=1#/a');
 assert.throws(()=>validateDiscoveryRequest({url,maxPages:201}),/200/);
});

test('discovers local tabs and directory pages, deduplicates links, then captures without a user recipe',async()=>{
 const result=await discoverPages(browser,{url:path.join(root,'index.html')+'#/dashboard',width:800,height:700});
 assert.equal(result.report.status,'complete',JSON.stringify(result.report));assert.equal(result.pages.length,5);
 assert.deepEqual(new Set(result.pages.map(p=>p.name)),new Set(['看板','明细','资产','使用帮助','操作指南']));
 assert.ok(result.pages.every(p=>p.checked&&!p.error));assert.ok(result.pages.every(p=>!p.url.includes('.private')&&!p.url.includes('symlink')));
 validateStatePlan(result.plan);const capture=await captureStates(browser,result.plan);assert.equal(capture.report.completed,5);assert.equal(capture.report.failed,0);
 assert.equal(browser.contexts().length,0);
});

test('HTTP discovery follows same-origin navigation while skipping destructive controls and blocking writes',async()=>{
 writes=0;const result=await discoverPages(browser,{url:remote,width:800,height:700});
 assert.equal(result.pages.length,5);assert.ok(result.pages.some(p=>p.name==='操作指南'));assert.ok(result.report.blockedRequests>0);assert.ok(result.report.skippedControls>0);assert.equal(writes,0);
 assert.ok(result.pages.every(p=>new URL(p.url).origin===new URL(remote).origin));assert.ok(result.pages.every(p=>!p.steps.some(step=>step.selector==='#danger')));
});

test('discovery cancellation retains found candidates and closes the browser context',async()=>{
 const controller=new AbortController();const result=await discoverPages(browser,{url},{signal:controller.signal,onProgress:p=>{if(p.scanned>=1)controller.abort();}});
 assert.equal(result.report.status,'cancelled');assert.equal(result.pages.length,5);assert.equal(browser.contexts().length,0);
 const again=await discoverPages(browser,{url,maxPages:1});assert.equal(again.pages.length,1);assert.equal(again.report.limited,true);
});

test('discovery caps large collections at 200 pages without dropping the ability to capture unscanned pages',async()=>{
 const many=path.join(temp,'many');await mkdir(many);await Promise.all(Array.from({length:205},(_,i)=>writeFile(path.join(many,`page-${String(i).padStart(3,'0')}.html`),'<html><body><h1>Page</h1></body></html>')));
 const controller=new AbortController();const result=await discoverPages(browser,{url:path.join(many,'page-000.html')},{signal:controller.signal,onProgress:p=>{if(p.scanned>=1)controller.abort();}});
 assert.equal(result.pages.length,200);assert.equal(result.plan.states.length,200);assert.equal(result.report.limited,true);
 const last=await captureStates(browser,{...result.plan,states:result.plan.states.slice(-1)});assert.equal(last.report.completed,1);
});

test('discovery jobs are authenticated, serialized with capture and cancellable',async()=>{
 const app=await createAppServer({port:0}),headers={'X-H2F-Token':app.token,'Content-Type':'application/json'};
 try{
  assert.equal((await fetch(app.address+'/api/discover',{method:'POST',body:'{}'})).status,401);
  const start=await fetch(app.address+'/api/discover',{method:'POST',headers,body:JSON.stringify({url})});assert.equal(start.status,202);const job=await start.json();
  assert.equal((await fetch(app.address+'/api/capture',{method:'POST',headers,body:JSON.stringify({url})})).status,409);
  await fetch(`${app.address}/api/discover/${job.id}/cancel`,{method:'POST',headers,body:'{}'});
  let status;for(let i=0;i<100;i++){status=await(await fetch(`${app.address}/api/discover/${job.id}`,{headers})).json();if(status.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(status.status,'cancelled');assert.equal((await fetch(`${app.address}/api/states/${job.id}`,{headers})).status,404);
 }finally{await app.close();}
});

test('UI discovers, selects, captures only checked pages and invalidates discovery after path edits',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:430,height:960}}),page=await context.newPage();
 try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#url-mode').selectOption('states');await page.locator('#state-input-mode').selectOption('auto');await page.locator('#page-url').fill(path.join(root,'index.html')+'#/dashboard');
  assert.equal(await page.locator('#state-input-mode').inputValue(),'auto');assert.equal(await page.locator('#prepare-label').textContent(),'自动发现页面');
  await page.locator('#prepare').click();await page.waitForFunction(()=>document.querySelector('#discovery-results').hidden===false&&!document.querySelector('#prepare').disabled,{},{timeout:20000});
  assert.equal(await page.locator('.discovery-row').count(),5);assert.equal(await page.locator('#prepare-label').textContent(),'开始捕获（5 页）');
  await page.evaluate(()=>document.body.classList.add('is-plugin'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#discovery-title').scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/discovery-ui.png'});
  await page.locator('#discovery-clear').click();assert.equal(await page.locator('#prepare').isDisabled(),true);
  await page.getByRole('checkbox',{name:'捕获 看板',exact:true}).check();await page.getByRole('checkbox',{name:'捕获 资产',exact:true}).check();
  await page.locator('#prepare').click();await page.locator('#ready-actions').waitFor({state:'visible',timeout:15000});assert.equal(await page.locator('.page-row').count(),2);
  assert.ok((await page.locator('#status').textContent()).includes('成功 2 / 2'));
  await page.locator('#page-url').fill(path.join(root,'guide.html'));assert.equal(await page.locator('#discovery-results').isHidden(),true);assert.equal(await page.locator('#ready-actions').isHidden(),true);assert.equal(await page.locator('#prepare-label').textContent(),'自动发现页面');
 }finally{await context.close();await app.close();}
});

import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {validateStatePlan,captureStates} from '../scripts/state-capture.mjs';
import {launchBrowser} from '../scripts/browser.mjs';
import {validateBundle,hydratePage} from '../dist/lib/bundle.js';
import {createAppServer} from '../scripts/server.mjs';
let browser,server,url,mutations=0;
before(async()=>{const html=await readFile('examples/dynamic-state-test.html');server=http.createServer((req,res)=>{if(req.method==='POST')mutations++;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}/`;browser=await launchBrowser();},{timeout:30000});
after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(r=>server?.close(r));});
const plan=states=>({schemaVersion:1,name:'State test',url,viewport:{width:800,height:700},captureMode:'viewport',states});
const click=selector=>({type:'click',selector});
const flat=n=>[n,...(n.children||[]).flatMap(flat)];
test('validates bounded same-origin recipes without arbitrary code execution',()=>{
 const valid=plan([{id:'a',name:'A',steps:[]}]);assert.equal(validateStatePlan(valid).states.length,1);
 assert.throws(()=>validateStatePlan({...valid,states:[{id:'a',name:'A',url:'https://untrusted.test/'}]}),/同源/);
 assert.throws(()=>validateStatePlan({...valid,states:[{id:'a',name:'A',steps:[{type:'evaluate',value:'alert(1)'}]}]}),/不支持/);
 assert.throws(()=>validateStatePlan({...valid,states:Array.from({length:201},(_,i)=>({id:`s${i}`,name:'a'}))}),/200/);
});
test('captures independent live states with editable select and checkbox content',async()=>{
 const result=await captureStates(browser,plan([
 {id:'base',name:'默认'},
 {id:'dialog',name:'详情',steps:[click('#open')]},
 {id:'error',name:'校验',steps:[click('#open'),click('#save'),{type:'wait',selector:'#error'}]},
 {id:'selection',name:'已选择',steps:[{type:'select',selector:'#choice',value:'active'},{type:'check',selector:'#enabled',checked:true}]},
 {id:'session-change',name:'临时修改',steps:[click('#increment')]},
 {id:'fresh',name:'独立会话'}
 ]));
 validateBundle(result.bundle);assert.equal(result.report.completed,6);assert.equal(result.report.failed,0);
 const data=result.bundle.pages.map((_,i)=>hydratePage(result.bundle,i));assert.ok(data.every(p=>p.root.width===800&&p.root.height===700&&p.root.clip));
 assert.ok(flat(data[2].root).some(n=>n.text?.value.includes('名称不能为空')));
 assert.ok(flat(data[3].root).some(n=>n.name==='表单文字'&&n.text?.value==='生效中'));
 const tick=flat(data[3].root).find(n=>n.name==='enabled');assert.equal(tick.kind,'svg');assert.ok(tick.svg.includes('m4 8'));
 const counter=flat(data[5].root).find(n=>n.name==='counter');assert.equal(counter.children[0].text.value,'0');
});
test('failed state is reported and does not block later states; network writes are blocked',async()=>{
 const result=await captureStates(browser,plan([{id:'missing',name:'不存在',steps:[{type:'click',selector:'#missing',timeoutMs:100}]},{id:'write',name:'阻止写请求',steps:[click('#mutate'),{type:'wait',selector:'#status',text:'写请求已阻止'}]},{id:'ok',name:'成功'}]));
 assert.equal(result.report.status,'partial');assert.equal(result.report.failed,1);assert.equal(result.report.completed,2);assert.equal(mutations,0);assert.equal(result.report.states[1].blockedRequests,1);
});
test('cancellation keeps finished states and reports unexecuted states',async()=>{
 const controller=new AbortController();const result=await captureStates(browser,plan([{id:'a',name:'完成页'},{id:'b',name:'未执行页'}]),{signal:controller.signal,onState:()=>controller.abort()});
 assert.equal(result.report.status,'cancelled');assert.equal(result.bundle.pages.length,1);assert.equal(result.report.states[1].status,'not-run');
});
test('authenticated asynchronous state endpoint returns a portable bundle and report',async()=>{
 const app=await createAppServer({port:0});const headers={'X-H2F-Token':app.token,'Content-Type':'application/json'};
 try{
  assert.equal((await fetch(`${app.address}/api/states`,{method:'POST',body:'{}'})).status,401);
  const start=await fetch(`${app.address}/api/states`,{method:'POST',headers,body:JSON.stringify(plan([{id:'first',name:'首页'},{id:'second',name:'详情',steps:[click('#open')]}]))});assert.equal(start.status,202);const job=await start.json();
  let status;for(let i=0;i<100;i++){status=await(await fetch(`${app.address}/api/states/${job.id}`,{headers})).json();if(status.status!=='running')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(status.status,'complete');const result=await(await fetch(`${app.address}/api/states/${job.id}/result`,{headers})).json();validateBundle(result.bundle);assert.equal(result.report.completed,2);
 }finally{await app.close();}
});
test('virtual editor canvases are clipped to visible ancestors without losing text',async()=>{
 const context=await browser.newContext({viewport:{width:800,height:700}});const page=await context.newPage();
 try{
  await page.setContent('<html><body style="margin:0"><div style="width:500px;height:250px;overflow:hidden;position:relative"><div id="virtual" style="width:16777216px;height:16777216px;position:absolute;left:0;top:0"><div style="width:450px;height:24px">SELECT * FROM events</div></div></div></body></html>');
  await page.addScriptTag({path:'dist/capture.js'});const capture=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document,{clipToViewport:true}));
  const node=flat(capture.root).find(n=>n.name==='virtual');assert.equal(node.width,500);assert.equal(node.height,250);assert.ok(flat(capture.root).some(n=>n.text?.value.includes('SELECT * FROM events')));assert.ok(capture.diagnostics.some(d=>d.code==='VIRTUAL_CANVAS_CLIPPED'));
 }finally{await context.close();}
});
test('workbench loads a state recipe, polls progress and exposes coverage report',async()=>{
 const app=await createAppServer({port:0});const context=await browser.newContext();const page=await context.newPage();
 try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#url-mode').selectOption('states');
  const recipe=plan([{id:'list',name:'默认'},{id:'detail',name:'详情',steps:[click('#open')]}]);
  await page.locator('#state-plan-file').setInputFiles({name:'demo.states.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});
  await page.locator('#prepare').click();await page.locator('#ready-actions').waitFor({state:'visible',timeout:20000});
  assert.equal(await page.locator('.page-row').count(),2);assert.equal(await page.locator('#download-state-report').isVisible(),true);assert.ok((await page.locator('#status').textContent()).includes('成功 2 / 2'));
 }finally{await context.close();await app.close();}
});
test('zero-pixel helper canvases do not become missing image placeholders',async()=>{
 const context=await browser.newContext();const page=await context.newPage();try{await page.setContent('<canvas width="0" height="200" style="width:1px;height:200px"></canvas>');await page.addScriptTag({path:'dist/capture.js'});const result=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document));assert.equal(result.assets.length,0);assert.equal(result.stats.missingAssets,0);}finally{await context.close();}
});
test('password placeholders stay readable while real password values are masked',async()=>{
 const context=await browser.newContext();const page=await context.newPage();try{await page.setContent('<input id="empty" type="password" placeholder="请输入密码"><input id="filled" type="password" value="SecretDemo123">');await page.addScriptTag({path:'dist/capture.js'});const capture=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document));const nodes=flat(capture.root);assert.equal(nodes.find(n=>n.name==='empty').children[0].text.value,'请输入密码');assert.equal(nodes.find(n=>n.name==='filled').children[0].text.value,'•'.repeat(13));}finally{await context.close();}
});

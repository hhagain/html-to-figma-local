import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const run = promisify(execFile);
if (process.platform !== 'win32') throw new Error('Packaged Windows validation requires Windows.');
const root = process.cwd(), out = path.join(root,'artifacts/windows');
const pkg = JSON.parse(await readFile('package.json','utf8'));
const setup = path.join(out,`HTML-to-Figma-Capture-${pkg.version}-win-x64-Setup.exe`);
const installDir = path.join(root,'.cache','windows-installed');
await mkdir(path.dirname(installDir),{recursive:true});
console.log('Installing Windows setup EXE.');
await run(setup,['/S',`/D=${installDir}`],{timeout:180000,windowsHide:true});
console.log('Installed; validating bundled service without a system runtime.');
const executable = path.join(installDir,'HTML to Figma Capture.exe');
const resources = path.join(installDir,'resources');
await run(process.execPath,['scripts/desktop/smoke.mjs'],{timeout:180000,maxBuffer:1024*1024,env:{...process.env,
  H2F_SMOKE_RESOURCES:resources,H2F_SMOKE_EXECUTABLE:executable,H2F_SMOKE_OUTPUT:path.join(out,'engine-validation.json')}}).then(r=>console.log(r.stdout));
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
let instance;
const failures=[];
try {
  instance = await electron.launch({executablePath:executable,env,timeout:60000});
  console.log('Launching the installed Windows desktop window.');
  const page = await instance.firstWindow(); page.setDefaultTimeout(30000);
  page.on('pageerror',e=>failures.push(e.message));
  await page.waitForURL(/\/desktop$/,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#engine-title')?.textContent==='捕获引擎已就绪');
  const address = new URL(page.url()).origin;
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal(await page.evaluate(()=>typeof window.h2fAssistant?.send),'function');
  const credentials = {clientId:'figma-'+randomBytes(16).toString('hex'),credential:randomBytes(32).toString('hex')};
  const post = async (url,body,auth=false) => {
    const response=await fetch(address+url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'X-H2F-Token':credentials.credential}:{}),Origin:'null'},body:JSON.stringify(body)});
    const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
  };
  const pair = await post('/api/desktop/pair/start',credentials);
  await page.locator('#pair-allow').waitFor({state:'visible'});await page.locator('#pair-allow').click();
  for(let n=0;n<40;n++){const status=await post('/api/desktop/pair/status',{...credentials,id:pair.id});if(status.status==='approved')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal((await fetch(address+'/api/health',{headers:{'X-H2F-Token':credentials.credential}})).status,200);
  const userData = await instance.evaluate(({app})=>app.getPath('userData'));
  console.log('Checking native pairing and plugin export.');
  await page.locator('#show-plugin').click();
  const manifest = path.join(userData,'Figma Plugin','manifest.json');
  for(let n=0;n<40;n++){try{await readFile(manifest);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const exported=JSON.parse(await readFile(manifest,'utf8'));assert.equal(exported.name,'HTML to Figma · Local');
  await writeFile(manifest,JSON.stringify({...exported,id:'test-preserved-id'}));
  await page.locator('#show-plugin').click();await new Promise(r=>setTimeout(r,250));
  assert.equal(JSON.parse(await readFile(manifest,'utf8')).id,'test-preserved-id');
  assert.deepEqual(await readFile(path.join(userData,'Figma Plugin/dist/code.js')),await readFile('dist/code.js'));
  console.log('Checking local capture and preview gestures.');
  await page.locator('#open-workbench').click();await page.waitForURL(address+'/');
  await page.locator('#url-tab').click();
  const localProject=path.join(root,'.cache','Windows Design 本地');
  await cp(path.join(resources,'engine/examples'),localProject,{recursive:true});
  await page.locator('#page-url').fill(path.join(localProject,'dashboard.html')+'?windows=1#/dashboard');
  await page.locator('#prepare').click();await page.locator('#preview-zoom-controls').waitFor({state:'visible',timeout:60000});
  await page.locator('#preview-zoom-actual').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'100%');
  const stage=page.locator('#preview-stage'),box=await stage.boundingBox();
  await page.mouse.move(box.x+180,box.y+140);await page.keyboard.down('Control');await page.mouse.wheel(0,-250);await page.keyboard.up('Control');
  await page.waitForFunction(()=>parseInt(document.querySelector('#preview-zoom-value').textContent)>100);
  const before=await stage.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}));
  await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(box.x+70,box.y+60,{steps:8});await page.mouse.up();await page.keyboard.up('Space');
  const after=await stage.evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}));assert.ok(after.x>before.x+40);assert.ok(after.y>before.y+30);
  await page.locator('#preview-zoom-fit').click();
  console.log('Checking direct handoff and lifecycle.');
  const receiverId=randomBytes(16).toString('hex'),contextVersion=randomBytes(16).toString('hex');
  const heartbeat = () => post('/api/figma/receivers',{receiverId,contextVersion,documentName:'Windows 自动化接收端',pageName:'验收',pageId:'0:1',busy:false},true);
  const target=await heartbeat();const timer=setInterval(()=>heartbeat().catch(()=>{}),3000);
  try {
    await page.waitForFunction(()=>document.querySelector('#figma-target')?.options.length>1);
    await page.locator('#figma-target').selectOption(target.id);
    await page.locator('#direct-import').click();
    const latest=await(await fetch(address+'/api/handoffs/latest?receiverId='+receiverId,{headers:{'X-H2F-Token':credentials.credential}})).json();
    assert.ok(latest.handoff?.id);
    const transfer=await post('/api/handoffs/'+latest.handoff.id+'/claim',{receiverId,contextVersion},true);
    assert.equal(transfer.autoImport,true);assert.equal(transfer.bundle.pages.length,1);
    await post('/api/handoffs/'+latest.handoff.id+'/progress',{receiverId,status:'complete',completed:1,failed:0},true);
    await page.waitForFunction(()=>document.querySelector('#handoff-send-status').textContent.includes('已导入 Figma：1 / 1'));
  } finally {clearInterval(timer);}
  await page.screenshot({path:path.join(out,'windows-workbench.png'),fullPage:true});
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  assert.equal((await fetch(address+'/api/health',{headers:{'X-H2F-Token':credentials.credential}})).status,200);
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
  await page.goto(address+'/desktop');await page.locator('#restart').click();
  await page.waitForFunction(()=>document.querySelector('#engine-title')?.textContent==='捕获引擎已就绪',{},{timeout:60000});
  const currentAddress=new URL(page.url()).origin;
  assert.equal((await fetch(currentAddress+'/api/health',{headers:{'X-H2F-Token':credentials.credential}})).status,200);
  await page.screenshot({path:path.join(out,'windows-assistant.png'),fullPage:true});
  assert.deepEqual(failures,[]);
  await instance.close();instance=null;
  let stillRunning=true;try{await fetch(currentAddress+'/api/desktop/discovery',{signal:AbortSignal.timeout(1000)});}catch{stillRunning=false;}
  assert.equal(stillRunning,false);
  await writeFile(path.join(out,'native-validation.json'),JSON.stringify({version:pkg.version,validatedAt:new Date().toISOString(),platform:process.platform,
    installerInstalled:true,packagedAppLaunched:true,rendererNodeDisabled:true,pairingThroughNativeBridge:true,pluginExport:true,pluginIDPreserved:true,
    nativeWindowsPathCapture:true,ctrlWheel:true,spaceDrag:true,fitAndActualZoom:true,desktopDirectHandoff:true,
    receiver:'automated receiver; real Windows Figma not tested',trayCloseKeepsService:true,restartKeepsPairing:true,quitStopsService:true},null,2)+'\n');
  console.log('Installed Windows assistant end-to-end validation passed.');
} catch(error) {
  if(instance) { try { const page=await instance.firstWindow(); await page.screenshot({path:path.join(out,'windows-error.png'),fullPage:true}); console.error('Window URL:',page.url()); } catch {} }
  throw error;
} finally {if(instance)await instance.close().catch(()=>{});}

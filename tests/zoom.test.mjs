import test,{before,after}from'node:test';import assert from'node:assert/strict';import{createAppServer}from'../scripts/server.mjs';import{launchBrowser}from'../scripts/browser.mjs';
let browser;before(async()=>{browser=await launchBrowser();});after(async()=>{await browser?.close();});
test('remote preview supports fit, actual size, bounded zoom and scrolling without changing capture dimensions',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();
 try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#page-url').fill(app.address+'/source/dashboard.html');await page.locator('#prepare').click();await page.locator('#preview-zoom-controls').waitFor({state:'visible',timeout:20000});
  const dimensions=await page.locator('#remote-preview').evaluate(el=>({width:el.naturalWidth,height:el.naturalHeight,display:el.getBoundingClientRect().width}));assert.ok(dimensions.display<dimensions.width);
  await page.locator('#preview-zoom-actual').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'100%');assert.equal(await page.locator('#remote-preview').evaluate(el=>el.getBoundingClientRect().width),dimensions.width);
  assert.ok(await page.locator('#preview-stage').evaluate(el=>el.scrollWidth>el.clientWidth));await page.locator('#preview-stage').evaluate(el=>{el.scrollLeft=200;el.scrollTop=200;});assert.ok(await page.locator('#preview-stage').evaluate(el=>el.scrollLeft>0));
  await page.locator('#preview-zoom-in').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'125%');await page.locator('#preview-zoom-out').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'100%');
  for(let i=0;i<6;i++)if(await page.locator('#preview-zoom-in').isEnabled())await page.locator('#preview-zoom-in').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'400%');assert.equal(await page.locator('#preview-zoom-in').isDisabled(),true);
  await page.locator('#preview-zoom-fit').click();assert.equal(await page.locator('#preview-zoom-fit').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#preview-stage').evaluate(el=>el.scrollLeft),0);
  assert.ok((await page.locator('#report-summary').textContent()).includes('1440'));await page.locator('.preview-panel').screenshot({path:'artifacts/preview-zoom-ui.png'});
 }finally{await context.close();await app.close();}
});
test('static HTML iframe preview can zoom while keeping its layout viewport unchanged',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();
 try{await page.goto(app.address);await page.locator('#demo').click();await page.locator('#ready-actions').waitFor({state:'visible'});await page.locator('#preview-zoom-actual').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'100%');assert.equal(await page.locator('#frame-container iframe').evaluate(el=>el.contentWindow.innerWidth),1440);await page.locator('#preview-zoom-fit').click();assert.equal(await page.locator('#frame-container iframe').evaluate(el=>el.contentWindow.innerWidth),1440);}finally{await context.close();await app.close();}
});

test('captured backups restore all saved previews and keep screenshots out of Figma transfers',async()=>{
 const {BundleBuilder}=await import('../dist/lib/bundle.js');const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();
 try{
  const response=await fetch(app.address+'/api/capture',{method:'POST',headers:{'X-H2F-Token':app.token,'Content-Type':'application/json'},body:JSON.stringify({url:app.address+'/source/dashboard.html',width:800,height:700})});const capture=await response.json();const builder=new BundleBuilder('含预览的备份');for(let i=0;i<2;i++)builder.add({...capture.document,name:'备份页 '+(i+1)});const data={...builder.bundle,previewImages:[capture.preview,capture.preview]};
  await page.goto(app.address);await page.locator('#file-input').setInputFiles({name:'backup.h2f.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await page.locator('#preview-zoom-controls').waitFor({state:'visible'});
  await page.locator('#preview-page').selectOption('1');await page.waitForFunction(()=>document.querySelector('#remote-preview').dataset.pageIndex==='1'&&!document.querySelector('#remote-preview').hidden);assert.equal(await page.locator('#preview-size').textContent(),'2 / 2 页');await page.locator('#preview-zoom-actual').click();assert.equal(await page.locator('#preview-zoom-value').textContent(),'100%');
  const sentResponse=page.waitForResponse(r=>r.url().endsWith('/api/handoffs')&&r.request().method()==='POST');await page.locator('#send-handoff').click();const sent=await(await sentResponse).json();const received=await(await fetch(`${app.address}/api/handoffs/${sent.id}/claim`,{method:'POST',headers:{'X-H2F-Token':app.token,'Content-Type':'application/json'},body:JSON.stringify({receiverId:'11'.repeat(16)})})).json();assert.equal(received.bundle.pages.length,2);assert.equal('previewImages'in received.bundle,false);
 }finally{await context.close();await app.close();}
});

test('Cmd-wheel zooms around the pointer and Space-left-drag pans the preview',async()=>{
 const app=await createAppServer({port:0}),context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();
 try{
  await page.goto(app.address);await page.locator('#url-tab').click();await page.locator('#page-url').fill(app.address+'/source/dashboard.html');await page.locator('#prepare').click();await page.locator('#preview-zoom-controls').waitFor({state:'visible',timeout:20000});await page.locator('#preview-zoom-actual').click();
  const box=await page.locator('#preview-stage').boundingBox();await page.mouse.move(box.x+180,box.y+150);await page.keyboard.down('Meta');await page.mouse.wheel(0,-100);await page.keyboard.up('Meta');await page.waitForFunction(()=>parseInt(document.querySelector('#preview-zoom-value').textContent)>100);
  const before=await page.locator('#preview-stage').evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
  await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(box.x+80,box.y+80,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
  const after=await page.locator('#preview-stage').evaluate(el=>({left:el.scrollLeft,top:el.scrollTop,panning:el.classList.contains('panning'),ready:el.classList.contains('pan-ready')}));assert.ok(after.left>before.left+50);assert.ok(after.top>before.top+30);assert.equal(after.panning,false);assert.equal(after.ready,false);
  await page.locator('#page-url').focus();await page.keyboard.press('End');await page.keyboard.press('Space');assert.ok((await page.locator('#page-url').inputValue()).endsWith(' '));assert.equal(await page.locator('#preview-stage').evaluate(el=>el.classList.contains('pan-ready')),false);
 }finally{await context.close();await app.close();}
});

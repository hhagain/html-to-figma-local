import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {linearGradient} from '../dist/lib/gradient.js';
import {launchBrowser} from '../scripts/browser.mjs';
import {importDocument} from '../dist/lib/importer.js';
import {mockFigma} from './helpers.mjs';
const colors={red:{r:1,g:0,b:0,a:1},blue:{r:0,g:0,b:1,a:1},transparent:{r:0,g:0,b:0,a:0}};
const read=s=>colors[s]||null;
let browser;before(async()=>{browser=await launchBrowser();});after(async()=>{await browser?.close();});
test('pixel, percent, unitless zero and dual color stops are normalized without discarding colors',()=>{
 const g=linearGradient('linear-gradient(180deg, red 0, blue 180px, red 50% 380px, blue 520px)',300,800,read);
 assert.equal(g.type,'linear');assert.ok(g.stops.every(s=>s.color.a===1));assert.equal(g.stops[1].position,180/800);assert.equal(g.stops[2].position,.5);assert.equal(g.stops[3].position,.5);assert.equal(g.stops[4].position,520/800);
 assert.equal(linearGradient('linear-gradient(red 3em, blue)',300,800,read),null);
});
test('out-of-bounds stops interpolate at the visible edges and diagonal directions use the CSS box',()=>{
 const g=linearGradient('linear-gradient(to right, red -100px, blue 200px)',100,200,read);
 assert.equal(g.stops[0].position,0);assert.ok(Math.abs(g.stops[0].color.b-1/3)<1e-9);assert.equal(g.stops.at(-1).position,1);assert.ok(Math.abs(g.stops.at(-1).color.b-2/3)<1e-9);
 const diagonal=linearGradient('linear-gradient(to bottom right, red, blue)',100,200,read);assert.ok(Math.abs(diagonal.transform[0][0]-.5)<1e-9);assert.ok(Math.abs(diagonal.transform[0][1]-.5)<1e-9);
});
test('scaled mobile chrome preserves opaque blue pixel gradients from browser capture through the importer',async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.setContent('<html><body><div style="transform:scale(.5);transform-origin:top left"><div id="phone" style="width:400px;height:800px;background:linear-gradient(180deg,#0759b0 0px,#0b69c7 180px,#dceaf8 380px,#f5f7fb 520px)"><h1 style="color:white">白色标题</h1></div></div></body></html>');
  await page.addScriptTag({path:'dist/capture.js'});const d=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document,{selector:'#phone'}));
  const paint=d.root.fills.find(p=>p.type==='linear');assert.equal(d.root.height,400);assert.equal(paint.stops[1].position,180/800);assert.equal(paint.stops[0].color.a,1);assert.ok(paint.stops[0].color.b>.65);
  const mock=mockFigma();const result=await importDocument(mock.api,d,{mode:'visual'});const imported=mock.all.find(n=>n.id===result.nodeId);assert.deepEqual(imported.fills[0].gradientStops,paint.stops.map(s=>({position:s.position,color:{...s.color}})));
 }finally{await context.close();}
});

test('background-clip text remains editable gradient text without rectangular color blocks',async()=>{
 const context=await browser.newContext(),page=await context.newPage();try{
  await page.setContent('<html><body><div style="transform:scale(.8);transform-origin:top left"><span id="tab" style="font:20px/30px Arial;background:linear-gradient(#dceaff,#9ebfe8);background-clip:text;color:transparent">明细</span></div></body></html>');await page.addScriptTag({path:'dist/capture.js'});const d=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document,{selector:'#tab'}));
  assert.equal(d.root.fills.length,0);const t=d.root.children[0];assert.equal(t.kind,'text');assert.equal(t.text.size,16);assert.equal(t.text.lineHeight,24);assert.equal(t.fills[0].type,'linear');assert.ok(t.fills[0].stops.every(s=>s.color.a===1));const mock=mockFigma();await importDocument(mock.api,d,{mode:'visual'});assert.equal(mock.all.find(n=>n.type==='TEXT').fills[0].type,'GRADIENT_LINEAR');
 }finally{await context.close();}
});

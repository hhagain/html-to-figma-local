import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../scripts/browser.mjs';
import { importDocument } from '../dist/lib/importer.js';
import { mockFigma } from './helpers.mjs';
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
const flatten = n => [n, ...(n.children || []).flatMap(flatten)];
async function diff(page, a, b) {
  return page.evaluate(async ([a,b]) => {
    const pixels = await Promise.all([a,b].map(async data => { const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img,0,0); return ctx.getImageData(0,0,c.width,c.height).data; }));
    let changed=0; for(let i=0;i<pixels[0].length;i+=4)if([0,1,2,3].some(c=>Math.abs(pixels[0][i+c]-pixels[1][i+c])>24))changed++;
    return changed/(pixels[0].length/4);
  },[a.toString('base64'),b.toString('base64')]);
}
test('normalized SVG dashes preserve continuous and multicolor rings without relying on pathLength', async () => {
  const context=await browser.newContext(),page=await context.newPage();
  try {
    await page.setContent(await readFile('examples/svg-donut.html','utf8'));await page.addScriptTag({path:'dist/capture.js'});
    const before=await page.locator('#cards').screenshot(),doc=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document,{selector:'#cards'}));
    const rings=flatten(doc.root).filter(n=>n.kind==='svg');assert.equal(rings.length,2);
    assert.ok(rings.every(n=>!n.svg.includes('pathLength=')));
    const original=await page.locator('#ring79').innerHTML();
    // Emulate an SVG importer ignoring pathLength: this must reproduce a visible regression.
    await page.locator('#ring79 [pathLength]').evaluate(el=>el.removeAttribute('pathLength'));
    assert.ok(await diff(page,before,await page.locator('#cards').screenshot())>.003);
    await page.locator('#ring79').evaluate((el,html)=>el.innerHTML=html,original);
    for(const n of rings)await page.locator('#'+n.name).evaluate((el,svg)=>{el.outerHTML=svg;},n.svg);
    const ratio=await diff(page,before,await page.locator('#cards').screenshot());assert.ok(ratio<.003,`normalized ring pixel difference ${ratio}`);
    assert.ok(flatten(doc.root).filter(n=>n.name==='section.card').every(n=>n.effects.length===1));
    for(const mode of ['visual','auto']){const mock=mockFigma(),received=[],create=mock.api.createNodeFromSvg;mock.api.createNodeFromSvg=svg=>{received.push(svg);return create(svg);};await importDocument(mock.api,doc,{mode});assert.deepEqual(received,rings.map(n=>n.svg));}
  } finally { await context.close(); }
});
test('CSS dash offsets, percentage distances, paths and text remain present in serialized SVG',async()=>{
 const context=await browser.newContext(),page=await context.newPage();try{
  await page.setContent('<style>#p{stroke-dasharray:25px 100px;stroke-dashoffset:-20px}#q{stroke-dasharray:10% 20%;stroke-dashoffset:5%}</style><svg id="chart" width="200" height="100" viewBox="0 0 200 100"><path id="p" d="M0 10H200" pathLength="100" stroke="blue"/><path id="q" d="M0 20H200" pathLength="100" stroke="red"/><text x="20" y="70">占比</text></svg>');await page.addScriptTag({path:'dist/capture.js'});const d=await page.evaluate(()=>window.HTMLToFigma.captureDOM(document,{selector:'#chart'}));
  const attributes=await page.evaluate(svg=>{const d=new DOMParser().parseFromString(svg,'image/svg+xml');return [...d.querySelectorAll('path')].map(el=>({dash:el.getAttribute('stroke-dasharray'),offset:el.getAttribute('stroke-dashoffset')}));},d.root.svg);
  assert.deepEqual(attributes,[{dash:'50 200',offset:'-40'},{dash:'10% 20%',offset:'5%'}]);assert.ok(d.root.svg.includes('占比'));assert.equal(d.diagnostics.length,0);
 }finally{await context.close();}
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../scripts/browser.mjs';
import { importDocument } from '../dist/lib/importer.js';
import { validateDocument } from '../dist/lib/schema.js';
import { figmaWithLayout } from './layout-figma.mjs';
import { createPluginTestHost } from './plugin-test-host.mjs';
let browser;
before(async () => { browser = await launchBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); });
const flatten = n => [n, ...(n.children || []).flatMap(flatten)];
const rect = n => [n.x,n.y,n.width,n.height];
// Compare painted bounds with the browser's used values: platforms may snap fractional offsets.
const strokeOutset = (align,width) => ({ INSIDE:0, CENTER:.5, OUTSIDE:1 }[align])*width;
const readOutline = el => { const s=getComputedStyle(el);return {width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),boxWidth:el.getBoundingClientRect().width}; };
async function capture(page, html, selector) {
  await page.setContent(html); await page.addScriptTag({ path: 'dist/capture.js' });
  return page.evaluate(selector => window.HTMLToFigma.captureDOM(document, { selector }), selector);
}

test('outline-only field and cancel button retain their strokes and geometry in visual and Auto Layout modes', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    const doc = await capture(page, await readFile('examples/outline-form.html','utf8'), '#dialog');
    const field = flatten(doc.root).find(n => n.name === 'field');
    const css = await page.locator('#field').evaluate(readOutline);
    assert.deepEqual(field.border.color, {r:229/255,g:234/255,b:240/255,a:1});assert.deepEqual(field.border.widths,[1,1,1,1]);
    assert.ok(Math.abs(strokeOutset(field.border.align,field.border.widths[0])-(css.width+css.offset))<.01);
    const cancelSource=flatten(doc.root).find(n=>n.name==='cancel');
    assert.equal(field.width,318); assert.equal(field.height,48); assert.deepEqual(field.radius,[12,12,12,12]);
    const restored = JSON.parse(JSON.stringify(doc)); validateDocument(restored);
    for (const mode of ['visual','auto']) {
      const mock = figmaWithLayout(); const result = await importDocument(mock.api,restored,{mode});
      const imported = mock.all.find(n => n.name === 'field'), cancel = mock.all.find(n => n.name === 'cancel');
      assert.deepEqual(rect(imported),rect(field)); assert.equal(imported.strokeAlign,field.border.align);
      assert.equal(imported.strokeTopWeight,1); assert.equal(imported.strokes[0].color.r,229/255);
      assert.equal(imported.topLeftRadius,12); assert.equal(cancel.strokeAlign,cancelSource.border.align); assert.equal(cancel.strokeTopWeight,1);
      assert.equal(cancel.strokes[0].color.b,242/255); assert.equal(imported.children[0].x,16); assert.equal(imported.children[0].y,13.5);
      if (mode === 'auto') {
        assert.ok(result.autoLayouts > 0); assert.equal(imported.layoutMode,'VERTICAL');
        assert.equal(imported.strokesIncludedInLayout,false); assert.equal(cancel.strokesIncludedInLayout,false);
      } else assert.equal(imported.layoutMode,'NONE');
    }
  } finally { await context.close(); }
});

test('CSS outline offsets map to native stroke alignments without changing layout boxes, including scaling', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    const html='<div id="root"><div id="outside" style="width:100px;height:40px;outline:2px solid #1175f2"></div><div id="inside" style="width:100px;height:40px;outline:2px solid #1175f2;outline-offset:-2px"></div><div style="transform:scale(.5);transform-origin:top left"><div id="scaled" style="width:100px;height:40px;outline:2px solid #1175f2;outline-offset:-1px"></div></div></div>';
    const doc = await capture(page,html,'#root'), nodes=flatten(doc.root);
    assert.equal(nodes.find(n=>n.name==='outside').border.align,'OUTSIDE'); assert.equal(nodes.find(n=>n.name==='inside').border.align,'INSIDE');
    const scaled = nodes.find(n=>n.name==='scaled'); assert.equal(scaled.border.align,'CENTER'); assert.deepEqual(scaled.border.widths,[1,1,1,1]); assert.equal(scaled.width,50); assert.equal(scaled.height,20);
    const mock=figmaWithLayout();await importDocument(mock.api,doc,{mode:'auto'});
    for(const name of ['outside','inside','scaled']){const source=nodes.find(n=>n.name===name),n=mock.all.find(n=>n.name===name);assert.equal(n.strokeAlign,source.border.align);assert.deepEqual(rect(n),rect(source));}
  } finally { await context.close(); }
});

test('arbitrary outline offsets and coexisting borders preserve both paints outside Auto Layout flow', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    const doc=await capture(page,'<div id="root"><div id="offset" style="display:flex;width:100px;height:40px;outline:2px solid blue;outline-offset:4px"><span>text</span></div><div id="both" style="width:100px;height:40px;border:2px solid red;outline:2px solid blue"></div><div id="clipped" style="width:100px;height:40px;border:2px solid red;outline:2px solid blue;overflow:hidden"></div></div>','#root');
    const nodes=flatten(doc.root),offset=nodes.find(n=>n.name==='offset'),both=nodes.find(n=>n.name==='both');
    const ring=offset.children.find(n=>n.name==='CSS outline / offset');assert.ok(ring);assert.deepEqual([ring.x,ring.y,ring.width,ring.height],[-4,-4,108,48]);assert.equal(ring.border.align,'OUTSIDE');assert.equal(offset.layout.eligible,false);
    assert.equal(both.border.color.r,1);assert.equal(both.border.color.b,0);assert.equal(both.children.find(n=>n.name==='CSS outline / both').border.color.b,1);
    assert.equal(doc.diagnostics.filter(w=>w.code==='OUTLINE_UNSUPPORTED').reduce((n,w)=>n+(w.count||1),0),1);
    const mock=figmaWithLayout();await importDocument(mock.api,doc,{mode:'auto'});assert.equal(mock.all.find(n=>n.name==='offset').layoutMode,'NONE');assert.equal(mock.all.find(n=>n.name==='CSS outline / offset').strokeAlign,'OUTSIDE');
  } finally { await context.close(); }
});

test('legacy border data remains valid and invalid stroke alignments are rejected', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    const doc=await capture(page,'<div id="field" style="width:100px;height:40px;border:1px solid red"></div>','#field');
    assert.equal(doc.root.border.align,undefined);validateDocument(doc);
    doc.root.border.align='AROUND';assert.throws(()=>validateDocument(doc),/边框无效/);
  } finally { await context.close(); }
});

test('compiled plugin UI sends outline geometry through an Auto Layout import', async () => {
  const env=await createPluginTestHost(browser,figmaWithLayout());
  try {
    await env.ui.locator('#file-input').setInputFiles('examples/outline-form.html');await env.ui.locator('input[name=mode][value=auto]').check();
    await env.ui.locator('#prepare').click();await env.ui.locator('#ready-actions').waitFor({state:'visible'});
    await env.ui.locator('#import').click();await env.ui.locator('#report-title').filter({hasText:'已导入 Figma'}).waitFor({timeout:30000});
    const sourceFrame=await(await env.ui.locator('#capture-host iframe').elementHandle()).contentFrame();const css=await sourceFrame.locator('#field').evaluate(readOutline);
    const field=env.mock.all.find(n=>n.name==='field');assert.ok(field);assert.ok(Math.abs(strokeOutset(field.strokeAlign,field.strokeTopWeight)-(css.width+css.offset))<.01);assert.equal(field.strokeTopWeight,1);assert.equal(field.width,318);assert.equal(field.height,48);assert.equal(field.layoutMode,'VERTICAL');assert.deepEqual(env.errors,[]);
  } finally { await env.close(); }
});


test('fractional outline painted bounds match browser used values at 1x and 2x display scale', async () => {
  for (const deviceScaleFactor of [1,2]) {
    const context=await browser.newContext({deviceScaleFactor}),page=await context.newPage();
    try {
      const doc=await capture(page,'<div id="field" style="width:100px;height:40px;background:white;outline:1.5px solid blue;outline-offset:-.75px"></div>','#field');
      const css=await page.locator('#field').evaluate(readOutline),paint=doc.root.border?doc.root:doc.root.children.find(n=>n.name==='CSS outline / field');assert.ok(paint);
      const outset=strokeOutset(paint.border.align,paint.border.widths[0]);
      assert.ok(Math.abs((paint.x-outset)-(-css.width-css.offset))<.01);
      assert.ok(Math.abs((paint.x+paint.width+outset)-(css.boxWidth+css.width+css.offset))<.01);
    } finally {await context.close();}
  }
});

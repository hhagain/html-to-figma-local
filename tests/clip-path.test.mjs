import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../scripts/browser.mjs';
import { importDocument } from '../dist/lib/importer.js';
import { mockFigma } from './helpers.mjs';
let browser;
before(async () => { browser = await launchBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); });
const flatten = n => [n, ...(n.children || []).flatMap(flatten)];
async function rasterDiff(page, before, after) {
  return page.evaluate(async ([a, b]) => {
    const load = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `data:image/png;base64,${src}`; });
    const images = await Promise.all([load(a), load(b)]);
    const pixels = images.map(image => { const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, c.width, c.height).data; });
    let changed = 0, maxDelta = 0;
    for (let i = 0; i < pixels[0].length; i += 4) {
      const d = Math.max(...[0,1,2,3].map(c => Math.abs(pixels[0][i+c] - pixels[1][i+c])));
      if (d > 24) changed++; maxDelta = Math.max(maxDelta, d);
    }
    return { changed, ratio: changed / (pixels[0].length / 4), maxDelta };
  }, [before.toString('base64'), after.toString('base64')]);
}

test('solid CSS path countdowns become hollow editable SVGs with their center numbers intact', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.setContent(await readFile('examples/clip-path-icons.html', 'utf8')); await page.addScriptTag({ path: 'dist/capture.js' });
    const original = await page.locator('#icons').screenshot();
    const d = await page.evaluate(() => window.HTMLToFigma.captureDOM(document, { selector: '#icons' }));
    const nodes = flatten(d.root), paths = nodes.filter(n => /^(track|arc)-/.test(n.name));
    assert.equal(paths.length, 8); assert.equal(d.stats.vectors, 8);
    assert.ok(paths.every(n => n.kind === 'svg' && n.fills.length === 0 && n.width === 36 && n.height === 36));
    assert.equal(nodes.filter(n => n.kind === 'text' && ['22','04'].includes(n.text.value)).length, 4);
    assert.ok(!d.diagnostics.some(w => w.code === 'CLIP_PATH_UNSUPPORTED' || w.code === 'VISUAL_EFFECT'));
    // Render the exact SVG data handed to Figma in place of the original clipped divs.
    await page.evaluate(paths => { for (const n of paths) { const el = document.getElementById(n.name); el.style.clipPath = 'none'; el.style.background = 'none'; el.innerHTML = n.svg; } }, paths);
    const diff = await rasterDiff(page, original, await page.locator('#icons').screenshot());
    assert.ok(diff.ratio < .01, `CSS path/SVG pixel difference: ${JSON.stringify(diff)}`);
    const mock = mockFigma(), received = [], create = mock.api.createNodeFromSvg;
    mock.api.createNodeFromSvg = svg => { received.push(svg); const n = create(svg); n.resize(36,36); return n; };
    await importDocument(mock.api, d, { mode: 'visual' });
    assert.equal(received.length, 8); assert.deepEqual(received, paths.map(n => n.svg));
    assert.ok(mock.all.filter(n => /^(track|arc)-/.test(n.name)).every(n => n.fills.length === 0 && n.children.length === 1));
    assert.equal(mock.all.filter(n => n.type === 'TEXT').length, 4);
  } finally { await context.close(); }
});

test('path fill rules preserve holes, translucent color and non-square layout coordinates', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.setContent(`<div id="shape" style="width:40px;height:20px;background:rgba(12,34,56,.4);opacity:.6;clip-path:path(evenodd,'M0 0H40V20H0Z M10 5H30V15H10Z')"></div>`);
    await page.addScriptTag({ path: 'dist/capture.js' });
    const d = await page.evaluate(() => window.HTMLToFigma.captureDOM(document, { selector: '#shape' }));
    assert.equal(d.root.kind, 'svg'); assert.equal(d.root.opacity, .6); assert.equal(d.root.fills.length, 0);
    assert.match(d.root.svg, /fill-rule="evenodd"/); assert.match(d.root.svg, /viewBox="0 0 40 20"/);
    const pixels = await page.evaluate(async svg => {
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20; const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
      return { hole: [...ctx.getImageData(20,10,1,1).data], ink: [...ctx.getImageData(2,2,1,1).data] };
    }, d.root.svg);
    assert.equal(pixels.hole[3], 0); assert.ok(Math.abs(pixels.ink[3] - 102) <= 1);
  } finally { await context.close(); }
});

test('scaled paths use their original CSS pixel coordinate system', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.setContent(`<div style="transform:scale(.5);transform-origin:top left"><div id="shape" style="width:36px;height:36px;background:#1175f2;clip-path:path('M18 0A18 18 0 1 1 18 36A18 18 0 1 1 18 0Z')"></div></div>`);
    await page.addScriptTag({ path: 'dist/capture.js' }); const d = await page.evaluate(() => window.HTMLToFigma.captureDOM(document, { selector: '#shape' }));
    assert.equal(d.root.kind, 'svg'); assert.equal(d.root.width, 18); assert.equal(d.root.height, 18);
    assert.match(d.root.svg, /width="18" height="18" viewBox="0 0 36 36"/);
  } finally { await context.close(); }
});

test('unsupported clip shapes and clipped containers still preserve content and report their limits', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.setContent(`<div id="root"><div style="width:36px;height:36px;background:red;clip-path:circle(50%)"></div><div style="width:100px;height:40px;background:red;clip-path:path('M0 0H100V40H0Z')">仍需保留的文字</div></div>`);
    await page.addScriptTag({ path: 'dist/capture.js' }); const d = await page.evaluate(() => window.HTMLToFigma.captureDOM(document, { selector: '#root' }));
    assert.ok(flatten(d.root).map(n => n.text?.value || '').join('').includes('仍需保留的文字'));
    assert.equal(d.diagnostics.filter(w => w.code === 'CLIP_PATH_UNSUPPORTED').reduce((sum,w) => sum + (w.count || 1),0), 2);
  } finally { await context.close(); }
});


test('clipped replaced elements retain their own image content instead of becoming a background-only vector', async () => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.setContent(`<img id="image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" style="width:36px;height:36px;background:red;clip-path:path('M0 0H36V36H0Z')">`);
    await page.addScriptTag({ path: 'dist/capture.js' }); const d = await page.evaluate(() => window.HTMLToFigma.captureDOM(document, { selector: '#image' }));
    assert.equal(d.root.kind, 'frame'); assert.ok(d.root.fills.some(p => p.type === 'image'));
    assert.ok(d.diagnostics.some(w => w.code === 'CLIP_PATH_UNSUPPORTED'));
  } finally { await context.close(); }
});

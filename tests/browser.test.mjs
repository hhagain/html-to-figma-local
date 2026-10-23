import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { createAppServer } from '../scripts/server.mjs';
import { launchBrowser, captureURL } from '../scripts/browser.mjs';
import { validateDocument } from '../dist/lib/schema.js';
import { isBundle, validateBundle, hydratePage } from '../dist/lib/bundle.js';
let app, browser;
before(async () => { app = await createAppServer({ port: 0 }); browser = await launchBrowser(); await mkdir('artifacts', { recursive: true }); }, { timeout: 30000 });
after(async () => { await browser?.close(); await app?.close(); });
const flatten = root => [root, ...(root.children || []).flatMap(flatten)];
test('desktop capture preserves real dimensions, CJK, raster images, SVG and gradients', async () => {
  const result = await captureURL(browser, { url: `${app.address}/source/dashboard.html`, width: 1440 });
  const d = result.document; validateDocument(d); const nodes = flatten(d.root);
  assert.equal(d.root.width, 1440); assert.notEqual(d.root.height, 1080); assert.ok(d.stats.texts > 20); assert.equal(d.stats.vectors, 2); assert.equal(d.stats.images, 1); assert.equal(d.stats.missingAssets, 0);
  assert.ok(nodes.some(n => n.text?.value.includes('把灵感'))); assert.ok(nodes.some(n => n.fills.some(p => p.type === 'linear'))); assert.ok(d.assets.every(a => a.base64));
  assert.ok(nodes.filter(n => n.kind === 'text').every(n => n.width > 0 && n.height > 0));
  await writeFile('artifacts/dashboard-desktop.h2f.json', JSON.stringify(d, null, 2)); await writeFile('artifacts/dashboard-desktop.jpg', Buffer.from(result.preview.split(',')[1], 'base64'));
});
test('mobile viewport changes wrapping and keeps all text within the screen', async () => {
  const result = await captureURL(browser, { url: `${app.address}/source/dashboard.html`, width: 390 }); const d = result.document; validateDocument(d);
  assert.equal(d.root.width, 390); assert.ok(d.root.height > 1000);
  const nodes = flatten(d.root); assert.ok(nodes.map(n => n.text?.value || '').join('').includes('工作方式'));
  const checkBounds = (n, parentX = 0) => { const x = parentX + n.x; if (n.kind === 'text') assert.ok(x >= -1 && x + n.width <= 391, `Text outside mobile viewport: ${n.text.value}`); n.children?.forEach(c => checkBounds(c, x)); }; checkBounds(d.root);
  await writeFile('artifacts/dashboard-mobile.h2f.json', JSON.stringify(d, null, 2)); await writeFile('artifacts/dashboard-mobile.jpg', Buffer.from(result.preview.split(',')[1], 'base64'));
});
test('selected region captures only the intended DOM subtree', async () => {
  const { document: d } = await captureURL(browser, { url: `${app.address}/source/dashboard.html`, width: 1440, selector: '.metrics' });
  assert.equal(d.root.x, 0); assert.equal(d.root.y, 0); assert.equal(d.stats.images, 0); assert.equal(d.stats.vectors, 0); assert.ok(flatten(d.root).some(n => n.text?.value.includes('128.5'))); assert.ok(!flatten(d.root).some(n => n.text?.value.includes('工作台')));
});
test('URL capture executes dynamic content in an isolated browser', async () => {
  const pageHTML = '<!doctype html><html><head><meta charset="UTF-8"></head><body><h1 id="x">Loading</h1><script>document.getElementById("x").textContent="动态内容已就绪"</script></body></html>';
  const context = await browser.newContext(); const page = await context.newPage(); await page.route('http://capture.test/', route => route.fulfill({ contentType: 'text/html', body: pageHTML }));
  await page.goto('http://capture.test/'); await page.addScriptTag({ path: 'dist/capture.js' }); const d = await page.evaluate(() => window.HTMLToFigma.captureDOM()); assert.ok(flatten(d.root).some(n => n.text?.value.includes('动态内容已就绪'))); await context.close();
});
test('local API requires a token and rejects non-HTTP URLs and unsafe paths', async () => {
  assert.equal((await fetch(`${app.address}/api/health`)).status, 401);
  assert.equal((await fetch(`${app.address}/api/health`, { headers: { 'X-H2F-Token': app.token } })).status, 200);
  const invalid = await fetch(`${app.address}/api/capture`, { method: 'POST', headers: { 'X-H2F-Token': app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'file:///etc/passwd' }) }); assert.equal(invalid.status, 400);
  const traversal = await fetch(`${app.address}/source/%2e%2e%2fpackage.json`); assert.ok([403, 404].includes(traversal.status));
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(`${app.address}/api/health`, { headers: { Host: 'untrusted.example', 'X-H2F-Token': app.token } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); }); assert.equal(hostStatus, 403);
});
test('browser UI previews and exports sample, then invalidates stale data on edits', async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1050 }, acceptDownloads: true }); const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(app.address); await page.locator('#demo').click(); await page.locator('#ready-actions').waitFor({ state: 'visible', timeout: 20000 });
  assert.ok(Number(await page.locator('#stat-text').textContent()) > 20); assert.ok((await page.locator('#status').textContent()).includes('下载'));
  const downloadPromise = page.waitForEvent('download'); await page.locator('#import').click(); const download = await downloadPromise; assert.ok(download.suggestedFilename().endsWith('.h2f.json'));
  await page.screenshot({ path: 'artifacts/capture-studio-desktop.png', fullPage: true });
  await page.evaluate(() => document.body.classList.add('is-plugin')); await page.setViewportSize({ width: 440, height: 720 });
  await page.screenshot({ path: 'artifacts/plugin-panel.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const action = await page.locator('#import').boundingBox(); assert.ok(action.y + action.height <= 720);
  await page.evaluate(() => document.body.classList.remove('is-plugin')); await page.setViewportSize({ width: 1360, height: 1050 });
  await page.locator('#selector').fill('.missing'); assert.equal(await page.locator('#ready-actions').isVisible(), false);
  await page.locator('#prepare').click(); await page.waitForFunction(() => document.querySelector('#status').classList.contains('error')); assert.ok((await page.locator('#status').textContent()).includes('没有找到'));
  assert.deepEqual(errors, []); await context.close();
});
test('pasted HTML cannot execute scripts or event handlers in preview', async () => {
  const context = await browser.newContext({ viewport: { width: 440, height: 900 } }); const page = await context.newPage(); await page.goto(app.address);
  await page.locator('#code-tab').click();
  await page.locator('#html-code').fill('<html><body><h1>安全预览</h1><script>parent.document.body.dataset.pwned="yes"</script><img src="bad.png" onerror="parent.document.body.dataset.pwned=\'yes\'"></body></html>');
  await page.locator('#prepare').click(); await page.locator('#ready-actions').waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await page.locator('body').getAttribute('data-pwned'), null); assert.ok((await page.locator('#stat-text').textContent()) !== '0');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'artifacts/capture-studio-mobile.png', fullPage: true }); await context.close();
});
test('authenticated URL endpoint returns a valid portable capture', async () => {
  const response = await fetch(`${app.address}/api/capture`, { method: 'POST', headers: { 'X-H2F-Token': app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `${app.address}/source/dashboard.html`, width: 390, selector: '.metrics' }) });
  assert.equal(response.status, 200); const data = await response.json(); validateDocument(data.document); assert.ok(data.preview.startsWith('data:image/jpeg;base64,')); assert.ok(data.document.stats.texts > 5);
});
test('CSS SVG images are embedded as Figma-compatible bitmaps', async () => {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.setContent('<html><body><div style="width:100px;height:100px;background-image:url(\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22red%22/%3E%3C/svg%3E\')"></div></body></html>');
  await page.addScriptTag({ path: 'dist/capture.js' }); const data = await page.evaluate(async () => window.HTMLToFigma.embedBrowserAssets(await window.HTMLToFigma.captureDOM()));
  validateDocument(data); assert.equal(data.assets.length, 1); assert.equal(data.assets[0].mime, 'image/png'); assert.equal(data.stats.missingAssets, 0); await context.close();
});
test('Tailwind CDN HTML compiles offline with literal config, arbitrary values and apply', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, acceptDownloads: true }); const page = await context.newPage();
  const errors = [], external = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', req => { if (req.url().includes('cdn.tailwindcss.com')) external.push(req.url()); });
  await page.goto(app.address); await page.locator('#file-input').setInputFiles('examples/tailwind-export.html'); await page.locator('#prepare').click();
  await page.locator('#ready-actions').waitFor({ state: 'visible', timeout: 20000 });
  const metrics = await page.frameLocator('#frame-container iframe').locator('[data-pencil-name="账号登录"]').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, background: getComputedStyle(el).backgroundImage }));
  assert.equal(metrics.width, 390); assert.equal(metrics.height, 844); assert.ok(metrics.background.includes('linear-gradient'));
  assert.equal(await page.frameLocator('#frame-container iframe').locator('button').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(98, 80, 245)');
  assert.equal(await page.frameLocator('#frame-container iframe').locator('.status-pill').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(98, 80, 245)');
  const event = page.waitForEvent('download'); await page.locator('#import').click(); const download = await event;
  const { readFile } = await import('node:fs/promises'); const data = JSON.parse(await readFile(await download.path(), 'utf8')); validateBundle(data); assert.equal(data.pages.length, 2);
  const firstPage = hydratePage(data, 0);
  assert.ok(flatten(firstPage.root).some(n => n.name === '账号登录' && n.width === 390 && n.height === 844));
  assert.ok(!data.pages.some(p => p.diagnostics.some(d => d.code === 'SCRIPTS_DISABLED'))); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  await context.close();
});
test('Tailwind config expressions are never executed', async () => {
  const context = await browser.newContext(); const page = await context.newPage(); await page.goto(app.address); await page.locator('#code-tab').click();
  await page.locator('#html-code').fill('<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config = { theme: { colors: (() => { parent.document.body.dataset.pwned="yes";return {}; })() } };</script><div class="w-[390px]">内容</div>');
  await page.locator('#prepare').click(); await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
  assert.equal(await page.locator('body').getAttribute('data-pwned'), null); assert.ok((await page.locator('#status').textContent()).includes('动态 JavaScript')); assert.equal(await page.locator('#ready-actions').isVisible(), false);
  await context.close();
});
test('Figma desktop bridge completion with a null source updates plugin UI', async () => {
  const { readFile } = await import('node:fs/promises'); const html = await readFile('dist/ui.html', 'utf8');
  const context = await browser.newContext(); const page = await context.newPage();
  await page.setContent('<iframe id="plugin" style="width:440px;height:720px"></iframe>');
  await page.locator('#plugin').evaluate((el, source) => { el.srcdoc = source; }, html);
  const ui = page.frameLocator('#plugin'); await ui.locator('#demo').click(); await ui.locator('#ready-actions').waitFor({ state: 'visible', timeout: 20000 });
  await ui.locator('#import').click(); assert.equal(await ui.locator('#import').isEnabled(), false);
  await page.frames()[1].evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: null, data: { pluginMessage: { type: 'COMPLETE', result: { nodes: 106, autoLayouts: 0, diagnostics: [] } } } })));
  assert.equal(await ui.locator('#report-title').textContent(), '已导入 Figma'); assert.equal(await ui.locator('#import').isEnabled(), true);
  await context.close();
});
test('200-page HTML captures beyond 6000 total nodes without truncation', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true }); const page = await context.newPage();
  await page.goto(app.address); await page.locator('#file-input').setInputFiles('examples/multi-page-200.html'); await page.locator('#prepare').click();
  await page.locator('#ready-actions').waitFor({ state: 'visible', timeout: 45000 });
  assert.equal(await page.locator('.page-row').count(), 200); assert.ok(Number(await page.locator('#stat-nodes').textContent()) > 6000);
  const next = page.waitForEvent('download'); await page.locator('#import').click(); const dl = await next; const { readFile } = await import('node:fs/promises');
  const bundle = JSON.parse(await readFile(await dl.path(), 'utf8')); validateBundle(bundle); assert.equal(bundle.pages.length, 200); assert.equal(bundle.assets.length, 1); assert.equal(bundle.errors.length, 0);
  await writeFile('artifacts/200-pages.h2f.json', JSON.stringify(bundle)); await page.screenshot({ path: 'artifacts/200-pages-workbench.png', fullPage: true }); await context.close();
});
test('multiple HTML files are captured independently in one batch', async () => {
  const context = await browser.newContext(); const page = await context.newPage(); await page.goto(app.address);
  await page.locator('#file-input').setInputFiles(['examples/dashboard.html', 'examples/tailwind-export.html']); await page.locator('#prepare').click(); await page.locator('#ready-actions').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('.page-row').count(), 3); assert.ok((await page.locator('#page-list-title').textContent()).includes('3 / 3')); await context.close();
});
test('auto-layout regression captures fixed buttons, bottom footer and centered modal', async () => {
  const { document: d } = await captureURL(browser, { url: `${app.address}/source/auto-layout-regression.html`, width: 1000 }); const nodes = flatten(d.root);
  const button = nodes.find(n => n.name === '主按钮 · 52px'); assert.equal(button.height, 52); assert.equal(button.layout.eligible, true);
  const footer = nodes.find(n => n.name === '底部操作 · 64px'); assert.equal(footer.y, 756); assert.equal(footer.height, 64);
  const modal = nodes.find(n => n.name === '弹窗 · 342×220'); assert.equal(modal.x, 24); assert.equal(modal.y, 312); assert.equal(modal.height, 220);
  await writeFile('artifacts/auto-layout-regression.h2f.json', JSON.stringify(d, null, 2));
});

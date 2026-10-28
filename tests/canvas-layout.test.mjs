import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../scripts/browser.mjs';
import { validateBundle } from '../dist/lib/bundle.js';
import { createPluginTestHost } from './plugin-test-host.mjs';
let browser;
before(async () => { browser = await launchBrowser(); }, { timeout: 30000 });
after(async () => { await browser?.close(); });
const expected = [[0,420,390,844],[0,1400,390,52],[0,0,600,300],[450,420,390,844],[0,1480,390,148],[800,0,900,300],[0,1800,1800,200],[0,0,160,40]];
async function prepare(env, files = ['examples/design-canvas.html']) {
  await env.ui.locator('#file-input').setInputFiles(files); await env.ui.locator('#prepare').click();
  await env.ui.locator('#ready-actions').waitFor({ state: 'visible', timeout: 30000 });
}
async function importPages(env) {
  await env.ui.locator('#import').click();
  await env.ui.locator('#report-title').filter({ hasText: '多页导入完成' }).waitFor({ timeout: 30000 });
  assert.equal(env.result.failed, 0); assert.deepEqual(env.errors, []);
}

test('split design exports keep original canvas coordinates through capture, JSON and the compiled plugin', async () => {
  const env = await createPluginTestHost(browser);
  try {
    await prepare(env); assert.equal(await env.ui.locator('.page-row').count(), 8);
    assert.match(await env.ui.locator('#report-summary').textContent(), /保留原画布排布/);
    const bundle = await env.download(); validateBundle(bundle);
    assert.equal(new Set(bundle.pages.map(p => p.source.canvas.id)).size, 1);
    assert.ok(bundle.pages.every(p => p.source.canvas.width === 1800 && p.source.canvas.height === 2400));
    assert.deepEqual(bundle.pages.map(p => [p.source.canvas.x, p.source.canvas.y, p.root.width, p.root.height]), expected);
    await importPages(env); assert.equal(env.result.completed, 8);
    assert.deepEqual(env.mock.page.children.map(n => [n.x - 400, n.y - 400, n.width, n.height]), expected);
    assert.deepEqual(env.messages.find(m => m.type === 'BATCH_START').plan.map(p => [p.canvas.x, p.canvas.y, p.width, p.height]), expected);
  } finally { await env.close(); }
});

test('selected canvas objects keep their spacing and original overlaps after backup restore', async () => {
  const env = await createPluginTestHost(browser);
  try {
    await prepare(env); const bundle = await env.download();
    await env.ui.locator('#file-input').setInputFiles({ name: 'canvas.h2f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
    await env.ui.locator('#ready-actions').waitFor({ state: 'visible' });
    // Skip the first two objects and another phone; annotations and the overlapping source objects remain.
    for (const i of [0, 1, 3]) await env.ui.locator('.page-row input[type=checkbox]').nth(i).uncheck();
    await importPages(env); assert.equal(env.result.completed, 5);
    assert.deepEqual(env.mock.page.children.map(n => [n.x - 400, n.y - 400, n.width, n.height]), [2,4,5,6,7].map(i => expected[i]));
  } finally { await env.close(); }
});

test('two HTML files with the same internal names retain separate canvas groups', async () => {
  const env = await createPluginTestHost(browser);
  try {
    const bytes = await readFile('examples/design-canvas.html');
    await prepare(env, ['one.html', 'two.html'].map(name => ({ name, mimeType: 'text/html', buffer: bytes })));
    const bundle = await env.download(); assert.equal(bundle.pages.length, 16);
    assert.equal(new Set(bundle.pages.map(p => p.source.canvas.id)).size, 2);
    await importPages(env); assert.equal(env.result.completed, 16);
    const nodes = env.mock.page.children;
    assert.equal(nodes[8].x - nodes[0].x, 1920); assert.equal(nodes[8].y, nodes[0].y);
    assert.deepEqual(nodes.slice(8).map(n => [n.x - 2320, n.y - 400, n.width, n.height]), expected);
  } finally { await env.close(); }
});

test('ordinary flow pages remain independent and keep automatic grid arrangement', async () => {
  const env = await createPluginTestHost(browser);
  try {
    const html = '<html><head><style>body{margin:0}.page{width:390px;height:844px}</style></head><body><section class="page">One</section><section class="page">Two</section></body></html>';
    await prepare(env, [{ name: 'flow.html', mimeType: 'text/html', buffer: Buffer.from(html) }]);
    const bundle = await env.download(); assert.ok(bundle.pages.every(p => p.source.canvas === undefined));
    await importPages(env); assert.deepEqual(env.mock.page.children.map(n => [n.x, n.y]), [[400,400],[910,400]]);
  } finally { await env.close(); }
});

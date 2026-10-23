import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateCaptureURL, openCaptureSource, resolveStateURL } from '../scripts/capture-source.mjs';
import { launchBrowser, captureURL } from '../scripts/browser.mjs';
import { captureStates, validateStatePlan } from '../scripts/state-capture.mjs';
import { createAppServer } from '../scripts/server.mjs';
import { hydratePage } from '../dist/lib/bundle.js';

let temp, root, entry, url, browser;
const flat = n => [n, ...(n.children || []).flatMap(flat)];
const recipe = states => ({ schemaVersion: 1, name: '本地交互页面', url, snapshotDocument: true, viewport: { width: 900, height: 700 }, states });
before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'h2f-local-'));
  root = path.join(temp, 'Open Design 项目 #100%'); await mkdir(root);
  entry = path.join(root, 'index page.html');
  await writeFile(entry, `<!doctype html><html><head><meta charset="utf-8"><title>本地页面</title><link rel="stylesheet" href="/style.css"></head><body><div class="card"><h1 id="title">Loading</h1><img src="./picture.svg" width="48" height="48"><button id="detail">详情</button><p id="output"></p><p id="count"></p></div><script type="module" src="./app.js"></script></body></html>`);
  await writeFile(path.join(root, 'style.css'), '.card{width:500px;padding:20px;background:rgb(240,245,250)}h1{font-size:26px;color:rgb(20,40,80)}');
  await writeFile(path.join(root, 'message.js'), `export const message = '本地模块已加载';`);
  await writeFile(path.join(root, 'app.js'), `import {message} from './message.js'; const data=await (await fetch('./data.json')).json(); document.querySelector('#title').textContent=message+' '+location.hash+' '+new URLSearchParams(location.search).get('mode')+' '+data.name; document.querySelector('#count').textContent=String(Number(localStorage.getItem('count')||0)); document.querySelector('#detail').onclick=()=>{location.hash='/details';document.querySelector('#output').textContent='详情弹窗已打开';localStorage.setItem('count','1');};`);
  await writeFile(path.join(root, 'data.json'), '{"name":"相对数据已加载"}');
  await writeFile(path.join(root, 'picture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#16a2d6"/></svg>');
  await writeFile(path.join(temp, 'outside.html'), 'secret outside root');
  await symlink(path.join(temp, 'outside.html'), path.join(root, 'escape.html'));
  await mkdir(path.join(root, '.private')); await writeFile(path.join(root, '.private', 'config.json'), '{"secret":true}');
  await symlink(path.join(root, '.private', 'config.json'), path.join(root, 'hidden.json'));
  url = pathToFileURL(entry).href + '?mode=local#/dashboard';
  browser = await launchBrowser();
}, { timeout: 30000 });
after(async () => { await browser?.close(); await rm(temp, { recursive: true, force: true }); });

test('local URL parsing preserves encoded filenames, query and hash; rejects invalid file inputs', async () => {
  assert.equal(validateCaptureURL(url).href, url);
  for (const value of ['file://other-host/tmp/index.html', 'file:///tmp/no.txt', 'file:///tmp/.secret.html', 'file:///tmp/a%2Fb.html', 'file:///tmp/%00.html', 'javascript:alert(1)', 'https://user:pass@example.com']) assert.throws(() => validateCaptureURL(value));
  await assert.rejects(openCaptureSource(pathToFileURL(path.join(root, 'missing.html')).href), /找不到/);
  await assert.rejects(openCaptureSource(pathToFileURL(path.join(root, 'escape.html')).href), /符号链接/);
});

test('local source maps only its directory and blocks hidden files, traversal and escaping symlinks', async () => {
  const source = await openCaptureSource(url);
  assert.equal(new URL(source.url).hash, '#/dashboard');
  assert.equal(source.toSourceURL(source.url), url);
  assert.equal((await source.read(source.url)).status, 200);
  for (const suffix of ['/%2e%2e%2foutside.html', '/%2fetc%2fpasswd', '/.private/config.json', '/escape.html', '/hidden.json', '/a%00.json']) {
    assert.equal((await source.read(source.origin + suffix)).status, 403, suffix);
  }
  assert.equal((await source.read(source.origin + '/missing.js')).status, 404);
  assert.equal(await source.read('https://external.example/logo.png'), null);
  assert.notEqual((await openCaptureSource(url)).origin, source.origin);
});

test('local state URLs are constrained by directory, not the shared null file origin', () => {
  assert.equal(resolveStateURL('#/assets', url), url.replace('#/dashboard', '#/assets'));
  for (const target of ['../outside.html', pathToFileURL(path.join(temp, 'outside.html')).href, './.private/page.html', 'https://example.com/']) {
    assert.throws(() => validateStatePlan(recipe([{ id: 'escape', name: '越界', url: target }])), /目录/);
  }
  assert.throws(() => resolveStateURL(url, 'https://example.com/'), /同源/);
});

test('captures local module scripts, CSS, JSON and image resources with original file provenance', async () => {
  const result = await captureURL(browser, { url, width: 900, height: 700 });
  const nodes = flat(result.document.root);
  const text = nodes.map(n => n.text?.value || '').join('');
  for (const expected of ['本地模块已加载', '#/dashboard', 'local', '相对数据已加载']) assert.ok(text.includes(expected), text);
  assert.ok(nodes.some(n => n.name === 'div.card' && n.width === 540));
  assert.equal(result.document.stats.images, 1); assert.equal(result.document.stats.missingAssets, 0);
  assert.equal(result.document.source.url, url);
  assert.ok(result.document.assets.every(a => a.base64 && a.url.startsWith('file:')));
  assert.equal(browser.contexts().length, 0);
});

test('local multi-state capture replays snapshots, resolves hash navigation and isolates sessions', async () => {
  const result = await captureStates(browser, recipe([
    { id: 'dashboard', name: '仪表盘', steps: [{ type: 'wait', selector: '#title', text: '本地模块已加载' }] },
    { id: 'detail', name: '详情', steps: [{ type: 'click', selector: '#detail' }] },
    { id: 'assets', name: '资产', url: '#/assets', steps: [{ type: 'wait', selector: '#title', text: '#/assets' }] },
  ]));
  assert.equal(result.report.completed, 3); assert.equal(result.report.failed, 0);
  assert.equal(result.report.sourceSnapshot.url, url);
  assert.equal(result.report.sourceSnapshot.sha256, createHash('sha256').update(await readFile(entry)).digest('hex'));
  assert.equal(result.report.states[1].url, url.replace('#/dashboard', '#/details'));
  assert.ok(flat(hydratePage(result.bundle, 1).root).some(n => n.text?.value === '详情弹窗已打开'));
  const last = hydratePage(result.bundle, 2);
  assert.equal(flat(last.root).find(n => n.name === 'count').children[0].text.value, '0');
  assert.ok(result.bundle.pages.every(p => p.source.url.startsWith('file:')));
  assert.equal(browser.contexts().length, 0);
});

test('local cancellation closes the context and keeps only finished states', async () => {
  const controller = new AbortController();
  const result = await captureStates(browser, recipe([{ id: 'done', name: '完成' }, { id: 'next', name: '后续' }]), { signal: controller.signal, onState: () => controller.abort() });
  assert.equal(result.report.status, 'cancelled'); assert.equal(result.report.states[1].status, 'not-run');
  assert.equal(result.bundle.pages.length, 1); assert.equal(browser.contexts().length, 0);
  await assert.rejects(captureURL(browser, { url }, { signal: controller.signal }), /取消/);
  assert.equal(browser.contexts().length, 0);
});

test('local missing and symlink states fail individually without exposing outside content', async () => {
  const result = await captureStates(browser, recipe([{ id: 'bad', name: '越界资源', url: './escape.html' }, { id: 'missing', name: '缺失文件', url: './missing.html' }, { id: 'good', name: '可用页面' }]));
  assert.equal(result.report.failed, 2); assert.equal(result.report.completed, 1);
  assert.ok(result.report.states[0].error.includes('403')); assert.ok(result.report.states[1].error.includes('404'));
});

test('workbench accepts a pasted local URL and exports editable capture data', async () => {
  const app = await createAppServer({ port: 0 }); const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(app.address);
    await page.locator('#url-tab').click(); await page.locator('#page-url').fill(url);
    await page.locator('#prepare').click(); await page.locator('#ready-actions').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await page.locator('#remote-preview').isVisible(), true);
    assert.ok(!(await page.locator('#status').textContent()).includes('http 或 https'));
  } finally { await context.close(); await app.close(); }
});

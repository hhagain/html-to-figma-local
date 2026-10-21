import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../dist/lib/schema.js';
import { importDocument } from '../dist/lib/importer.js';
import { mockFigma } from './helpers.mjs';
const color = { r: .1, g: .2, b: .3, a: 1 };
const node = (id, extra = {}) => ({ id, kind: 'frame', name: id, x: 0, y: 0, width: 100, height: 40, opacity: 1, fills: [], children: [], ...extra });
const text = (id, value = '中文与 English') => node(id, { kind: 'text', text: { value, families: ['Missing Font'], size: 16, weight: 400, italic: false, lineHeight: 24, letterSpacing: 0, color, decoration: 'NONE' } });
const doc = (root = node('root')) => ({ schemaVersion: 1, name: '测试页面', createdAt: new Date().toISOString(), source: { title: '测试', url: 'local-html', selector: 'body', viewport: { width: 1440, height: 900 } }, root, assets: [], diagnostics: [], stats: { nodes: 0, texts: 0, images: 0, vectors: 0, missingAssets: 0 } });
test('rejects untrusted geometry, broken assets and excessive trees before changing canvas', async () => {
  const invalid = doc(); invalid.root.width = NaN; assert.throws(() => validateDocument(invalid), /尺寸/);
  const badAsset = doc(); badAsset.assets = [{ id: 'a', url: 'x', base64: 'bad<>' }]; assert.throws(() => validateDocument(badAsset), /编码/);
  const duplicate = doc(node('root', { children: [node('root')] })); assert.throws(() => validateDocument(duplicate), /ID/);
  const huge = doc(node('root', { children: Array.from({ length: 6001 }, (_, i) => node(`n${i}`)) })); assert.throws(() => validateDocument(huge), /超限/);
  const mock = mockFigma(); await assert.rejects(importDocument(mock.api, invalid, { mode: 'visual' })); assert.equal(mock.page.children.length, 0);
});
test('creates editable Chinese text and reports a real font fallback', async () => {
  const mock = mockFigma(); const result = await importDocument(mock.api, doc(node('root', { children: [text('t')] })), { mode: 'visual' });
  assert.equal(mock.page.children.length, 1); assert.equal(mock.page.children[0].name, '测试页面');
  const t = mock.page.children[0].children[0]; assert.equal(t.type, 'TEXT'); assert.equal(t.characters, '中文与 English'); assert.equal(t.fontName.family, 'Noto Sans SC');
  assert.equal(result.nodes, 2); assert.ok(result.diagnostics.some(d => d.code === 'FONT_SUBSTITUTED')); assert.equal(mock.page.selection[0], mock.page.children[0]);
});
test('failure removes partially built layers and preserves original selection', async () => {
  const mock = mockFigma({ failAt: 4 }); const original = mock.api.createFrame(); mock.page.selection = [original];
  await assert.rejects(importDocument(mock.api, doc(node('root', { children: [text('t'), node('b')] })), { mode: 'visual' }), /simulated/);
  assert.deepEqual(mock.page.children, [original]); assert.deepEqual(mock.page.selection, [original]);
});
test('cancelling a large import removes all imported layers', async () => {
  const mock = mockFigma(); let cancel = false;
  await assert.rejects(importDocument(mock.api, doc(node('root', { children: Array.from({ length: 60 }, (_, i) => node(`n${i}`)) })), { mode: 'visual', cancelled: () => cancel, progress: () => { cancel = true; } }), /取消/);
  assert.equal(mock.page.children.length, 0);
});
test('auto layout only upgrades containers whose measured geometry matches', async () => {
  const layout = { direction: 'HORIZONTAL', gap: 10, padding: [10, 10, 10, 10], main: 'MIN', cross: 'MIN', eligible: true };
  const matching = doc(node('root', { width: 230, height: 60, layout, children: [node('a', { x: 10, y: 10 }), node('b', { x: 120, y: 10 })] }));
  const first = mockFigma(); const result = await importDocument(first.api, matching, { mode: 'auto' }); assert.equal(result.autoLayouts, 1); assert.equal(first.page.children[0].layoutMode, 'HORIZONTAL');
  const mismatch = structuredClone(matching); mismatch.root.children[1].x = 130;
  const second = mockFigma(); const fallback = await importDocument(second.api, mismatch, { mode: 'auto' }); assert.equal(fallback.autoLayouts, 0); assert.ok(fallback.diagnostics.some(d => d.code === 'AUTO_LAYOUT_SKIPPED'));
});
test('missing and invalid images keep placeholders and report the loss', async () => {
  const data = doc(node('root', { fills: [{ type: 'image', assetId: 'a', fit: 'FILL' }] })); data.assets = [{ id: 'a', url: 'https://example.test/missing.png' }];
  const mock = mockFigma(); const result = await importDocument(mock.api, data, { mode: 'visual' }); assert.equal(mock.page.children[0].fills[0].type, 'SOLID'); assert.ok(result.diagnostics.some(d => d.code === 'ASSET_MISSING'));
});
test('failure after moving to page also rolls back the imported root', async () => {
  const mock = mockFigma({ viewportError: true }); const original = mock.api.createFrame(); mock.page.selection = [original];
  await assert.rejects(importDocument(mock.api, doc(node('root')), { mode: 'visual' }), /viewport failed/);
  assert.deepEqual(mock.page.children, [original]); assert.deepEqual(mock.page.selection, [original]);
});

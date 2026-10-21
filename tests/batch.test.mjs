import test from 'node:test';
import assert from 'node:assert/strict';
import { BundleBuilder, validateBundle, hydratePage } from '../dist/lib/bundle.js';
import { ImportBatch } from '../dist/lib/batch.js';
import { mockFigma } from './helpers.mjs';
const frame = (id, children = []) => ({ id, kind: 'frame', name: id, x: 0, y: 0, width: 390, height: 844, opacity: 1, fills: [], children });
const page = (i, count = 40) => ({ schemaVersion: 1, name: `页面 ${i}`, createdAt: '', source: { title: '', url: 'local-html', selector: '.page', viewport: { width: 1440, height: 900 } }, root: frame('root', Array.from({ length: count }, (_, j) => frame(`n${j}`))), assets: [], diagnostics: [], stats: { nodes: count + 1, texts: 0, images: 0, vectors: 0, missingAssets: 0 } });
test('200-page bundle exceeds single-page node cap safely and deduplicates image bytes', () => {
  const builder = new BundleBuilder('200 页');
  for (let i = 0; i < 200; i++) { const p = page(i); p.assets = [{ id: 'image', url: 'data:image/png;base64,AAAAAAAAAAAAAAAA', mime: 'image/png', base64: 'AAAAAAAAAAAAAAAA' }]; p.root.fills = [{ type: 'image', assetId: 'image', fit: 'FILL' }]; builder.add(p); }
  validateBundle(builder.bundle); assert.equal(builder.bundle.pages.length, 200); assert.equal(builder.bundle.assets.length, 1);
  assert.ok(builder.bundle.pages.reduce((n, p) => n + p.stats.nodes, 0) > 6000); assert.ok(builder.bundle.pages.every(p => !p.assets[0].base64));
  assert.equal(hydratePage(builder.bundle, 199).assets[0].base64, 'AAAAAAAAAAAAAAAA'); assert.throws(() => builder.add(page(201)), /200/);
});
test('batch imports 200 pages with one font inventory and no overlapping grid positions', async () => {
  const mock = mockFigma(); let inventories = 0; const list = mock.api.listAvailableFontsAsync; mock.api.listAvailableFontsAsync = async () => { inventories++; return list(); };
  const data = Array.from({ length: 200 }, (_, i) => page(i, 0)); const batch = new ImportBatch(mock.api, 'test', data.map(p => ({ name: p.name, width: 390, height: 844 })), 'visual');
  for (let i = 0; i < 200; i++) assert.ok((await batch.importPage(i, data[i])).nodeId);
  const result = await batch.finish(); assert.equal(result.completed, 200); assert.equal(result.failed, 0); assert.equal(inventories, 1); assert.equal(mock.page.children.length, 200);
  const positions = mock.page.children.map(n => `${n.x},${n.y}`); assert.equal(new Set(positions).size, 200);
});
test('one failed page does not remove successful pages or block the next one', async () => {
  const mock = mockFigma(); const data = [page(1, 0), page(2, 0), page(3, 0)]; data[1].root.width = -1;
  const batch = new ImportBatch(mock.api, 'partial', data.map(p => ({ name: p.name, width: 390, height: 844 })), 'visual');
  assert.ok((await batch.importPage(0, data[0])).nodeId); assert.ok((await batch.importPage(1, data[1])).error); assert.ok((await batch.importPage(2, data[2])).nodeId);
  const result = await batch.finish(); assert.equal(result.completed, 2); assert.equal(result.failed, 1); assert.equal(mock.page.children.length, 2);
});
test('batch cancellation rolls back only the in-progress page', async () => {
  const mock = mockFigma(); const batch = new ImportBatch(mock.api, 'cancel', [1, 2, 3].map(i => ({ name: `页面${i}`, width: 390, height: 844 })), 'visual');
  await batch.importPage(0, page(1, 0)); const second = await batch.importPage(1, page(2, 60), () => batch.cancel()); assert.equal(second.error, '导入已取消');
  const result = await batch.finish(); assert.equal(result.completed, 1); assert.equal(result.cancelled, true); assert.equal(mock.page.children.length, 1); await assert.rejects(batch.importPage(2, page(3)), /取消/);
});
test('identical image contents with different URLs do not create duplicate page references', () => {
  const p = page(1, 0); p.assets = ['a', 'b'].map(id => ({ id, url: `https://example.test/${id}.png`, mime: 'image/png', base64: 'AAAAAAAAAAAAAAAA' }));
  p.root.fills = p.assets.map(a => ({ type: 'image', assetId: a.id, fit: 'FILL' })); const builder = new BundleBuilder('图片去重'); builder.add(p); validateBundle(builder.bundle);
  assert.equal(builder.bundle.assets.length, 1); assert.equal(builder.bundle.pages[0].assets.length, 1);
});

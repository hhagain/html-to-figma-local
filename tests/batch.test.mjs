import test from 'node:test';
import assert from 'node:assert/strict';
import { BundleBuilder, validateBundle, hydratePage } from '../dist/lib/bundle.js';
import { ImportBatch } from '../dist/lib/batch.js';
import { validateDocument } from '../dist/lib/schema.js';
import { mockFigma } from './helpers.mjs';
const frame = (id, children = []) => ({ id, kind: 'frame', name: id, x: 0, y: 0, width: 390, height: 844, opacity: 1, fills: [], children });
const page = (i, count = 40) => ({ schemaVersion: 1, name: `页面 ${i}`, createdAt: '', source: { title: '', url: 'local-html', selector: '.page', viewport: { width: 1440, height: 900 } }, root: frame('root', Array.from({ length: count }, (_, j) => frame(`n${j}`))), assets: [], diagnostics: [], stats: { nodes: count + 1, texts: 0, images: 0, vectors: 0, missingAssets: 0 } });
test('1000-page bundle exceeds single-page node cap safely and deduplicates image bytes', () => {
  const builder = new BundleBuilder('1000 页');
  for (let i = 0; i < 1000; i++) { const p = page(i); p.assets = [{ id: 'image', url: 'data:image/png;base64,AAAAAAAAAAAAAAAA', mime: 'image/png', base64: 'AAAAAAAAAAAAAAAA' }]; p.root.fills = [{ type: 'image', assetId: 'image', fit: 'FILL' }]; builder.add(p); }
  validateBundle(builder.bundle); assert.equal(builder.bundle.pages.length, 1000); assert.equal(builder.bundle.assets.length, 1);
  assert.ok(builder.bundle.pages.reduce((n, p) => n + p.stats.nodes, 0) > 6000); assert.ok(builder.bundle.pages.every(p => !p.assets[0].base64));
  assert.equal(hydratePage(builder.bundle, 999).assets[0].base64, 'AAAAAAAAAAAAAAAA'); builder.add(page(1001)); assert.equal(builder.bundle.pages.length,1001); validateBundle(builder.bundle);
});
test('batch imports 1000 pages with one font inventory and no overlapping grid positions', async () => {
  const mock = mockFigma(); let inventories = 0; const list = mock.api.listAvailableFontsAsync; mock.api.listAvailableFontsAsync = async () => { inventories++; return list(); };
  const data = Array.from({ length: 1000 }, (_, i) => page(i, 0)); const batch = new ImportBatch(mock.api, 'test', data.map(p => ({ name: p.name, width: 390, height: 844 })), 'visual');
  for (let i = 0; i < 1000; i++) assert.ok((await batch.importPage(i, data[i])).nodeId);
  const result = await batch.finish(); assert.equal(result.completed, 1000); assert.equal(result.failed, 0); assert.equal(inventories, 1); assert.equal(mock.page.children.length, 1000);
  const positions = mock.page.children.map(n => `${n.x},${n.y}`); assert.equal(new Set(positions).size, 1000);
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

test('removing page limits keeps the total-node resource budget enforced',()=>{
  const builder=new BundleBuilder('资源预算');
  for(let i=0;i<100;i++)builder.add(page(i,1199));
  assert.equal(builder.bundle.pages.length,100);validateBundle(builder.bundle);
  assert.throws(()=>builder.add(page(101,0)),/120000/);
});

test('page failure records above 400 remain valid when the bundle fits its resource budget',()=>{
  const builder=new BundleBuilder('多失败记录');builder.add(page(1,0));
  for(let i=0;i<800;i++)builder.error('页面 '+i,new Error('捕获失败'));
  validateBundle(builder.bundle);assert.equal(builder.bundle.errors.length,800);
});

const onCanvas = (i, x, y, id = 'design-export') => {
  const p = page(i, 0);
  p.source.canvas = { id, x, y, width: 3990, height: 60901 };
  return p;
};
const planFor = data => data.map(p => ({ name: p.name, width: p.root.width, height: p.root.height, canvas: p.source.canvas }));

test('absolute canvas positions survive split imports, DOM order and mixed artboard sizes', async () => {
  const mock = mockFigma();
  const data = [onCanvas('phone', 0, 2511), onCanvas('tab', 0, 3934), onCanvas('palette', 0, 0), onCanvas('second-phone', 450, 2511), onCanvas('annotation', 0, 4866)];
  data[1].root.height = 52; data[2].root.width = 1298; data[2].root.height = 1920; data[4].root.height = 148;
  const batch = new ImportBatch(mock.api, 'canvas', planFor(data), 'visual');
  for (let i = 0; i < data.length; i++) assert.ok((await batch.importPage(i, data[i])).nodeId);
  assert.equal((await batch.finish()).completed, 5);
  assert.deepEqual(mock.page.children.map(n => [n.x - 400, n.y - 400, n.width, n.height]), [
    [0, 2511, 390, 844], [0, 3934, 390, 52], [0, 0, 1298, 1920], [450, 2511, 390, 844], [0, 4866, 390, 148]
  ]);
});

test('selecting some pages keeps their original canvas gaps and intended overlaps', async () => {
  const mock = mockFigma();
  const data = [onCanvas('later', 1350, 2511), onCanvas('overlay-a', 0, 0), onCanvas('overlay-b', 0, 0), onCanvas('bottom', 0, 59000)];
  const batch = new ImportBatch(mock.api, 'selected', planFor(data), 'auto');
  for (let i = 0; i < data.length; i++) await batch.importPage(i, data[i]);
  assert.equal((await batch.finish()).completed, 4);
  assert.deepEqual(mock.page.children.map(n => [n.x - 400, n.y - 400]), [[1350, 2511], [0, 0], [0, 0], [0, 59000]]);
});

test('different source canvases and ordinary pages are placed apart from existing designs', async () => {
  const mock = mockFigma(), existing = mock.api.createFrame(); existing.x = 100; existing.width = 1000;
  const data = [onCanvas('first', -50, 300, 'first'), onCanvas('second', 0, 0, 'second'), onCanvas('first-next', 400, 300, 'first'), page('ordinary', 0)];
  const batch = new ImportBatch(mock.api, 'multiple', planFor(data), 'visual');
  for (let i = 0; i < data.length; i++) assert.ok((await batch.importPage(i, data[i])).nodeId);
  const [a, b, a2, ordinary] = mock.page.children.slice(1);
  assert.equal(existing.x, 100); assert.equal(a.x, 1260); assert.equal(a2.x - a.x, 450);
  assert.equal(b.x - a.x, 4160); assert.equal(b.y, 400); assert.equal(ordinary.y, 61421);
});

test('bundle roundtrips retain canvas metadata and repeated backups get independent canvas groups', () => {
  const input = new BundleBuilder('original'); input.add(onCanvas(1, 0, 2511)); input.add(onCanvas(2, 450, 2511));
  const restored = JSON.parse(JSON.stringify(input.bundle)); validateBundle(restored);
  assert.deepEqual(hydratePage(restored, 1).source.canvas, { id: 'design-export', x: 450, y: 2511, width: 3990, height: 60901 });
  const merged = new BundleBuilder('merged'); merged.addBundle(restored); merged.addBundle(restored); validateBundle(merged.bundle);
  const ids = merged.bundle.pages.map(p => p.source.canvas.id);
  assert.equal(ids[0], ids[1]); assert.equal(ids[2], ids[3]); assert.notEqual(ids[0], ids[2]);
  assert.equal(restored.pages[0].source.canvas.id, 'design-export');
});

test('canvas metadata is optional for old files and malformed placements fail before import', () => {
  validateDocument(page('legacy', 0));
  for (const invalid of [null, {}, { x: NaN }, { y: Infinity }, { x: '10' }, { width: 0 }, { height: 10000001 }, { id: 'unsafe / id' }]) {
    const p = onCanvas('invalid', 0, 0);
    p.source.canvas = invalid === null ? null : { ...p.source.canvas, ...invalid };
    if (invalid && !Object.keys(invalid).length) p.source.canvas = {};
    assert.throws(() => validateDocument(p), /原画布/);
    assert.throws(() => new ImportBatch(mockFigma().api, 'bad', planFor([p]), 'visual'), /批次计划/);
  }
});

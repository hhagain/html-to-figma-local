import test from 'node:test';
import assert from 'node:assert/strict';
import { figmaWithLayout } from './layout-figma.mjs';
import { importDocument } from '../dist/lib/importer.js';
const frame = (id, width, height, x = 0, y = 0, children = [], layout) => ({ id, kind: 'frame', name: id, width, height, x, y, opacity: 1, fills: [], children, ...(layout ? { layout } : {}) });
const layout = (direction, main = 'CENTER', cross = 'CENTER', padding = [0, 0, 0, 0], gap = 0) => ({ direction, main, cross, padding, gap, eligible: true });
const doc = root => ({ schemaVersion: 1, name: 'Auto Layout regression', createdAt: '', source: { title: '', url: 'local-html', selector: 'body', viewport: { width: 1440, height: 900 } }, root, assets: [], diagnostics: [], stats: { nodes: 0, texts: 0, images: 0, vectors: 0, missingAssets: 0 } });
const rect = n => ({ x: n.x, y: n.y, width: n.width, height: n.height });
test('fixed-height button stays 342 × 52 after Figma auto-sizing side effects', async () => {
  const child = frame('label', 90, 24, 126, 14);
  const source = frame('button', 342, 52, 0, 0, [child], layout('HORIZONTAL'));
  const mock = figmaWithLayout(); const result = await importDocument(mock.api, doc(source), { mode: 'auto' }); const actual = mock.page.children[0];
  assert.equal(result.autoLayouts, 1); assert.equal(actual.width, 342); assert.equal(actual.height, 52); assert.deepEqual(rect(actual.children[0]), rect(child));
});
test('space-between page keeps 844px height and footer at captured bottom', async () => {
  const header = frame('header', 342, 100, 24, 24), footer = frame('footer', 342, 70, 24, 750);
  const source = frame('screen', 390, 844, 0, 0, [header, footer], layout('VERTICAL', 'SPACE_BETWEEN', 'CENTER', [24, 24, 24, 24]));
  const mock = figmaWithLayout(); const result = await importDocument(mock.api, doc(source), { mode: 'auto' }); const actual = mock.page.children[0];
  assert.equal(result.autoLayouts, 1); assert.equal(actual.height, 844); assert.deepEqual(actual.children.map(rect), source.children.map(rect));
});
test('nested centered modal and its fixed-height action retain captured geometry', async () => {
  const action = frame('action', 294, 52, 24, 84, [frame('label', 90, 24, 102, 14)], layout('HORIZONTAL'));
  const title = frame('title', 294, 40, 24, 24);
  const modal = frame('modal', 342, 160, 24, 342, [title, action], layout('VERTICAL', 'MIN', 'CENTER', [24, 24, 24, 24], 20));
  const source = frame('overlay', 390, 844, 0, 0, [modal], layout('VERTICAL'));
  const mock = figmaWithLayout(); const result = await importDocument(mock.api, doc(source), { mode: 'auto' }); const actual = mock.page.children[0];
  assert.equal(result.autoLayouts, 3); assert.deepEqual(rect(actual.children[0]), rect(modal)); assert.deepEqual(rect(actual.children[0].children[1]), rect(action)); assert.equal(actual.height, 844);
});
test('unexpected child movement falls back without losing original geometry', async () => {
  const child = frame('dialog', 342, 160, 24, 342); const source = frame('overlay', 390, 844, 0, 0, [child], layout('VERTICAL'));
  const mock = figmaWithLayout({ drift: true }); const result = await importDocument(mock.api, doc(source), { mode: 'auto' }); const actual = mock.page.children[0];
  assert.equal(result.autoLayouts, 0); assert.equal(actual.layoutMode, 'NONE'); assert.equal(actual.height, 844); assert.deepEqual(rect(actual.children[0]), rect(child)); assert.ok(result.diagnostics.some(d => d.code === 'AUTO_LAYOUT_REVERTED'));
});
test('layout setter failure reverts only that container and completes the import', async () => {
  const child = frame('label', 90, 24, 126, 14); const source = frame('button', 342, 52, 0, 0, [child], layout('HORIZONTAL'));
  const mock = figmaWithLayout({ rejectSpacing: true }); const result = await importDocument(mock.api, doc(source), { mode: 'auto' }); const actual = mock.page.children[0];
  assert.equal(result.autoLayouts, 0); assert.equal(actual.height, 52); assert.deepEqual(rect(actual.children[0]), rect(child)); assert.ok(result.diagnostics.some(d => d.code === 'AUTO_LAYOUT_REVERTED'));
});

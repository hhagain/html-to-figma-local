import test from 'node:test';
import assert from 'node:assert/strict';
import { mockFigma } from './helpers.mjs';
import { importDocument } from '../dist/lib/importer.js';
const frame = (id, width, height, x = 0, y = 0, children = [], layout) => ({ id, kind: 'frame', name: id, width, height, x, y, opacity: 1, fills: [], children, ...(layout ? { layout } : {}) });
const layout = (direction, main = 'CENTER', cross = 'CENTER', padding = [0, 0, 0, 0], gap = 0) => ({ direction, main, cross, padding, gap, eligible: true });
const doc = root => ({ schemaVersion: 1, name: 'Auto Layout regression', createdAt: '', source: { title: '', url: 'local-html', selector: 'body', viewport: { width: 1440, height: 900 } }, root, assets: [], diagnostics: [], stats: { nodes: 0, texts: 0, images: 0, vectors: 0, missingAssets: 0 } });
// Model the documented Figma side effect: enabling layout shrinks dimensions to
// content and changes child positions. A plain object mock cannot catch this bug.
function figmaWithLayout({ drift = false, rejectSpacing = false } = {}) {
  const mock = mockFigma(); const original = mock.api.createFrame;
  mock.api.createFrame = () => {
    const f = original();
    const state = { layoutMode: 'NONE', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, itemSpacing: 0 };
    const reflow = () => {
      if (state.layoutMode === 'NONE' || !f.children.length) return;
      const horizontal = state.layoutMode === 'HORIZONTAL';
      const mainStart = horizontal ? state.paddingLeft : state.paddingTop, mainEnd = horizontal ? state.paddingRight : state.paddingBottom;
      const crossStart = horizontal ? state.paddingTop : state.paddingLeft, crossEnd = horizontal ? state.paddingBottom : state.paddingRight;
      const sum = f.children.reduce((n, c) => n + (horizontal ? c.width : c.height), 0);
      const max = Math.max(...f.children.map(c => horizontal ? c.height : c.width));
      if (state.primaryAxisSizingMode === 'AUTO') f[horizontal ? 'width' : 'height'] = sum + state.itemSpacing * (f.children.length - 1) + mainStart + mainEnd;
      if (state.counterAxisSizingMode === 'AUTO') f[horizontal ? 'height' : 'width'] = max + crossStart + crossEnd;
      const room = f[horizontal ? 'width' : 'height'] - mainStart - mainEnd - sum;
      const gap = state.primaryAxisAlignItems === 'SPACE_BETWEEN' && f.children.length > 1 ? room / (f.children.length - 1) : state.itemSpacing;
      const free = room - gap * (f.children.length - 1);
      let cursor = mainStart + (state.primaryAxisAlignItems === 'CENTER' ? free / 2 : state.primaryAxisAlignItems === 'MAX' ? free : 0);
      for (const child of f.children) {
        const crossRoom = f[horizontal ? 'height' : 'width'] - crossStart - crossEnd - child[horizontal ? 'height' : 'width'];
        child[horizontal ? 'x' : 'y'] = cursor;
        child[horizontal ? 'y' : 'x'] = crossStart + (state.counterAxisAlignItems === 'CENTER' ? crossRoom / 2 : state.counterAxisAlignItems === 'MAX' ? crossRoom : 0);
        cursor += child[horizontal ? 'width' : 'height'] + gap;
      }
      if (drift && f.width === 390 && f.height === 844) f.children[0].y += 4;
    };
    for (const key of Object.keys(state)) Object.defineProperty(f, key, { configurable: true, get: () => state[key], set: value => {
      if (key === 'itemSpacing' && rejectSpacing && state.layoutMode !== 'NONE') throw new Error('simulated layout setter failure');
      state[key] = value;
      if (key === 'layoutMode' && value !== 'NONE') { state.primaryAxisSizingMode = 'AUTO'; state.counterAxisSizingMode = 'AUTO'; }
      reflow();
    } });
    f.resize = (w, h) => { f.width = w; f.height = h; reflow(); };
    f.resizeWithoutConstraints = (w, h) => { f.width = w; f.height = h; reflow(); };
    f.layoutSizingHorizontal = 'FIXED'; f.layoutSizingVertical = 'FIXED';
    return f;
  };
  return mock;
}
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

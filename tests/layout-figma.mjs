import { mockFigma } from './helpers.mjs';
// Model the documented Figma side effect: enabling layout shrinks dimensions to
// content and changes child positions. A plain object mock cannot catch this bug.
export function figmaWithLayout({ drift = false, rejectSpacing = false } = {}) {
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

export function mockFigma({ failAt = Infinity, viewportError = false } = {}) {
  let serial = 0;
  const all = [], fontsLoaded = [];
  const page = { id: 'page-1', children: [], selection: [], appendChild(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); this.children.push(child); child.parent = this; } };
  const create = type => {
    if (++serial === failAt) throw new Error('simulated API failure');
    const n = { id: String(serial), type, children: [], removed: false, visible: true, width: 100, height: 24, x: 0, y: 0, layoutGrow: 0, layoutAlign: 'INHERIT', pluginData: {}, resize(w, h) { this.width = w; this.height = h; }, resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }, rescale(scale) { this.width *= scale; this.height *= scale; }, appendChild: page.appendChild, setPluginData(key, value) { this.pluginData[key] = value; }, remove() { for (const c of [...this.children]) c.remove(); if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.removed = true; this.parent = null; } };
    all.push(n); page.appendChild(n); return n;
  };
  const api = { currentPage: page, getNodeByIdAsync: async id => all.find(n => n.id === id && !n.removed) || null, viewport: { center: { x: 400, y: 400 }, scrollAndZoomIntoView() { if (viewportError) throw new Error('viewport failed'); } }, listAvailableFontsAsync: async () => [{ fontName: { family: 'Noto Sans SC', style: 'Regular' } }, { fontName: { family: 'Inter', style: 'Regular' } }], loadFontAsync: async f => fontsLoaded.push(f), createFrame: () => create('FRAME'), createText: () => create('TEXT'), createNodeFromSvg: () => create('FRAME'), createImage: bytes => { if (bytes.length < 10) throw new Error('bad image'); return { hash: 'test-image' }; }, base64Decode: s => new Uint8Array(Buffer.from(s, 'base64')) };
  return { api, all, page, fontsLoaded };
}

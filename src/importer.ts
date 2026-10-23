import { addDiagnostic, countScene, validateDocument, type CaptureDocument, type Color, type Diagnostic, type ImportMode, type Paint as SourcePaint, type SceneNode as SourceNode } from './schema';
import { applyAutoLayoutPreservingGeometry } from './auto-layout';
export interface ImportOptions { mode: ImportMode; cancelled?: () => boolean; progress?: (done: number, total: number) => void; context?: ImportContext; page?: PageNode; focus?: boolean; position?: { x: number; y: number }; onStaging?: (node: FrameNode | null) => void }
export interface ImportContext { fonts: Promise<Font[]>; fontCache: Map<string, FontName>; loaded: Set<string>; imageHashes: Map<string, string> }
export function createImportContext(api: PluginAPI): ImportContext { return { fonts: api.listAvailableFontsAsync(), fontCache: new Map(), loaded: new Set(), imageHashes: new Map() }; }
export interface ImportResult { nodeId: string; nodes: number; autoLayouts: number; diagnostics: Diagnostic[] }
const rgb = (c: Color): RGB => ({ r: c.r, g: c.g, b: c.b });
const weightOf = (style: string): number => {
  const s = style.toLowerCase().replace(/[ -]/g, '');
  if (/thin/.test(s)) return 100; if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s)) return 300; if (/medium/.test(s)) return 500;
  if (/semibold|demibold/.test(s)) return 600; if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900; if (/bold/.test(s)) return 700; return 400;
};
export async function importDocument(api: PluginAPI, document: CaptureDocument, options: ImportOptions): Promise<ImportResult> {
  validateDocument(document);
  const diagnostics = document.diagnostics.map(d => ({ ...d }));
  const warn = (code: string, message: string, node?: string) => addDiagnostic(diagnostics, code, message, node);
  const check = () => { if (options.cancelled?.()) throw new Error('导入已取消'); };
  const context = options.context || createImportContext(api);
  const targetPage = options.page || api.currentPage;
  const fonts = await context.fonts; check();
  const fontCache = context.fontCache;
  const loaded = context.loaded;
  const generic: Record<string, string[]> = { 'sans-serif': ['Arial', 'Inter'], 'system-ui': ['Inter', 'Arial'], '-apple-system': ['SF Pro Text', 'Inter'], 'BlinkMacSystemFont': ['SF Pro Text', 'Inter'], serif: ['Times New Roman', 'Noto Serif'], monospace: ['SF Mono', 'Roboto Mono', 'Courier New'] };
  const resolveFont = async (text: NonNullable<SourceNode['text']>): Promise<FontName> => {
    const key = JSON.stringify([text.families, text.weight, text.italic, /[\u3400-\u9fff]/.test(text.value)]);
    if (fontCache.has(key)) return fontCache.get(key)!;
    const candidates = text.families.flatMap(f => generic[f] || [f]);
    if (/[\u3400-\u9fff]/.test(text.value)) candidates.push('Noto Sans SC', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei');
    candidates.push('Inter', 'Arial');
    for (const family of candidates) {
      const matches = fonts.filter(f => f.fontName.family.toLowerCase() === family.toLowerCase()).sort((a, b) => {
        const score = (f: Font) => Math.abs(weightOf(f.fontName.style) - text.weight) + (/(italic|oblique)/i.test(f.fontName.style) !== text.italic ? 1000 : 0);
        return score(a) - score(b);
      });
      for (const match of matches) {
        try {
          const id = JSON.stringify(match.fontName);
          if (!loaded.has(id)) { await api.loadFontAsync(match.fontName); loaded.add(id); }
          if (!text.families.some(f => f.toLowerCase() === family.toLowerCase() || (generic[f] || []).some(g => g.toLowerCase() === family.toLowerCase()))) warn('FONT_SUBSTITUTED', `字体 ${text.families[0] || '默认字体'} 替换为 ${match.fontName.family}`);
          if (Math.abs(weightOf(match.fontName.style) - text.weight) >= 100 || /(italic|oblique)/i.test(match.fontName.style) !== text.italic) warn('FONT_STYLE_SUBSTITUTED', `${match.fontName.family} 的部分字重或斜体使用近似样式`);
          fontCache.set(key, match.fontName); return match.fontName;
        } catch { /* try next installed font */ }
      }
    }
    throw new Error('Figma 中没有可用字体，请先安装或启用 Inter');
  };
  const imageHashes = context.imageHashes;
  for (const a of document.assets) {
    check(); if (imageHashes.has(a.id)) continue; if (!a.base64) { warn('ASSET_MISSING', '图片缺失，已保留灰色占位图层', a.url.slice(0, 180)); continue; }
    try { imageHashes.set(a.id, api.createImage(api.base64Decode(a.base64)).hash); }
    catch { warn('IMAGE_FORMAT', '图片格式无法解码，已保留占位图层', a.url.slice(0, 180)); }
  }
  const paints = (values: SourcePaint[]): Paint[] => values.map(p => {
    if (p.type === 'solid') return { type: 'SOLID', color: rgb(p.color), opacity: p.color.a } as SolidPaint;
    if (p.type === 'linear') return { type: 'GRADIENT_LINEAR', gradientStops: p.stops.map(s => ({ position: s.position, color: { ...rgb(s.color), a: s.color.a } })), gradientTransform: p.transform, opacity: 1 } as GradientPaint;
    const imageHash = imageHashes.get(p.assetId);
    if (!imageHash) return { type: 'SOLID', color: { r: .90, g: .91, b: .93 } } as SolidPaint;
    return { type: 'IMAGE', imageHash, scaleMode: p.fit, ...(p.fit === 'TILE' ? { scalingFactor: 1 } : {}) } as ImagePaint;
  });
  const setFrameStyle = (node: FrameNode, spec: SourceNode) => {
    node.fills = paints(spec.fills); node.opacity = spec.opacity; node.clipsContent = !!spec.clip;
    if (spec.radius) [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = spec.radius;
    if (spec.border) {
      node.strokes = [{ type: 'SOLID', color: rgb(spec.border.color), opacity: spec.border.color.a }];
      [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight] = spec.border.widths;
      node.strokeAlign = 'INSIDE'; if (spec.border.dashed) node.dashPattern = [4, 4];
    }
    node.effects = (spec.effects || []).map(e => ({ type: e.inner ? 'INNER_SHADOW' : 'DROP_SHADOW', color: { ...rgb(e.color), a: e.color.a }, offset: { x: e.x, y: e.y }, radius: e.blur, spread: e.spread, visible: true, blendMode: 'NORMAL' } as Effect));
  };
  let done = 0, autoLayouts = 0;
  const total = countScene(document.root).nodes;
  const staging = api.createFrame(); staging.name = `${document.name} · 导入中`; staging.fills = []; staging.clipsContent = false; staging.visible = false;
  targetPage.appendChild(staging); options.onStaging?.(staging);
  const originalSelection = [...targetPage.selection];
  let transferred: SceneNode | null = null;
  try {
    const build = async (spec: SourceNode, parent: FrameNode): Promise<SceneNode> => {
      check(); let node: SceneNode;
      if (spec.kind === 'text') {
        const font = await resolveFont(spec.text!); check();
        const t = api.createText(); parent.appendChild(t); node = t;
        const text = spec.text!; t.fontName = font; t.fontSize = text.size;
        t.characters = text.value; t.lineHeight = { unit: 'PIXELS', value: text.lineHeight };
        t.letterSpacing = { unit: 'PIXELS', value: text.letterSpacing }; t.textDecoration = text.decoration;
        t.textAutoResize = 'WIDTH_AND_HEIGHT'; t.fills = spec.fills.length ? paints(spec.fills) : [{ type: 'SOLID', color: rgb(text.color), opacity: text.color.a }]; t.opacity = spec.opacity;
      } else {
        const f = api.createFrame(); parent.appendChild(f); node = f;
        f.resize(spec.width, spec.height); setFrameStyle(f, spec);
        if (spec.kind === 'svg') {
          try {
            const vector = api.createNodeFromSvg(spec.svg!); f.appendChild(vector); vector.x = vector.y = 0; vector.name = 'SVG';
            if (vector.width > 0 && Math.abs(vector.width - spec.width) > .1) vector.rescale(spec.width / vector.width);
            if (Math.abs(vector.height - spec.height) > 1) warn('SVG_SIZE', 'SVG 宽高比与浏览器显示存在差异', spec.name);
          } catch { warn('SVG_FAILED', 'SVG 无法转换，已保留容器', spec.name); }
        }
        for (const child of spec.children || []) await build(child, f);
        if (spec.layout) {
          f.setPluginData('htmlFlex', JSON.stringify(spec.layout));
          if (options.mode === 'auto') {
            const result = applyAutoLayoutPreservingGeometry(f, spec);
            f.setPluginData('h2fAutoLayout', result);
            if (result === 'applied') autoLayouts++;
            else if (result === 'reverted') warn('AUTO_LAYOUT_REVERTED', '自动布局改变了尺寸或位置，已恢复该容器的原始布局', spec.name);
            else warn('AUTO_LAYOUT_SKIPPED', '部分 Flex 容器保留原始位置，以避免布局发生变化', spec.name);
          }
        }
      }
      node.name = spec.name; node.x = spec.x; node.y = spec.y; node.setPluginData('htmlNodeId', spec.id);
      done++; if (done % 30 === 0) { options.progress?.(done, total); await new Promise(resolve => setTimeout(resolve, 0)); }
      return node;
    };
    const built = await build(document.root, staging); check();
    targetPage.appendChild(built); transferred = built;
    const center = api.viewport.center;
    built.x = options.position?.x ?? Math.round(center.x - built.width / 2); built.y = options.position?.y ?? Math.round(center.y - built.height / 2);
    built.name = document.name; built.setPluginData('h2fSource', JSON.stringify(document.source)); built.setPluginData('h2fVersion', '1');
    staging.remove(); options.onStaging?.(null);
    if (options.focus !== false) { targetPage.selection = [built]; api.viewport.scrollAndZoomIntoView([built]); }
    options.progress?.(total, total);
    return { nodeId: built.id, nodes: done, autoLayouts, diagnostics };
  } catch (error) {
    if (transferred && !transferred.removed) transferred.remove();
    if (!staging.removed) staging.remove();
    options.onStaging?.(null);
    if (options.focus !== false) targetPage.selection = originalSelection.filter(n => !n.removed);
    throw error;
  }
}

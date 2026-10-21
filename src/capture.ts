import { SCHEMA_VERSION, LIMITS, addDiagnostic, countScene, type CaptureDocument, type SceneNode, type Color, type Paint, type Asset, type Diagnostic, type Layout } from './schema';
export interface CaptureOptions { selector?: string; name?: string; maxNodes?: number }
const round = (v: number) => Math.round(v * 100) / 100;
const px = (v: string) => parseFloat(v) || 0;
export function splitCSS(value: string, delimiter = ','): string[] {
  const out: string[] = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) { if (c === quote && value[i - 1] !== '\\') quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === delimiter && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
  }
  out.push(value.slice(start).trim()); return out;
}
export async function captureDOM(doc: Document = document, options: CaptureOptions = {}): Promise<CaptureDocument> {
  const win = doc.defaultView!;
  const selector = options.selector?.trim() || 'body';
  let rootEl: Element | null;
  try { rootEl = doc.querySelector(selector); } catch { throw new Error('CSS 选择器格式不正确'); }
  if (!rootEl) throw new Error(`没有找到选择器：${selector}`);
  await Promise.race([doc.fonts?.ready, new Promise(resolve => setTimeout(resolve, 2500))]);
  const diagnostics: Diagnostic[] = [], assets: Asset[] = [];
  const warn = (code: string, message: string, node?: string) => addDiagnostic(diagnostics, code, message, node);
  const colorCanvas = doc.createElement('canvas'); colorCanvas.width = colorCanvas.height = 1;
  const ctx = colorCanvas.getContext('2d', { willReadFrequently: true })!;
  const color = (value: string): Color => {
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = 'transparent'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
  };
  let sequence = 0, textChars = 0;
  const base = (kind: SceneNode['kind'], name: string, rect: { x: number; y: number; width: number; height: number }, parent: { x: number; y: number }): SceneNode => {
    if (++sequence > Math.min(options.maxNodes || LIMITS.nodes, LIMITS.nodes)) throw new Error(`页面超过 ${LIMITS.nodes} 个图层，请用选择器缩小捕获区域`);
    return { id: `n${sequence}`, kind, name: name.slice(0, 150), x: round(rect.x - parent.x), y: round(rect.y - parent.y), width: Math.max(.1, round(rect.width)), height: Math.max(.1, round(rect.height)), opacity: 1, fills: [] };
  };
  const asset = (url: string): string => {
    let resolved = url;
    try { resolved = new URL(url, doc.baseURI).href; } catch { /* retained for diagnostic */ }
    let a = assets.find(a => a.url === resolved);
    if (!a) {
      if (assets.length >= LIMITS.assets) throw new Error('页面图片资源超过 300 个，请缩小捕获区域');
      a = { id: `a${assets.length + 1}`, url: resolved };
      const m = resolved.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/);
      if (m) { a.mime = m[1]; a.base64 = m[2].replace(/\s/g, ''); }
      assets.push(a);
    }
    return a.id;
  };
  const gradient = (value: string, width: number, height: number): Paint | null => {
    const match = value.match(/^linear-gradient\((.*)\)$/s); if (!match) return null;
    const parts = splitCSS(match[1]); let angle = 180;
    if (/deg$/.test(parts[0])) angle = px(parts.shift()!);
    else if (/^to /.test(parts[0])) {
      const dir = parts.shift()!.slice(3).trim();
      const map: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };
      angle = map[dir] ?? 180;
    }
    const provisional = parts.map(p => {
      const m = p.match(/^(.*?)\s+(-?[\d.]+)%$/);
      return { color: color(m ? m[1] : p), position: m ? Math.max(0, Math.min(1, Number(m[2]) / 100)) : null };
    });
    if (provisional.length < 2 || provisional.length > 50) return null;
    provisional[0].position ??= 0; provisional[provisional.length - 1].position ??= 1;
    let previous = 0;
    for (let i = 1; i < provisional.length; i++) {
      if (provisional[i].position == null) continue;
      const end = Math.max(provisional[previous].position!, provisional[i].position!);
      provisional[i].position = end;
      for (let j = previous + 1; j < i; j++) provisional[j].position = provisional[previous].position! + (end - provisional[previous].position!) * (j - previous) / (i - previous);
      previous = i;
    }
    const rad = angle * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
    const length = Math.abs(width * dx) + Math.abs(height * dy) || 1;
    const a = width * dx / length, b = height * dy / length;
    return { type: 'linear', stops: provisional as { color: Color; position: number }[], transform: [[a, b, .5 - (a + b) / 2], [-b, a, .5 - (a - b) / 2]] };
  };
  const effects = (value: string): NonNullable<SceneNode['effects']> => {
    if (value === 'none') return [];
    return splitCSS(value).slice(0, 10).flatMap(part => {
      const match = part.match(/(?:rgba?|color|oklch|oklab)\([^)]*\)/);
      if (!match) return [];
      const c = color(match[0]), rest = part.replace(match[0], '');
      const numbers = [...rest.matchAll(/(-?[\d.]+)px/g)].map(m => Number(m[1]));
      if (numbers.length < 2) return [];
      return [{ inner: /\binset\b/.test(rest), color: c, x: numbers[0], y: numbers[1], blur: Math.max(0, numbers[2] || 0), spread: numbers[3] || 0 }];
    });
  };
  const textNodes = (node: Text, parentRect: DOMRect, cs: CSSStyleDeclaration): SceneNode[] => {
    const value = node.nodeValue || ''; if (!value.trim() && !/pre|break-spaces/.test(cs.whiteSpace)) return [];
    textChars += value.length; if (textChars > LIMITS.text) throw new Error('页面文字过多，请缩小捕获区域');
    const range = doc.createRange();
    type Line = { value: string; x: number; y: number; width: number; height: number };
    const lines: Line[] = []; let index = 0, lastRect: DOMRect | null = null;
    for (const char of value) {
      const start = index; index += char.length;
      if (char === '\n' && !/pre|break-spaces/.test(cs.whiteSpace)) { /* CSS may render this as one space */ }
      range.setStart(node, start); range.setEnd(node, index);
      const rect = range.getBoundingClientRect();
      if (rect.height < .1 || rect.width < .01 || (lastRect && /^\s$/.test(char) && Math.abs(rect.x - lastRect.x) < .01 && Math.abs(rect.width - lastRect.width) < .01)) continue;
      let visible = /[\r\n\t]/.test(char) && !/pre|break-spaces/.test(cs.whiteSpace) ? ' ' : char;
      if (visible === '\n' || visible === '\r') continue;
      const line = lines[lines.length - 1];
      if (line && Math.abs(line.y - rect.y) < Math.max(2, rect.height * .2)) {
        line.value += visible; const right = Math.max(line.x + line.width, rect.right); line.x = Math.min(line.x, rect.x); line.width = right - line.x; line.height = Math.max(line.height, rect.height);
      } else lines.push({ value: visible, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      lastRect = rect;
    }
    range.detach();
    return lines.filter(l => l.value.trim() || /pre|break-spaces/.test(cs.whiteSpace)).map(line => {
      let text = line.value;
      if (cs.textTransform === 'uppercase') text = text.toUpperCase();
      if (cs.textTransform === 'lowercase') text = text.toLowerCase();
      if (cs.textTransform === 'capitalize') text = text.replace(/(^|\s)(\S)/g, (_, space: string, ch: string) => space + ch.toUpperCase());
      const lineHeight = px(cs.lineHeight) || px(cs.fontSize) * 1.2;
      const n = base('text', text.trim().slice(0, 45) || '文字', { ...line, y: line.y - (lineHeight - line.height) / 2, height: lineHeight }, parentRect);
      n.text = { value: text, families: splitCSS(cs.fontFamily).map(f => f.replace(/^['"]|['"]$/g, '')), size: px(cs.fontSize) || 16, weight: px(cs.fontWeight) || 400, italic: cs.fontStyle !== 'normal', lineHeight, letterSpacing: px(cs.letterSpacing), color: color(cs.color), decoration: cs.textDecorationLine.includes('line-through') ? 'STRIKETHROUGH' : cs.textDecorationLine.includes('underline') ? 'UNDERLINE' : 'NONE' };
      return n;
    });
  };
  const svgString = (el: Element, rect: DOMRect): string => {
    const clone = el.cloneNode(true) as Element;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(rect.width)); clone.setAttribute('height', String(rect.height));
    const originals = [el, ...el.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    const properties = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight'];
    originals.forEach((original, i) => {
      const copy = copies[i], style = win.getComputedStyle(original);
      for (const attr of Array.from(copy.attributes)) if (/^on/i.test(attr.name)) copy.removeAttribute(attr.name);
      for (const prop of properties) { const value = style.getPropertyValue(prop); if (value && !value.includes('url(')) copy.setAttribute(prop, value); }
      copy.removeAttribute('class'); copy.removeAttribute('style');
      if (['script', 'foreignobject'].includes(copy.tagName.toLowerCase())) { copy.remove(); warn('SVG_UNSUPPORTED', 'SVG 中的脚本和 foreignObject 未导入', el.id || 'SVG'); }
      const href = copy.getAttribute('href') || copy.getAttribute('xlink:href');
      if (href && !href.startsWith('#') && !href.startsWith('data:image/')) { copy.remove(); warn('SVG_EXTERNAL', 'SVG 的外部引用未导入，请先内嵌该资源'); }
    });
    clone.setAttribute('opacity', '1'); // The wrapper carries the SVG element's opacity.
    return new XMLSerializer().serializeToString(clone);
  };
  const walk = (el: Element, parent: { x: number; y: number }, depth: number): SceneNode | null => {
    if (depth > LIMITS.depth) throw new Error('页面嵌套过深，请缩小捕获区域');
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) || el.hasAttribute('data-h2f-ignore')) return null;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0 && cs.display !== 'contents') return null;
    const name = el.getAttribute('aria-label') || el.getAttribute('data-pencil-name') || el.id || `${el.tagName.toLowerCase()}${el.classList.length ? '.' + el.classList[0] : ''}`;
    const n = base(el.tagName.toLowerCase() === 'svg' ? 'svg' : 'frame', name, rect, parent);
    n.opacity = Math.max(0, Math.min(1, Number(cs.opacity) || 1));
    const bg = color(cs.backgroundColor); if (bg.a) n.fills.push({ type: 'solid', color: bg });
    const backgrounds = splitCSS(cs.backgroundImage);
    const sizes = splitCSS(cs.backgroundSize);
    for (let i = backgrounds.length - 1; i >= 0; i--) {
      const layer = backgrounds[i]; if (layer === 'none') continue;
      const g = gradient(layer, rect.width, rect.height);
      if (g) n.fills.push(g);
      else if (/^url\(/.test(layer)) {
        const url = layer.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
        n.fills.push({ type: 'image', assetId: asset(url), fit: sizes[i] === 'contain' ? 'FIT' : cs.backgroundRepeat === 'repeat' ? 'TILE' : 'FILL' });
        if (!['cover', 'contain', 'auto'].includes(sizes[i] || sizes[0])) warn('BACKGROUND_SIZE', '自定义背景图片尺寸以填充模式导入', name);
      } else warn('BACKGROUND_UNSUPPORTED', '部分背景效果未转换（支持纯色和线性渐变）', name);
    }
    const radius = (value: string) => value.includes('%') ? Math.min(rect.width, rect.height) * px(value) / 100 : px(value);
    n.radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(v => Math.min(radius(v), Math.min(rect.width, rect.height) / 2)) as SceneNode['radius'];
    const widths: [number, number, number, number] = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
    if (widths.some(w => w > 0)) {
      const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
      const first = widths.findIndex(w => w > 0);
      n.border = { color: color(colors[first]), widths, dashed: /dashed|dotted/.test([cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle][first]) };
      if (colors.some((c, i) => widths[i] && c !== colors[first])) warn('BORDER_COLORS', '多色边框采用第一个可见边的颜色', name);
    }
    n.effects = effects(cs.boxShadow);
    n.clip = ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowX) || ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowY);
    if (cs.transform !== 'none') warn('TRANSFORM', 'CSS 变换按屏幕包围盒捕获，旋转和倾斜可能有差异', name);
    if (cs.filter !== 'none' || cs.backdropFilter !== 'none' || cs.clipPath !== 'none') warn('VISUAL_EFFECT', '滤镜、背景模糊和 clip-path 未转换', name);
    for (const pseudo of ['::before', '::after']) {
      const style = win.getComputedStyle(el, pseudo);
      if (style.content && !['none', 'normal'].includes(style.content) && style.display !== 'none' && (!['""', "''"].includes(style.content) || color(style.backgroundColor).a > 0 || px(style.borderTopWidth) > 0 || style.backgroundImage !== 'none')) warn('PSEUDO_ELEMENT', '伪元素内容未导入，建议改为真实 DOM 或 SVG', name);
    }
    if (n.kind === 'svg') { n.svg = svgString(el, rect); return n; }
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const img = el as HTMLImageElement;
      if (img.currentSrc || img.src) {
        const id = asset(img.currentSrc || img.src); n.fills.push({ type: 'image', assetId: id, fit: cs.objectFit === 'contain' || cs.objectFit === 'scale-down' ? 'FIT' : 'FILL' });
        if (!img.complete || !img.naturalWidth) warn('IMAGE_NOT_READY', '部分图片未完成加载，导入时会尝试重新获取', name);
        try {
          if (img.naturalWidth > 0 && img.naturalWidth * img.naturalHeight <= 16000000) {
            const canvas = doc.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d')!.drawImage(img, 0, 0); const data = canvas.toDataURL('image/png');
            Object.assign(assets.find(a => a.id === id)!, { mime: 'image/png', base64: data.split(',')[1] });
          }
        } catch { /* cross-origin images resolved later by local browser service */ }
      }
      return n;
    }
    if (['canvas', 'video', 'iframe'].includes(tag)) {
      if (tag === 'canvas') {
        try { n.fills.push({ type: 'image', assetId: asset((el as HTMLCanvasElement).toDataURL('image/png')), fit: 'FILL' }); warn('CANVAS_RASTER', 'Canvas 以位图导入，内部内容不可单独编辑', name); }
        catch { warn('CANVAS_BLOCKED', '受跨域限制的 Canvas 未能捕获', name); }
      } else warn('EMBED_UNSUPPORTED', '视频和 iframe 仅保留容器', name);
      return n;
    }
    if (el.shadowRoot) warn('SHADOW_DOM', 'Shadow DOM 的内部内容未捕获', name);
    n.children = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) n.children.push(...textNodes(child as Text, rect, cs));
      else if (child.nodeType === 1) { const childNode = walk(child as Element, rect, depth + 1); if (childNode) n.children.push(childNode); }
    }
    if (['input', 'textarea'].includes(tag)) {
      const value = (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder;
      if (value) {
        const t = base('text', '表单文字', { x: rect.x + px(cs.paddingLeft) + widths[3], y: rect.y + px(cs.paddingTop) + widths[0], width: Math.max(1, rect.width - px(cs.paddingLeft) - px(cs.paddingRight)), height: px(cs.lineHeight) || px(cs.fontSize) * 1.2 }, rect);
        t.text = { value: (el as HTMLInputElement).type === 'password' ? '•'.repeat(Math.min(value.length, 20)) : value, families: splitCSS(cs.fontFamily).map(f => f.replace(/^['"]|['"]$/g, '')), size: px(cs.fontSize) || 16, weight: px(cs.fontWeight) || 400, italic: cs.fontStyle !== 'normal', lineHeight: px(cs.lineHeight) || px(cs.fontSize) * 1.2, letterSpacing: px(cs.letterSpacing), color: color(cs.color), decoration: 'NONE' };
        n.children.push(t);
      }
    }
    if (cs.display === 'flex' || cs.display === 'inline-flex') {
      const horizontal = cs.flexDirection.startsWith('row');
      const main: Layout['main'] = cs.justifyContent === 'center' ? 'CENTER' : /^(flex-)?end$/.test(cs.justifyContent) ? 'MAX' : cs.justifyContent === 'space-between' ? 'SPACE_BETWEEN' : 'MIN';
      const cross: Layout['cross'] = cs.alignItems === 'center' ? 'CENTER' : /^(flex-)?end$/.test(cs.alignItems) ? 'MAX' : 'MIN';
      const eligible = cs.flexWrap === 'nowrap' && !cs.flexDirection.endsWith('reverse') && !['space-around', 'space-evenly'].includes(cs.justifyContent) && !['baseline', 'last baseline'].includes(cs.alignItems)
        && n.children.length === el.children.length && Array.from(el.children).every(c => { const s = win.getComputedStyle(c); return !['absolute', 'fixed'].includes(s.position) && [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].every(m => m === '0px'); });
      n.layout = { direction: horizontal ? 'HORIZONTAL' : 'VERTICAL', gap: px(horizontal ? cs.columnGap : cs.rowGap), padding: [px(cs.paddingTop) + widths[0], px(cs.paddingRight) + widths[1], px(cs.paddingBottom) + widths[2], px(cs.paddingLeft) + widths[3]], main, cross, eligible };
    }
    return n;
  };
  const rootRect = rootEl.getBoundingClientRect();
  const root = walk(rootEl, rootRect, 0); if (!root) throw new Error('捕获区域不可见或没有可导入内容');
  root.x = root.y = 0;
  if (rootEl === doc.body || rootEl === doc.documentElement) { root.width = Math.max(root.width, (rootEl as HTMLElement).scrollWidth); root.height = Math.max(root.height, (rootEl as HTMLElement).scrollHeight); root.clip = false; }
  const result: CaptureDocument = { schemaVersion: SCHEMA_VERSION, name: options.name?.trim() || doc.title || 'HTML 页面', createdAt: new Date().toISOString(), source: { title: doc.title, url: win.location.href, viewport: { width: win.innerWidth, height: win.innerHeight }, selector }, root, assets, diagnostics, stats: { ...countScene(root), missingAssets: assets.filter(a => !a.base64).length } };
  return result;
}
export async function embedBrowserAssets(document: CaptureDocument) {
  let bytes = document.assets.reduce((n, a) => n + (a.base64?.length || 0) * .75, 0);
  for (const a of document.assets) {
    if (a.base64) continue;
    try {
      if (!/^(https?:|blob:|data:image\/)/i.test(a.url)) throw new Error('资源路径无法直接读取');
      const response = await fetch(a.url, { signal: AbortSignal.timeout(6000), credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob(); if (blob.size > 8 * 1024 * 1024 || bytes + blob.size > LIMITS.assetBytes) throw new Error('图片体积超限');
      if (!blob.type.startsWith('image/')) throw new Error('资源不是图片');
      const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
      a.base64 = data.split(',')[1]; a.mime = blob.type; bytes += blob.size;
    } catch { addDiagnostic(document.diagnostics, 'ASSET_MISSING', '图片无法读取，请使用本地服务捕获，或将图片内嵌到 HTML', a.url.slice(0, 180)); }
  }
  for (const a of document.assets) {
    if (!a.base64 || !a.mime || ['image/png', 'image/jpeg', 'image/gif'].includes(a.mime)) continue;
    try {
      const image = new Image(); image.src = `data:${a.mime};base64,${a.base64}`; await image.decode();
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('图片尺寸超限');
      const canvas = window.document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')!.drawImage(image, 0, 0);
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      const nextBytes = bytes - a.base64.length * .75 + base64.length * .75; if (nextBytes > LIMITS.assetBytes) throw new Error('图片体积超限');
      bytes = nextBytes; a.base64 = base64; a.mime = 'image/png';
    } catch { delete a.base64; addDiagnostic(document.diagnostics, 'IMAGE_FORMAT', '部分图片无法解码，已保留占位', a.url.slice(0, 180)); }
  }
  document.stats.missingAssets = document.assets.filter(a => !a.base64).length;
  return document;
}
if (typeof window !== 'undefined') (window as any).HTMLToFigma = { captureDOM, embedBrowserAssets };

import { validateDocument, countScene, validImportSettings, type ImportSettings, type CaptureDocument, type Asset, type SceneNode, type CanvasPlacement } from './schema';
export const BATCH_LIMITS = { nodes: 120000, assets: 2000, assetBytes: 64 * 1024 * 1024 };
export interface CaptureBundle { schemaVersion: 1; format: 'h2f-bundle'; name: string; createdAt: string; importOptions?: ImportSettings; pages: CaptureDocument[]; assets: Asset[]; errors: { name: string; message: string }[] }
export function isBundle(value: any): value is CaptureBundle { return value?.format === 'h2f-bundle'; }
export function hydratePage(bundle: CaptureBundle, index: number): CaptureDocument {
  const page = bundle.pages[index]; if (!page) throw new Error('页面不存在');
  const shared = new Map(bundle.assets.map(a => [a.id, a]));
  return { ...page, assets: page.assets.map(a => { const resolved = shared.get(a.id); if (!resolved) throw new Error('页面资源引用不存在'); return resolved; }) };
}
function fingerprint(a: Asset) { let hash = 2166136261; const value = a.base64 || a.url; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return `${a.mime}:${value.length}:${hash >>> 0}`; }
export class BundleBuilder {
  readonly bundle: CaptureBundle;
  private buckets = new Map<string, Asset[]>(); private bytes = 0; private nodes = 0;
  constructor(name: string) { this.bundle = { schemaVersion: 1, format: 'h2f-bundle', name, createdAt: new Date().toISOString(), pages: [], assets: [], errors: [] }; }
  add(input: CaptureDocument) {
    validateDocument(input);
    const count = countScene(input.root).nodes; if (this.nodes + count > BATCH_LIMITS.nodes) throw new Error('整批超过 120000 个图层，请分批捕获');
    const mapping = new Map<string, string>(); const refs: Asset[] = [];
    for (const a of input.assets) {
      const key = fingerprint(a); let common = this.buckets.get(key)?.find(x => x.mime === a.mime && (a.base64 ? x.base64 === a.base64 : x.url === a.url));
      if (!common) {
        const bytes = (a.base64?.length || 0) * .75;
        if (this.bytes + bytes > BATCH_LIMITS.assetBytes || this.bundle.assets.length >= BATCH_LIMITS.assets) throw new Error('整批图片资源超限（去重后最多 64 MB、2000 个）');
        common = { ...a, id: `asset-${this.bundle.assets.length + 1}`, url: a.base64 && a.url.startsWith('data:') ? 'embedded-image' : a.url };
        this.bundle.assets.push(common); this.bytes += bytes; this.buckets.set(key, [...(this.buckets.get(key) || []), common]);
      }
      mapping.set(a.id, common.id); if (!refs.some(ref => ref.id === common!.id)) refs.push({ id: common.id, url: `asset:${common.id}`, mime: common.mime });
    }
    const clone = (n: SceneNode): SceneNode => ({ ...n, fills: n.fills.map(p => p.type === 'image' ? { ...p, assetId: mapping.get(p.assetId)! } : p), ...(n.children ? { children: n.children.map(clone) } : {}) });
    this.bundle.pages.push({ ...input, root: clone(input.root), assets: refs }); this.nodes += count;
  }
  addBundle(bundle: CaptureBundle) {
    validateBundle(bundle);
    // Repeated backups and different input files must not share the same canvas placement group.
    const namespace = `bundle-${this.bundle.pages.length}`, canvases = new Map<string, string>();
    bundle.pages.forEach((_, i) => {
      const page = hydratePage(bundle, i), canvas = page.source.canvas;
      if (canvas) {
        if (!canvases.has(canvas.id)) canvases.set(canvas.id, `${namespace}-${canvases.size}`);
        page.source = { ...page.source, canvas: { ...canvas, id: canvases.get(canvas.id)! } };
      }
      this.add(page);
    });
    for (const error of bundle.errors) this.bundle.errors.push(error);
  }
  error(name: string, error: unknown) { this.bundle.errors.push({ name, message: error instanceof Error ? error.message : String(error) }); }
}
export function validateBundle(value: unknown): asserts value is CaptureBundle {
  const b = value as CaptureBundle;
  if (!b || b.schemaVersion !== 1 || b.format !== 'h2f-bundle' || typeof b.name !== 'string' || b.name.length > 500 || !Array.isArray(b.pages) || !b.pages.length || !Array.isArray(b.assets) || b.assets.length > BATCH_LIMITS.assets || !Array.isArray(b.errors)) throw new Error('多页数据格式无效');
  if(b.importOptions!==undefined&&!validImportSettings(b.importOptions))throw new Error('导入设置无效');
  const ids = new Set<string>(); let bytes = 0, nodes = 0;
  for (const a of b.assets) { if (!a || typeof a.id !== 'string' || ids.has(a.id) || typeof a.url !== 'string' || (a.base64 !== undefined && typeof a.base64 !== 'string')) throw new Error('共享资源无效'); ids.add(a.id); bytes += (a.base64?.length || 0) * .75; }
  if (bytes > BATCH_LIMITS.assetBytes) throw new Error('整批图片超过 64 MB');
  for (let i = 0; i < b.pages.length; i++) { const page = hydratePage(b, i); validateDocument(page); nodes += countScene(page.root).nodes; }
  if (nodes > BATCH_LIMITS.nodes) throw new Error('整批超过 120000 个图层');
  if (b.errors.some(e => !e || typeof e.name !== 'string' || typeof e.message !== 'string')) throw new Error('页面错误记录无效');
}
export interface DiscoveredPage { element: Element; selector: string; name: string; canvas?: CanvasPlacement }
export function discoverPages(doc: Document, baseSelector: string, split: boolean, pageSelector = '', canvasId = `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`): DiscoveredPage[] {
  let root: Element | null;
  try { root = doc.querySelector(baseSelector || 'body'); } catch { throw new Error('捕获区域选择器格式不正确'); }
  if (!root) throw new Error(`没有找到选择器：${baseSelector}`);
  let pages: Element[] = [];
  if (split) {
    if (pageSelector.trim()) {
      try { pages = Array.from(root.querySelectorAll(pageSelector)); if (root.matches(pageSelector)) pages.unshift(root); } catch { throw new Error('页面选择器格式不正确'); }
      if (!pages.length) throw new Error(`没有找到页面：${pageSelector}`);
    } else {
      for (const candidate of ['[data-pencil-name]', '[data-artboard]', '[data-page]', '.page', '.slide', '.artboard']) {
        const elements = Array.from(root.querySelectorAll(candidate)); const top = elements.filter(el => { const ancestor = el.parentElement?.closest(candidate); return !ancestor || !root!.contains(ancestor); });
        if (top.length >= 2) { pages = top; break; }
      }
    }
  }
  if (!pages.length) pages = [root];
  const placements = new Map<Element, CanvasPlacement>();
  if (split && pages.length > 1 && doc.defaultView) {
    const groups = new Map<Element, Element[]>();
    for (const page of pages) {
      if (!page.parentElement) continue;
      const siblings = groups.get(page.parentElement);
      if (siblings) siblings.push(page); else groups.set(page.parentElement, [page]);
    }
    let groupIndex = 0;
    for (const [parent, siblings] of groups) {
      // Absolute design exports are pieces of one canvas. Ordinary flow pages and dynamic states
      // remain independent and use the existing grid arrangement.
      if (siblings.length < 2 || !siblings.every(el => doc.defaultView!.getComputedStyle(el).position === 'absolute')) continue;
      const base = parent.getBoundingClientRect(), bounds = siblings.map(el => el.getBoundingClientRect());
      const round = (n: number) => Math.round(n * 100) / 100;
      const width = round(bounds.reduce((max, r) => Math.max(max, r.right - base.left), Math.max(base.width, parent.scrollWidth)));
      const height = round(bounds.reduce((max, r) => Math.max(max, r.bottom - base.top), Math.max(base.height, parent.scrollHeight)));
      const id = `${canvasId}-${groupIndex++}`;
      siblings.forEach((el, i) => placements.set(el, { id, x: round(bounds[i].left - base.left), y: round(bounds[i].top - base.top), width, height }));
    }
  }
  return pages.map((element, i) => {
    element.setAttribute('data-h2f-capture-page', String(i));
    const name = element.getAttribute('data-pencil-name') || element.getAttribute('data-page-name') || element.getAttribute('aria-label') || element.getAttribute('data-page') || element.querySelector('h1,h2')?.textContent?.trim() || `${doc.title || '页面'} ${String(i + 1).padStart(3, '0')}`;
    return { element, selector: `[data-h2f-capture-page="${i}"]`, name: name.slice(0, 150), ...(placements.has(element) ? { canvas: placements.get(element)! } : {}) };
  });
}

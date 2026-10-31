import { validArtifact, type DesignArtifact } from './design-artifact';
import { validOrganization, type DesignOrganization } from './design-organization';
export const SCHEMA_VERSION = 1 as const;
export const LIMITS = { nodes: 6000, depth: 64, text: 250000, assets: 300, assetBytes: 24 * 1024 * 1024, dimension: 100000 };
export type Color = { r: number; g: number; b: number; a: number };
export type Paint =
  | { type: 'solid'; color: Color }
  | { type: 'linear'; stops: { color: Color; position: number }[]; transform: [[number, number, number], [number, number, number]] }
  | { type: 'image'; assetId: string; fit: 'FILL' | 'FIT' | 'TILE' };
export interface Diagnostic { code: string; message: string; node?: string; count?: number }
export interface Asset { id: string; url: string; mime?: string; base64?: string }
export interface Layout {
  direction: 'HORIZONTAL' | 'VERTICAL'; gap: number; padding: [number, number, number, number];
  main: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN'; cross: 'MIN' | 'CENTER' | 'MAX'; eligible: boolean;
}
export interface SceneNode {
  id: string; kind: 'frame' | 'text' | 'svg'; name: string; captureKey?: string;
  x: number; y: number; width: number; height: number; opacity: number;
  fills: Paint[]; radius?: [number, number, number, number];
  border?: { color: Color; widths: [number, number, number, number]; dashed?: boolean; align?: 'INSIDE' | 'CENTER' | 'OUTSIDE' };
  effects?: { inner: boolean; color: Color; x: number; y: number; blur: number; spread: number }[];
  clip?: boolean; layout?: Layout; children?: SceneNode[];
  text?: { value: string; families: string[]; size: number; weight: number; italic: boolean; lineHeight: number; letterSpacing: number; color: Color; decoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' };
  svg?: string;
}
export interface CanvasPlacement {
  id: string; x: number; y: number; width: number; height: number;
}
// A canvas can span many individually captured pages, so its extent is larger than a single node.
export function isCanvasPlacement(value: unknown): value is CanvasPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const canvas = value as CanvasPlacement, max = 10000000;
  return typeof canvas.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(canvas.id)
    && [canvas.x, canvas.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max)
    && [canvas.width, canvas.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max);
}
export interface ImportSettings { smartLayout: boolean }
export function validImportSettings(value: unknown): value is ImportSettings { return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as ImportSettings).smartLayout === 'boolean'; }
export interface CaptureDocument {
  schemaVersion: 1; name: string; createdAt: string; importOptions?: ImportSettings;
  source: { title: string; url: string; viewport: { width: number; height: number }; selector: string; artifact?: DesignArtifact; canvas?: CanvasPlacement; design?: DesignOrganization; longPage?: { expanded: true; containers: { name: string; width: number; height: number }[]; mergedStateIds: string[] } };
  root: SceneNode; assets: Asset[]; diagnostics: Diagnostic[];
  stats: { nodes: number; texts: number; images: number; vectors: number; missingAssets: number };
}
export type ImportMode = 'visual' | 'auto';
export function countScene(root: SceneNode) {
  let nodes = 0, texts = 0, images = 0, vectors = 0;
  const walk = (n: SceneNode) => { nodes++; texts += Number(n.kind === 'text'); vectors += Number(n.kind === 'svg'); images += n.fills.filter(p => p.type === 'image').length; n.children?.forEach(walk); };
  walk(root); return { nodes, texts, images, vectors };
}
export function addDiagnostic(list: Diagnostic[], code: string, message: string, node?: string) {
  const match = list.find(d => d.code === code && d.message === message);
  if (match) match.count = (match.count || 1) + 1;
  else if (list.length < 200) list.push({ code, message, node, count: 1 });
}
export function validateDocument(input: unknown): asserts input is CaptureDocument {
  const fail = (s: string): never => { throw new Error(`捕获数据无效：${s}`); };
  const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
  const number = (v: unknown, max = LIMITS.dimension, min = -max): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const color = (v: unknown) => object(v) && ['r', 'g', 'b', 'a'].every(k => number(v[k], 1, 0));
  const tuple = (v: unknown, len: number, min = 0) => Array.isArray(v) && v.length === len && v.every(x => number(x, LIMITS.dimension, min));
  if (!object(input) || input.schemaVersion !== SCHEMA_VERSION) fail('版本不兼容，请使用本插件生成的 .h2f.json 文件');
  const doc = input as Record<string, any>;
  if (doc.importOptions !== undefined && !validImportSettings(doc.importOptions)) fail('导入设置无效');
  if (typeof doc.name !== 'string' || doc.name.length > 500) fail('名称过长或缺失');
  if (!object(doc.source) || !object(doc.source.viewport) || !number(doc.source.viewport.width, LIMITS.dimension, 1) || !number(doc.source.viewport.height, LIMITS.dimension, 1) || typeof doc.source.url !== 'string' || typeof doc.source.selector !== 'string') fail('缺少页面信息');
  if (doc.source.artifact !== undefined && !validArtifact(doc.source.artifact)) fail('设计稿项信息无效');
  if (doc.source.canvas !== undefined && !isCanvasPlacement(doc.source.canvas)) fail('原画布位置信息无效');
  if (doc.source.design !== undefined && !validOrganization(doc.source.design)) fail('页面分类信息无效');
  if (doc.source.longPage !== undefined) { const p=doc.source.longPage;if(!object(p)||p.expanded!==true||!Array.isArray(p.containers)||p.containers.length>32||p.containers.some((c:any)=>!object(c)||typeof c.name!=='string'||c.name.length>150||!number(c.width,LIMITS.dimension,.01)||!number(c.height,LIMITS.dimension,.01))||!Array.isArray(p.mergedStateIds)||p.mergedStateIds.some((id:any)=>typeof id!=='string'||!/^[\w-]{1,80}$/.test(id)))fail('长页信息无效'); }
  if (!Array.isArray(doc.assets) || doc.assets.length > LIMITS.assets) fail('资源数量超限');
  const ids = new Set<string>(); let assetBytes = 0;
  for (const a of doc.assets) {
    if (!object(a) || typeof a.id !== 'string' || ids.has(a.id) || typeof a.url !== 'string') fail('资源 ID 或地址无效');
    ids.add(a.id);
    if (a.base64 !== undefined) {
      if (typeof a.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64) || a.base64.length % 4 !== 0) fail('图片编码无效');
      assetBytes += a.base64.length * .75;
      if (assetBytes > LIMITS.assetBytes) fail('图片资源超过 24 MB');
    }
  }
  if (!Array.isArray(doc.diagnostics) || doc.diagnostics.length > 200 || doc.diagnostics.some((d: any) => !object(d) || typeof d.code !== 'string' || typeof d.message !== 'string' || d.message.length > 2000)) fail('诊断数据无效');
  const nodeIds = new Set<string>(); let nodes = 0, chars = 0;
  const walk = (n: any, depth: number) => {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('图层数量或嵌套深度超限');
    if (!object(n) || !['frame', 'text', 'svg'].includes(n.kind) || typeof n.name !== 'string' || n.name.length > 500 || typeof n.id !== 'string' || nodeIds.has(n.id)) fail('图层类型、名称或 ID 无效');
    nodeIds.add(n.id);
    if (!number(n.x) || !number(n.y) || !number(n.width, LIMITS.dimension, .01) || !number(n.height, LIMITS.dimension, .01) || !number(n.opacity, 1, 0)) fail(`图层坐标或尺寸无效：${n.name} [${n.x}, ${n.y}, ${n.width}, ${n.height}]`);
    if (!Array.isArray(n.fills) || n.fills.length > 20) fail('填充无效');
    for (const p of n.fills) {
      if (!object(p)) fail('填充格式无效');
      if (p.type === 'solid') { if (!color(p.color)) fail('颜色无效'); }
      else if (p.type === 'image') { if (!ids.has(p.assetId) || !['FILL', 'FIT', 'TILE'].includes(p.fit)) fail('图片引用无效'); }
      else if (p.type === 'linear') {
        if (!Array.isArray(p.stops) || p.stops.length < 2 || p.stops.length > 50 || p.stops.some((s: any) => !object(s) || !color(s.color) || !number(s.position, 1, 0))) fail('渐变色标无效');
        if (!Array.isArray(p.transform) || p.transform.length !== 2 || !p.transform.every((row: any) => tuple(row, 3, -LIMITS.dimension))) fail('渐变矩阵无效');
      } else fail('不支持的填充类型');
    }
    if (n.radius !== undefined && !tuple(n.radius, 4)) fail('圆角无效');
    if (n.border !== undefined && (!object(n.border) || !color(n.border.color) || !tuple(n.border.widths, 4) || (n.border.align !== undefined && !['INSIDE', 'CENTER', 'OUTSIDE'].includes(n.border.align)))) fail('边框无效');
    if (n.effects !== undefined && (!Array.isArray(n.effects) || n.effects.length > 10 || n.effects.some((e: any) => !object(e) || !color(e.color) || !number(e.x) || !number(e.y) || !number(e.blur, LIMITS.dimension, 0) || !number(e.spread)))) fail('阴影无效');
    if (n.layout !== undefined) {
      const l = n.layout;
      if (!object(l) || !['HORIZONTAL', 'VERTICAL'].includes(l.direction) || !number(l.gap, LIMITS.dimension, 0) || !tuple(l.padding, 4) || !['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'].includes(l.main) || !['MIN', 'CENTER', 'MAX'].includes(l.cross) || typeof l.eligible !== 'boolean') fail('布局无效');
    }
    if (n.kind === 'text') {
      const t = n.text;
      if (!object(t) || typeof t.value !== 'string' || !Array.isArray(t.families) || t.families.length > 30 || t.families.some((f: any) => typeof f !== 'string' || f.length > 200) || !number(t.size, 1000, .01) || !number(t.weight, 1000, 1) || !number(t.lineHeight, 10000, .01) || !number(t.letterSpacing, 1000) || !color(t.color) || !['NONE', 'UNDERLINE', 'STRIKETHROUGH'].includes(t.decoration)) fail('文字样式无效');
      chars += t.value.length; if (chars > LIMITS.text) fail('文字总量超限');
    }
    if (n.kind === 'svg' && (typeof n.svg !== 'string' || n.svg.length > 2 * 1024 * 1024 || !/^\s*<svg[\s>]/i.test(n.svg))) fail('SVG 无效');
    if (n.children !== undefined && !Array.isArray(n.children)) fail('子图层无效');
    n.children?.forEach((child: any) => walk(child, depth + 1));
  };
  walk(doc.root, 0);
}

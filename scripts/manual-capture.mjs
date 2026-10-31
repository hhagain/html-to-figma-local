import { randomBytes, createHash } from 'node:crypto';
import { captureLoadedPage, validateCaptureRequest } from './browser.mjs';
import { openCaptureSource } from './capture-source.mjs';
import { inspectDesign } from './design-snapshot.mjs';
import { inspectState } from './interaction-inspector.mjs';
import { designOutput } from './design-output.mjs';
import { inferOrganization } from '../dist/lib/design-organization.js';
import { countScene, validateDocument } from '../dist/lib/schema.js';
import { BundleBuilder } from '../dist/lib/bundle.js';

const id = () => randomBytes(12).toString('hex');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const label = value => String(value || '').trim().slice(0, 150);
const MODES = new Set(['viewport', 'long']);
const MEMORY_BYTES = 256 * 1024 * 1024;
export function validateManualOptions(input = {}) {
  if (input.collectExtras !== undefined && typeof input.collectExtras !== 'boolean') throw new Error('组件和图标整理开关无效');
  if (input.layout !== undefined && !['selection', 'smart'].includes(input.layout)) throw new Error('导出排版选项无效');
  return { collectExtras: input.collectExtras !== false, layout: input.layout || 'selection' };
}

// A retained editable subtree, not a screenshot and not an interaction replay.
export function extractManualArtifact(document, selector, entry) {
  const find = node => node.captureKey === selector ? node : (node.children || []).map(find).find(Boolean);
  const original = find(document.root); if (!original) return null;
  const root = structuredClone(original); root.x = root.y = 0;
  const used = new Set();
  const clean = node => { delete node.captureKey; for (const fill of node.fills) if (fill.type === 'image') used.add(fill.assetId); for (const child of node.children || []) clean(child); };
  clean(root);
  const result = { ...document, name: entry.name, root, source: { ...document.source, selector, artifact: entry.artifact, design: entry.design }, assets: document.assets.filter(a => used.has(a.id)), stats: { ...countScene(root), missingAssets: document.assets.filter(a => used.has(a.id) && !a.base64).length } };
  validateDocument(result); return result;
}

export async function openManualCapture(browser, raw, { serviceOrigin } = {}) {
  const options = validateCaptureRequest(raw), settings = validateManualOptions(raw.options);
  const source = await openCaptureSource(options.url);
  const context = await browser.newContext({ viewport: { width: options.width, height: options.height }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
  try {
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      // Original HTML never executes in the authenticated workbench or native bridge.
      if (serviceOrigin && url.origin === serviceOrigin && !url.pathname.startsWith('/source/')) return route.abort();
      const local = await source.read(request.url());
      if (local) return ['GET', 'HEAD'].includes(request.method()) ? route.fulfill(local) : route.abort();
      if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return route.abort();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && url.origin !== new URL(source.url).origin) return route.abort();
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    const session = new ManualCapture(context, page, source, options, settings);
    context.on('page', popup => { if (popup !== page) void popup.close(); });
    page.on('download', download => { void download.cancel(); });
    page.on('dialog', dialog => { session.dialog = dialog; });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) session.dirtyAt = Date.now(); });
    const response = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (source.local && response && !response.ok()) throw new Error(`本地页面无法读取：HTTP ${response.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    if (!session.dialog) await session.observe().catch(error => { session.warning = error.message; });
    return session;
  } catch (error) { await context.close(); throw error; }
}

class ManualCapture {
  constructor(context, page, source, options, settings) {
    Object.assign(this, { context, page, source, options, settings });
    this.id = id(); this.marks = []; this.selected = []; this.entries = []; this.observations = new Map(); this.artifacts = new Map();
    this.bytes = 0; this.closed = false; this.chain = Promise.resolve(); this.dirtyAt = 0; this.lastObserved = 0; this.warning = ''; this.dialog = null; this.lastImage = null;
  }
  run(fn) {
    const task = this.chain.catch(() => {}).then(() => { if (this.closed) throw new Error('手动标记会话已结束，请重新打开原网页'); return fn(); });
    this.chain = task.catch(() => {}); return task;
  }
  snapshot() {
    return { id: this.id, closed: this.closed, url: this.source.toSourceURL(this.page.url()), viewport: { width: this.options.width, height: this.options.height }, options: this.settings, observed: this.entries.length, warning: this.warning,
      marks: this.marks.map(m => ({ id: m.id, name: m.name, mode: m.mode, longAvailable: !!m.long, longError: m.longError, selected: this.selected.includes(m.id), order: this.selected.indexOf(m.id) + 1, viewportHeight: m.viewport.document.root.height, longHeight: m.long?.document.root.height })),
      selectedIds: [...this.selected], dialog: this.dialog ? { type: this.dialog.type(), message: this.dialog.message(), defaultValue: this.dialog.defaultValue() } : null };
  }
  reserve(values) {
    const bytes = Buffer.byteLength(JSON.stringify(values));
    if (this.bytes + bytes > MEMORY_BYTES) throw new Error('本次记录已达到 256 MB 暂存预算，请先导出已有标记，再开始下一批');
    this.bytes += bytes; return bytes;
  }
  async observe() {
    if (this.dialog || this.closed) return null;
    const designSnapshot = await inspectDesign(this.page, this.options.selector);
    // Only elements actually visible in the live browser participate in manual extras.
    const selectors = [...new Set([...designSnapshot.regions, ...designSnapshot.icons].map(r => r.selector))];
    const visible = new Set(await this.page.evaluate(selectors => selectors.filter(selector => {
      const el = document.querySelector(selector); if (!el) return false; const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.right <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
      for (let p = el.parentElement; p; p = p.parentElement) { const s=getComputedStyle(p),box=p.getBoundingClientRect(); if (/hidden|clip|auto|scroll/.test(s.overflowY) && (r.bottom <= box.top || r.top >= box.bottom)) return false; }
      return true;
    }), selectors));
    designSnapshot.regions = designSnapshot.regions.filter(r => visible.has(r.selector)); designSnapshot.icons = designSnapshot.icons.filter(r => visible.has(r.selector));
    const key = digest([designSnapshot.identity, designSnapshot.layout, designSnapshot.regions.map(r => [r.selector, r.shape, r.state]), designSnapshot.icons.map(r => r.hash)]);
    this.lastObserved = Date.now();
    if (this.observations.has(key)) return this.observations.get(key);
    const actual = await inspectState(this.page, this.source.local);
    const previous = this.entries.at(-1);
    const design = inferOrganization({ url: this.source.toSourceURL(this.page.url()), entryURL: this.options.url, heading: actual.heading, title: actual.title, dialog: actual.dialog, viewFingerprint: actual.viewFingerprint, ...actual.structure, scrolls: actual.scrolls, parent: previous?.design, parentURL: previous?.url });
    const entry = { id: id(), observationId: id(), name: label(actual.heading || actual.title || '当前页面'), url: this.source.toSourceURL(this.page.url()), design, designSnapshot };
    const catalog = designOutput([entry]);
    const pending = catalog.pages.filter(a => a.artifact?.kind !== 'page' && !this.artifacts.has(a.id));
    if (this.settings.collectExtras && pending.length) {
      const captureKeys = [...new Set(pending.map(a => a.selector))];
      const result = await captureLoadedPage(this.page, this.context, { ...this.options, captureKeys }, { source: this.source, preview: false });
      const image = 'data:image/jpeg;base64,' + (await this.page.screenshot({ type: 'jpeg', quality: 65, timeout: 8000 })).toString('base64');
      const rectangles = await this.page.evaluate(selectors => Object.fromEntries(selectors.map(s => { const r=document.querySelector(s)?.getBoundingClientRect();return [s,r?{x:r.x,y:r.y,width:r.width,height:r.height}:null]; })), captureKeys);
      const crops = await this.page.evaluate(async ({ image, rectangles }) => {
        const bitmap = new Image(); bitmap.src = image; await bitmap.decode(); const result = {};
        for (const [key, r] of Object.entries(rectangles)) {
          if (!r) continue; const x=Math.max(0,r.x),y=Math.max(0,r.y),width=Math.min(bitmap.width,r.x+r.width)-x,height=Math.min(bitmap.height,r.y+r.height)-y;
          if (width <= 0 || height <= 0) continue;
          const scale=Math.min(1,640/width,800/height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));canvas.getContext('2d').drawImage(bitmap,x,y,width,height,0,0,canvas.width,canvas.height);result[key]=canvas.toDataURL('image/jpeg',.75);
        }
        return result;
      }, { image, rectangles });
      const captured = pending.map(a => ({ id: a.id, entry: a, document: extractManualArtifact(result.document, a.selector, a), preview: crops[a.selector] || image })).filter(a => a.document);
      this.reserve(captured);
      for (const artifact of captured) this.artifacts.set(artifact.id, artifact);
    }
    this.reserve(entry); this.entries.push(entry); this.observations.set(key, entry); return entry;
  }
  frame() { return this.run(async () => {
    if (!this.dialog && this.settings.collectExtras && Date.now() - this.lastObserved > 1000 && Date.now() - this.dirtyAt > 450) {
      try { await this.observe(); } catch (error) { this.warning = '组件记录：' + error.message; }
    }
    if (!this.dialog) this.lastImage = 'data:image/jpeg;base64,' + (await this.page.screenshot({ type: 'jpeg', quality: 80, timeout: 8000 })).toString('base64');
    const select = this.dialog ? null : await this.page.evaluate(() => { const el=document.activeElement;return el?.tagName === 'SELECT' ? { value: el.value, options: [...el.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled})), multiple: el.multiple } : null; });
    return { ...this.snapshot(), image: this.lastImage, select };
  }); }
  input(raw) { return this.run(async () => {
    const events = Array.isArray(raw.events) ? raw.events : [raw]; if (events.length > 100) throw new Error('单次操作过多');
    let clipboard;
    for (const event of events) {
      if (!event || typeof event !== 'object') throw new Error('操作格式无效');
      if (event.type === 'dialog') { if (this.dialog) { const dialog=this.dialog;this.dialog=null;event.accept ? await dialog.accept(String(event.text || '').slice(0,20000)) : await dialog.dismiss(); } continue; }
      if (this.dialog) throw new Error('请先处理网页对话框');
      if (['move','down','up','click','wheel'].includes(event.type)) {
        if (![event.x,event.y].every(Number.isFinite) || event.x < 0 || event.y < 0 || event.x > this.options.width || event.y > this.options.height) throw new Error('点击坐标超出页面范围');
        await this.page.mouse.move(event.x, event.y);
        const button = ['left','right','middle'].includes(event.button) ? event.button : 'left';
        if (event.type === 'down') await this.page.mouse.down({ button, clickCount: event.clickCount === 2 ? 2 : 1 });
        if (event.type === 'up') await this.page.mouse.up({ button, clickCount: event.clickCount === 2 ? 2 : 1 });
        if (event.type === 'click') await this.page.mouse.click(event.x,event.y,{button,clickCount:event.clickCount === 2 ? 2 : 1});
        if (event.type === 'wheel') { if (![event.deltaX,event.deltaY].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000)) throw new Error('滚动距离无效'); await this.page.mouse.wheel(event.deltaX,event.deltaY); }
      } else if (event.type === 'copy') {
        clipboard=await this.page.evaluate(()=>{const el=document.activeElement;return el&&['INPUT','TEXTAREA'].includes(el.tagName)?el.value.slice(el.selectionStart||0,el.selectionEnd||0):String(getSelection());});
      } else if (event.type === 'text') {
        if (typeof event.text !== 'string' || event.text.length > 20000) throw new Error('输入内容过长');
        await this.page.keyboard.insertText(event.text);
      } else if (event.type === 'key') {
        if (typeof event.key !== 'string' || event.key.length > 80 || !['press','down','up',undefined].includes(event.action)) throw new Error('按键无效');
        await this.page.keyboard[event.action || 'press'](event.key);
      } else if (event.type === 'select') {
        if (typeof event.value !== 'string' || event.value.length > 20000) throw new Error('选项无效');
        await this.page.locator('select:focus').selectOption(event.value);
      } else if (['back','forward','reload'].includes(event.type)) {
        const method = {back:'goBack',forward:'goForward',reload:'reload'}[event.type];
        await this.page[method]({waitUntil:'domcontentloaded',timeout:15000});
      } else throw new Error('不支持的手动操作');
      if (event.type !== 'move') this.dirtyAt = Date.now();
    }
    return { ...this.snapshot(), ...(clipboard!==undefined?{clipboard}:{}) };
  }); }
  mark(raw = {}) { return this.run(async () => {
    if (this.dialog) throw new Error('请先处理网页对话框');
    const mode = raw.mode || 'viewport'; if (!MODES.has(mode)) throw new Error('捕获范围必须为当前页面或完整长页');
    const observation = await this.observe();
    const name = label(raw.name || observation?.name || `页面 ${this.marks.length + 1}`); if (!name) throw new Error('请输入页面名称');
    const viewport = await captureLoadedPage(this.page,this.context,this.options,{source:this.source,viewportOnly:true,name});
    let long = null, longError = '';
    try { long = await captureLoadedPage(this.page,this.context,this.options,{source:this.source,longPage:true,name}); }
    catch (error) { longError = error.message; if (mode === 'long') throw error; }
    const mark = { id:id(),name,mode,observationId:observation?.observationId,viewport,long,longError,design:observation?.design };
    mark.bytes = this.reserve(mark); this.marks.push(mark); this.selected.push(mark.id); return this.snapshot();
  }); }
  update(raw) { return this.run(async () => {
    if (raw.options) {
      const previous=this.settings;this.settings=validateManualOptions({...this.settings,...raw.options});
      if (!previous.collectExtras && this.settings.collectExtras) { this.observations.clear(); this.lastObserved=0; }
    }
    if (raw.id) {
      const mark=this.marks.find(m=>m.id===raw.id); if (!mark) throw new Error('标记不存在');
      if (raw.name !== undefined) { if (typeof raw.name !== 'string' || !label(raw.name)) throw new Error('页面名称无效'); mark.name=label(raw.name); }
      if (raw.mode !== undefined) { if (!MODES.has(raw.mode) || raw.mode === 'long' && !mark.long) throw new Error(mark.longError || '长页快照不可用');mark.mode=raw.mode; }
      if (raw.selected !== undefined) {
        if (typeof raw.selected !== 'boolean') throw new Error('勾选状态无效');
        this.selected=this.selected.filter(value=>value!==mark.id);if(raw.selected)this.selected.push(mark.id);
      }
      if (raw.remove === true) { this.bytes=Math.max(0,this.bytes-(mark.bytes||0));this.marks=this.marks.filter(m=>m.id!==mark.id);this.selected=this.selected.filter(value=>value!==mark.id); }
    }
    return this.snapshot();
  }); }
  export() { return this.run(async () => {
    const selected = this.selected.map(value=>this.marks.find(m=>m.id===value)).filter(Boolean);
    if (!selected.length) throw new Error('请至少勾选一个页面');
    const builder=new BundleBuilder('手动标记的设计稿'), previews=[];
    for (const mark of selected) {
      const capture=mark.mode==='long'?mark.long:mark.viewport;
      const document=structuredClone(capture.document);document.name=mark.name;document.source.design=mark.design?{...mark.design,stateName:mark.name}:undefined;
      document.source.artifact={kind:'page',familyId:mark.design?.pageId||mark.id,familyName:mark.design?.pageName||mark.name,stateName:mark.name,reason:'用户手动标记并勾选的页面',sampleCount:1};
      builder.add(document);previews.push(capture.preview);
    }
    let extras=[];
    if (this.settings.collectExtras) {
      const selectedObservations=new Set(selected.map(m=>m.observationId));
      const catalog=designOutput(this.entries.filter(e=>!selectedObservations.has(e.observationId)));
      for(const entry of catalog.pages.filter(e=>e.artifact?.kind!=='page')) {
        const cached=this.artifacts.get(entry.id); if(!cached)continue;
        const document={...cached.document,name:entry.name,source:{...cached.document.source,design:entry.design,artifact:entry.artifact}};
        builder.add(document);previews.push(cached.preview);extras.push(entry.artifact.kind);
      }
    }
    builder.bundle.importOptions={smartLayout:this.settings.layout==='smart'};
    return {bundle:builder.bundle,previewImages:previews,report:{schemaVersion:1,mode:'manual',status:'complete',completed:builder.bundle.pages.length,total:builder.bundle.pages.length,failed:0,selectedPages:selected.length,observedStates:this.entries.length,components:extras.filter(k=>k==='component').length,icons:extras.filter(k=>k==='icon').length,options:{...this.settings},limitations:['只包含用户手动操作时已记录到的状态；未浏览状态不会自动穷举。','完整长页只展开主滚动区域，保留局部列表、折叠内容与弹窗的视口。','虚拟列表和无限滚动只包含当时已加载的内容。'],...(this.warning?{warning:this.warning}:{})}};
  }); }
  async close() { this.closed=true; await this.context.close().catch(()=>{});await this.chain.catch(()=>{}); }
}

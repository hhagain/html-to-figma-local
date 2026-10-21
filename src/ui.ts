import { captureDOM, embedBrowserAssets } from './capture';
import { validateDocument, countScene, type CaptureDocument, type Diagnostic, type ImportMode } from './schema';
import demoHTML from '../examples/dashboard.html';
import { readTailwind, compileTailwind } from './tailwind';
import { BundleBuilder, discoverPages, hydratePage, isBundle, validateBundle, type CaptureBundle } from './bundle';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const plugin = window.parent !== window;
document.body.classList.toggle('is-plugin', plugin);
let tab = 'file', source = '', sourceName = '', prepared: CaptureDocument | null = null, busy = false;
let frame: HTMLIFrameElement | null = null, controller: AbortController | null = null;
let sourceFiles: File[] = [], preparedBundle: CaptureBundle | null = null, captureStopped = false, importing = false;
let pageStates: { selected: boolean; state: 'pending' | 'working' | 'complete' | 'failed'; detail?: string }[] = [];
let queue: number[] = [], queuePosition = 0, batchId = '';
const service = 'http://127.0.0.1:3847';
const session = (window as any).__LOCAL_SESSION__ as { token: string } | undefined;
if (session?.token) {
  input('service-token').value = session.token; $('pairing-code').textContent = session.token;
  $('local-pairing').hidden = false; $('connection-label').textContent = '本地服务已连接'; $('connection-dot').classList.add('connected');
}
function mode(): ImportMode { return document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === 'auto' ? 'auto' : 'visual'; }
function message(type: string, content: Record<string, unknown> = {}) { if (plugin) window.parent.postMessage({ pluginMessage: { type, ...content } }, '*'); }
function status(text: string, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function setBusy(value: boolean, importing = false) {
  busy = value;
  for (const el of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('button,input,textarea')) {
    if (el.id !== 'cancel') el.disabled = value;
  }
  $('progress-wrap').hidden = !value;
  $('cancel').hidden = !value;
  if (value) $<HTMLProgressElement>('progress').removeAttribute('value');
  $('prepare-label').textContent = value ? '处理中…' : '解析并预览';
}
function invalidate() {
  prepared = null; preparedBundle = null; pageStates = []; $('page-list-section').hidden = true; $('report').hidden = true; $('ready-actions').hidden = true;
  $('prepare').hidden = false;
}
function updateWarnings(diagnostics: Diagnostic[]) {
  $('warnings').hidden = diagnostics.length === 0;
  $('warning-title').textContent = `${diagnostics.length} 项转换说明`;
  $('warning-list').replaceChildren(...diagnostics.map(d => { const li = document.createElement('li'); li.textContent = `${d.message}${(d.count || 1) > 1 ? `（${d.count} 处）` : ''}`; return li; }));
}
function showPrepared(doc: CaptureDocument) { const builder = new BundleBuilder(doc.name); builder.add(doc); showBundle(builder.bundle); }
function showBundle(bundle: CaptureBundle) {
  validateBundle(bundle); preparedBundle = bundle; prepared = hydratePage(bundle, 0);
  pageStates = bundle.pages.map(() => ({ selected: true, state: 'pending' }));
  const stats = bundle.pages.reduce((sum, page) => { const s = countScene(page.root); for (const key of ['nodes', 'texts', 'images', 'vectors'] as const) sum[key] += s[key]; return sum; }, { nodes: 0, texts: 0, images: 0, vectors: 0 });
  $('report').hidden = false; $('ready-actions').hidden = false; $('prepare').hidden = true;
  $('report-title').textContent = bundle.pages.length > 1 ? `已准备好 ${bundle.pages.length} 页` : '已准备好';
  $('report-summary').textContent = bundle.pages.length > 1 ? `${bundle.name} · 图片资源已跨页去重` : `${Math.round(prepared.root.width)} × ${Math.round(prepared.root.height)} px · ${prepared.name}`;
  $('stat-nodes').textContent = String(stats.nodes); $('stat-text').textContent = String(stats.texts); $('stat-image').textContent = String(stats.images); $('stat-svg').textContent = String(stats.vectors);
  $('preview-size').textContent = bundle.pages.length > 1 ? `${bundle.pages.length} 页` : `${Math.round(prepared.root.width)} × ${Math.round(prepared.root.height)}`;
  const diagnostics = bundle.pages.flatMap(page => page.diagnostics).slice(0, 100);
  diagnostics.push(...bundle.errors.map(error => ({ code: 'PAGE_CAPTURE_FAILED', message: `${error.name}：${error.message}` })));
  updateWarnings(diagnostics); renderPageList();
  $('import').textContent = plugin ? `导入到 Figma${bundle.pages.length > 1 ? `（${bundle.pages.length} 页）` : ''}` : '下载 Figma 数据';
  $('download').hidden = !plugin;
  const missing = bundle.assets.filter(a => !a.base64).length;
  status(missing ? `${missing} 个共享图片资源未能读取，导入时将保留占位。` : plugin ? '内容已就绪，多页会逐页导入；取消时保留已完成的页面。' : '下载数据后，将文件拖入 Figma 插件即可继续。');
}
function renderPageList() {
  if (!preparedBundle) return;
  $('page-list-section').hidden = preparedBundle.pages.length < 2;
  $('page-list-title').textContent = `页面列表 · ${pageStates.filter(p => p.selected).length} / ${pageStates.length}`;
  $('page-list').replaceChildren(...preparedBundle.pages.map((page, i) => {
    const label = document.createElement('label'); label.className = 'page-row';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = pageStates[i].selected; box.disabled = busy; box.setAttribute('aria-label', `选择 ${page.name}`);
    box.addEventListener('change', () => { pageStates[i].selected = box.checked; refreshImportAction(); $('page-list-title').textContent = `页面列表 · ${pageStates.filter(p => p.selected).length} / ${pageStates.length}`; });
    const title = document.createElement('span'); title.textContent = `${String(i + 1).padStart(3, '0')}  ${page.name}`; title.title = page.name;
    const state = document.createElement('small'); state.id = `page-state-${i}`; state.textContent = pageStates[i].detail || `${Math.round(page.root.width)} × ${Math.round(page.root.height)}`; state.dataset.state = pageStates[i].state;
    label.append(box, title, state); return label;
  }));
  refreshImportAction();
}
function refreshImportAction() {
  if (!preparedBundle || preparedBundle.pages.length < 2) return;
  const selected = pageStates.filter(p => p.selected).length, remaining = pageStates.filter(p => p.selected && p.state !== 'complete').length;
  $<HTMLButtonElement>('import').disabled = busy || !selected || (plugin && !remaining);
  $('import').textContent = !plugin ? '下载 Figma 数据' : !remaining && selected ? '所选页面已全部导入' : `导入到 Figma（${remaining} 页）`;
}
function setPageState(index: number, state: typeof pageStates[number]['state'], detail: string) {
  if (!pageStates[index]) return; Object.assign(pageStates[index], { state, detail });
  const el = document.getElementById(`page-state-${index}`); if (el) { el.textContent = detail; el.dataset.state = state; }
}
function sendNextPage() {
  if (!preparedBundle || queuePosition >= queue.length || captureStopped) return;
  const index = queue[queuePosition]; setPageState(index, 'working', '导入中…');
  status(`正在导入第 ${queuePosition + 1} / ${queue.length} 页：${preparedBundle.pages[index].name}`);
  message('IMPORT_PAGE', { id: batchId, index: queuePosition, document: hydratePage(preparedBundle, index) });
}
function switchTab(next: string) {
  tab = next;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(btn => { const active = btn.dataset.tab === next; btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active)); btn.tabIndex = active ? 0 : -1; });
  for (const key of ['file', 'code', 'url']) $(`${key}-panel`).hidden = key !== next;
  $('advanced').hidden = next === 'url'; $('split-options').hidden = next === 'url'; invalidate(); status('');
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab!));
  btn.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = ['file', 'code', 'url'];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    switchTab(tabs[next]); $(`${tabs[next]}-tab`).focus();
  });
}
const drop = $('drop-zone');
drop.addEventListener('click', () => input('file-input').click());
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); if (!busy) drop.classList.add('dragover'); });
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragover'); });
drop.addEventListener('drop', event => { if (!busy) { const files = Array.from((event as DragEvent).dataTransfer?.files || []); if (files.length) void loadFiles(files); } });
input('file-input').addEventListener('change', () => { const files = Array.from(input('file-input').files || []); if (files.length) void loadFiles(files); });
async function loadFiles(files: File[]) {
  invalidate(); sourceFiles = files; source = '';
  try {
    if (files.length > 200 || files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024) throw new Error('每批最多 200 个文件、128 MB');
    if (files.some(f => !/\.(html?|json)$/i.test(f.name))) throw new Error('请选择 HTML 或本插件导出的 JSON 文件');
    sourceName = files.length === 1 ? files[0].name : `${files.length} 个 HTML / 数据文件`;
    $('file-label').textContent = sourceName;
    if (files.length === 1) {
      const file = files[0]; const text = await file.text();
      if (/\.json$/i.test(file.name)) { const doc = JSON.parse(text); if (isBundle(doc)) showBundle(doc); else { validateDocument(doc); showPrepared(doc); } }
      else { source = text; status('已读取 HTML，点击“解析并预览”继续。'); }
    } else status(`已选择 ${files.length} 个文件，将按顺序解析，每页单独导入。`);
  } catch (error) { sourceFiles = []; source = ''; status(errorText(error), true); }
}
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function safeHTML(html: string): Promise<{ html: string; unhandledScripts: boolean; tailwind: boolean }> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const tailwind = readTailwind(parsed);
  const unhandledScripts = Array.from(parsed.scripts).some(script => !tailwind?.handledScripts.includes(script));
  if (tailwind) {
    status('检测到 Tailwind，正在本地编译样式…');
    const css = await compileTailwind(tailwind);
    const style = parsed.createElement('style'); style.setAttribute('data-h2f-tailwind', '3.4.17'); style.textContent = css; parsed.head.appendChild(style);
    parsed.querySelectorAll('style[type="text/tailwindcss"]').forEach(style => style.remove());
  }
  parsed.querySelectorAll('script,meta[http-equiv="refresh"],base').forEach(el => el.remove());
  parsed.querySelectorAll('*').forEach(el => { for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); });
  const baseURL = input('base-url').value.trim();
  if (baseURL) {
    let url: URL; try { url = new URL(baseURL); } catch { throw new Error('资源基础地址必须是完整的 http 或 https 地址'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('资源基础地址只支持 http 或 https');
    const base = parsed.createElement('base'); base.href = url.href; parsed.head.prepend(base);
  }
  const viewportStyle = parsed.createElement('style'); viewportStyle.textContent = 'html{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}'; parsed.head.appendChild(viewportStyle);
  const csp = parsed.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy'; csp.content = "script-src 'none'; object-src 'none'; form-action 'none'"; parsed.head.prepend(csp);
  return { html: '<!doctype html>\n' + parsed.documentElement.outerHTML, unhandledScripts, tailwind: !!tailwind };
}
function viewportWidth(): number {
  const width = Number(input('viewport-width').value); if (!Number.isFinite(width) || width < 320 || width > 3840) throw new Error('浏览器宽度需要在 320–3840 px 之间'); return Math.round(width);
}
function fitPreview() {
  if (!frame || plugin || $('frame-container').hidden) return;
  const host = $('frame-container'); const width = Number(frame.dataset.viewportWidth || 1440);
  const scale = Math.min(1, host.clientWidth / width); frame.style.transform = `scale(${scale})`;
  const height = 900;
  frame.style.height = `${height}px`; host.style.height = `${height * scale}px`;
}
new ResizeObserver(fitPreview).observe($('preview-stage'));
async function prepareHTML(html: string, filename = sourceName, builder = new BundleBuilder(filename.replace(/\.html?$/i, '') || 'HTML 页面')) {
  if (!html.trim()) throw new Error('请先选择 HTML 文件或粘贴 HTML 代码');
  const width = viewportWidth(); const selector = input('selector').value.trim() || 'body';
  const preparedHTML = await safeHTML(html);
  if (frame) frame.remove();
  frame = document.createElement('iframe'); frame.title = 'HTML 预览'; frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.width = `${width}px`; frame.style.height = '900px'; frame.style.border = '0'; frame.style.boxSizing = 'content-box'; frame.dataset.viewportWidth = String(width);
  const target = plugin ? $('capture-host') : $('frame-container');
  target.replaceChildren(frame);
  if (!plugin) { $('preview-empty').hidden = true; $('remote-preview').hidden = true; target.hidden = false; }
  const currentFrame = frame;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HTML 预览加载超时，请检查外部资源')), 15000);
    currentFrame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    currentFrame.srcdoc = preparedHTML.html;
  });
  const doc = currentFrame.contentDocument; if (!doc) throw new Error('无法访问预览内容，请通过本地服务捕获');
  doc.addEventListener('click', event => event.preventDefault(), true);
  await Promise.race([Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 3500))]);
  await Promise.race([doc.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))]);
  const pages = discoverPages(doc, selector, input('split-pages').checked, input('page-selector').value.trim());
  for (let i = 0; i < pages.length; i++) {
    if (captureStopped) break;
    const page = pages[i]; status(`正在解析 ${filename || 'HTML'} · 第 ${i + 1} / ${pages.length} 页…`);
    $<HTMLProgressElement>('progress').value = Math.round(i / pages.length * 100);
    try {
      const captured = await captureDOM(doc, { selector: page.selector, name: pages.length > 1 ? page.name : doc.title || filename.replace(/\.html?$/i, '') || 'HTML 页面' });
      captured.source.url = input('base-url').value.trim() || 'local-html'; captured.source.selector = pages.length > 1 ? page.name : selector;
      if (preparedHTML.unhandledScripts) captured.diagnostics.push({ code: 'SCRIPTS_DISABLED', message: 'HTML 内脚本未执行；依赖 JavaScript 的页面请使用网页链接入口', count: 1 });
      for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')) if (!link.sheet) captured.diagnostics.push({ code: 'STYLESHEET_MISSING', message: '外部样式未加载，请设置资源基础地址或使用本地服务捕获', node: link.href.slice(0, 180), count: 1 });
      await embedBrowserAssets(captured); builder.add(captured);
    } catch (error) {
      if (pages.length === 1 || /每批最多|整批/.test(errorText(error))) throw error;
      builder.error(page.name, error);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  fitPreview(); if (!builder.bundle.pages.length) throw new Error(captureStopped ? '解析已取消' : '没有可导入的页面，请查看页面选择器和可见性');
  return builder.bundle;
}

async function api(path: string, payload?: unknown) {
  const token = input('service-token').value.trim(); if (!token) throw new Error('请先填写本地服务连接码（运行 npm run serve 后可见）');
  try {
    const response = await fetch(`${service}${path}`, { method: payload ? 'POST' : 'GET', headers: { 'X-H2F-Token': token, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: controller?.signal || AbortSignal.timeout(7000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `请求失败：${response.status}`); return result;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('无法连接本地服务。请运行 npm run serve，并确认使用 127.0.0.1:3847。');
    throw e;
  }
}
$('connect').addEventListener('click', async () => {
  try { await api('/api/health'); $('connection-dot').classList.add('connected'); $('connection-label').textContent = '本地服务已连接'; status('本地服务连接成功。'); message('SETTINGS', { settings: { mode: mode(), token: input('service-token').value } }); }
  catch (e) { $('connection-dot').classList.remove('connected'); status(errorText(e), true); }
});
$('prepare').addEventListener('click', async () => {
  invalidate(); captureStopped = false; importing = false; controller = tab === 'url' ? new AbortController() : null; setBusy(true); status('正在准备内容…');
  try {
    if (tab === 'url') {
      const url = input('page-url').value.trim(); if (!/^https?:\/\//i.test(url)) throw new Error('请输入完整的 http 或 https 页面地址');
      const response = await api('/api/capture', { url, width: viewportWidth(), height: 900, selector: input('selector').value.trim() || 'body' });
      $('preview-empty').hidden = true; $('frame-container').hidden = true; $<HTMLImageElement>('remote-preview').src = response.preview; $('remote-preview').hidden = false; showPrepared(response.document);
    } else if (tab === 'file' && sourceFiles.length > 1) {
      const builder = new BundleBuilder(sourceName);
      for (const file of sourceFiles) {
        if (captureStopped) break;
        try {
          const content = await file.text();
          if (/\.json$/i.test(file.name)) { const data = JSON.parse(content); if (isBundle(data)) builder.addBundle(data); else builder.add(data); }
          else await prepareHTML(content, file.name, builder);
        } catch (error) { builder.error(file.name, error); if (/每批最多|整批/.test(errorText(error))) break; }
      }
      showBundle(builder.bundle);
    } else if (tab === 'file' && sourceFiles.length === 1 && /\.json$/i.test(sourceFiles[0].name)) {
      const data = JSON.parse(await sourceFiles[0].text()); if (isBundle(data)) showBundle(data); else showPrepared(data);
    } else showBundle(await prepareHTML(tab === 'code' ? $<HTMLTextAreaElement>('html-code').value : source));
    if (captureStopped) status('解析已停止，已完成的页面可继续导入。');
  } catch (e) { status(errorText(e) === 'This operation was aborted' ? '捕获已取消。' : errorText(e), true); }
  finally { controller = null; setBusy(false); renderPageList(); }
});
$('demo').addEventListener('click', async () => {
  switchTab('file'); sourceFiles = []; captureStopped = false; source = demoHTML; sourceName = 'dashboard.html'; $('file-label').textContent = 'dashboard.html · 内置示例'; input('base-url').value = '';
  input('selector').value = 'body'; setBusy(true); status('正在解析示例页面…');
  try { showBundle(await prepareHTML(demoHTML)); } catch (e) { status(errorText(e), true); } finally { setBusy(false); }
});
function download() {
  if (!prepared) return;
  const selected = preparedBundle ? pageStates.map((p, i) => p.selected ? i : -1).filter(i => i >= 0) : [0];
  if (!selected.length) { status('请至少选择一页。', true); return; }
  let data: CaptureDocument | CaptureBundle = prepared;
  if (preparedBundle) { if (selected.length === 1) data = hydratePage(preparedBundle, selected[0]); else { const builder = new BundleBuilder(preparedBundle.name); selected.forEach(i => builder.add(hydratePage(preparedBundle!, i))); data = builder.bundle; } }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `${prepared.name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.h2f.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  if (!plugin) status('已下载捕获数据。请在 Figma 中运行插件，并拖入此文件。');
}
$('download').addEventListener('click', download);
$('import').addEventListener('click', () => {
  if (!prepared || !preparedBundle) return; if (!plugin) { download(); return; }
  queue = pageStates.map((p, i) => p.selected && p.state !== 'complete' ? i : -1).filter(i => i >= 0);
  if (!queue.length) { status(pageStates.some(p => p.selected) ? '所选页面都已导入；重新解析后可再次导入。' : '请至少选择一页。'); return; }
  captureStopped = false; importing = true; setBusy(true, true); renderPageList();
  message('SETTINGS', { settings: { mode: mode(), token: input('service-token').value } });
  if (preparedBundle.pages.length === 1) { status('正在加载字体并创建图层…'); message('IMPORT', { document: prepared, mode: mode() }); }
  else {
    batchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; queuePosition = 0;
    message('BATCH_START', { id: batchId, mode: mode(), plan: queue.map(i => ({ name: preparedBundle!.pages[i].name, width: preparedBundle!.pages[i].root.width, height: preparedBundle!.pages[i].root.height })) });
    status(`开始导入 ${queue.length} 页…`);
  }
});
$('cancel').addEventListener('click', () => { captureStopped = true; if (controller) controller.abort(); if (importing) message('CANCEL'); status(importing ? '正在取消当前页，已完成的页面会保留…' : '正在停止解析…'); });
$('select-all-pages').addEventListener('click', () => { pageStates.forEach(p => { p.selected = true; }); renderPageList(); });
$('select-no-pages').addEventListener('click', () => { pageStates.forEach(p => { p.selected = false; }); renderPageList(); });
for (const id of ['viewport-width', 'selector', 'base-url', 'page-url', 'html-code', 'split-pages', 'page-selector']) $(id).addEventListener('input', invalidate);
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.addEventListener('change', () => { document.querySelectorAll('.mode-card').forEach(card => card.classList.toggle('selected', !!card.querySelector<HTMLInputElement>('input')?.checked)); });
$('copy-token').addEventListener('click', async () => { try { await navigator.clipboard.writeText(input('service-token').value); status('已复制连接码。'); } catch { status('请手动选择并复制连接码。'); } });
window.onmessage = event => {
  // Desktop Figma can forward messages from an ancestor sandbox or invoke onmessage.
  // Reject messages from our own preview/compiler frames, but do not assume one parent level.
  if (!plugin || !event.data?.pluginMessage || (event.source && Array.from(document.querySelectorAll('iframe')).some(child => child.contentWindow === event.source))) return;
  const msg = event.data.pluginMessage;
  if (msg.type === 'SETTINGS') {
    if (typeof msg.settings?.token === 'string') input('service-token').value = msg.settings.token;
    const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${msg.settings?.mode === 'auto' ? 'auto' : 'visual'}"]`); if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
  } else if (msg.type === 'BATCH_READY' && msg.id === batchId) { sendNextPage(); }
  else if (msg.type === 'PAGE_PROGRESS' && msg.id === batchId) { $<HTMLProgressElement>('progress').value = Math.round((queuePosition + msg.done / msg.total) / queue.length * 100); }
  else if (msg.type === 'PAGE_COMPLETE' && msg.id === batchId) {
    const index = queue[msg.index]; setPageState(index, msg.result.nodeId ? 'complete' : 'failed', msg.result.nodeId ? `完成 · ${msg.result.result.nodes} 层` : msg.result.error);
    queuePosition++; if (!captureStopped && queuePosition < queue.length) setTimeout(sendNextPage, 0);
  } else if (msg.type === 'BATCH_COMPLETE' && msg.id === batchId) {
    importing = false; setBusy(false); renderPageList();
    $('report-title').textContent = msg.result.cancelled ? '批次已停止' : '多页导入完成';
    status(`本次完成 ${msg.result.completed} / ${msg.result.total} 页，失败 ${msg.result.failed} 页。${msg.result.cancelled ? '已完成页面保留，可继续导入剩余页面。' : '每页已创建独立 Frame。'}`);
    const remaining = pageStates.filter(p => p.selected && p.state !== 'complete').length; $('import').textContent = remaining ? `继续导入剩余 ${remaining} 页` : '所选页面已全部导入'; $<HTMLButtonElement>('import').disabled = remaining === 0;
    updateWarnings(msg.result.results.flatMap((r: any) => r.error ? [{ code: 'PAGE_FAILED', message: `${r.name}：${r.error}` }] : r.result?.diagnostics || []).slice(0, 100));
  } else if (msg.type === 'PROGRESS') { $<HTMLProgressElement>('progress').value = Math.round(msg.done / msg.total * 100); status(`正在创建图层 ${msg.done} / ${msg.total}…`); }
  else if (msg.type === 'COMPLETE') {
    importing = false; setBusy(false); if (pageStates[0]) pageStates[0].state = 'complete'; $('report-title').textContent = '已导入 Figma';
    status(`已创建 ${msg.result.nodes} 个图层${msg.result.autoLayouts ? `，其中 ${msg.result.autoLayouts} 个 Auto Layout 容器` : ''}。可以在 Figma 中撤销本次导入。`);
    updateWarnings(msg.result.diagnostics || []);
  } else if (msg.type === 'ERROR') { importing = false; setBusy(false); status(msg.message || '导入失败，请重试', true); }
};
message('READY');

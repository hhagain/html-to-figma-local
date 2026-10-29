import { designLayout, PAGE_LEVELS } from './design-organization';
import { normalizeCaptureAddress } from './capture-address';
import { captureDOM, embedBrowserAssets } from './capture';
import { validateDocument, countScene, type CaptureDocument, type Diagnostic, type ImportMode } from './schema';
import demoHTML from '../examples/dashboard.html';
import { readTailwind, compileTailwind } from './tailwind';
import demoStatePlan from '../examples/multi-app-admin.states.json';
import { discoverAssistant, verifyAssistant, pairAssistant, newAssistantCredentials, type AssistantCredentials } from './desktop-connection';
import { BundleBuilder, discoverPages, hydratePage, isBundle, validateBundle, type CaptureBundle } from './bundle';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const plugin = window.parent !== window;
document.body.classList.toggle('is-plugin', plugin);
$('download-assistant').hidden = !plugin;
$('download-assistant').addEventListener('click', event => {
  if (plugin) { event.preventDefault(); message('OPEN_DESKTOP_ASSISTANT_DOWNLOAD'); }
});
let tab = 'file', source = '', sourceName = '', prepared: CaptureDocument | null = null, busy = false;
let frame: HTMLIFrameElement | null = null, controller: AbortController | null = null;
let sourceFiles: File[] = [], preparedBundle: CaptureBundle | null = null, captureStopped = false, importing = false;
let pageStates: { selected: boolean; state: 'pending' | 'working' | 'complete' | 'failed'; detail?: string }[] = [];
let queue: number[] = [], queuePosition = 0, batchId = '';
let previewPageIndex = 0, previewRevision = 0, previewController: AbortController | null = null;
let previewSession: { service: string; token: string; jobId: string; entries: { pageIndex: number; error?: string }[] } | null = null;
const previewImages = new Map<number, string>();
let restoredPreviews: string[] | null = null;
let hasRemotePreview = false;
let previewZoom = 1, previewFit = true, previewHovered = false, previewSpace = false;
let previewPan: { pointer: number; x: number; y: number; left: number; top: number } | null = null;
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const receiverId = randomId();
let handoffCandidate: any = null, handoffPolling = false, handoffReceiving = false, handoffSending = false, outgoingHandoff: string | null = null;
let sendRequestId = '', sendSignature = '', outgoingPhase = '';
let figmaContext: { documentName: string; pageName: string; pageId: string; contextVersion: string } | null = null;
let figmaTargets: any[] = [], targetOptionsKey = '';
let incomingHandoff: { id: string; ack: Promise<unknown>; lastProgress: number; expectedPageId?: string } | null = null;

let service = !plugin && /^https?:$/.test(location.protocol) && ['127.0.0.1','localhost'].includes(location.hostname) ? location.origin : 'http://127.0.0.1:3847';
let activeStateJob: string | null = null, activeJobKind: 'states' | 'discover' = 'states', stateReport: any = null;
let discovery: any = null, discoveryKey = '', discoverySelection: boolean[] = [];
const autoStates = () => tab === 'url' && $<HTMLSelectElement>('url-mode').value === 'states' && $<HTMLSelectElement>('state-input-mode').value !== 'recipe';
function requestKey() { return JSON.stringify([input('page-url').value.trim(), viewportWidth(), input('selector').value.trim(), $<HTMLSelectElement>('state-input-mode').value, $<HTMLSelectElement>('exploration-depth').value]); }
function refreshPrepareAction() {
  const label = busy ? '处理中…' : autoStates() ? discovery ? `开始捕获（${discoverySelection.filter(Boolean).length} 页）` : $<HTMLSelectElement>('state-input-mode').value === 'explore' ? '探索交互状态' : '自动发现页面' : '解析并预览';
  $('prepare-label').textContent = label;
  $<HTMLButtonElement>('prepare').disabled = busy || (autoStates() && !!discovery && !discoverySelection.some(Boolean));
}
function clearDiscovery() { discovery = null; discoveryKey = ''; discoverySelection = []; $('discovery-results').hidden = true; $('discovery-intro').hidden = false; refreshPrepareAction(); }
function syncStateInput() { const automatic = $<HTMLSelectElement>('state-input-mode').value !== 'recipe'; $('state-auto-panel').hidden = !automatic; $('state-recipe-panel').hidden = automatic; $('exploration-options').hidden = $<HTMLSelectElement>('state-input-mode').value !== 'explore'; $('discovery-intro').textContent = $<HTMLSelectElement>('state-input-mode').value === 'explore' ? '自动打开详情、弹窗和表单，记录可重放的交互状态，再勾选捕获。无需准备 JSON。' : '识别导航标签、页面链接和本地 HTML。此模式不探索详情和弹窗。'; refreshPrepareAction(); }

let assistantCredentials: AssistantCredentials | null = null, assistantConnecting = false;
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
  for (const el of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('button,input,textarea,select')) {
    if (el.id !== 'cancel') el.disabled = value;
  }
  $('progress-wrap').hidden = !value;
  $('cancel').hidden = !value || handoffSending || handoffReceiving;
  if (value) $<HTMLProgressElement>('progress').removeAttribute('value');
  $('state-plan-panel').setAttribute('aria-busy', String(value));
  refreshPrepareAction(); refreshPreviewControls(); refreshZoomControls(); refreshHandoffControls();
}
function invalidate() {
  outgoingHandoff = null; sendRequestId = ''; sendSignature = ''; incomingHandoff = null; $('handoff-send-status').hidden = true;
  resetPreview();
  prepared = null; preparedBundle = null; stateReport = null; $('download-state-report').hidden = true; pageStates = []; $('page-list-section').hidden = true; $('report').hidden = true; $('ready-actions').hidden = true;
  $('prepare').hidden = false; refreshPrepareAction();
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
  $('report-summary').textContent = bundle.pages.length > 1 ? `${bundle.name} · ${bundle.pages.some(p => p.source.canvas) ? '保留原画布排布 · ' : bundle.pages.some(p => p.source.design) ? '按页面与功能分组 · ' : ''}图片资源已跨页去重` : `${Math.round(prepared.root.width)} × ${Math.round(prepared.root.height)} px · ${prepared.name}`;
  $('stat-nodes').textContent = String(stats.nodes); $('stat-text').textContent = String(stats.texts); $('stat-image').textContent = String(stats.images); $('stat-svg').textContent = String(stats.vectors);
  $('preview-size').textContent = bundle.pages.length > 1 ? `${bundle.pages.length} 页` : `${Math.round(prepared.root.width)} × ${Math.round(prepared.root.height)}`;
  const diagnostics = bundle.pages.flatMap(page => page.diagnostics).slice(0, 100);
  diagnostics.push(...bundle.errors.map(error => ({ code: 'PAGE_CAPTURE_FAILED', message: `${error.name}：${error.message}` })));
  updateWarnings(diagnostics); renderPageList();
  $('import').textContent = plugin ? `导入到 Figma${bundle.pages.length > 1 ? `（${bundle.pages.length} 页）` : ''}` : '下载 Figma 数据';
  $('download').hidden = !plugin; $('send-handoff').hidden = plugin; refreshHandoffControls();
  const missing = bundle.assets.filter(a => !a.base64).length;
  status(missing ? `${missing} 个共享图片资源未能读取，导入时将保留占位。` : plugin ? '内容已就绪，多页会逐页导入；取消时保留已完成的页面。' : '选择页面后点击“发送到 Figma 插件”，在插件内接收并导入。也可以下载数据。');
  const restored = (bundle as CaptureBundle & { previewImages?: unknown }).previewImages;
  if (!plugin && restored !== undefined) {
    if (!Array.isArray(restored) || restored.length !== bundle.pages.length || restored.some(value => typeof value !== 'string' || value.length > 6*1024*1024 || !/^data:image\/jpeg;base64,[\w+/=]+$/.test(value)) || restored.reduce((n, value) => n + value.length, 0) > 90*1024*1024) throw new Error('备份预览数据无效或过大');
    showRemotePreviews(restored[0], undefined, [], restored);
  }

}
function renderPageList() {
  if (!preparedBundle) return;
  $('page-list-section').hidden = preparedBundle.pages.length < 2 && !preparedBundle.pages[0]?.source.design;
  $('page-list-title').textContent = `页面列表 · ${pageStates.filter(p => p.selected).length} / ${pageStates.length}`;
  const rows = document.createDocumentFragment();
  const organization=designLayout(preparedBundle.pages.map(p=>({name:p.name,width:p.root.width,height:p.root.height,design:p.source.canvas?undefined:p.source.design})));
  const grouped=new Set(organization.groups.flatMap(g=>g.indices)),ordered=[...organization.groups.flatMap(g=>g.indices),...preparedBundle.pages.map((_,i)=>i).filter(i=>!grouped.has(i))];
  const heads=new Map(organization.groups.map(g=>[g.indices[0],g]));
  ordered.forEach(i => {
    const page=preparedBundle!.pages[i],group=heads.get(i);
    if(group){
      const heading=document.createElement('div');heading.className='page-group-heading';
      const name=document.createElement('strong');name.textContent=group.name;name.title=page.source.design!.reason;name.setAttribute('role','heading');name.setAttribute('aria-level','3');
      const level=document.createElement('select');level.className='group-level';level.disabled=busy;level.setAttribute('aria-label',`调整 ${group.name} 的页面层级`);
      for(const [value,label] of Object.entries(PAGE_LEVELS)){const option=document.createElement('option');option.value=value;option.textContent=label;level.append(option);}level.value=page.source.design!.level;
      level.addEventListener('change',()=>{for(const index of group.indices){const d=preparedBundle!.pages[index].source.design!;d.level=level.value as keyof typeof PAGE_LEVELS;d.confidence='high';d.reason='用户调整页面类型';}renderPageList();});
      heading.append(name,level);rows.append(heading);
    }
    const row = document.createElement('div'); row.className = 'page-row'; row.dataset.previewActive = String(hasRemotePreview && previewPageIndex === i);
    const label = document.createElement('label'); label.className = 'page-select';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = pageStates[i].selected; box.disabled = busy; box.setAttribute('aria-label', `选择 ${page.name}`);
    box.addEventListener('change', () => { pageStates[i].selected = box.checked; refreshImportAction(); $('page-list-title').textContent = `页面列表 · ${pageStates.filter(p => p.selected).length} / ${pageStates.length}`; });
    const title = document.createElement('span'); title.textContent = `${String(i + 1).padStart(3, '0')}  ${page.name}`; title.title = page.name;
    if(page.source.design){const d=page.source.design;title.title+=`\n${PAGE_LEVELS[d.level]} · ${d.moduleName} / ${d.pageName}\n推断依据：${d.reason}`;title.dataset.pageLevel=d.level;}
    const state = document.createElement('small'); state.id = `page-state-${i}`; state.textContent = pageStates[i].detail || `${Math.round(page.root.width)} × ${Math.round(page.root.height)}`; state.dataset.state = pageStates[i].state;
    label.append(box, title); row.append(label, state);
    if (hasRemotePreview && !plugin) {
      const view = document.createElement('button'); view.type = 'button'; view.className = 'text-button page-preview'; view.disabled = busy;
      view.textContent = previewPageIndex === i ? '当前预览' : '预览'; view.setAttribute('aria-label', `预览 ${page.name}`); view.setAttribute('aria-pressed', String(previewPageIndex === i));
      view.addEventListener('click', () => { void selectPreviewPage(i); }); row.append(view);
    }
    rows.append(row);
  });
  $('page-list').replaceChildren(rows);
  refreshImportAction();
}
function resetPreview() {
  previewSpace = false; releasePreviewPan(); $('preview-stage').classList.remove('pan-ready');
  previewRevision++; previewController?.abort(); previewController = null;
  for (const url of previewImages.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  previewImages.clear(); restoredPreviews = null; previewSession = null; previewPageIndex = 0; hasRemotePreview = false; previewFit = true; previewZoom = 1;
  $('preview-zoom-controls').hidden = true; $('preview-stage').classList.remove('zoomable');
  $('preview-controls').hidden = true; $('preview-caption').hidden = true; $('preview-message').hidden = true;
  $('preview-stage').setAttribute('aria-busy', 'false'); $('preview-empty').hidden = false; $('frame-container').hidden = true;
  const image = $<HTMLImageElement>('remote-preview'); image.hidden = true; image.removeAttribute('src');
  $('preview-size').textContent = '等待内容';
}
function refreshPreviewControls() {
  const total = hasRemotePreview ? preparedBundle?.pages.length || 0 : 0;
  $('preview-controls').hidden = total < 2;
  $<HTMLButtonElement>('preview-prev').disabled = busy || previewPageIndex === 0;
  $<HTMLButtonElement>('preview-next').disabled = busy || previewPageIndex >= total - 1;
  $<HTMLSelectElement>('preview-page').disabled = busy || total < 2;
}
function cachePreview(index: number, url: string) {
  previewImages.delete(index); previewImages.set(index, url);
  while (previewImages.size > 3) {
    const oldest = previewImages.keys().next().value!; const value = previewImages.get(oldest)!;
    previewImages.delete(oldest); if (value.startsWith('blob:')) URL.revokeObjectURL(value);
  }
}
function showRemotePreviews(first: string | null, jobId?: string, entries: { pageIndex: number; error?: string }[] = [], restored?: string[]) {
  resetPreview(); if (!preparedBundle) return;
  hasRemotePreview = true; restoredPreviews = restored || null;
  if (jobId) previewSession = { service, token: input('service-token').value.trim(), jobId, entries };
  if (first) cachePreview(0, first);
  const options = preparedBundle.pages.map((page, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = page.name; return option; });
  $<HTMLSelectElement>('preview-page').replaceChildren(...options);
  void selectPreviewPage(0); renderPageList();
}
async function selectPreviewPage(index: number) {
  if (!preparedBundle || !hasRemotePreview || !preparedBundle.pages[index]) return;
  previewController?.abort(); const revision = ++previewRevision; const localController = new AbortController(); previewController = localController;
  previewPageIndex = index; const page = preparedBundle.pages[index];
  $<HTMLSelectElement>('preview-page').value = String(index); $('preview-size').textContent = `${index + 1} / ${preparedBundle.pages.length} 页`;
  $('preview-caption').textContent = `${page.name} · ${Math.round(page.root.width)} × ${Math.round(page.root.height)} px`; $('preview-caption').hidden = false;
  $('preview-empty').hidden = true; $('frame-container').hidden = true; $('remote-preview').hidden = true;
  $('preview-message').hidden = false; $('preview-message-text').textContent = `正在加载第 ${index + 1} 页预览…`; $('preview-retry').hidden = true;
  $('preview-stage').setAttribute('aria-busy', 'true'); refreshPreviewControls();
  document.querySelectorAll<HTMLElement>('.page-row').forEach((row, i) => { row.dataset.previewActive = String(i === index); const button = row.querySelector<HTMLButtonElement>('.page-preview'); if (button) { button.textContent = i === index ? '当前预览' : '预览'; button.setAttribute('aria-pressed', String(i === index)); } });
  let objectURL: string | null = null;
  const timer = setTimeout(() => localController.abort(), 10000);
  try {
    let url = previewImages.get(index) || restoredPreviews?.[index];
    if (!url) {
      const session = previewSession, entry = session?.entries.find(p => p.pageIndex === index);
      if (!session || !entry) throw new Error('此页没有可用截图，请更新助手后重新捕获。');
      if (entry.error) throw new Error(entry.error);
      const response = await fetch(`${session.service}/api/states/${session.jobId}/preview/${index}`, { headers: { 'X-H2F-Token': session.token }, signal: localController.signal });
      if (!response.ok) throw new Error(response.status === 404 ? '预览已过期，请重新捕获页面。' : '预览加载失败，请检查助手连接后重试。');
      const blob = await response.blob(); if (!blob.type.startsWith('image/jpeg')) throw new Error('预览图片格式无效，请重新捕获。');
      objectURL = URL.createObjectURL(blob); url = objectURL;
    }
    const image = new Image(); image.src = url; await image.decode();
    if (revision !== previewRevision) return;
    if (localController.signal.aborted) throw new Error('预览加载超时');
    cachePreview(index, url); objectURL = null;
    const target = $<HTMLImageElement>('remote-preview'); target.src = url; target.alt = `第 ${index + 1} 页：${page.name}`; target.dataset.pageIndex = String(index); target.hidden = false; applyPreviewZoom(true);
    $('preview-message').hidden = true;
  } catch (error) {
    if (revision !== previewRevision) return;
    $('preview-message-text').textContent = localController.signal.aborted ? '预览加载超时，请重试。' : errorText(error);
    $('preview-retry').hidden = false;
  } finally {
    clearTimeout(timer); if (objectURL) URL.revokeObjectURL(objectURL);
    if (revision === previewRevision) { $('preview-stage').setAttribute('aria-busy', 'false'); previewController = null; }
  }
}
$('preview-prev').addEventListener('click', () => { void selectPreviewPage(previewPageIndex - 1); });
$('preview-next').addEventListener('click', () => { void selectPreviewPage(previewPageIndex + 1); });
$('preview-page').addEventListener('change', () => { void selectPreviewPage(Number($<HTMLSelectElement>('preview-page').value)); });
$('preview-retry').addEventListener('click', () => { void selectPreviewPage(previewPageIndex); });
function refreshImportAction() {
  refreshHandoffControls();
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
    if (files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024) throw new Error('所选文件总量超过 128 MB，请分批导入');
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
function previewDimensions() {
  const image = $<HTMLImageElement>('remote-preview');
  if (!image.hidden && image.naturalWidth) return { width: image.naturalWidth, height: image.naturalHeight, kind: 'image' };
  if (frame && !$('frame-container').hidden) return { width: Number(frame.dataset.viewportWidth || 1440), height: 900, kind: 'html' };
  return null;
}
function refreshZoomControls() {
  const dimensions = previewDimensions(), enabled = !!dimensions && !plugin;
  $('preview-zoom-controls').hidden = !enabled; $('preview-shortcuts').hidden = !enabled;
  $<HTMLButtonElement>('preview-zoom-out').disabled = busy || !enabled || previewZoom <= .1;
  $<HTMLButtonElement>('preview-zoom-in').disabled = busy || !enabled || previewZoom >= 4;
  $<HTMLButtonElement>('preview-zoom-actual').disabled = busy || !enabled;
  $<HTMLButtonElement>('preview-zoom-fit').disabled = busy || !enabled;
  $('preview-zoom-value').textContent = `${Math.round(previewZoom * 100)}%`;
  $('preview-zoom-fit').setAttribute('aria-pressed', String(previewFit));
  $('preview-zoom-actual').setAttribute('aria-pressed', String(!previewFit && previewZoom === 1));
}
function applyPreviewZoom(reset = false, previousZoom = previewZoom) {
  const dimensions = previewDimensions(); if (!dimensions || plugin) { refreshZoomControls(); return; }
  const stage = $('preview-stage'); stage.classList.add('zoomable');
  const style = getComputedStyle(stage), paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const centerX = (stage.scrollLeft + stage.clientWidth / 2) / previousZoom, centerY = (stage.scrollTop + stage.clientHeight / 2) / previousZoom;
  if (previewFit) previewZoom = Math.max(.01, Math.min(1, (stage.clientWidth - paddingX) / dimensions.width, (stage.clientHeight - paddingY) / dimensions.height));
  if (dimensions.kind === 'image') { const image = $<HTMLImageElement>('remote-preview'); image.style.width = `${dimensions.width * previewZoom}px`; image.style.height = `${dimensions.height * previewZoom}px`; }
  else if (frame) { const host = $('frame-container'); host.style.width = `${dimensions.width * previewZoom}px`; host.style.height = `${dimensions.height * previewZoom}px`; frame.style.height = `${dimensions.height}px`; frame.style.transform = `scale(${previewZoom})`; }
  if (reset || previewFit) { stage.scrollLeft = 0; stage.scrollTop = 0; }
  else { stage.scrollLeft = Math.max(0, centerX * previewZoom - stage.clientWidth / 2); stage.scrollTop = Math.max(0, centerY * previewZoom - stage.clientHeight / 2); }
  refreshZoomControls();
}
function setPreviewZoom(value: number | 'fit') { const previous = previewZoom; previewFit = value === 'fit'; if (typeof value === 'number') previewZoom = Math.max(.1, Math.min(4, value)); applyPreviewZoom(false, previous); }
const zoomSteps = [.1, .25, .5, .75, 1, 1.25, 1.5, 2, 3, 4];
$('preview-zoom-in').addEventListener('click', () => setPreviewZoom(zoomSteps.find(z => z > previewZoom + .001) || 4));
$('preview-zoom-out').addEventListener('click', () => setPreviewZoom([...zoomSteps].reverse().find(z => z < previewZoom - .001) || .1));
$('preview-zoom-actual').addEventListener('click', () => setPreviewZoom(1));
$('preview-zoom-fit').addEventListener('click', () => setPreviewZoom('fit'));
$('remote-preview').addEventListener('load', () => applyPreviewZoom(true));
function previewIsEditing(target: EventTarget | null) { return !!(target as Element | null)?.closest?.('input,textarea,select,[contenteditable="true"]'); }
function handlePreviewWheel(event: WheelEvent, embeddedFrame?: HTMLIFrameElement) {
  if ((!event.metaKey && !event.ctrlKey) || busy || !previewDimensions() || plugin) return;
  event.preventDefault();
  const target = !$('remote-preview').hidden ? $('remote-preview') : $('frame-container'), stage = $('preview-stage');
  const bounds = target.getBoundingClientRect(), frameBounds = embeddedFrame?.getBoundingClientRect();
  const x = frameBounds ? frameBounds.left + event.clientX * previewZoom : event.clientX, y = frameBounds ? frameBounds.top + event.clientY * previewZoom : event.clientY;
  const localX = (x - bounds.left) / previewZoom, localY = (y - bounds.top) / previewZoom;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
  setPreviewZoom(previewZoom * Math.exp(-delta * .002));
  const next = target.getBoundingClientRect(); stage.scrollLeft += next.left + localX * previewZoom - x; stage.scrollTop += next.top + localY * previewZoom - y;
}
function handlePreviewKeyDown(event: KeyboardEvent) {
  if (event.code !== 'Space' || previewIsEditing(event.target) || busy || !previewDimensions() || plugin || (!previewHovered && !$('preview-stage').contains(document.activeElement))) return;
  event.preventDefault(); previewSpace = true; $('preview-stage').classList.add('pan-ready');
}
function handlePreviewKeyUp(event: KeyboardEvent) { if (event.code === 'Space') { previewSpace = false; $('preview-stage').classList.remove('pan-ready'); releasePreviewPan(); } }
function releasePreviewPan() {
  const pan = previewPan; previewPan = null; const stage = $('preview-stage'); stage.classList.remove('panning');
  if (pan && stage.hasPointerCapture(pan.pointer)) stage.releasePointerCapture(pan.pointer);
}
$('preview-stage').addEventListener('pointerenter', () => { previewHovered = true; });
$('preview-stage').addEventListener('pointerleave', () => { previewHovered = false; });
$('preview-stage').addEventListener('wheel', event => handlePreviewWheel(event), { passive: false });
document.addEventListener('keydown', handlePreviewKeyDown);
document.addEventListener('keyup', handlePreviewKeyUp);
window.addEventListener('blur', () => { previewSpace = false; $('preview-stage').classList.remove('pan-ready'); releasePreviewPan(); });
$('preview-stage').addEventListener('pointerdown', event => {
  if (event.button !== 0 || !previewSpace || !previewDimensions()) return;
  event.preventDefault(); const stage = $('preview-stage'); stage.focus({ preventScroll: true }); stage.setPointerCapture(event.pointerId);
  previewPan = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.classList.add('panning');
});
$('preview-stage').addEventListener('pointermove', event => { if (!previewPan || event.pointerId !== previewPan.pointer) return; event.preventDefault(); const stage = $('preview-stage'); stage.scrollLeft = previewPan.left - (event.clientX - previewPan.x); stage.scrollTop = previewPan.top - (event.clientY - previewPan.y); });
for (const type of ['pointerup','pointercancel','lostpointercapture']) $('preview-stage').addEventListener(type, releasePreviewPan);
function fitPreview() { applyPreviewZoom(); }
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
  doc.addEventListener('wheel', event => handlePreviewWheel(event, currentFrame), { passive: false }); doc.addEventListener('keydown', handlePreviewKeyDown); doc.addEventListener('keyup', handlePreviewKeyUp);
  await Promise.race([Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 3500))]);
  await Promise.race([doc.fonts.ready, new Promise(resolve => setTimeout(resolve, 2500))]);
  const pages = discoverPages(doc, selector, input('split-pages').checked, input('page-selector').value.trim(), randomId());
  for (let i = 0; i < pages.length; i++) {
    if (captureStopped) break;
    const page = pages[i]; status(`正在解析 ${filename || 'HTML'} · 第 ${i + 1} / ${pages.length} 页…`);
    $<HTMLProgressElement>('progress').value = Math.round(i / pages.length * 100);
    try {
      const captured = await captureDOM(doc, { selector: page.selector, name: pages.length > 1 ? page.name : doc.title || filename.replace(/\.html?$/i, '') || 'HTML 页面' });
      if (page.canvas) captured.source.canvas = page.canvas;
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
  const token = input('service-token').value.trim(); if (!token) throw new Error('请先打开捕获助手，并点击“连接桌面助手”');
  try {
    const response = await fetch(`${service}${path}`, { method: payload ? 'POST' : 'GET', headers: { 'X-H2F-Token': token, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: controller?.signal || AbortSignal.timeout(7000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `请求失败：${response.status}`); return result;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('无法连接捕获助手。请确认助手仍在菜单栏运行，再点击“连接桌面助手”。');
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
      const url = normalizeCaptureAddress(input('page-url').value);
      if ($<HTMLSelectElement>('url-mode').value === 'states') {
        if (autoStates()) {
          if (!discovery || discoveryKey !== requestKey()) { await discoverAutomaticPages(url); return; }
          const states = discovery.plan.states.filter((_: unknown, i: number) => discoverySelection[i]);
          if (!states.length) throw new Error('请至少勾选一个页面');
          await prepareStates(url, { ...discovery.plan, states });
        } else await prepareStates(url);
        return;
      }
      const response = await api('/api/capture', { url, width: viewportWidth(), height: 900, selector: input('selector').value.trim() || 'body' });
      showPrepared(response.document); showRemotePreviews(response.preview);
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
  finally { controller = null; activeStateJob = null; setBusy(false); renderPageList(); renderDiscovery(); }
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
function importPrepared() {
  if (!prepared || !preparedBundle) return; if (!plugin) { download(); return; }
  queue = pageStates.map((p, i) => p.selected && p.state !== 'complete' ? i : -1).filter(i => i >= 0);
  if (!queue.length) { status(pageStates.some(p => p.selected) ? '所选页面都已导入；重新解析后可再次导入。' : '请至少选择一页。'); return; }
  captureStopped = false; importing = true; void reportHandoffProgress('importing', pageStates.filter(p => p.state === 'complete').length, 0); setBusy(true, true); renderPageList();
  message('SETTINGS', { settings: { mode: mode(), token: input('service-token').value } });
  if (preparedBundle.pages.length === 1 && !prepared.source.design) { status('正在加载字体并创建图层…'); message('IMPORT', { document: prepared, mode: mode(), expectedPageId: incomingHandoff?.expectedPageId }); }
  else {
    batchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; queuePosition = 0;
    message('BATCH_START', { id: batchId, mode: mode(), expectedPageId: incomingHandoff?.expectedPageId, plan: queue.map(i => ({ name: preparedBundle!.pages[i].name, width: preparedBundle!.pages[i].root.width, height: preparedBundle!.pages[i].root.height, design: preparedBundle!.pages[i].source.design, canvas: preparedBundle!.pages[i].source.canvas })) });
    status(`开始导入 ${queue.length} 页…`);
  }
}
$('import').addEventListener('click', importPrepared);
$('cancel').addEventListener('click', () => { captureStopped = true; if(activeStateJob) { void api(`/api/${activeJobKind}/${activeStateJob}/cancel`,{}).catch(e=>status(errorText(e),true)); } else if (controller) controller.abort(); if (importing) message('CANCEL'); status(importing ? '正在取消当前页，已完成的页面会保留…' : '正在停止解析…'); });
$('select-all-pages').addEventListener('click', () => { pageStates.forEach(p => { p.selected = true; }); renderPageList(); });
$('select-no-pages').addEventListener('click', () => { pageStates.forEach(p => { p.selected = false; }); renderPageList(); });
for (const id of ['viewport-width', 'selector', 'base-url', 'page-url', 'html-code', 'split-pages', 'page-selector', 'state-plan', 'url-mode']) $(id).addEventListener('input', invalidate);
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.addEventListener('change', () => { document.querySelectorAll('.mode-card').forEach(card => card.classList.toggle('selected', !!card.querySelector<HTMLInputElement>('input')?.checked)); });
$('copy-token').addEventListener('click', async () => { try { await navigator.clipboard.writeText(input('service-token').value); status('已复制连接码。'); } catch { status('请手动选择并复制连接码。'); } });
window.onmessage = event => {
  // Desktop Figma can forward messages from an ancestor sandbox or invoke onmessage.
  // Reject messages from our own preview/compiler frames, but do not assume one parent level.
  if (!plugin || !event.data?.pluginMessage || (event.source && Array.from(document.querySelectorAll('iframe')).some(child => child.contentWindow === event.source))) return;
  const msg = event.data.pluginMessage;
  if (msg.type === 'CONTEXT') { updateFigmaContext(msg.context); return; }
  if (msg.type === 'SETTINGS') {
    updateFigmaContext(msg.context);
    if (typeof msg.settings?.token === 'string') input('service-token').value = msg.settings.token;
    if(msg.assistant && typeof msg.assistant.clientId==='string' && typeof msg.assistant.credential==='string')assistantCredentials=msg.assistant;
    if(plugin)void connectAssistant(false);
    const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${msg.settings?.mode === 'auto' ? 'auto' : 'visual'}"]`); if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
  } else if (msg.type === 'BATCH_READY' && msg.id === batchId) { sendNextPage(); }
  else if (msg.type === 'PAGE_PROGRESS' && msg.id === batchId) { $<HTMLProgressElement>('progress').value = Math.round((queuePosition + msg.done / msg.total) / queue.length * 100); }
  else if (msg.type === 'PAGE_COMPLETE' && msg.id === batchId) {
    const index = queue[msg.index]; setPageState(index, msg.result.nodeId ? 'complete' : 'failed', msg.result.nodeId ? `完成 · ${msg.result.result.nodes} 层` : msg.result.error);
    if(incomingHandoff && Date.now()-incomingHandoff.lastProgress>600){incomingHandoff.lastProgress=Date.now();void reportHandoffProgress('importing',pageStates.filter(p=>p.state==='complete').length,pageStates.filter(p=>p.state==='failed').length);}
    queuePosition++; if (!captureStopped && queuePosition < queue.length) setTimeout(sendNextPage, 0);
  } else if (msg.type === 'BATCH_COMPLETE' && msg.id === batchId) {
    importing = false; setBusy(false); renderPageList();
    $('report-title').textContent = msg.result.cancelled ? '批次已停止' : msg.result.total > 1 ? '多页导入完成' : '已导入 Figma';
    status(`本次完成 ${msg.result.completed} / ${msg.result.total} 页，失败 ${msg.result.failed} 页。${msg.result.cancelled ? '已完成页面保留，可继续导入剩余页面。' : '每页已创建独立 Frame。'}`);
    const remaining = pageStates.filter(p => p.selected && p.state !== 'complete').length; $('import').textContent = remaining ? `继续导入剩余 ${remaining} 页` : '所选页面已全部导入'; $<HTMLButtonElement>('import').disabled = remaining === 0;
    void reportHandoffProgress(msg.result.cancelled?'cancelled':msg.result.failed?'partial':'complete',pageStates.filter(p=>p.state==='complete').length,pageStates.filter(p=>p.state==='failed').length);
    updateWarnings(msg.result.results.flatMap((r: any) => r.error ? [{ code: 'PAGE_FAILED', message: `${r.name}：${r.error}` }] : r.result?.diagnostics || []).slice(0, 100));
  } else if (msg.type === 'PROGRESS') { $<HTMLProgressElement>('progress').value = Math.round(msg.done / msg.total * 100); status(`正在创建图层 ${msg.done} / ${msg.total}…`); }
  else if (msg.type === 'COMPLETE') {
    importing = false; setBusy(false); if (pageStates[0]) pageStates[0].state = 'complete'; $('report-title').textContent = '已导入 Figma';
    status(`已创建 ${msg.result.nodes} 个图层${msg.result.autoLayouts ? `，其中 ${msg.result.autoLayouts} 个 Auto Layout 容器` : ''}。可以在 Figma 中撤销本次导入。`);
    void reportHandoffProgress('complete',1,0);
    updateWarnings(msg.result.diagnostics || []);
  } else if (msg.type === 'ERROR') { void reportHandoffProgress('failed',pageStates.filter(p=>p.state==='complete').length,0); importing = false; setBusy(false); status(msg.message || '导入失败，请重试', true); }
};

$('url-mode').addEventListener('change', () => { $('state-plan-panel').hidden = $<HTMLSelectElement>('url-mode').value !== 'states'; invalidate(); syncStateInput(); });
$('state-input-mode').addEventListener('change', () => { invalidate(); clearDiscovery(); syncStateInput(); });
$('exploration-depth').addEventListener('change', () => { invalidate(); clearDiscovery(); });
for (const id of ['page-url', 'viewport-width', 'selector']) $(id).addEventListener('input', clearDiscovery);
$('rediscover-pages').addEventListener('click', () => { clearDiscovery(); invalidate(); $('prepare').click(); });
function renderDiscovery() {
  if (!discovery) return;
  $('discovery-intro').hidden = true; $('discovery-results').hidden = false;
  $('discovery-title').textContent = `${discovery.report.mode === 'interactions' ? '已探索' : '发现'} ${discovery.pages.length} 个${discovery.report.mode === 'interactions' ? '状态' : '页面'}`;
  const count = () => { $('discovery-count').textContent = `已选择 ${discoverySelection.filter(Boolean).length} / ${discovery.pages.length}`; refreshPrepareAction(); };
  const rows = document.createDocumentFragment();
  discovery.pages.forEach((page: any, i: number) => {
    const row = document.createElement('label'); row.className = 'discovery-row'; row.dataset.failed = String(!!page.error);
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = discoverySelection[i]; checkbox.disabled = busy || !!page.error; checkbox.setAttribute('aria-label', `捕获 ${page.name}`);
    checkbox.addEventListener('change', () => { discoverySelection[i] = checkbox.checked; invalidate(); count(); });
    const copy = document.createElement('span'); copy.className = 'discovery-copy';
    const name = document.createElement('strong'); name.textContent = page.name;
    const detail = document.createElement('small');
    let route = ''; try { const address = new URL(page.destination || page.url); route = address.hash || decodeURIComponent(address.pathname.split('/').pop() || '/'); } catch {}
    detail.textContent = page.error ? `无法打开 · ${page.error}` : `${page.via} · ${page.via === '导航标签' && !page.destination ? '点击后捕获' : route}${page.checked ? '' : ' · 捕获时验证'}`;
    if (page.path) detail.textContent = `${page.via} · ${page.path}`;
    if(page.design){detail.textContent=`${PAGE_LEVELS[page.design.level as keyof typeof PAGE_LEVELS]} · ${page.design.moduleName} / ${page.design.pageName}${page.design.kind==='scroll'?' · 长页分段':''}${page.design.confidence==='low'?' · 待确认':''}`;detail.title=page.design.reason;}
    copy.append(name, detail); row.append(checkbox, copy); rows.append(row);
  });
  $('discovery-list').replaceChildren(rows);
  const report = discovery.report;
  $('discovery-summary').textContent = `${report.cancelled ? '发现已停止。' : ''}已验证 ${discovery.pages.filter((p: any) => p.checked).length} 页${report.errors.length ? `，${report.errors.length} 页无法打开` : ''}。${report.limited ? '达到扫描范围或时间上限，剩余候选页会在捕获时验证。' : '勾选页面后点击“开始捕获”。'}`;
  if (report.mode === 'interactions') $('discovery-summary').textContent = `已记录 ${discovery.pages.length} 个不同状态，尝试 ${report.attempted} 次，合并 ${report.duplicates} 次重复，失败 ${report.errors.length} 次。${report.limited ? `仍有 ${report.remaining} 个候选动作未探索；已达到本次范围或时间上限。` : '本次队列已处理。'} 跳过 ${report.skippedControls} 个受限或重复控件；不代表全部交互已覆盖。`;
  count();
}
$('discovery-select-all').addEventListener('click', () => { if (discovery) { discoverySelection = discovery.pages.map((p: any) => !p.error); invalidate(); renderDiscovery(); } });
$('discovery-clear').addEventListener('click', () => { discoverySelection.fill(false); invalidate(); renderDiscovery(); });
async function discoverAutomaticPages(url: string) {
  clearDiscovery(); status('正在打开入口并发现页面…');
  const key = requestKey();
  const job = await api('/api/discover', { url, width: viewportWidth(), height: 900, selector: input('selector').value.trim() || 'body', exploreInteractions: $<HTMLSelectElement>('state-input-mode').value === 'explore', maxDepth: Number($<HTMLSelectElement>('exploration-depth').value) });
  activeStateJob = job.id; activeJobKind = 'discover';
  while (true) {
    const snapshot = await api(`/api/discover/${job.id}`), p = snapshot.progress;
    if (p) status(`${captureStopped ? '正在停止探索' : p.status === 'exploring' ? '正在探索交互' : '正在发现页面'}：已找到 ${p.found || 0} 页 · 已检查 ${p.scanned || 0} 页 · ${p.name || ''}${p.attempted !== undefined ? ` · 已尝试 ${p.attempted} 次` : ''}`);
    if (snapshot.status !== 'running') {
      if (snapshot.error) throw new Error(snapshot.error);
      discovery = await api(`/api/discover/${job.id}/result`); discoveryKey = key;
      discoverySelection = discovery.pages.map((p: any) => !p.error); renderDiscovery();
      status(discovery.report.mode === 'interactions' ? `${discovery.report.cancelled ? '探索已停止' : '本轮探索结束'}：记录 ${discovery.pages.length} 个状态${discovery.report.limited ? '，仍有未探索动作' : ''}。请查看报告并勾选捕获。` : `${discovery.report.cancelled ? '发现已停止' : '发现完成'}：${discovery.pages.length} 个候选页面，请勾选后开始捕获。`, !discoverySelection.some(Boolean));
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

function downloadDiscoveryFile(data: unknown, filename: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
$('download-discovery-report').addEventListener('click', () => { if (discovery) downloadDiscoveryFile({ ...discovery.report, states: discovery.pages.map(({ name, path, via, depth }: any) => ({ name, path, via, depth })) }, 'interaction-exploration-report.json'); });
$('download-generated-plan').addEventListener('click', () => { if (discovery) downloadDiscoveryFile({ ...discovery.plan, states: discovery.plan.states.filter((_: unknown, i: number) => discoverySelection[i]) }, 'discovered-states.json'); });
$('load-demo-states').addEventListener('click', () => {
  invalidate(); clearDiscovery(); $<HTMLSelectElement>('state-input-mode').value = 'recipe'; syncStateInput(); $<HTMLTextAreaElement>('state-plan').value = JSON.stringify(demoStatePlan, null, 2); input('page-url').value=demoStatePlan.url;
  input('viewport-width').value=String(demoStatePlan.viewport.width); $('state-plan-label').textContent=`示例清单 · ${demoStatePlan.states.length} 个状态`;
  status('已载入示例状态清单。连接本地服务后点击解析，逐个捕获交互状态。');
});
$('choose-state-plan').addEventListener('click',()=>input('state-plan-file').click());
input('state-plan-file').addEventListener('change',async()=>{
  const file=input('state-plan-file').files?.[0];if(!file)return;invalidate();clearDiscovery();$<HTMLSelectElement>('state-input-mode').value='recipe';syncStateInput();
  try{if(file.size>2*1024*1024)throw new Error('状态清单最多 2 MB');const text=await file.text();const plan=JSON.parse(text);if(!Array.isArray(plan.states))throw new Error('状态清单需要 states 数组');$<HTMLTextAreaElement>('state-plan').value=text;input('page-url').value=plan.url||'';input('viewport-width').value=String(plan.viewport?.width||1440);$('state-plan-label').textContent=`${file.name} · ${plan.states.length} 个状态`;}catch(e){status(errorText(e),true);}
});
async function prepareStates(url: string, suppliedPlan?: any) {
  let plan;try{plan=suppliedPlan || JSON.parse($<HTMLTextAreaElement>('state-plan').value);}catch{throw new Error('请先载入状态清单，或粘贴有效的 JSON');}
  plan.url=url;plan.viewport={...plan.viewport,width:viewportWidth()};
  const job=await api('/api/states',plan);activeStateJob=job.id;activeJobKind='states';
  while(true){
    const snapshot=await api(`/api/states/${job.id}`);const p=snapshot.progress;
    if(p){$<HTMLProgressElement>('progress').value=Math.round((p.completed+p.failed)/p.total*100);status(`${captureStopped?'正在停止':'正在捕获'} ${Math.min(p.index+1,p.total)} / ${p.total}：${p.name} · 完成 ${p.completed}，失败 ${p.failed}`);}
    if(snapshot.status!=='running'){
      if(snapshot.status==='failed')throw new Error(snapshot.error||'状态捕获失败');
      const result=await api(`/api/states/${job.id}/result`);stateReport=result.report;
      if(result.bundle.pages.length){showBundle(result.bundle);showRemotePreviews(result.preview,job.id,result.previews||[]);}
      $('download-state-report').hidden=false;
      status(`状态捕获${result.report.cancelled?'已停止':'完成'}：成功 ${result.report.completed} / ${result.report.total}，失败 ${result.report.failed}。${result.report.completed?'可选择页面后导入 Figma。':'请下载报告检查失败原因。'}`,!result.report.completed);
      break;
    }
    await new Promise(resolve=>setTimeout(resolve,700));
  }
}
$('download-state-report').addEventListener('click',()=>{
  if(!stateReport)return;const blob=new Blob([JSON.stringify(stateReport,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='state-capture-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
});


async function handoffAPI(path: string, body?: unknown, timeout = 5000) {
  const token = input('service-token').value.trim(); if (!token) throw new Error('请先连接桌面助手');
  const response = await fetch(`${service}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-H2F-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '结果传输失败'); return result;
}
function refreshHandoffControls() {
  const count = pageStates.filter(p => p.selected).length;
  $('send-handoff').hidden = plugin || !preparedBundle;
  $<HTMLButtonElement>('send-handoff').disabled = busy || !count;
  $('send-handoff').textContent = `发送到 Figma 插件${count ? `（${count} 页）` : ''}`;
  $<HTMLButtonElement>('receive-handoff').disabled = busy || handoffReceiving;
  $('direct-target').hidden = plugin || !preparedBundle; $('direct-import').hidden = plugin || !preparedBundle;
  const target = figmaTargets.find(t => t.id === $<HTMLSelectElement>('figma-target').value);
  $<HTMLButtonElement>('direct-import').disabled = busy || !count || !target || target.busy;
  $('direct-import').textContent = `${outgoingPhase === 'complete' ? '再次导入' : '直接导入'} Figma${count ? `（${count} 页）` : ''}`;
  $('figma-target-help').textContent = target ? `${target.documentName} / ${target.pageName}${target.busy ? ' · 插件正在处理任务' : ''}` : '请在目标 Figma 文件中打开插件并保持连接。';
}
function selectedBundle() {
  if (!preparedBundle) throw new Error('请先捕获页面');
  const indices = pageStates.map((p, i) => p.selected ? i : -1).filter(i => i >= 0);
  if (!indices.length) throw new Error('请至少选择一页');
  const builder = new BundleBuilder(preparedBundle.name); indices.forEach(i => builder.add(hydratePage(preparedBundle!, i))); return builder.bundle;
}
function outgoingStatus(item: any) {
  outgoingPhase = item.status;
  const labels: Record<string, string> = { pending: '已发送。请在 Figma 插件中点击“接收并导入当前页面”。', received: 'Figma 插件已接收，正在准备导入。', importing: `正在导入 Figma：${item.completed} / ${item.pages} 页`, complete: `已导入 Figma：${item.completed} / ${item.pages} 页`, partial: `导入结束：完成 ${item.completed} 页，失败 ${item.failed} 页。请在 Figma 中检查。`, cancelled: `导入已取消，保留已完成的 ${item.completed} 页。`, failed: '导入失败，请在 Figma 插件中查看原因或重试。', replaced: '这批结果已被新发送的结果替代。' };
  $('handoff-send-status').hidden = false; $('handoff-send-status').classList.toggle('error', ['failed','partial'].includes(item.status)); $('handoff-send-status').textContent = item.error || (item.autoImport && item.status === 'pending' ? `已请求导入：${item.target.documentName} / ${item.target.pageName}，等待插件执行…` : labels[item.status] || item.status); refreshHandoffControls();
}
async function sendHandoff(direct = false) {
  if (plugin || busy) return;
  try {
    const target = direct ? figmaTargets.find(t => t.id === $<HTMLSelectElement>('figma-target').value) : null;
    if (direct && !target) throw new Error('请先选择已连接的 Figma 目标页面');
    const bundle = selectedBundle(), signature = JSON.stringify([preparedBundle?.createdAt, pageStates.map(p=>p.selected),preparedBundle?.pages.map(p=>p.source.design),mode(),target?.id,target?.contextVersion]);
    // Keep the same request id after a transport failure; successful retries cannot duplicate a batch.
    const stableSignature = signature;
    if (stableSignature !== sendSignature || (direct && ['complete','partial','failed','cancelled','replaced'].includes(outgoingPhase))) { sendSignature = stableSignature; sendRequestId = randomId(); }
    outgoingHandoff = null; handoffSending = true; setBusy(true); $('handoff-send-status').hidden = false; $('handoff-send-status').classList.remove('error'); $('handoff-send-status').textContent = '正在发送所选页面到 Figma 插件…';
    const sent = await handoffAPI('/api/handoffs', { requestId: sendRequestId, bundle, mode: mode(), ...(target ? { targetId: target.id, targetContext: target.contextVersion } : {}) }, 60000); outgoingHandoff = sent.id; outgoingStatus(sent);
  } catch (error) { $('handoff-send-status').hidden = false; $('handoff-send-status').classList.add('error'); $('handoff-send-status').textContent = errorText(error); }
  finally { handoffSending = false; setBusy(false); renderPageList(); }
}
$('send-handoff').addEventListener('click', () => { void sendHandoff(false); });
$('direct-import').addEventListener('click', () => { void sendHandoff(true); });
$('figma-target').addEventListener('change', refreshHandoffControls);
async function pollHandoffs() {
  if (handoffPolling || !input('service-token').value.trim()) return; handoffPolling = true;
  try {
    if (plugin && !handoffReceiving) {
      if (figmaContext) await handoffAPI('/api/figma/receivers', { receiverId, ...figmaContext, busy: busy || handoffReceiving || importing });
      const result = await handoffAPI(`/api/handoffs/latest?receiverId=${receiverId}`); handoffCandidate = result.handoff;
      if (handoffCandidate?.autoImport && !busy && !handoffReceiving) { await receiveHandoff(); return; }
      $('handoff-inbox').hidden = !handoffCandidate;
      if (handoffCandidate) { $('handoff-title').textContent = '桌面助手有新的捕获结果'; $('handoff-description').textContent = `${handoffCandidate.name} · ${handoffCandidate.pages} 页`; refreshHandoffControls(); }
    } else if (!plugin) {
      const receivers = await handoffAPI('/api/figma/receivers'); figmaTargets = receivers.targets;
      const key = JSON.stringify(figmaTargets);
      if (key !== targetOptionsKey) {
        const select = $<HTMLSelectElement>('figma-target'), previous = select.value; targetOptionsKey = key;
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = '选择 Figma 文件和页面';
        select.replaceChildren(empty, ...figmaTargets.map(t => { const option = document.createElement('option'); option.value = t.id; option.textContent = `${t.documentName} / ${t.pageName}${t.busy ? '（忙碌）' : ''}`; return option; }));
        select.value = figmaTargets.some(t => t.id === previous) ? previous : !previous && figmaTargets.length === 1 ? figmaTargets[0].id : ''; refreshHandoffControls();
      }
      if (outgoingHandoff) { const id = outgoingHandoff, result = await handoffAPI(`/api/handoffs/${id}`); if (outgoingHandoff === id) outgoingStatus(result); }
    }
  } catch { /* Connection retry is passive; existing capture data stays available. */ }
  finally { handoffPolling = false; }
}
function reportHandoffProgress(state: string, completed: number, failed: number) {
  const handoff = incomingHandoff; if (!handoff) return Promise.resolve();
  handoff.ack = handoff.ack.catch(() => {}).then(() => handoffAPI(`/api/handoffs/${handoff.id}/progress`, { receiverId, status: state, completed, failed })).catch(() => {});
  return handoff.ack;
}
async function receiveHandoff() {
  if (!plugin || !handoffCandidate || busy || handoffReceiving) return;
  const id = handoffCandidate.id; handoffReceiving = true; setBusy(true);
  try {
    const received = await handoffAPI(`/api/handoffs/${id}/claim`, { receiverId, contextVersion: figmaContext?.contextVersion }, 60000); validateBundle(received.bundle);
    invalidate(); showBundle(received.bundle); incomingHandoff = { id, ack: Promise.resolve(), lastProgress: 0, expectedPageId: received.target?.pageId };
    const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${received.mode === 'auto' ? 'auto' : 'visual'}"]`); if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
    $('handoff-inbox').hidden = true; handoffCandidate = null; handoffReceiving = false; setBusy(false); importPrepared();
  } catch (error) { status(errorText(error), true); }
  finally { handoffReceiving = false; if (!importing) setBusy(false); }
}
$('receive-handoff').addEventListener('click', () => { void receiveHandoff(); });
function updateFigmaContext(context: any) {
  if (!context || typeof context.pageId !== 'string') return;
  if (!figmaContext || figmaContext.pageId !== context.pageId || figmaContext.documentName !== context.documentName || figmaContext.pageName !== context.pageName) figmaContext = { ...context, contextVersion: randomId() };
}
const handoffPollTimer = setInterval(() => { void pollHandoffs(); }, 2000);
window.addEventListener('beforeunload', () => clearInterval(handoffPollTimer));

function assistantConnected(url: string, credential: string) {
  void Promise.resolve().then(pollHandoffs);
  service=url;input('service-token').value=credential;$('connection-dot').classList.add('connected');$('connection-label').textContent='桌面助手已连接';
  $('assistant-pair-code').hidden=true;$('assistant-help').textContent='助手保持运行，即可直接捕获；下次会自动重连。';$('connect-assistant').textContent='重新检测';
}
async function connectAssistant(interactive: boolean) {
  if(assistantConnecting)return;assistantConnecting=true;$<HTMLButtonElement>('connect-assistant').disabled=true;
  try{
    if(interactive)$('assistant-help').textContent='正在查找已打开的捕获助手…';
    const found=await discoverAssistant(assistantCredentials?.serviceURL);
    if(!found){if(interactive){$('connection-dot').classList.remove('connected');$('connection-label').textContent='尚未连接桌面助手';$('assistant-help').textContent='请先双击打开 HTML to Figma 捕获助手，再点击连接。';}return;}
    if(assistantCredentials && await verifyAssistant(found,assistantCredentials.credential)){assistantConnected(found,assistantCredentials.credential);assistantCredentials.serviceURL=found;message('ASSISTANT_SETTINGS',{assistant:assistantCredentials});return;}
    if(!interactive){$('connection-label').textContent='已找到桌面助手';$('assistant-help').textContent='点击连接，首次只需在助手中确认一次。';return;}
    assistantCredentials ||= newAssistantCredentials();
    const result=await pairAssistant(found,assistantCredentials,code=>{$('assistant-pair-code').textContent=code;$('assistant-pair-code').hidden=false;$('assistant-help').textContent='请核对助手窗口中的配对码一致，然后点击“允许连接”。';});
    assistantCredentials={clientId:result.clientId,credential:result.credential,serviceURL:result.url};message('ASSISTANT_SETTINGS',{assistant:assistantCredentials});assistantConnected(result.url,result.credential);status('桌面助手已连接，可以开始捕获。');
  }catch(error){$('assistant-help').textContent=errorText(error);$('assistant-pair-code').hidden=true;}
  finally{assistantConnecting=false;$<HTMLButtonElement>('connect-assistant').disabled=false;}
}
$('connect-assistant').addEventListener('click',()=>void connectAssistant(true));
if(!plugin && session?.token){$('connect-assistant').hidden=true;$('assistant-help').textContent='当前工作台已连接本机捕获服务。';}

message('READY');

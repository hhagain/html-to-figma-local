import { exploreStates } from './explore-states.mjs';
import { validateCaptureRequest } from './browser.mjs';
import { openCaptureSource, resolveStateURL } from './capture-source.mjs';

export function validateDiscoveryRequest(input) {
  const options = validateCaptureRequest(input);
  const maxPages = input.maxPages ?? 200;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) throw new Error('自动发现最多支持 200 页');
  const maxDepth = input.maxDepth ?? 4, maxActions = input.maxActions ?? 300, timeoutMs = input.timeoutMs ?? 180000;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 6 || !Number.isInteger(maxActions) || maxActions < 1 || maxActions > 1000 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('探索范围无效');
  return { ...options, maxPages, maxDepth, maxActions, timeoutMs, exploreInteractions: input.exploreInteractions === true };
}

// Only enumerate navigation controls. Never execute page-provided scripts as recipes.
function inspectNavigation() {
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const name = el => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const risky = /删除|清空|退出|注销|重置|提交|保存|发送|支付|购买|结算|下载|导出|\b(?:delete|remove|logout|signout|sign-out|reset|submit|save|send|checkout|purchase|download|export)\b/i;
  const selector = el => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let current = el; current && current !== document.body; current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
      const siblings = [...(current.parentElement?.children || [])].filter(node => node.tagName === current.tagName);
      part += `:nth-of-type(${siblings.indexOf(current) + 1})`; parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const candidates = []; let skipped = 0;
  for (const el of document.querySelectorAll('a[href], [role="tab"], nav button, aside button, [role="navigation"] button, button[data-route], button[data-page], button[data-tab]')) {
    if (candidates.length >= 500) break;
    if (!visible(el) || el.disabled || el.closest('form') || el.hasAttribute('download')) continue;
    const label = name(el); if (!label) continue;
    const href = el.getAttribute('href');
    if (risky.test(label + ' ' + (href || '') + ' ' + (el.getAttribute('data-action') || ''))) { skipped++; continue; }
    const tab = el.getAttribute('role') === 'tab';
    if (href && !tab) {
      if (/^(javascript:|mailto:|tel:|data:|blob:)/i.test(href) || (href.startsWith('#') && !/^#!?\//.test(href))) continue;
      let url; try { url = new URL(href, document.baseURI); } catch { continue; }
      if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|json|css|m?js|mp4|docx?|xlsx?)(?:$|[?#])/i.test(url.href)) continue;
      candidates.push({ kind: 'link', name: label, url: url.href });
    } else {
      if (el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit') continue;
      const css = selector(el); if (!css || css.length > 650) continue;
      candidates.push({ kind: 'tab', name: label, selector: css, selected: el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page', waitSelected: el.hasAttribute('aria-selected') });
    }
  }
  return { title: document.title.slice(0, 120), candidates, skipped };
}

export async function discoverPages(browser, rawRequest, { signal, onProgress } = {}) {
  const options = validateDiscoveryRequest(rawRequest);
  if(options.exploreInteractions)return exploreStates(browser,options,{signal,onProgress});
  const source = await openCaptureSource(options.url);
  const pages = [], known = new Map(), queue = [], errors = [];
  const report = { status: 'running', found: 0, scanned: 0, blockedRequests: 0, skippedControls: 0, limited: false, cancelled: false, errors, maxPages: options.maxPages };
  let activeContext = null, closing = null, timedOut = false, title = '发现的页面';
  const closeContext = () => activeContext ? (closing ||= activeContext.close().catch(() => {})) : Promise.resolve();
  const abort = () => { void closeContext(); };
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => { timedOut = true; abort(); }, 60000); deadline.unref();
  const canonical = value => { const url = new URL(value); if (!/^#!?\//.test(url.hash)) url.hash = ''; return url.href; };
  const add = (key, state, via, depth) => {
    if (known.has(key)) return known.get(key);
    if (pages.length >= options.maxPages) { report.limited = true; return null; }
    const entry = { ...state, id: `page-${pages.length + 1}`, via, checked: false, depth };
    known.set(key, entry); pages.push(entry); if (depth <= 2) queue.push(entry); else report.limited = true; report.found = pages.length;
    return entry;
  };
  const entry = add('url:' + canonical(options.url), { name: '当前页面', url: options.url, steps: [] }, '入口', 0);
  try {
    while (queue.length && report.scanned < 30 && !signal?.aborted && !timedOut) {
      const item = queue.shift();
      onProgress?.({ status: 'discovering', name: item.name, found: pages.length, scanned: report.scanned });
      let pageTimer;
      try {
        activeContext = await browser.newContext({ viewport: { width: options.width, height: options.height }, serviceWorkers: 'block', reducedMotion: 'reduce', locale: 'zh-CN' }); closing = null;
        if (signal?.aborted || timedOut) break;
        pageTimer = setTimeout(abort, 12000); pageTimer.unref();
        const context = activeContext;
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) || !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ||
              (request.isNavigationRequest() && url.origin !== new URL(source.url).origin)) { report.blockedRequests++; return route.abort(); }
          const local = await source.read(url.href); return local ? route.fulfill(local) : route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(4000);
        page.on('dialog', dialog => void dialog.dismiss());
        page.on('popup', popup => void popup.close().catch(() => {}));
        const response = await page.goto(source.toBrowserURL(item.url), { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && !response.ok()) throw new Error(`HTTP ${response.status()}`);
        for (const step of item.steps) {
          if (signal?.aborted || timedOut) break;
          if (step.type === 'click') await page.locator(step.selector).click({ timeout: 3000 });
          if (step.type === 'wait') await page.locator(step.selector).waitFor({ state: 'visible', timeout: 3000 });
        }
        await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => {});
        if (signal?.aborted || timedOut) break;
        const inspected = await page.evaluate(inspectNavigation); report.skippedControls += inspected.skipped;
        if (item === entry) { title = inspected.title || title; item.name = inspected.candidates.find(c => c.selected)?.name || inspected.title || '当前页面'; }
        else if (item.via === '本地文件' && inspected.title) item.name = inspected.title;
        item.checked = true; item.destination = source.toSourceURL(page.url());
        for (const candidate of inspected.candidates) {
          if (candidate.kind === 'link') {
            try {
              const url = resolveStateURL(source.toSourceURL(candidate.url), options.url);
              add('url:' + canonical(url), { name: candidate.name, url, steps: [] }, '页面链接', item.depth + 1);
            } catch { /* Outside the entry's origin/directory. */ }
          } else {
            const location = new URL(item.url); location.hash = '';
            const key = `tab:${location.href}:${candidate.selector}:${candidate.name}`;
            if (candidate.selected) { if (!known.has(key)) known.set(key, item); continue; }
            if (item.steps.some(step => step.selector === candidate.selector)) continue;
            const steps = [...item.steps, { type: 'click', selector: candidate.selector }];
            if (candidate.waitSelected) steps.push({ type: 'wait', selector: `${candidate.selector}[aria-selected="true"]` });
            add(key, { name: candidate.name, url: item.url, steps }, '导航标签', item.depth + 1);
          }
        }
        // Local projects may have standalone pages with no links from index.html.
        if (item === entry && source.local) {
          const local = await source.listPages(options.maxPages + 1); report.limited ||= local.limited;
          for (const url of local.files) {
            const base = new URL(options.url); base.hash = ''; base.search = '';
            if (url === base.href) continue;
            const name = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.html?$/i, '');
            add('url:' + canonical(url), { name, url, steps: [] }, '本地文件', 1);
          }
        }
      } catch (error) {
        if (!signal?.aborted && !timedOut) { item.error = String(error.message).split('\n')[0].slice(0, 200); errors.push({ id: item.id, name: item.name, error: item.error }); }
      } finally { clearTimeout(pageTimer); await closeContext(); activeContext = null; closing = null; report.scanned++; }
    }
    report.limited ||= queue.length > 0 || timedOut;
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); await closeContext(); }
  report.cancelled = !!signal?.aborted; report.status = report.cancelled ? 'cancelled' : errors.length || report.limited ? 'partial' : 'complete';
  const states = pages.map(({ id, name, url, steps }) => ({ id, name, url, steps, group: '自动发现', selector: options.selector }));
  const plan = { schemaVersion: 1, name: title, url: options.url, viewport: { width: options.width, height: options.height }, selector: options.selector, captureMode: 'viewport', states };
  return { plan, pages, report };
}

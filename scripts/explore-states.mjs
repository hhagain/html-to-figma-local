import { setTimeout as delay } from 'node:timers/promises';
import { openCaptureSource } from './capture-source.mjs';
import { runSteps } from './state-capture.mjs';
import { inspectState } from './interaction-inspector.mjs';

export async function exploreStates(browser, options, { signal, onProgress } = {}) {
  const source = await openCaptureSource(options.url), pages = [], fingerprints = new Set(), attempted = new Set(), globalActions = new Set();
  const queue = [{ name: '当前页面', url: options.url, steps: [], keys: [], depth: 0, kind: '入口', path: [] }];
  const report = { status: 'running', mode: 'interactions', found: 0, scanned: 0, attempted: 0, duplicates: 0, skippedControls: 0, blockedRequests: 0, limited: false, cancelled: false, exhaustive: false, remaining: 0, errors: [], skipped: [], limits: { states: options.maxPages, actions: options.maxActions, depth: options.maxDepth, timeoutMs: options.timeoutMs }, limitations: ['自动探索按控件和状态取样，不代表穷举全部输入、权限、网络和时间条件。', '不提交已填表单，不自动处理设备权限、文件选择或远程登录。', '同类列表项最多取两个代表样本，未执行的操作会列在报告中。'] };
  let context = null, closing = null, activePageReady = null, timedOut = false, title = '交互状态', dropped = 0, listedLocal = false;
  const close = () => {if(!context)return Promise.resolve();const current=context,ready=activePageReady;return closing ||= (async()=>{await ready?.catch(()=>{});await current.close().catch(()=>{});})();};
  const abort = () => { void close(); }; signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => { timedOut = true; abort(); }, options.timeoutMs); deadline.unref();
  const blocked = reason => { report.blockedRequests++; return reason.abort(); };
  try {
    while (queue.length && (options.maxPages === null || pages.length < options.maxPages) && report.attempted < options.maxActions && !signal?.aborted && !timedOut) {
      const work = queue.shift(); let timer;
      onProgress?.({ status: 'exploring', name: work.name, found: pages.length, scanned: report.scanned, attempted: report.attempted, remaining: queue.length, depth: work.depth });
      try {
        context = await browser.newContext({ viewport: { width: options.width, height: options.height }, reducedMotion: 'reduce', locale: 'zh-CN', serviceWorkers: 'block', acceptDownloads: false }); closing = null;
        if (signal?.aborted || timedOut) break;
        timer = setTimeout(abort, 18000); timer.unref();
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || (req.isNavigationRequest() && url.origin !== new URL(source.url).origin)) return blocked(route);
          const local = await source.read(url.href); return local ? route.fulfill(local) : route.continue();
        });
        // Block other write transports in addition to ordinary HTTP requests.
        await context.addInitScript(() => { window.WebSocket = class { constructor() { throw new Error('捕获会话不连接 WebSocket'); } }; navigator.sendBeacon = () => false; });
        const page = await (activePageReady=context.newPage());activePageReady=null;if(signal?.aborted||timedOut)break;page.on('dialog', dialog => void dialog.dismiss()); page.on('popup', popup => void popup.close().catch(() => {}));
        const response = await page.goto(source.toBrowserURL(work.url), { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && !response.ok()) throw new Error('HTTP ' + response.status());
        await runSteps(page, work.steps, signal); await delay(180, undefined, { signal });
        if (signal?.aborted || timedOut) break;
        let current = await inspectState(page, source.local);
        // Wait for short DOM transitions; avoid requiring perpetual network idleness.
        for (let check = 0; check < 3; check++) { await delay(80, undefined, { signal }); const next = await inspectState(page, source.local); if (next.fingerprint === current.fingerprint) break; current = next; }
        report.attempted++; report.scanned++;
        if (fingerprints.has(current.fingerprint)) { report.duplicates++; continue; }
        fingerprints.add(current.fingerprint); title = current.title || title;
        const path = work.path.length ? work.path : [current.heading || current.title || '初始页面'];
        const name = work.depth === 0 ? current.heading || current.title || '初始页面' : current.dialog && current.heading ? current.heading + (['表单','校验','选择','滚动'].includes(work.kind) ? ' · ' + work.name : '') : work.name;
        const entry = { id: `state-${pages.length + 1}`, name: name.slice(0, 120), url: work.url, destination: source.toSourceURL(page.url()), steps: [...work.steps, { type: 'wait', ms: 180 }], checked: true, via: current.dialog ? '弹窗 / 表单' : work.kind, depth: work.depth, path: path.join(' → ').slice(0, 500), fingerprint: current.fingerprint };
        pages.push(entry); report.found = pages.length;
        for (const skip of current.skipped) { report.skippedControls++; if (report.skipped.length < 300) report.skipped.push({ state: entry.name, ...skip }); }
        if (work.depth >= options.maxDepth) { dropped += current.candidates.length; continue; }
        for (const candidate of current.candidates) {
          if (work.keys.includes(candidate.key)) continue;
          if(candidate.global){if(globalActions.has(candidate.key))continue;globalActions.add(candidate.key);}
          const key = current.fingerprint + ':' + candidate.key; if (attempted.has(key)) continue; attempted.add(key);
          if (queue.length >= options.maxActions * 3) { dropped++; continue; }
          queue[['表单','校验'].includes(candidate.kind)?'unshift':'push']({ url: work.url, name: candidate.name, steps: [...work.steps, ...candidate.steps.map(step => ({ ...step, timeoutMs: 2500 })), { type: 'wait', ms: 160 }], keys: [...work.keys, candidate.key], depth: work.depth + 1, kind: candidate.kind, path: [...path, candidate.name] });
        }
        if (!listedLocal && source.local) {
          listedLocal = true;
          const listing = await source.listPages(options.maxPages === null ? undefined : Math.min(options.maxPages + 1, Number.MAX_SAFE_INTEGER));
          for (const url of listing.files) { if (url === options.url.split(/[?#]/)[0]) continue; queue.push({ url, name: decodeURIComponent(new URL(url).pathname.split('/').pop()), steps: [], keys: [], depth: 0, kind: '本地文件', path: [] }); }
        }
      } catch (error) { report.attempted++; if (!signal?.aborted && !timedOut && report.errors.length < 200) report.errors.push({ name: work.name, path: work.path.join(' → ').slice(0, 500), error: String(error.message).split('\n')[0].slice(0, 200) }); }
      finally { clearTimeout(timer); await close(); context = null; closing = null; activePageReady = null; }
    }
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); await close(); }
  report.remaining = queue.length + dropped; report.limited = report.remaining > 0 || timedOut; report.cancelled = !!signal?.aborted;
  report.status = report.cancelled ? 'cancelled' : report.limited || report.errors.length ? 'partial' : 'complete';
  report.pending = queue.slice(0, 100).map(({ name, depth, path }) => ({ name, depth, path: path.join(' → ').slice(0, 500) }));
  const states = pages.map(({ id, name, url, steps, fingerprint }) => ({ id, name, url, steps, expectedFingerprint: fingerprint, group: '交互探索', selector: options.selector }));
  return { plan: { schemaVersion: 1, name: title, url: options.url, viewport: { width: options.width, height: options.height }, selector: options.selector, captureMode: 'viewport', states }, pages, report };
}

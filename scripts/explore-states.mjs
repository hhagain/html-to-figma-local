import { inferOrganization } from '../dist/lib/design-organization.js';
import { setTimeout as delay } from 'node:timers/promises';
import { openCaptureSource } from './capture-source.mjs';
import { runSteps } from './state-capture.mjs';
import { inspectState } from './interaction-inspector.mjs';

const binding = o => JSON.stringify([o.url, o.width, o.height, o.selector]);
const initialWork = url => ({ name: '当前页面', url, steps: [], keys: [], depth: 0, kind: '入口', path: [] });
export async function exploreStates(browser, options, { signal, onProgress, checkpoint } = {}) {
  if (checkpoint && checkpoint.binding !== binding(options)) throw new Error('入口、视口或捕获区域已改变，请重新探索');
  const source = await openCaptureSource(options.url);
  const state = checkpoint || {
    binding: binding(options), pages: [], queue: [initialWork(options.url)], deferred: [], works: [], failedWork: [],
    fingerprints: [], actionKeys: [], globalActions: [], listedLocal: false, title: '交互状态', rounds: 0, elapsedMs: 0,
    metrics: { scanned: 0, attempted: 0, duplicates: 0, rescanned: 0, failed: 0, skippedControls: 0, blockedRequests: 0, skippedByReason: { restricted: 0, sampling: 0, duplicate: 0 }, errors: [], skipped: [] }
  };
  const { pages, queue, metrics } = state;
  const fingerprints = new Set(state.fingerprints), actionKeys = new Set(state.actionKeys), globalActions = new Set(state.globalActions);
  const baseline = { attempted: metrics.attempted, found: pages.length, failed: metrics.failed }, started = Date.now();
  // Depth-limited actions remain replayable. A later round can increase or remove the depth.
  queue.push(...state.deferred); state.deferred = [];
  if (options.sampling === 'all') {
    const scheduled = new Set(queue.map(item => item.revisit).filter(Boolean));
    for (const work of state.works) if (work.sampling !== 'all' && !scheduled.has(work.fingerprint)) queue.push({ ...work, revisit: work.fingerprint });
  }
  if (options.retryFailures) { queue.push(...state.failedWork); state.failedWork = []; }
  let context = null, closing = null, activePageReady = null, timedOut = false, deadline;
  const close = () => {
    if (!context) return Promise.resolve();
    const current = context, ready = activePageReady;
    return closing ||= (async () => { await ready?.catch(() => {}); await current.close().catch(() => {}); })();
  };
  const abort = () => { void close(); };
  signal?.addEventListener('abort', abort, { once: true });
  // Re-arm long deadlines rather than overflowing Node's signed 32-bit timer range.
  const armDeadline = () => {
    if (options.timeoutMs === null) return;
    const remaining = options.timeoutMs - (Date.now() - started);
    if (remaining <= 0) { timedOut = true; abort(); return; }
    deadline = setTimeout(armDeadline, Math.min(remaining, 60000)); deadline.unref();
  };
  armDeadline();
  const skip = (entry, item) => {
    const count = item.count || 1, category = item.category || 'restricted';
    metrics.skippedControls += count; metrics.skippedByReason[category] = (metrics.skippedByReason[category] || 0) + count;
    if (metrics.skipped.length < 300) metrics.skipped.push({ state: entry.name, ...item });
  };
  try {
    while (queue.length && (options.maxPages === null || pages.length - baseline.found < options.maxPages)
      && (options.maxActions === null || metrics.attempted - baseline.attempted < options.maxActions) && !signal?.aborted && !timedOut) {
      const work = queue.shift();
      if (options.maxDepth !== null && work.depth > options.maxDepth) { state.deferred.push(work); continue; }
      let timer, finished = false, pageTimedOut = false;
      onProgress?.({ status: 'exploring', name: work.name, found: pages.length, scanned: metrics.scanned, attempted: metrics.attempted, remaining: queue.length + state.deferred.length + 1, depth: work.depth, round: state.rounds + 1 });
      try {
        if (signal?.aborted || timedOut) break;
        context = await browser.newContext({ viewport: { width: options.width, height: options.height }, reducedMotion: 'reduce', locale: 'zh-CN', serviceWorkers: 'block', acceptDownloads: false }); closing = null;
        if (signal?.aborted || timedOut) break;
        // Individual actions keep their timeouts; a long replay is no longer cut off at 18s.
        const replayBudget = 18000 + work.steps.reduce((sum, step) => sum + (step.type === 'wait' && !step.selector ? step.ms || 0 : step.timeoutMs || 7000), 0);
        timer = setTimeout(() => { pageTimedOut = true; abort(); }, Math.min(replayBudget, 2147483647)); timer.unref();
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url());
          if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || (req.isNavigationRequest() && url.origin !== new URL(source.url).origin)) { metrics.blockedRequests++; return route.abort(); }
          const local = await source.read(url.href); return local ? route.fulfill(local) : route.continue();
        });
        await context.addInitScript(() => { window.WebSocket = class { constructor() { throw new Error('捕获会话不连接 WebSocket'); } }; navigator.sendBeacon = () => false; });
        const page = await (activePageReady = context.newPage()); activePageReady = null;
        if (signal?.aborted || timedOut) break;
        page.on('dialog', dialog => void dialog.dismiss()); page.on('popup', popup => void popup.close().catch(() => {}));
        const response = await page.goto(source.toBrowserURL(work.url), { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && !response.ok()) throw new Error('HTTP ' + response.status());
        await runSteps(page, work.steps, signal); await delay(180, undefined, { signal });
        if (signal?.aborted || timedOut) break;
        let current = await inspectState(page, source.local, { sampling: options.sampling });
        for (let check = 0; check < 3; check++) {
          await delay(80, undefined, { signal }); const next = await inspectState(page, source.local, { sampling: options.sampling });
          if (next.fingerprint === current.fingerprint) break; current = next;
        }
        if (signal?.aborted || timedOut) break;
        finished = true; metrics.attempted++; metrics.scanned++;
        const known = fingerprints.has(current.fingerprint);
        if (known && !work.revisit) { metrics.duplicates++; continue; }
        const path = work.path.length ? work.path : [current.heading || current.title || '初始页面'];
        let entry;
        if (known) {
          metrics.rescanned++; entry = pages.find(p => p.fingerprint === current.fingerprint);
          const original = state.works.find(w => w.fingerprint === current.fingerprint); if (original) original.sampling = options.sampling;
        } else {
          fingerprints.add(current.fingerprint); state.title = current.title || state.title;
          const name = work.depth === 0 ? current.structure.primary?.name || current.heading || current.title || '初始页面' : current.dialog && current.heading ? current.heading + (['表单', '校验', '选择', '滚动'].includes(work.kind) ? ' · ' + work.name : '') : work.name;
          entry = { id: `state-${pages.length + 1}`, name: name.slice(0, 120), url: work.url, destination: source.toSourceURL(page.url()), steps: [...work.steps, { type: 'wait', ms: 180 }], checked: true, via: current.dialog ? '弹窗 / 表单' : work.kind, depth: work.depth, path: path.join(' → ').slice(0, 500), fingerprint: current.fingerprint };
          entry.design = inferOrganization({ url: entry.destination, entryURL: options.url, heading: current.heading, title: current.title, dialog: current.dialog, viewFingerprint: current.viewFingerprint, ...current.structure, scrolls: current.scrolls, name: entry.name, actionKind: work.kind, triggerFamily: work.family, featureName: work.featureName, parent: work.parentDesign, parentURL: work.parentURL });
          pages.push(entry); state.works.push({ ...work, revisit: undefined, fingerprint: current.fingerprint, sampling: options.sampling });
        }
        for (const item of current.skipped) skip(entry, item);
        for (const candidate of current.candidates) {
          const key = current.fingerprint + ':' + candidate.key;
          if (actionKeys.has(key) || (options.sampling !== 'all' && (work.keys.includes(candidate.key) || candidate.global && globalActions.has(candidate.key)))) {
            // Re-inspection of a state does not count previously enqueued controls again.
            if (!work.revisit) skip(entry, { name: candidate.name, reason: '重复动作或已访问路径', category: 'duplicate' });
            continue;
          }
          actionKeys.add(key); if (candidate.global) globalActions.add(candidate.key);
          const next = { url: work.url, name: candidate.name, steps: [...work.steps, ...candidate.steps.map(step => ({ ...step, timeoutMs: 2500 })), { type: 'wait', ms: 160 }], keys: [...work.keys, candidate.key], depth: work.depth + 1, kind: candidate.kind, path: [...path, candidate.name], parentDesign: entry.design, parentURL: entry.destination, family: candidate.family, featureName: candidate.featureName };
          if (options.maxDepth !== null && next.depth > options.maxDepth) state.deferred.push(next);
          else queue[['表单', '校验'].includes(candidate.kind) ? 'unshift' : 'push'](next);
        }
        if (!state.listedLocal && source.local) {
          state.listedLocal = true;
          const listing = await source.listPages();
          for (const url of listing.files) {
            if (url === options.url.split(/[?#]/)[0]) continue;
            queue.push({ ...initialWork(url), name: decodeURIComponent(new URL(url).pathname.split('/').pop()), kind: '本地文件' });
          }
        }
      } catch (error) {
        if (!signal?.aborted && !timedOut) {
          finished = true; metrics.attempted++; metrics.failed++;
          const failure = { ...work, revisit: undefined }; state.failedWork.push(failure);
          if (metrics.errors.length < 200) metrics.errors.push({ name: work.name, path: work.path.join(' → ').slice(0, 500), error: pageTimedOut ? '此动作回放超时' : String(error.message).split('\n')[0].slice(0, 200) });
        }
      } finally {
        if (!finished) queue.unshift(work);
        clearTimeout(timer); await close(); context = null; closing = null; activePageReady = null;
      }
    }
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); await close(); }
  state.fingerprints = [...fingerprints]; state.actionKeys = [...actionKeys]; state.globalActions = [...globalActions]; state.rounds++; state.elapsedMs += Date.now() - started;
  const remaining = queue.length + state.deferred.length, stopReasons = [];
  if (signal?.aborted) stopReasons.push('cancelled');
  if (timedOut) stopReasons.push('time');
  if (remaining && options.maxActions !== null && metrics.attempted - baseline.attempted >= options.maxActions) stopReasons.push('actions');
  if (remaining && options.maxPages !== null && pages.length - baseline.found >= options.maxPages) stopReasons.push('states');
  if (state.deferred.length) stopReasons.push('depth');
  if (!remaining && !stopReasons.length) stopReasons.push('queue');
  const report = {
    ...structuredClone(metrics), status: signal?.aborted ? 'cancelled' : remaining || state.failedWork.length ? 'partial' : 'complete', mode: 'interactions', found: pages.length,
    limited: remaining > 0 || timedOut, cancelled: !!signal?.aborted, exhaustive: false, remaining, queued: queue.length, depthDeferred: state.deferred.length,
    retryableFailures: state.failedWork.length, canResume: remaining > 0 || state.failedWork.length > 0 || options.sampling !== 'all' && metrics.skippedByReason.sampling > 0,
    stopReasons, rounds: state.rounds, elapsedMs: state.elapsedMs, sampling: options.sampling,
    limits: { states: options.maxPages, actions: options.maxActions, depth: options.maxDepth, timeoutMs: options.timeoutMs },
    round: { attempted: metrics.attempted - baseline.attempted, found: pages.length - baseline.found, failed: metrics.failed - baseline.failed, elapsedMs: Date.now() - started },
    pending: [...queue.slice(0, 100), ...state.deferred.slice(0, Math.max(0, 100 - queue.length))].map(({ name, depth, path }) => ({ name, depth, path: path.join(' → ').slice(0, 500) })),
    limitations: ['队列处理完成只表示本次可识别动作已遍历，不代表穷举所有输入、权限、网络和时间条件。', '不提交已填表单，不自动处理设备权限、文件选择或远程登录。', options.sampling === 'all' ? '遍历已识别的控件和选项；表单仍使用示例输入，滚动使用顶部/底部状态。' : '同类控件取代表样本；切换为遍历控件后可继续补充探索。', '继续探索需要助手保持运行；入口、视口和捕获区域必须一致。']
  };
  const snapshotPages = structuredClone(pages);
  const states = snapshotPages.map(({ id, name, url, steps, fingerprint, design }) => ({ id, name, url, steps, design, expectedFingerprint: fingerprint, group: '交互探索', selector: options.selector }));
  return { plan: { schemaVersion: 1, name: state.title, url: options.url, viewport: { width: options.width, height: options.height }, selector: options.selector, captureMode: 'viewport', states }, pages: snapshotPages, report, checkpoint: state };
}

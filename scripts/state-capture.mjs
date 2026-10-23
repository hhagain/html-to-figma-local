import { captureLoadedPage, validateCaptureRequest } from './browser.mjs';
import { createHash } from 'node:crypto';
import { resolveStateURL, openCaptureSource } from './capture-source.mjs';
import { inspectState } from './interaction-inspector.mjs';
const ACTIONS = new Set(['click','fill','select','check','press','hover','scroll','wait']);
export function validateStatePlan(input) {
  if (!input || input.schemaVersion !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150) throw new Error('状态清单需要 schemaVersion: 1 和名称');
  const base = validateCaptureRequest({ url: input.url, width: input.viewport?.width || 1440, height: input.viewport?.height || 1000, selector: input.selector || 'body' });
  if (!Array.isArray(input.states) || !input.states.length || input.states.length > 200) throw new Error('状态清单需要 1–200 个状态');
  if (input.captureMode !== undefined && !['viewport', 'full'].includes(input.captureMode)) throw new Error('捕获模式必须是 viewport 或 full');
  const safeURL = value => resolveStateURL(value, base.url);
  let actionCount = 0;
  const steps = (value = []) => {
    if (!Array.isArray(value) || value.length > 80) throw new Error('每个状态最多 80 个操作');
    return value.map(a => {
      if (++actionCount > 8000 || !a || !ACTIONS.has(a.type)) throw new Error('不支持的状态操作或操作数量超限');
      if (a.type !== 'wait' && (typeof a.selector !== 'string' || !a.selector || a.selector.length > 700)) throw new Error('操作需要有效的 CSS 选择器');
      if (a.selector !== undefined && (typeof a.selector !== 'string' || a.selector.length > 700)) throw new Error('选择器无效');
      if (a.value !== undefined && (typeof a.value !== 'string' || a.value.length > 20000)) throw new Error('输入值无效');
      if (['fill','select','press'].includes(a.type) && typeof a.value !== 'string') throw new Error('操作缺少 value');
      if (a.checked !== undefined && typeof a.checked !== 'boolean') throw new Error('checked 必须为布尔值');
      if (a.timeoutMs !== undefined && (!Number.isInteger(a.timeoutMs) || a.timeoutMs < 1 || a.timeoutMs > 15000)) throw new Error('操作超时范围为 1–15000 ms');
      if (a.ms !== undefined && (!Number.isInteger(a.ms) || a.ms < 0 || a.ms > 5000)) throw new Error('等待时间范围为 0–5000 ms');
      if (a.state !== undefined && !['visible','hidden','attached','detached'].includes(a.state)) throw new Error('等待条件无效');
      if (a.text !== undefined && (typeof a.text !== 'string' || a.text.length > 1000)) throw new Error('等待文本过长');
      if (a.index !== undefined && (!Number.isInteger(a.index) || a.index < 0 || a.index > 10000)) throw new Error('元素序号无效');
      for (const key of ['x','y']) if (a[key] !== undefined && (!Number.isFinite(a[key]) || Math.abs(a[key]) > 100000)) throw new Error('滚动坐标无效');
      return { type:a.type, ...(a.selector ? {selector:a.selector}:{}), ...Object.fromEntries(['value','checked','timeoutMs','ms','state','text','index','x','y'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]])) };
    });
  };
  const setup = steps(input.setup); const ids = new Set();
  const states = input.states.map((s,i) => {
    if (!s || typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id) || ids.has(s.id) || typeof s.name !== 'string' || !s.name || s.name.length > 150) throw new Error(`第 ${i+1} 个状态的 id 或名称无效`);
    if(s.expectedFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(s.expectedFingerprint))throw new Error('状态校验摘要无效');
    ids.add(s.id); const selector = s.selector || base.selector; if (typeof selector !== 'string' || selector.length > 700) throw new Error('捕获选择器无效');
    return { id:s.id, name:s.name, ...(s.expectedFingerprint?{expectedFingerprint:s.expectedFingerprint}:{}), group:typeof s.group==='string'?s.group.slice(0,80):'页面状态', url:safeURL(s.url), setup:s.setup!==false, selector, steps:steps(s.steps), captureMode:s.captureMode==='full'?'full':input.captureMode==='full'?'full':'viewport' };
  });
  if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 10000)) throw new Error('说明过长');
  return { schemaVersion:1, name:input.name, url:base.url, viewport:{width:base.width,height:base.height}, selector:base.selector, setup, states, captureMode:input.captureMode||'viewport', notes:input.notes||'', snapshotDocument:input.snapshotDocument===true };
}
export async function runSteps(page, steps, signal) {
  for (let i=0;i<steps.length;i++) {
    if (signal?.aborted) throw new Error('捕获已取消');
    const a=steps[i], timeout=a.timeoutMs||7000; let el;
    if (a.selector) { el=page.locator(a.selector); if (a.index!==undefined) el=el.nth(a.index); }
    try {
      if(a.type==='click') await el.click({timeout});
      if(a.type==='fill') await el.fill(a.value,{timeout});
      if(a.type==='select') await el.selectOption(a.value,{timeout});
      if(a.type==='check') await el.setChecked(a.checked!==false,{timeout});
      if(a.type==='press') await el.press(a.value,{timeout});
      if(a.type==='hover') await el.hover({timeout});
      if(a.type==='scroll') await el.evaluate((node,p)=>node.scrollTo({left:p.x||0,top:p.y||0,behavior:'instant'}),a);
      if(a.type==='wait') {
        if(el) { await el.waitFor({state:a.state||'visible',timeout}); if(a.text!==undefined) await page.waitForFunction(({selector,index,text})=>{const nodes=document.querySelectorAll(selector);return (nodes[index||0]?.textContent||'').includes(text);},{selector:a.selector,index:a.index,text:a.text},{timeout}); }
        if(a.ms) await page.waitForTimeout(a.ms);
      }
    } catch(error) { throw new Error(`步骤 ${i+1}（${a.type} ${a.selector||''}）失败：${String(error.message).split('\n')[0].slice(0,220)}`); }
  }
}
export async function captureStates(browser, rawPlan, {signal,onProgress,onState} = {}) {
  const plan=validateStatePlan(rawPlan); const {BundleBuilder}=await import('../dist/lib/bundle.js'); const builder=new BundleBuilder(plan.name);
  const report={schemaVersion:1,name:plan.name,url:plan.url,viewport:plan.viewport,startedAt:new Date().toISOString(),completedAt:null,status:'running',total:plan.states.length,completed:0,failed:0,cancelled:false,notes:plan.notes,states:[],limitations:['状态清单是明确覆盖范围，不等于穷举输入与交互的所有组合。','捕获是可编辑的静态快照，事件、数据连接与运行逻辑不会转入 Figma。','默认只捕获当前视口，滚动区域的其他部分需另列状态。']};
  const source=await openCaptureSource(plan.url);
  const fingerprints=new Map(); let activeContext=null, activeClose=null; let preview=null;
  let documentSnapshot=null;const resourceCache=new Map();let cacheBytes=0;
  if(plan.snapshotDocument){
    if(signal?.aborted)throw new Error('捕获已取消');
    const local=await source.read(source.url);
    const response=local?null:await fetch(source.url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
    if(local?local.status!==200:!response.ok)throw new Error('入口快照读取失败');
    const text=local?local.body.toString('utf8'):await response.text();if(Buffer.byteLength(text)>8*1024*1024)throw new Error('入口源码超过 8 MB');
    documentSnapshot={text,path:new URL(source.url).pathname,origin:new URL(source.url).origin};
    report.sourceSnapshot={url:plan.url,retrievedAt:new Date().toISOString(),bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};
    report.limitations.push('本次使用已核验的入口 HTML 快照重放交互；查询参数由同一份客户端脚本处理。');
  }
  const closeActive=()=>activeContext?(activeClose ||= activeContext.close().catch(()=>{})):Promise.resolve();
  const abort=()=>void closeActive(); signal?.addEventListener('abort',abort,{once:true});
  try {
    for(let i=0;i<plan.states.length;i++) {
      if(signal?.aborted) break;
      const state=plan.states[i], start=Date.now(); let blocked=0;
      onProgress?.({status:'running',index:i,total:plan.states.length,name:state.name,completed:report.completed,failed:report.failed});
      const record={index:i,id:state.id,name:state.name,group:state.group,url:state.url,status:'running',nodes:0,blockedRequests:0,durationMs:0};
      let timer;
      try {
        activeContext=await browser.newContext({viewport:plan.viewport,deviceScaleFactor:1,colorScheme:'light',reducedMotion:'reduce',serviceWorkers:'block',locale:'zh-CN'});
        const context=activeContext;activeClose=null;
        if(signal?.aborted)throw new Error('捕获已取消');
        timer=setTimeout(()=>void closeActive(),60000); timer.unref();
        await context.route('**/*',async route=>{
          const req=route.request(),url=new URL(req.url());
          if(!['http:','https:','data:','blob:'].includes(url.protocol)||!['GET','HEAD','OPTIONS'].includes(req.method())) { blocked++; return route.abort(); }
          if(req.isNavigationRequest()&&req.frame()===req.frame().page().mainFrame()&&url.origin!==new URL(source.url).origin){blocked++;return route.abort();}
          if(documentSnapshot && req.isNavigationRequest() && url.origin===documentSnapshot.origin && url.pathname===documentSnapshot.path) return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:documentSnapshot.text});
          if(documentSnapshot && url.origin===documentSnapshot.origin && /\.(svg|png|jpe?g|webp|gif|js|css|woff2?|ttf|otf)(?:$|\?)/i.test(url.pathname)){
            if(!resourceCache.has(url.href))resourceCache.set(url.href,(async()=>{const local=await source.read(url.href);const r=local?null:await fetch(url.href,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});const body=local?local.body:Buffer.from(await r.arrayBuffer());if(body.length>8*1024*1024||cacheBytes+body.length>128*1024*1024)throw new Error('资源缓存超限');cacheBytes+=body.length;return{status:local?local.status:r.status,contentType:local?local.contentType:r.headers.get('content-type')||'application/octet-stream',body};})());
            try{return await route.fulfill(await resourceCache.get(url.href));}catch{resourceCache.delete(url.href);}
          }
          const local=await source.read(url.href);
          return local?route.fulfill(local):route.continue();
        });
        if(state.expectedFingerprint)await context.addInitScript(()=>{window.WebSocket=class{constructor(){throw new Error('捕获会话不连接 WebSocket');}};navigator.sendBeacon=()=>false;});
        const page=await context.newPage(); page.setDefaultTimeout(8000);
        page.on('dialog',dialog=>void dialog.dismiss());
        const response=await page.goto(source.toBrowserURL(state.url),{waitUntil:'domcontentloaded',timeout:25000});
        if(source.local&&response&&!response.ok())throw new Error(`本地页面无法读取：HTTP ${response.status()}`);
        if(state.setup) await runSteps(page,plan.setup,signal);
        await runSteps(page,state.steps,signal);
        await page.waitForTimeout(120);
        await page.evaluate(async()=>{await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,1500))]);});
        if(signal?.aborted)throw new Error('捕获已取消');
        if(state.expectedFingerprint){const actual=await inspectState(page,source.local);if(actual.fingerprint!==state.expectedFingerprint)throw new Error('页面与探索时的状态不同，请重新探索；可能有异步数据或随机内容');}
        const options={url:page.url(),width:plan.viewport.width,height:plan.viewport.height,selector:state.selector};
        const result=await captureLoadedPage(page,context,options,{viewportOnly:state.captureMode==='viewport',name:`${String(i+1).padStart(3,'0')} · ${state.group} · ${state.name}`,source});
        result.document.source.state={id:state.id,name:state.name,group:state.group,stepCount:(state.setup?plan.setup.length:0)+state.steps.length};
        if(blocked) result.document.diagnostics.push({code:'NETWORK_BLOCKED',message:`隔离捕获阻止了 ${blocked} 个写请求或跨站跳转；请核对该状态是否完整`,count:1});
        builder.add(result.document);
        record.pageIndex=builder.bundle.pages.length-1;
        const sha=createHash('sha256').update(JSON.stringify(result.document.root)).digest('hex');
        if(fingerprints.has(sha))record.duplicateOf=fingerprints.get(sha);else fingerprints.set(sha,state.id);
        record.status='complete';record.nodes=result.document.stats.nodes;record.diagnostics=result.document.diagnostics;record.url=source.toSourceURL(page.url());record.sha256=sha;
        report.completed++; if(!preview)preview=result.preview;
        await onState?.({record:{...record},document:result.document,preview:result.preview});
      } catch(error) {
        record.status=signal?.aborted?'cancelled':'failed';record.error=signal?.aborted?'捕获已取消':String(error.message).slice(0,500);
        if(record.status==='failed'){report.failed++;builder.error(`${state.group} · ${state.name}`,record.error);}
      } finally {
        clearTimeout(timer);await closeActive();activeContext=null;activeClose=null;
        record.durationMs=Date.now()-start;record.blockedRequests=blocked;report.states.push(record);
        onProgress?.({status:record.status,index:i,total:plan.states.length,name:state.name,completed:report.completed,failed:report.failed,error:record.error});
      }
    }
  } finally {signal?.removeEventListener('abort',abort);}
  report.cancelled=!!signal?.aborted;report.status=report.cancelled?'cancelled':report.failed?'partial':'complete';report.completedAt=new Date().toISOString();
  for(let i=report.states.length;i<plan.states.length;i++) {const s=plan.states[i];report.states.push({index:i,id:s.id,name:s.name,group:s.group,url:s.url,status:'not-run'});}
  return {bundle:builder.bundle,report,preview};
}

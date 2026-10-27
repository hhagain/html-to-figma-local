import http from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, captureURL, validateCaptureRequest } from './browser.mjs';
import { captureStates, validateStatePlan } from './state-capture.mjs';
import { discoverPages, validateDiscoveryRequest } from './discover-pages.mjs';
import { createPreviewStore } from './preview-store.mjs';
import { createHandoffStore } from './handoff-store.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
export async function createAppServer({ port = 3847, root = path.join(project, 'examples'), token = randomBytes(18).toString('hex'), desktop = null } = {}) {
  const sourceRoot = await realpath(root); let browserPromise, capturing = false;
  const jobs = new Map(), previews = createPreviewStore(), handoffs = createHandoffStore();
  const pruneJobs = async () => { for (const [id, job] of jobs) if (job.status !== 'running' && jobs.size >= 2) { jobs.delete(id); await previews.forget(id).catch(() => {}); } };
  const readJSON = async (req, limit = 2 * 1024 * 1024) => { const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw new Error(`请求超过 ${limit/1024/1024} MB，请分批发送`);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')); };
  const identity = req => createHash('sha256').update(String(req.headers['x-h2f-token'] || '')).digest('hex');
  const receiverIdentity = (req, body) => { if(!/^[a-f0-9-]{16,80}$/.test(body.receiverId||''))throw new Error('接收端标识无效');return identity(req)+':'+body.receiverId; };
  const snapshot = job => ({ id:job.id,status:job.status,progress:job.progress,error:job.error,report:job.result?.report });
  const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); };
  const authorised = req => { const actual = Buffer.from(String(req.headers['x-h2f-token'] || '')), expected = Buffer.from(token); return (actual.length === expected.length && timingSafeEqual(actual, expected)) || !!desktop?.authorised(req); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const host = String(req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403); res.end('Invalid host'); return; }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-H2F-Token', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' }); res.end(); return; }
        if (desktop && url.pathname === '/api/desktop/discovery' && req.method === 'GET') { json(res,200,desktop.discovery());return; }
        if (desktop && ['/api/desktop/pair/start','/api/desktop/pair/status'].includes(url.pathname) && req.method === 'POST') {
          try { const body=await readJSON(req);const result=url.pathname.endsWith('/start')?desktop.startPair(body,req.headers.origin):desktop.pairStatus(body);json(res,200,result); }
          catch(error){json(res,400,{error:error.message});}return;
        }
        if (!authorised(req)) { json(res, 401, { error: '本地服务连接码不正确，请从终端或捕获页面重新复制' }); return; }
        if (desktop && url.pathname === '/api/desktop/status' && req.method === 'GET') { json(res,200,desktop.status());return; }
        if(url.pathname==='/api/handoffs'&&req.method==='POST'){
          try{const input=await readJSON(req,128*1024*1024);json(res,201,handoffs.publish(identity(req),input));}catch(error){json(res,400,{error:error.message});}return;
        }
        if(url.pathname==='/api/figma/receivers'&&req.method==='POST'){try{const body=await readJSON(req);json(res,200,handoffs.heartbeat(receiverIdentity(req,body),body));}catch(error){json(res,400,{error:error.message});}return;}
        if(url.pathname==='/api/figma/receivers'&&req.method==='GET'){json(res,200,{targets:handoffs.targets()});return;}
        if(url.pathname==='/api/handoffs/latest'&&req.method==='GET'){let receiver;try{if(url.searchParams.has('receiverId'))receiver=receiverIdentity(req,{receiverId:url.searchParams.get('receiverId')});}catch(error){json(res,400,{error:error.message});return;}json(res,200,{handoff:handoffs.latest(receiver)});return;}
        const handoffRoute=url.pathname.match(/^\/api\/handoffs\/([a-f0-9]{24})(?:\/(claim|progress))?$/);
        if(handoffRoute){try{
          if(req.method==='GET'&&!handoffRoute[2])json(res,200,handoffs.status(handoffRoute[1]));
          else if(req.method==='POST'&&handoffRoute[2]){const body=await readJSON(req);const receiver=receiverIdentity(req,body);json(res,200,handoffRoute[2]==='claim'?handoffs.claim(handoffRoute[1],receiver,body.contextVersion):handoffs.progress(handoffRoute[1],receiver,body));}
          else json(res,405,{error:'不支持的传输操作'});
        }catch(error){json(res,409,{error:error.message});}return;}
        if (url.pathname === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true, version: '0.9.0', capturing, desktop: !!desktop }); return; }
        if (url.pathname === '/api/discover' && req.method === 'POST') {
          if (capturing) { json(res,409,{error:'已有发现或捕获任务正在运行，请稍后重试'});return; }
          let request;try{request=validateDiscoveryRequest(await readJSON(req));}catch(error){json(res,400,{error:error.message});return;}
          if(capturing){json(res,409,{error:'已有发现或捕获任务正在运行，请稍后重试'});return;}
          capturing=true;await pruneJobs();
          const id=randomBytes(12).toString('hex'),controller=new AbortController();
          const job={id,kind:'discover',status:'running',progress:{name:'准备发现页面',found:0,scanned:0},controller};jobs.set(id,job);capturing=true;
          desktop?.onActivity({phase:'capturing',name:'正在发现页面',completed:0});json(res,202,snapshot(job));
          job.task=(async()=>{try{
            browserPromise ||= launchBrowser().catch(error=>{browserPromise=undefined;throw error;});
            job.result=await discoverPages(await browserPromise,request,{signal:controller.signal,onProgress:progress=>{job.progress=progress;}});
            job.status=job.result.report.status;
          }catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.error=error.message;}
          finally{capturing=false;desktop?.onActivity({phase:'idle',name:'页面发现已结束'});}})();return;
        }
        if (url.pathname === '/api/states' && req.method === 'POST') {
          if (capturing) { json(res, 409, { error: '已有捕获任务正在运行，请稍后重试' }); return; }
          let plan; try { plan = validateStatePlan(await readJSON(req)); } catch(e) { json(res,400,{error:e.message});return; }
          if(capturing){json(res,409,{error:'已有发现或捕获任务正在运行，请稍后重试'});return;}
          capturing=true;await pruneJobs();
          const id=randomBytes(12).toString('hex'), controller=new AbortController();
          const job={id,kind:'states',previews:[],status:'running',progress:{index:0,total:plan.states.length,completed:0,failed:0,name:'准备浏览器'},controller}; jobs.set(id,job);capturing=true;desktop?.onActivity({phase:'capturing',name:plan.name,total:plan.states.length,completed:0});
          json(res,202,snapshot(job));
          job.task=(async()=>{try{
            browserPromise ||= launchBrowser().catch(e=>{browserPromise=undefined;throw e;});
            job.result=await captureStates(await browserPromise,plan,{signal:controller.signal,onState:async({record,document,preview})=>{
              const entry={pageIndex:record.pageIndex,stateId:record.id,name:document.name};
              try{await previews.save(id,record.pageIndex,preview);}catch{entry.error='截图暂存失败，请重新捕获';}
              job.previews.push(entry);
            },onProgress:p=>{job.progress=p;desktop?.onActivity({phase:p.status==='running'?'capturing':p.status,name:p.name,total:p.total,completed:p.completed,failed:p.failed});}});
            job.status=job.result.report.status;
          }catch(e){job.status='failed';job.error=e.message;}finally{capturing=false;desktop?.onActivity({phase:'idle',name:plan.name});}})(); return;
        }
        const previewRoute=url.pathname.match(/^\/api\/states\/([a-f0-9]{24})\/preview\/(0|[1-9]\d*)$/);
        if(previewRoute&&req.method==='GET'){
          const job=jobs.get(previewRoute[1]),index=Number(previewRoute[2]);
          if(!Number.isSafeInteger(index)){json(res,400,{error:'预览索引无效'});return;}
          const entry=job?.kind==='states'?job.previews.find(p=>p.pageIndex===index):null;
          if(!entry||entry.error){json(res,404,{error:entry?.error||'此页预览不存在或已过期，请重新捕获'});return;}
          const image=await previews.read(job.id,index);
          if(!image){json(res,404,{error:'此页预览已过期，请重新捕获'});return;}
          res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.length,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(image);return;
        }
        const stateRoute=url.pathname.match(/^\/api\/(states|discover)\/([a-f0-9]{24})(?:\/(result|cancel))?$/);
        if(stateRoute){
          const job=jobs.get(stateRoute[2]);if(!job||job.kind!==stateRoute[1]){json(res,404,{error:'状态任务不存在或已过期'});return;}
          if(stateRoute[3]==='cancel'&&req.method==='POST'){job.controller.abort();json(res,200,snapshot(job));return;}
          if(stateRoute[3]==='result'&&req.method==='GET'){
            if(!job.result){json(res,job.status==='running'?409:422,{error:job.error||'状态捕获尚未完成'});return;}
            json(res,200,job.kind==='states'?{...job.result,previews:job.previews}:job.result);return;
          }
          if(!stateRoute[3]&&req.method==='GET'){json(res,200,snapshot(job));return;}
          json(res,405,{error:'不支持的操作'});return;
        }
        if (url.pathname === '/api/capture' && req.method === 'POST') {
          if (capturing) { json(res, 409, { error: '已有捕获任务正在运行，请稍后重试' }); return; }
          let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) { json(res, 413, { error: '请求过大' }); return; } }
          let request; try { request = validateCaptureRequest(JSON.parse(raw)); } catch (e) { json(res, 400, { error: e.message }); return; }
          capturing = true; desktop?.onActivity({phase:'capturing',name:request.url,total:1,completed:0}); const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          try {
            browserPromise ||= launchBrowser().catch(e => { browserPromise = undefined; throw e; });
            const result = await captureURL(await browserPromise, request, { signal: controller.signal });
            if (!res.destroyed) json(res, 200, result);
          } catch (e) { if (!res.destroyed) json(res, 422, { error: e.message }); }
          finally { capturing = false; desktop?.onActivity({phase:'idle',name:request.url}); }
          return;
        }
        json(res, 404, { error: '接口不存在' }); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      if (desktop && url.pathname === '/desktop') {
        res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await desktop.render());return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(path.join(project, 'dist/ui.html'), 'utf8');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'");
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html.replace('<head>', `<head><script>window.__LOCAL_SESSION__=${JSON.stringify({ token })}</script>`)); return;
      }
      if (url.pathname.startsWith('/source/')) {
        const relative = decodeURIComponent(url.pathname.slice('/source/'.length));
        if (relative.split(/[\\/]/).some(part => part.startsWith('.')) || relative.includes('\0')) { res.writeHead(403); res.end(); return; }
        const target = await realpath(path.resolve(sourceRoot, relative));
        if (!target.startsWith(sourceRoot + path.sep) || !mime[path.extname(target).toLowerCase()] || !(await stat(target)).isFile()) { res.writeHead(403); res.end(); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(target).toLowerCase()], 'Cache-Control': 'no-store' }); res.end(await readFile(target)); return;
      }
      res.writeHead(404); res.end('Not found');
    } catch (e) {
      if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.code === 'ENOENT' ? 'File not found' : 'Local server error');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { for(const job of jobs.values())job.controller.abort(); if (browserPromise) await (await browserPromise.catch(() => null))?.close(); await Promise.allSettled([...jobs.values()].map(job=>job.task)); await previews.close(); handoffs.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { server, address, token, close, sourceRoot };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--help')) { console.log('npm run serve -- [--root /path/to/html-folder] [--port 3847]'); process.exit(0); }
  try {
    const app = await createAppServer({ port: Number(value('--port') || 3847), root: value('--root') ? path.resolve(value('--root')) : undefined });
    console.log(`HTML to Figma · Local\n捕获页面：${app.address}\n连接码：${app.token}\n示例页面：${app.address}/source/dashboard.html\n资源目录：${app.sourceRoot}\n服务仅监听 127.0.0.1。按 Ctrl+C 结束。`);
    let closing = false; const stop = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? '端口 3847 已被占用，请先停止旧服务或使用 --port 指定其他端口（插件默认连接 3847）' : error.message); process.exitCode = 1; }
}

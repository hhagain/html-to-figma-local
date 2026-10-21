import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, captureURL, validateCaptureRequest } from './browser.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
export async function createAppServer({ port = 3847, root = path.join(project, 'examples'), token = randomBytes(18).toString('hex') } = {}) {
  const sourceRoot = await realpath(root); let browserPromise, capturing = false;
  const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(data)); };
  const authorised = req => { const actual = Buffer.from(String(req.headers['x-h2f-token'] || '')), expected = Buffer.from(token); return actual.length === expected.length && timingSafeEqual(actual, expected); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const host = String(req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403); res.end('Invalid host'); return; }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-H2F-Token', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' }); res.end(); return; }
        if (!authorised(req)) { json(res, 401, { error: '本地服务连接码不正确，请从终端或捕获页面重新复制' }); return; }
        if (url.pathname === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true, version: '0.2.0', capturing }); return; }
        if (url.pathname === '/api/capture' && req.method === 'POST') {
          if (capturing) { json(res, 409, { error: '已有捕获任务正在运行，请稍后重试' }); return; }
          let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) { json(res, 413, { error: '请求过大' }); return; } }
          let request; try { request = validateCaptureRequest(JSON.parse(raw)); } catch (e) { json(res, 400, { error: e.message }); return; }
          capturing = true; const controller = new AbortController();
          res.on('close', () => { if (!res.writableEnded) controller.abort(); });
          try {
            browserPromise ||= launchBrowser().catch(e => { browserPromise = undefined; throw e; });
            const result = await captureURL(await browserPromise, request, { signal: controller.signal });
            if (!res.destroyed) json(res, 200, result);
          } catch (e) { if (!res.destroyed) json(res, 422, { error: e.message }); }
          finally { capturing = false; }
          return;
        }
        json(res, 404, { error: '接口不存在' }); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
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
  const close = async () => { if (browserPromise) await (await browserPromise.catch(() => null))?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
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

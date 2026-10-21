import { chromium } from 'playwright';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function launchBrowser() {
  const candidates = [process.env.H2F_CHROME_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean);
  for (const executablePath of candidates) {
    try { await access(executablePath); } catch { continue; }
    return chromium.launch({ headless: true, executablePath, timeout: 20000 });
  }
  throw new Error('没有找到 Chromium / Chrome。请运行 npx playwright install chromium，或设置 H2F_CHROME_PATH。');
}
export function validateCaptureRequest(data) {
  if (!data || typeof data !== 'object') throw new Error('请求格式不正确');
  let url; try { url = new URL(data.url); } catch { throw new Error('请输入完整的页面 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持不含账号密码的 http / https URL');
  if (url.href.length > 4096) throw new Error('URL 过长');
  const width = Number(data.width ?? 1440), height = Number(data.height ?? 900);
  if (!Number.isInteger(width) || width < 320 || width > 3840 || !Number.isInteger(height) || height < 320 || height > 2160) throw new Error('浏览器尺寸不在允许范围内');
  const selector = data.selector || 'body'; if (typeof selector !== 'string' || selector.length > 500) throw new Error('CSS 选择器无效');
  return { url: url.href, width, height, selector };
}
export async function captureURL(browser, request, { signal } = {}) {
  const options = validateCaptureRequest(request);
  const context = await browser.newContext({ viewport: { width: options.width, height: options.height }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const abort = () => { void context.close().catch(() => {}); };
  if (signal?.aborted) { await context.close(); throw new Error('捕获已取消'); }
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, 55000);
  try {
    const page = await Promise.race([context.newPage(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('浏览器创建页面超时，请安装匹配版本：npx playwright install chromium')), 15000); timer.unref(); })]); page.setDefaultTimeout(12000);
    // No host filesystem or existing browser session is exposed to the remote page.
    await page.route('**/*', route => {
      const protocol = new URL(route.request().url()).protocol;
      return ['http:', 'https:', 'data:', 'blob:'].includes(protocol) ? route.continue() : route.abort();
    });
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await page.evaluate(async () => { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]); });
    await page.addScriptTag({ content: await readFile(path.join(project, 'dist/capture.js'), 'utf8') });
    const document = await page.evaluate(async ({ selector }) => window.HTMLToFigma.captureDOM(window.document, { selector }), options);
    let bytes = document.assets.reduce((n, a) => n + (a.base64?.length || 0) * .75, 0);
    for (const asset of document.assets) {
      if (!asset.base64) {
        try {
          if (!/^https?:/i.test(asset.url)) throw new Error('Unsupported image URL');
          const response = await context.request.get(asset.url, { timeout: 7000, maxRedirects: 5 });
          if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
          const mime = response.headers()['content-type']?.split(';')[0] || '';
          if (!mime.startsWith('image/')) throw new Error('Not an image');
          const body = await response.body();
          if (body.length > 8 * 1024 * 1024 || bytes + body.length > 24 * 1024 * 1024) throw new Error('Image budget exceeded');
          asset.base64 = body.toString('base64'); asset.mime = mime; bytes += body.length;
        } catch { document.diagnostics.push({ code: 'ASSET_MISSING', message: '图片无法读取，已保留占位图层', node: asset.url.slice(0, 180), count: 1 }); }
      }
      if (asset.base64 && !['image/png', 'image/jpeg', 'image/gif'].includes(asset.mime)) {
        try {
          asset.base64 = await page.evaluate(async a => {
            const image = new Image(); image.src = `data:${a.mime};base64,${a.base64}`;
            await image.decode();
            if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16000000) throw new Error('SVG image size exceeds limit');
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
          }, asset);
          asset.mime = 'image/png';
        } catch { delete asset.base64; document.diagnostics.push({ code: 'SVG_IMAGE_FAILED', message: '图片格式无法解码，已保留占位', count: 1 }); }
      }
    }
    document.stats.missingAssets = document.assets.filter(a => !a.base64).length;
    if (document.diagnostics.length > 200) document.diagnostics = document.diagnostics.slice(0, 200);
    const { validateDocument } = await import('../dist/lib/schema.js'); validateDocument(document);
    const full = document.root.height <= 12000 && document.root.width * document.root.height <= 28000000;
    let screenshot;
    if (full && options.selector !== 'body' && options.selector !== 'html') screenshot = await page.locator(options.selector).first().screenshot({ type: 'jpeg', quality: 75, animations: 'disabled', timeout: 8000 });
    else screenshot = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: full, animations: 'disabled', timeout: 8000 });
    if (!full) document.diagnostics.push({ code: 'PREVIEW_CROPPED', message: '超长页面的预览仅显示首屏，图层数据包含完整捕获区域', count: 1 });
    return { document, preview: `data:image/jpeg;base64,${screenshot.toString('base64')}` };
  } catch (error) {
    if (signal?.aborted) throw new Error('捕获已取消');
    throw error;
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); await context.close().catch(() => {}); }
}

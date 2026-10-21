import path from 'node:path';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createAppServer } from './server.mjs';
import { launchBrowser, captureURL } from './browser.mjs';
const args = process.argv.slice(2); const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help') || (!value('--url') && !value('--file'))) {
  console.log('npm run capture -- --url https://example.com [--width 1440] [--selector body] [--output artifacts/page.h2f.json]\nnpm run capture -- --file examples/dashboard.html --width 390');
  process.exit(args.includes('--help') ? 0 : 1);
}
let app, browser;
try {
  let url = value('--url');
  if (value('--file')) {
    const file = path.resolve(value('--file')); if (!(await stat(file)).isFile()) throw new Error('HTML 文件不存在');
    app = await createAppServer({ port: 0, root: path.dirname(file) }); url = `${app.address}/source/${encodeURIComponent(path.basename(file))}`;
  }
  browser = await launchBrowser();
  const result = await captureURL(browser, { url, width: Number(value('--width') || 1440), height: Number(value('--height') || 900), selector: value('--selector') || 'body' });
  const output = path.resolve(value('--output') || 'artifacts/page.h2f.json'); await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result.document, null, 2));
  const preview = output.replace(/\.json$/i, '') + '.jpg'; await writeFile(preview, Buffer.from(result.preview.split(',')[1], 'base64'));
  console.log(JSON.stringify({ output, preview, ...result.document.stats, diagnostics: result.document.diagnostics }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await browser?.close(); await app?.close(); }

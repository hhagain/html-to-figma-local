import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { mockFigma } from './helpers.mjs';

// Run the real compiled UI and plugin message handlers against a Figma API test host.
// This verifies the bridge, but does not substitute for a Figma desktop-client test.
export async function createPluginTestHost(browser, mock = mockFigma()) {
  const context = await browser.newContext({ viewport: { width: 460, height: 760 }, acceptDownloads: true });
  const host = await context.newPage(), messages = [], errors = [], pending = new Set();
  let result;
  await context.route(/^https?:\/\//, route => route.fulfill({ status: 404, body: '{}', contentType: 'application/json' }));
  host.on('pageerror', e => errors.push(e.message));
  mock.api.root = { name: '原画布排布测试' }; mock.page.name = '测试页面';
  mock.api.on = () => {}; mock.api.showUI = () => {}; mock.api.notify = () => {}; mock.api.openExternal = () => {};
  mock.api.clientStorage = { getAsync: async () => null, setAsync: async () => {} };
  mock.api.ui = { postMessage: message => {
    if (message.type === 'BATCH_COMPLETE') result = message.result;
    const response = host.evaluate(msg => document.querySelector('iframe')?.contentWindow.postMessage({ pluginMessage: msg }, '*'), message).catch(e => errors.push(e.message));
    pending.add(response); void response.finally(() => pending.delete(response));
  } };
  vm.runInNewContext(await readFile('dist/code.js', 'utf8'), { figma: mock.api, __html__: '', console, setTimeout, clearTimeout, Uint8Array, Buffer });
  await host.exposeFunction('pluginMessage', msg => { messages.push(msg); return mock.api.ui.onmessage(msg); });
  await host.setContent('<style>body{margin:0}iframe{display:block;border:0;width:460px;height:760px}</style><script>addEventListener("message",e=>{if(e.data?.pluginMessage)window.pluginMessage(e.data.pluginMessage);});</script><iframe></iframe>');
  await host.locator('iframe').evaluate((el, html) => el.srcdoc = html, await readFile('dist/ui.html', 'utf8'));
  const ui = host.frameLocator('iframe');
  return {
    context, host, ui, mock, messages, errors,
    get result() { return result; },
    async download() {
      const ready = host.waitForEvent('download'); await ui.locator('#download').click();
      const stream = await (await ready).createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    },
    async close() { await Promise.allSettled(pending); await context.close(); }
  };
}

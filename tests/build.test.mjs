import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('packaged UI preserves JavaScript dollar replacement sequences', async () => {
  const html = await readFile('dist/ui.html', 'utf8'); const source = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new vm.Script(source)); assert.equal(html.includes('/* INLINE_SCRIPT */'), false);
  assert.ok(html.includes('h2f-tailwind-result'));
});

test('compiled Figma sandbox opens only a local workbench without relying on a browser URL constructor',async()=>{
  const opened=[],api={showUI(){},on(){},ui:{postMessage(){}},openExternal:url=>opened.push(url)};
  vm.runInNewContext(await readFile('dist/code.js','utf8'),{figma:api,__html__:'',console,setTimeout,clearTimeout,Uint8Array});
  const valid='http://127.0.0.1:3847/?capture=manual&url=file%3A%2F%2F%2Ftmp%2Findex.html';
  await api.ui.onmessage({type:'OPEN_CAPTURE_WORKBENCH',url:valid});
  for(const url of ['https://example.com/','http://127.0.0.1.evil:3847/','http://127.0.0.1:3847@evil.com/','http://127.0.0.1:3846/','http://127.0.0.1:3847/api/health','javascript:alert(1)'])await api.ui.onmessage({type:'OPEN_CAPTURE_WORKBENCH',url});
  assert.deepEqual(opened,[valid]);
});

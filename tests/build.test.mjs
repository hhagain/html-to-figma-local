import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('packaged UI preserves JavaScript dollar replacement sequences', async () => {
  const html = await readFile('dist/ui.html', 'utf8'); const source = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new vm.Script(source)); assert.equal(html.includes('/* INLINE_SCRIPT */'), false);
  assert.ok(html.includes('h2f-tailwind-result'));
});

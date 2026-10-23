import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'dist'), { recursive: true });
const tailwindRuntime = await readFile(path.join(root, 'vendor/tailwind-play-3.4.17.js'), 'utf8');
const result = await Promise.allSettled([
  build({ absWorkingDir: root, entryPoints: ['src/plugin.ts'], outfile: 'dist/code.js', bundle: true, format: 'iife', target: 'es2017', minify: false }),
  build({ absWorkingDir: root, entryPoints: ['src/ui.ts'], define: { __TAILWIND_RUNTIME__: JSON.stringify(tailwindRuntime) }, loader: { '.html': 'text' }, outfile: 'dist/ui.js', bundle: true, format: 'iife', target: 'es2020' }),
  build({ absWorkingDir: root, entryPoints: ['src/capture.ts'], outfile: 'dist/capture.js', bundle: true, format: 'iife', target: 'es2020' }),
  build({ absWorkingDir: root, entryPoints: ['src/schema.ts', 'src/importer.ts', 'src/bundle.ts', 'src/batch.ts', 'src/capture-address.ts', 'src/gradient.ts'], outdir: 'dist/lib', bundle: true, format: 'esm', target: 'es2020' })
]);
for (const r of result) if (r.status === 'rejected') throw r.reason;
const [template, script, style] = await Promise.all(['src/ui.html', 'dist/ui.js', 'src/ui.css'].map(p => readFile(path.join(root, p), 'utf8')));
const html = template.replace('/* INLINE_STYLES */', () => style).replace('/* INLINE_SCRIPT */', () => script.replace(/<\/script/gi, '<\\/script'));
await writeFile(path.join(root, 'dist/ui.html'), html);
console.log('Built Figma plugin, browser UI, capture engine and test modules.');

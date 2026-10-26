import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const out = path.resolve('artifacts/windows');
const version = JSON.parse(await readFile('package.json','utf8')).version;
const entries = (await readdir(out)).filter(n => n.startsWith(`HTML-to-Figma-Capture-${version}-win-x64`) && /\.(exe|zip)$/.test(n)).sort();
if (entries.length !== 2) throw new Error('Expected Windows setup EXE and portable ZIP.');
const repair='H2F-Windows-0.8.0-Runtime-Repair.zip';
entries.push(repair);
const assets = [];
for (const name of entries) { const bytes = await readFile(path.join(out,name)); assets.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}); }
await writeFile(path.join(out,'SHA256SUMS-windows.txt'),assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
await writeFile(path.join(out,'windows-build.json'),JSON.stringify({version,platform:process.platform,arch:process.arch,commit:process.env.GITHUB_SHA||null,builtAt:new Date().toISOString(),signed:false,assets},null,2)+'\n');
await copyFile('docs/WINDOWS-ASSISTANT.md',path.join(out,'WINDOWS-INSTALL.md'));
console.log(JSON.stringify(assets,null,2));

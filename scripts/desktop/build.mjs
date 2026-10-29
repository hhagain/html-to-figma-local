import {mkdir,readFile,writeFile,cp,stat,readdir,chmod,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This build targets macOS Apple Silicon.');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await run(process.execPath,['scripts/build.mjs'],{cwd:root});
const stage=path.join(root,'.cache',`desktop-build-${Date.now()}`), appName='HTML to Figma Capture.app', app=path.join(stage,appName);
const contents=path.join(app,'Contents'),resources=path.join(contents,'Resources'),engine=path.join(resources,'engine');
await mkdir(path.join(contents,'MacOS'),{recursive:true});await mkdir(engine,{recursive:true});await mkdir(path.join(resources,'runtime'),{recursive:true});
const nodeCandidates=[process.env.H2F_NODE_BINARY,path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'),process.execPath].filter(Boolean);
let nodeBinary;for(const candidate of nodeCandidates){try{await stat(candidate);const links=(await run('otool',['-L',candidate])).stdout;if(!links.includes('/opt/homebrew/')&&!links.includes('/usr/local/')){nodeBinary=candidate;break;}}catch{}}
if(!nodeBinary)throw new Error('需要独立的官方 Node 二进制。可用 H2F_NODE_BINARY 指定，不能依赖 Homebrew 动态库。');
const browserCandidates=[process.env.H2F_BROWSER_DIR];const cache=path.join(os.homedir(),'Library/Caches/ms-playwright');
try{const names=(await readdir(cache)).filter(n=>/^chromium_headless_shell-\d+$/.test(n)).sort((a,b)=>Number(b.split('-').pop())-Number(a.split('-').pop()));browserCandidates.push(...names.map(n=>path.join(cache,n,'chrome-headless-shell-mac-arm64')));}catch{}
let browserDirectory;for(const candidate of browserCandidates.filter(Boolean)){try{await stat(path.join(candidate,'chrome-headless-shell'));browserDirectory=candidate;break;}catch{}}
if(!browserDirectory)throw new Error('需要 Chromium Headless Shell。构建机器可执行 npx playwright install chromium --only-shell，或设置 H2F_BROWSER_DIR。');
const compileArgs=['-fobjc-arc','-fblocks','-fno-modules','-arch','arm64','-mmacosx-version-min=14.0','-framework','Cocoa','-framework','WebKit'];
await run('xcrun',['clang',...compileArgs,'desktop/src/main.m','-o',path.join(contents,'MacOS','H2FCapture')],{cwd:root,maxBuffer:4*1024*1024});
await cp(nodeBinary,path.join(resources,'runtime/node'));await chmod(path.join(resources,'runtime/node'),0o755);
await cp(browserDirectory,path.join(resources,'browser'),{recursive:true});
await mkdir(path.join(engine,'scripts'),{recursive:true});
for(const name of ['browser.mjs','long-page.mjs','capture-source.mjs','discover-pages.mjs','explore-states.mjs','interaction-inspector.mjs','preview-store.mjs','handoff-store.mjs','server.mjs','state-capture.mjs','desktop-pairing.mjs','desktop-service.mjs'])await cp(path.join(root,'scripts',name),path.join(engine,'scripts',name));
for(const name of ['dist','examples'])await cp(path.join(root,name),path.join(engine,name),{recursive:true});
await cp(path.join(root,'desktop/ui'),path.join(engine,'desktop-ui'),{recursive:true});
const iconSource=path.join(root,'desktop/resources/app-icon.png');
await cp(iconSource,path.join(resources,'StatusIcon.png'));
const desktopHTML=await readFile(path.join(engine,'desktop-ui/index.html'),'utf8');
await writeFile(path.join(engine,'desktop-ui/index.html'),desktopHTML.replace('__APP_ICON_DATA__',`data:image/png;base64,${(await readFile(iconSource)).toString('base64')}`));
await mkdir(path.join(engine,'node_modules'),{recursive:true});for(const name of ['playwright','playwright-core'])await cp(path.join(root,'node_modules',name),path.join(engine,'node_modules',name),{recursive:true});
await writeFile(path.join(engine,'package.json'),JSON.stringify({name:'html-to-figma-capture-engine',version:pkg.version,type:'module',private:true},null,2)+'\n');
await mkdir(path.join(engine,'figma-plugin/dist'),{recursive:true});await cp(path.join(root,'manifest.json'),path.join(engine,'figma-plugin/manifest.json'));for(const file of ['code.js','ui.html'])await cp(path.join(root,'dist',file),path.join(engine,'figma-plugin/dist',file));
await mkdir(path.join(resources,'Licenses'),{recursive:true});await cp(path.join(root,'desktop/resources/Node-LICENSE.txt'),path.join(resources,'Licenses/Node-LICENSE.txt'));await cp(path.join(root,'vendor'),path.join(resources,'Licenses/vendor'),{recursive:true});
for(const name of ['playwright','playwright-core'])await cp(path.join(root,'node_modules',name,'LICENSE'),path.join(resources,'Licenses',`${name}-LICENSE.txt`));
const iconset=path.join(stage,'AppIcon.iconset');await mkdir(iconset,{recursive:true});const renderer=path.join(stage,'render-icon');
await run('xcrun',['clang','-fobjc-arc','-fno-modules','-framework','Cocoa','desktop/src/icon.m','-o',renderer],{cwd:root});const icon=path.join(stage,'icon-1024.png');await run(renderer,[iconSource,icon]);
for(const size of [16,32,128,256,512]){await run('sips',['-z',String(size),String(size),icon,'--out',path.join(iconset,`icon_${size}x${size}.png`)]);await run('sips',['-z',String(size*2),String(size*2),icon,'--out',path.join(iconset,`icon_${size}x${size}@2x.png`)]);}
await run('iconutil',['-c','icns',iconset,'-o',path.join(resources,'AppIcon.icns')]);
const info=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>HTML to Figma Capture</string><key>CFBundleDisplayName</key><string>HTML to Figma 捕获助手</string><key>CFBundleIdentifier</key><string>com.hhagain.HTMLToFigmaCapture</string><key>CFBundleExecutable</key><string>H2FCapture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${pkg.version}</string><key>CFBundleVersion</key><string>${pkg.version}</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/><key>CFBundleIconFile</key><string>AppIcon</string><key>NSPrincipalClass</key><string>NSApplication</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict><key>NSHumanReadableCopyright</key><string>HTML to Figma Capture · Local development build</string></dict></plist>`;
await writeFile(path.join(contents,'Info.plist'),info);
const isMachO=async file=>{try{const data=await readFile(file);return ['cffaedfe','cefaedfe','cafebabe','bebafeca'].includes(data.subarray(0,4).toString('hex'));}catch{return false;}};
for(const name of await readdir(path.join(resources,'browser'))){const file=path.join(resources,'browser',name);if((await stat(file)).isFile()&&await isMachO(file))await run('codesign',['--force','--sign','-','--timestamp=none','--preserve-metadata=entitlements',file]);}
await run('codesign',['--force','--sign','-','--timestamp=none','--preserve-metadata=entitlements',path.join(resources,'runtime/node')]);
await run('codesign',['--force','--deep','--sign','-','--timestamp=none',app]);await run('codesign',['--verify','--deep','--strict',app]);
const output=path.join(root,'artifacts/desktop');await mkdir(output,{recursive:true});const final=path.join(output,appName);
try{await stat(final);await rename(final,path.join(stage,'previous-build.app'));}catch(error){if(error.code!=='ENOENT')throw error;}
await rename(app,final);
const nodeVersion=(await run(path.join(final,'Contents/Resources/runtime/node'),['--version'])).stdout.trim();const browserVersion=(await run(path.join(final,'Contents/Resources/browser/chrome-headless-shell'),['--version'])).stdout.trim();
await writeFile(path.join(output,'build-info.json'),JSON.stringify({version:pkg.version,app:final,arch:'arm64',minimumMacOS:'14.0',nodeVersion,browserVersion,signed:'ad-hoc',notarized:false,builtAt:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify({app:final,nodeVersion,browserVersion,signed:'ad-hoc',notarized:false},null,2));

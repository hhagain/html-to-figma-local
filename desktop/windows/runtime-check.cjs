const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const PACKAGES = ['playwright', 'playwright-core'];
function within(root, filename) {
  const relative=path.relative(root,filename);
  return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function assertPackagedDependencies(engineRoot) {
  const localRequire=createRequire(path.join(engineRoot,'scripts','browser.mjs'));
  return PACKAGES.map(name=>{
    const packageRoot=path.join(engineRoot,'node_modules',name);
    try {
      for(const file of ['package.json','index.js','index.mjs'])if(!fs.statSync(path.join(packageRoot,file)).isFile())throw new Error('missing entry');
      const resolved=fs.realpathSync(localRequire.resolve(name));
      if(!within(fs.realpathSync(packageRoot),resolved))throw new Error('resolved outside packaged directory');
      const metadata=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
      if(metadata.name!==name)throw new Error('unexpected package');
      return {name,version:metadata.version,entry:path.relative(fs.realpathSync(engineRoot),resolved).split(path.sep).join('/')};
    } catch(cause) {
      const error=new Error(`安装包缺少或无法读取捕获依赖 ${name}，请完整解压或安装修复版。`);
      error.code='H2F_RUNTIME_DEPENDENCY_MISSING';error.cause=cause;throw error;
    }
  });
}
function packageFiles(resources) {
  const files=[];
  function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Packaged runtime dependencies must not contain symlinks');if(entry.isDirectory())visit(file);else if(entry.isFile()){const bytes=fs.readFileSync(file);files.push({path:path.relative(resources,file).split(path.sep).join('/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}}
  for(const name of PACKAGES)visit(path.join(resources,'engine','node_modules',name));
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function writeDependencyManifest(resources) {
  const packages=assertPackagedDependencies(path.join(resources,'engine'));
  const manifest={schemaVersion:1,packages,files:packageFiles(resources)};
  fs.writeFileSync(path.join(resources,'runtime-dependencies.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
function verifyDependencyManifest(resources) {
  const packages=assertPackagedDependencies(path.join(resources,'engine'));
  const manifest=JSON.parse(fs.readFileSync(path.join(resources,'runtime-dependencies.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length<6)throw new Error('Invalid runtime dependency manifest');
  for(const expected of manifest.files){const filename=path.resolve(resources,expected.path);if(!within(resources,filename)||!/^engine\/node_modules\/(playwright|playwright-core)\//.test(expected.path))throw new Error('Invalid dependency path');const bytes=fs.readFileSync(filename);if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new Error('Runtime dependency content differs: '+expected.path);}
  const actual=packageFiles(resources);if(actual.length!==manifest.files.length)throw new Error('Runtime dependency file count differs');
  return {packages,files:manifest.files.length};
}
function redactStartupError(text, roots=[]) {
  let result=String(text||'');
  for(const root of roots.filter(Boolean).sort((a,b)=>b.length-a.length))result=result.replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'<LOCAL_PATH>');
  return result.replace(/\b[a-f0-9]{64}\b/gi,'<REDACTED_TOKEN>').replace(/([A-Z]:\\Users\\)[^\\\s]+/gi,'$1<USER>');
}
module.exports={assertPackagedDependencies,writeDependencyManifest,verifyDependencyManifest,redactStartupError};

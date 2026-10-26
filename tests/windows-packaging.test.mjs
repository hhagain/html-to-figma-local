import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {assertPackagedDependencies,writeDependencyManifest,verifyDependencyManifest,redactStartupError}=createRequire(import.meta.url)('../desktop/windows/runtime-check.cjs');
async function makePackage(directory,name){await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'package.json'),JSON.stringify({name,version:'1.0.0',exports:{'.':{import:'./index.mjs',require:'./index.js'}}}));await writeFile(path.join(directory,'index.js'),'module.exports={};');await writeFile(path.join(directory,'index.mjs'),'export default {};');}
async function fixture(){const directory=await mkdtemp(path.join(os.tmpdir(),'h2f-runtime-bundle-'));const resources=path.join(directory,'app/resources'),engine=path.join(resources,'engine');await mkdir(path.join(engine,'scripts'),{recursive:true});return{directory,resources,engine,close:()=>rm(directory,{recursive:true,force:true})};}
async function fill(engine){for(const name of ['playwright','playwright-core'])await makePackage(path.join(engine,'node_modules',name),name);}

test('packaged runtime rejects a module available only in an ancestor checkout',async()=>{
 const f=await fixture();try{
  for(const name of ['playwright','playwright-core'])await makePackage(path.join(f.directory,'node_modules',name),name);
  const require=createRequire(path.join(f.engine,'scripts/browser.mjs'));assert.match(require.resolve('playwright'),/node_modules/);
  assert.throws(()=>assertPackagedDependencies(f.engine),{code:'H2F_RUNTIME_DEPENDENCY_MISSING'});
 }finally{await f.close();}
});
test('packaged dependency manifest covers both complete local packages',async()=>{
 const f=await fixture();try{await fill(f.engine);const manifest=writeDependencyManifest(f.resources);assert.equal(manifest.packages.length,2);assert.equal(manifest.files.length,6);assert.equal(verifyDependencyManifest(f.resources).files,6);assert.ok(manifest.packages.every(p=>p.entry.startsWith('node_modules/')));}finally{await f.close();}
});
test('missing files from an extracted distribution cannot pass dependency validation',async()=>{
 const f=await fixture();try{await fill(f.engine);writeDependencyManifest(f.resources);await rm(path.join(f.engine,'node_modules/playwright-core/index.mjs'));assert.throws(()=>verifyDependencyManifest(f.resources),{code:'H2F_RUNTIME_DEPENDENCY_MISSING'});}finally{await f.close();}
});
test('modified library contents are rejected even when package resolution still succeeds',async()=>{
 const f=await fixture();try{await fill(f.engine);writeDependencyManifest(f.resources);await writeFile(path.join(f.engine,'node_modules/playwright/index.js'),'different contents');assert.throws(()=>verifyDependencyManifest(f.resources),/content differs/);}finally{await f.close();}
});
test('native startup error text does not expose local paths or connection tokens',()=>{
 const secret='ab'.repeat(32);const text=redactStartupError(String.raw`C:\Users\Sample\AppData\Roaming\service.js ${secret}`,[String.raw`C:\Users\Sample`]);assert.equal(text.includes('Sample'),false);assert.equal(text.includes(secret),false);assert.match(text,/<LOCAL_PATH>/);
});

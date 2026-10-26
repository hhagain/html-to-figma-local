const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {assertPackagedDependencies,writeDependencyManifest} = fs.existsSync(path.join(__dirname,'runtime-check.cjs')) ? require('./runtime-check.cjs') : require('../../desktop/windows/runtime-check.cjs');
function applyRepair(executable,payloadRoot) {
  const resources=path.join(path.dirname(executable),'resources'),engine=path.join(resources,'engine');
  const runtime=JSON.parse(fs.readFileSync(path.join(resources,'runtime.json'),'utf8'));
  if(runtime.version!=='0.8.0'||runtime.platform!=='win32')throw new Error('此补丁仅适用于 Windows 助手 v0.8.0；其他版本请使用完整安装包。');
  const manifest=JSON.parse(fs.readFileSync(path.join(payloadRoot,'repair-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length<6)throw new Error('补丁清单无效，请重新完整解压。');
  for(const expected of manifest.files){if(!/^(playwright|playwright-core)\//.test(expected.path)||expected.path.split('/').some(p=>p==='..'||p==='.'||p.includes('\\')))throw new Error('补丁路径无效');const content=fs.readFileSync(path.join(payloadRoot,'runtime-libraries',expected.path));if(content.length!==expected.bytes||createHash('sha256').update(content).digest('hex')!==expected.sha256)throw new Error('补丁文件不完整：'+expected.path);}
  for(const name of ['playwright','playwright-core'])fs.cpSync(path.join(payloadRoot,'runtime-libraries',name),path.join(engine,'node_modules',name),{recursive:true});
  const packages=assertPackagedDependencies(engine);const verified=writeDependencyManifest(resources);
  return {assistantVersion:runtime.version,packages:packages.map(({name,version})=>({name,version})),verifiedFiles:verified.files.length};
}
module.exports={applyRepair};
if(require.main===module){try{const executable=process.argv[2];if(process.platform!=='win32'||!executable)throw new Error('请在 Windows 上通过“修复缺失依赖.cmd”运行此补丁。');const result=applyRepair(executable,__dirname);console.log('修复成功：已补齐 '+result.packages.map(p=>p.name+' '+p.version).join('、'));console.log('已核对 '+result.verifiedFiles+' 个依赖文件。现在可以重新打开助手。');}catch(error){console.error('修复未完成：'+error.message);console.error('若提示 EACCES / EPERM，请改用 v0.8.1 安装包更新；不要更改系统安全设置。');process.exitCode=1;}}

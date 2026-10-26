const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

function redact(value, replacements = []) {
  let text = String(value || '');
  for (const [original, replacement] of replacements.filter(([source]) => source).sort((a,b)=>b[0].length-a[0].length)) {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    text = text.replace(new RegExp(escaped,'gi'),replacement);
  }
  return text.replace(/\b[a-f0-9]{64}\b/gi,'<REDACTED_TOKEN>')
    .replace(/([A-Z]:\\Users\\)[^\\\s]+/gi,'$1<USER>')
    .replace(/(https?:\/\/)([^\s/@]+:[^\s/@]+)@/gi,'$1<REDACTED>@');
}
function probePort(port) {
  return new Promise(resolve => {
    const server=net.createServer();
    server.once('error',error=>resolve({port,result:error.code||'ERROR'}));
    server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(()=>resolve({port,result:'available'})));
  });
}
function probeService({executable, resources, dataDirectory, timeoutMs=12000, healthyMs=750}) {
  return new Promise(resolve => {
    let stderr='',stdout='',pending='',ready=false,started=false,stopping=false,errorCode=null,healthyTimer,timeout;
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1',H2F_DESKTOP:'1'};
    for(const key of ['NODE_OPTIONS','NODE_PATH','ELECTRON_NO_ASAR','ELECTRON_ENABLE_LOGGING','ELECTRON_ENABLE_STACK_DUMPING'])delete env[key];
    try { const runtime=require(path.join(resources,'runtime.json'));env.H2F_CHROME_PATH=path.join(resources,'browser',runtime.browserExecutable); }
    catch(error){resolve({result:'runtime-metadata-error',error:error.message,code:error.code});return;}
    const child=spawn(executable,[path.join(resources,'engine/scripts/desktop-service.mjs'),'--data-dir',dataDirectory],{
      cwd:path.join(resources,'engine'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let settled=false;
    const finish=details=>{if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(healthyTimer);resolve({...details,readyEventReceived:ready,shutdownRequested:stopping,stderr,stdout});};
    child.stdin.on('error',()=>{});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',text=>{
      pending+=text;
      while(pending.includes('\n')){
        const end=pending.indexOf('\n'),line=pending.slice(0,end);pending=pending.slice(end+1);
        if(line.startsWith('H2F_EVENT ')){
          try{
            const event=JSON.parse(line.slice(10));
            // Never retain the session token, pairing data or complete event body.
            if(event.type==='ready'){
              ready=true;stdout+='ready event; version '+String(event.version||'unknown')+'\n';
              if(!healthyTimer)healthyTimer=setTimeout(()=>{stopping=true;if(child.stdin.writable)child.stdin.write('{"type":"shutdown"}\n');},healthyMs);
            }else if(event.type==='error'||event.type==='command-error')stderr+=String(event.message||event.type)+'\n';
          }catch{stdout+='unreadable service event\n';}
        }else stdout=(stdout+line+'\n').slice(-16000);
      }
      if(pending.length>65536)pending='';
    });
    child.stderr.on('data',text=>{stderr=(stderr+text).slice(-24000);});
    child.on('spawn',()=>{started=true;});
    child.on('error',error=>{errorCode=error.code;stderr+=error.message+'\n';});
    child.on('close',(code,signal)=>finish({result:ready&&stopping&&code===0?'ready-and-stopped':'failed',started,exitCode:code,signal,errorCode}));
    timeout=setTimeout(()=>{child.kill();finish({result:'timed-out',started,errorCode});},timeoutMs);
  });
}
async function diagnose(executable, outputDirectory) {
  const resources=path.join(path.dirname(executable),'resources');
  const dataDirectory=path.join(process.env.APPDATA||path.join(os.homedir(),'AppData/Roaming'),'HTML to Figma Capture');
  const replacements=[[path.dirname(executable),'<APP_DIR>'],[dataDirectory,'<APP_DATA>'],[os.tmpdir(),'<TEMP>'],[process.env.USERPROFILE,'<USER>'],[os.homedir(),'<USER>']];
  const files=['runtime.json','engine/scripts/desktop-service.mjs','engine/scripts/server.mjs','engine/node_modules/playwright/package.json','engine/node_modules/playwright-core/package.json','engine/examples/dashboard.html','engine/dist/ui.html'];
  const installation=[];
  for(const file of files){try{const info=await fs.stat(path.join(resources,file));installation.push({file,present:info.isFile(),bytes:info.size});}catch(error){installation.push({file,present:false,error:error.code});}}
  try{const runtime=JSON.parse(await fs.readFile(path.join(resources,'runtime.json'),'utf8'));const file=path.join('browser',runtime.browserExecutable);const info=await fs.stat(path.join(resources,file));installation.push({file,present:info.isFile(),bytes:info.size});}catch(error){installation.push({file:'browser executable',present:false,error:error.code||error.message});}
  const ports=[];for(let port=3847;port<=3851;port++)ports.push(await probePort(port));
  let dataAccess;
  try{await fs.mkdir(dataDirectory,{recursive:true});const probe=path.join(dataDirectory,'h2f-diagnostic-'+Date.now()+'.tmp');await fs.writeFile(probe,'diagnostic write check',{flag:'wx'});await fs.unlink(probe);dataAccess='write-check-passed';}catch(error){dataAccess={code:error.code,message:error.message};}
  const service=await probeService({executable,resources,dataDirectory});
  let assistantVersion='unknown';try{assistantVersion=JSON.parse(await fs.readFile(path.join(resources,'runtime.json'),'utf8')).version||'unknown';}catch{}
  const report={toolVersion:2,assistantVersion,createdAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,systemVersion:os.release(),embeddedNode:process.version,
    installation,ports,dataDirectoryAccess:dataAccess,service,
    explanation:service.result==='ready-and-stopped'?'后台服务在本次诊断中正常启动并已关闭；可重新打开助手。':'后台服务启动失败，请将此报告发送给开发者定位。'};
  const target=path.join(outputDirectory,'H2F-Windows-startup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
  const content=redact(JSON.stringify(report,null,2),replacements)+'\n';
  let reportPath=target;
  try{await fs.writeFile(reportPath,content);}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error;reportPath=path.join(os.homedir(),path.basename(target));await fs.writeFile(reportPath,content);}
  console.log('Diagnostic report saved: '+reportPath);
  return {target:reportPath,result:service.result};
}
module.exports={redact,probeService,diagnose};
if(require.main===module){
  const [executable,outputDirectory]=process.argv.slice(2);
  if(!executable||!outputDirectory){console.error('Usage: diagnose.cjs <assistant.exe> <output-folder>');process.exitCode=1;}
  else diagnose(executable,outputDirectory).catch(error=>{console.error(redact(error.stack||error.message,[[os.homedir(),'<USER>']]));process.exitCode=1;});
}

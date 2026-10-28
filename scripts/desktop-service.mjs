import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './server.mjs';
import { createDesktopPairing } from './desktop-pairing.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);const index=args.indexOf('--data-dir');
if(index<0||!args[index+1])throw new Error('Desktop data directory is required');
const dataDir=path.resolve(args[index+1]);await mkdir(dataDir,{recursive:true,mode:0o700});
const emit=data=>console.log('H2F_EVENT '+JSON.stringify(data));
const token=randomBytes(32).toString('hex');let app=null,closing=false;let status='starting',lastActivity=null;
const pairing=await createDesktopPairing({directory:dataDir,onRequest:request=>emit({type:'pair-request',...request})});
const desktop={
  authorised:req=>pairing.authorised(String(req.headers['x-h2f-token']||'')),
  onActivity:event=>{lastActivity={...event,at:new Date().toISOString()};emit({type:'activity',...lastActivity});},
  discovery:()=>({product:'html-to-figma-capture',version:'0.9.3',desktop:true,pairing:true}),
  startPair:(body,origin)=>pairing.start(body,origin),
  pairStatus:body=>pairing.status(body),
  status:()=>({state:status,version:'0.9.3',clients:pairing.list(),pairing:pairing.pendingList(),lastActivity,browser:'内置捕获浏览器',runtime:'已内置，无需 Node.js',manifestPath:path.join(root,'figma-plugin','manifest.json')}),
  render:async()=>{const html=await readFile(path.join(root,'desktop-ui','index.html'),'utf8');return html.replace('/* DESKTOP_SESSION */',()=>`window.__H2F_DESKTOP__=${JSON.stringify({token,version:'0.9.3'})};`);}
};
for(let port=3847;port<=3851;port++){
  try{app=await createAppServer({port,token,desktop});break;}catch(error){if(error.code!=='EADDRINUSE')throw error;}
}
if(!app){emit({type:'error',message:'本地端口 3847–3851 均被占用，请关闭旧版捕获服务后重试。'});process.exit(1);}
status='ready';emit({type:'ready',url:app.address,token,version:'0.9.3',clients:pairing.list().length});
await writeFile(path.join(dataDir,'service-state.json'),JSON.stringify({pid:process.pid,url:app.address,version:'0.9.3',startedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
const shutdown=async()=>{if(closing)return;closing=true;status='stopping';try{await app.close();}finally{process.exit(0);}};
const input=createInterface({input:process.stdin});input.on('line',line=>{void(async()=>{try{const command=JSON.parse(line);if(command.type==='pair-decision'){const accepted=await pairing.decide(command.id,command.approved===true);emit({type:'pair-decision',id:command.id,accepted,approved:command.approved===true});}else if(command.type==='revoke-clients'){await pairing.revoke();emit({type:'clients-revoked'});}else if(command.type==='shutdown')await shutdown();}catch(error){emit({type:'command-error',message:error.message});}})();});
input.on('close',shutdown);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

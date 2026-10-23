import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => { const left=Buffer.from(a||''),right=Buffer.from(b||'');return left.length===right.length&&timingSafeEqual(left,right); };
const allowedOrigin = origin => !origin || origin==='null' || /^https:\/\/(www\.)?figma\.com$/.test(origin) || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
export async function createDesktopPairing({ directory, onRequest=()=>{}, now=()=>Date.now() }) {
  await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'paired-clients.json');
  let clients=[];try{const data=JSON.parse(await readFile(file,'utf8'));if(Array.isArray(data))clients=data.filter(c=>c&&typeof c.id==='string'&&/^[a-f0-9]{64}$/.test(c.hash));}catch{}
  const pending=new Map();
  const persist=async()=>{const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(clients,null,2)+'\n',{mode:0o600});await rename(tmp,file);};
  const prune=()=>{for(const [id,p] of pending)if(now()>p.expiresAt)pending.delete(id);};
  const start=({clientId,credential,clientName='Figma 插件'},origin)=>{
    prune();if(!allowedOrigin(origin))throw new Error('此页面来源不允许发起配对');
    if(typeof clientId!=='string'||!/^figma-[a-f0-9-]{16,100}$/.test(clientId)||typeof credential!=='string'||!/^[a-f0-9]{64}$/.test(credential))throw new Error('配对请求格式无效');
    const digest=hash(credential);const existing=clients.find(c=>c.id===clientId&&same(c.hash,digest));
    if(existing)return{status:'approved',clientId};
    const duplicate=[...pending.values()].find(p=>p.status==='pending'&&p.clientId===clientId&&same(p.hash,digest));
    if(duplicate)return{id:duplicate.id,code:duplicate.code,status:duplicate.status,expiresAt:duplicate.expiresAt};
    if([...pending.values()].filter(p=>p.status==='pending').length>=3)throw new Error('已有连接请求等待确认，请先在助手中处理');
    const request={id:randomBytes(16).toString('hex'),code:String(randomBytes(4).readUInt32BE(0)%1000000).padStart(6,'0'),clientId,clientName:String(clientName).slice(0,80),hash:digest,status:'pending',createdAt:now(),expiresAt:now()+120000};
    pending.set(request.id,request);onRequest({id:request.id,code:request.code,clientName:request.clientName,expiresAt:request.expiresAt});
    return{id:request.id,code:request.code,status:'pending',expiresAt:request.expiresAt};
  };
  const status=({id,credential})=>{prune();const request=pending.get(id);if(!request||typeof credential!=='string'||!same(request.hash,hash(credential)))return{status:'expired'};return{status:request.status,clientId:request.clientId};};
  const decide=async(id,approved)=>{prune();const request=pending.get(id);if(!request||request.status!=='pending')return false;request.status=approved?'approved':'rejected';if(approved){clients=clients.filter(c=>c.id!==request.clientId);clients.push({id:request.clientId,name:request.clientName,hash:request.hash,pairedAt:new Date(now()).toISOString()});await persist();}return true;};
  const authorised=credential=>typeof credential==='string'&&clients.some(c=>same(c.hash,hash(credential)));
  const pendingList=()=>{prune();return [...pending.values()].filter(p=>p.status==='pending').map(({id,code,clientName,expiresAt})=>({id,code,clientName,expiresAt}));};
  const list=()=>clients.map(({hash,...client})=>client);
  const revoke=async()=>{clients=[];pending.clear();await persist();};
  return{start,status,decide,authorised,list,pendingList,revoke,allowedOrigin};
}

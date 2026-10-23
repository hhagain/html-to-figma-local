export interface AssistantCredentials { clientId: string; credential: string; serviceURL?: string }
export interface AssistantConnection { url: string; credential: string; clientId: string }
const PORTS = [3847,3848,3849,3850,3851];
export function validAssistantURL(value: string): boolean { return /^http:\/\/127\.0\.0\.1:384[7-9]$|^http:\/\/127\.0\.0\.1:385[01]$/.test(value); }
export function newAssistantCredentials(): AssistantCredentials {
  const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)),value=>value.toString(16).padStart(2,'0')).join('');
  return {clientId:`figma-${hex(16)}`,credential:hex(32)};
}
export async function discoverAssistant(preferred?: string): Promise<string | null> {
  const urls=[...(preferred&&validAssistantURL(preferred)?[preferred]:[]),...PORTS.map(port=>`http://127.0.0.1:${port}`)].filter((url,i,list)=>list.indexOf(url)===i);
  const results=await Promise.allSettled(urls.map(async url=>{const response=await fetch(`${url}/api/desktop/discovery`,{signal:AbortSignal.timeout(1200)});if(!response.ok)throw new Error('Unavailable');const data=await response.json();if(data.product!=='html-to-figma-capture'||!data.desktop)throw new Error('Different service');return url;}));
  for(const result of results)if(result.status==='fulfilled')return result.value;return null;
}
export async function verifyAssistant(url: string, credential: string): Promise<boolean> {
  if(!validAssistantURL(url))return false;
  try{const r=await fetch(`${url}/api/health`,{headers:{'X-H2F-Token':credential},signal:AbortSignal.timeout(1800)});return r.ok&&(await r.json()).desktop===true;}catch{return false;}
}
export async function pairAssistant(url: string, credentials: AssistantCredentials, onCode: (code: string)=>void): Promise<AssistantConnection> {
  if(!validAssistantURL(url))throw new Error('助手地址无效');
  const post=async(route:string,body:unknown)=>{const r=await fetch(`${url}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'连接请求失败');return data;};
  const started=await post('/api/desktop/pair/start',{clientId:credentials.clientId,credential:credentials.credential,clientName:'HTML to Figma 插件'});
  if(started.status==='approved')return{url,credential:credentials.credential,clientId:credentials.clientId};
  if(typeof started.id!=='string'||typeof started.code!=='string')throw new Error('助手返回了无效的配对请求');
  onCode(started.code);
  for(let i=0;i<120;i++){
    await new Promise(resolve=>setTimeout(resolve,800));
    const result=await post('/api/desktop/pair/status',{id:started.id,credential:credentials.credential});
    if(result.status==='approved')return{url,credential:credentials.credential,clientId:credentials.clientId};
    if(result.status==='rejected')throw new Error('连接未获允许，可以重新发起配对');
    if(result.status==='expired')throw new Error('配对已过期，请重新连接');
  }
  throw new Error('等待配对确认超时，请在桌面助手中核对配对码');
}

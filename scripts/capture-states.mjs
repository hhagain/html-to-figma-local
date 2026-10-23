import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';
import { captureStates, validateStatePlan } from './state-capture.mjs';
const args=process.argv.slice(2);const value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};
if(args.includes('--help')||!value('--plan')){console.log('npm run capture:states -- --plan examples/multi-app-admin.states.json [--output artifacts/dynamic-states] [--only id1,id2]');process.exit(args.includes('--help')?0:1);}
let browser;const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
try {
 const raw=JSON.parse(await readFile(path.resolve(value('--plan')),'utf8'));if(value('--only')){const ids=new Set(value('--only').split(','));raw.states=raw.states.filter(s=>ids.has(s.id));}
 const plan=validateStatePlan(raw),out=path.resolve(value('--output')||'artifacts/dynamic-states');await mkdir(path.join(out,'previews'),{recursive:true});
 browser=await launchBrowser();const result=await captureStates(browser,plan,{signal:controller.signal,onProgress:p=>{if(p.status!=='running')console.log(`${p.index+1}/${p.total} ${p.status} ${p.name}${p.error?' — '+p.error:''}`);},onState:async({record,preview})=>{await writeFile(path.join(out,'previews',`${String(record.index+1).padStart(3,'0')}-${record.id}.jpg`),Buffer.from(preview.split(',')[1],'base64'));}});
 await writeFile(path.join(out,'states.h2f.json'),JSON.stringify(result.bundle));await writeFile(path.join(out,'coverage.json'),JSON.stringify(result.report,null,2));
 const md=`# ${plan.name}\n\n状态：${result.report.status}；完成 ${result.report.completed}/${result.report.total}，失败 ${result.report.failed}。\n\n${plan.notes}\n\n| 序号 | 模块 | 状态 | 结果 | 节点 | 说明 |\n|---|---|---|---|---:|---|\n`+result.report.states.map(s=>`| ${s.index+1} | ${s.group} | ${s.name} | ${s.status} | ${s.nodes||0} | ${(s.error||'').replace(/\|/g,'／')} |`).join('\n');
 await writeFile(path.join(out,'COVERAGE.md'),md+'\n');console.log(JSON.stringify({output:out,status:result.report.status,completed:result.report.completed,total:result.report.total,failed:result.report.failed,assets:result.bundle.assets.length},null,2));
 if(result.report.failed||result.report.cancelled)process.exitCode=2;
}catch(error){console.error(error.message);process.exitCode=1;}finally{await browser?.close();}

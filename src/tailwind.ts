import { parse } from 'acorn';
declare const __TAILWIND_RUNTIME__: string;
export interface TailwindInput { classes: string[]; config: Record<string, unknown>; styles: string[]; handledScripts: HTMLScriptElement[] }
const configError = () => new Error('Tailwind 配置包含动态 JavaScript，无法静态编译；请改用网页链接捕获。');
function literal(node: any, depth = 0): any {
  if (!node || depth > 30) throw configError();
  if (node.type === 'Literal' && !node.regex && typeof node.value !== 'bigint') return node.value;
  if (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return node.operator === '-' ? -node.argument.value : node.argument.value;
  if (node.type === 'ArrayExpression') return node.elements.map((el: any) => literal(el, depth + 1));
  if (node.type === 'ObjectExpression') {
    const value = Object.create(null);
    for (const p of node.properties) {
      if (p.type !== 'Property' || p.kind !== 'init' || p.method || p.computed || p.shorthand) throw configError();
      const key = p.key.name ?? p.key.value;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) throw configError();
      value[key] = literal(p.value, depth + 1);
    }
    return value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  throw configError();
}
function configAssignment(node: any): { matched: boolean; config?: Record<string, unknown> } {
  if (node.type === 'ExpressionStatement') return configAssignment(node.expression);
  if (node.type === 'AssignmentExpression' && node.operator === '=') {
    const target = node.left;
    if (target.type === 'Identifier' && target.name === 'tailwind') { const obj = literal(node.right); return { matched: true, config: obj?.config }; }
    if (target.type === 'MemberExpression' && !target.computed && target.object.type === 'Identifier' && target.object.name === 'tailwind' && target.property.name === 'config') return { matched: true, config: literal(node.right) };
  }
  if (node.type === 'VariableDeclaration' && node.declarations.length === 1 && node.declarations[0].id.name === 'tailwind') { const obj = literal(node.declarations[0].init); return { matched: true, config: obj?.config }; }
  return { matched: false };
}
export function readTailwind(doc: Document): TailwindInput | null {
  const scripts = Array.from(doc.scripts);
  const runtime = scripts.filter(script => { try { return new URL(script.src, doc.baseURI).hostname === 'cdn.tailwindcss.com'; } catch { return false; } });
  if (!runtime.length) return null;
  let config: Record<string, unknown> = {};
  const handledScripts = [...runtime];
  for (const script of scripts.filter(s => !s.src && /\btailwind\b/.test(s.textContent || ''))) {
    let statements: any[]; try { statements = (parse(script.textContent || '', { ecmaVersion: 'latest', sourceType: 'script' }) as any).body; } catch { throw configError(); }
    let allHandled = true;
    for (const statement of statements) {
      const result = configAssignment(statement); allHandled &&= result.matched;
      if (result.config) {
        if (typeof result.config !== 'object' || Array.isArray(result.config)) throw configError();
        config = result.config;
      }
    }
    if (allHandled) handledScripts.push(script);
  }
  // Only literal configuration is accepted. No page script, callback or require() is executed.
  if (config.plugins !== undefined && (!Array.isArray(config.plugins) || config.plugins.length > 0)) throw configError();
  const classes = [...new Set(Array.from(doc.querySelectorAll('[class]')).flatMap(el => Array.from(el.classList)))];
  if (classes.length > 20000 || classes.join(' ').length > 1024 * 1024) throw new Error('Tailwind 类名数量超限，请分区导出');
  return { classes, config, styles: Array.from(doc.querySelectorAll('style[type="text/tailwindcss"]')).map(s => s.textContent || ''), handledScripts };
}
const cache = new Map<string, string>();
export async function compileTailwind(input: TailwindInput): Promise<string> {
  const payload = { classes: input.classes, config: input.config, styles: input.styles };
  const key = JSON.stringify(payload); if (cache.has(key)) return cache.get(key)!;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts'); // Opaque origin; the compiler cannot access the host UI.
  frame.setAttribute('aria-hidden', 'true'); frame.style.display = 'none';
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
  const json = JSON.stringify({ ...payload, id }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const runtime = __TAILWIND_RUNTIME__.replace(/<\/script/gi, '<\\/script');
  const setup = `const job=${json};let sent=false,timer;function send(value){if(sent)return;sent=true;parent.postMessage({type:'h2f-tailwind-result',id:job.id,...value},'*');}window.addEventListener('error',e=>send({error:e.message}));window.addEventListener('unhandledrejection',e=>send({error:String(e.reason)}));const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{const css=Array.from(document.head.querySelectorAll('style:not([type])')).map(s=>s.textContent).join('\\n');if(css)send({css});},150);});observer.observe(document.head,{subtree:true,childList:true,characterData:true});`;
  const populate = `window.tailwind.config=job.config;for(const name of job.classes){const el=document.createElement('div');el.className=name;document.body.appendChild(el);}for(const text of job.styles){const style=document.createElement('style');style.type='text/tailwindcss';style.textContent=text;document.head.appendChild(style);}`;
  try {
    const css = await new Promise<string>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.data?.type !== 'h2f-tailwind-result' || event.data.id !== id) return;
        cleanup();
        if (typeof event.data.css === 'string' && event.data.css.length <= 4 * 1024 * 1024) resolve(event.data.css);
        else reject(new Error(`Tailwind 样式编译失败：${String(event.data.error || '输出无效').slice(0, 250)}`));
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Tailwind 样式编译超时，请使用本地工作台重新捕获')); }, 15000);
      window.addEventListener('message', onMessage);
      frame.srcdoc = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline'"></head><body><script>${setup}<\/script><script>${runtime}<\/script><script>${populate}<\/script></body></html>`;
      document.body.appendChild(frame);
    });
    if (cache.size >= 4) cache.delete(cache.keys().next().value!); cache.set(key, css); return css;
  } finally { frame.remove(); }
}

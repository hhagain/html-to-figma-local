import { createHash } from 'node:crypto';

// Browser-side evidence only. No source-provided code, labels or recipes are executed here.
export function inspectDesignDOM({ selector = 'body' } = {}) {
  const root = document.querySelector(selector); if (!root) throw new Error('没有找到捕获区域：' + selector);
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || !r.height || s.display === 'none' || s.visibility === 'hidden' || el.closest('[hidden],[aria-hidden="true"]')) return false;
    for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open && !p.querySelector(':scope > summary')?.contains(el)) return false;
    return true;
  };
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const normalize = value => clean(value).replace(/[¥￥$€£]?[-+]?\d[\d,.]*(?:%|元|年|月|日|号|笔|条|项)?/g, '#');
  const label = el => clean(el.getAttribute('aria-label') || el.getAttribute('data-h2f-component') || el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > header h2,:scope > header h3,:scope > summary,legend')?.textContent || el.id || el.classList[0] || el.tagName.toLowerCase());
  const css = el => {
    if (el === document.body) return 'body';
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.id) { parts.unshift('#' + CSS.escape(p.id)); break; }
      const peers = [...(p.parentElement?.children || [])].filter(n => n.tagName === p.tagName);
      parts.unshift(p.tagName.toLowerCase() + ':nth-of-type(' + (peers.indexOf(p) + 1) + ')');
    }
    return parts.join(' > ');
  };
  const route = location.pathname.replace(/\/(?:\d+|[a-f0-9]{8}-[a-f0-9-]{20,})(?=\/|$)/gi, '/:id') + (location.hash.startsWith('#/') ? location.hash.split('?')[0].replace(/\/(?:\d+|[a-f0-9]{8}-[a-f0-9-]{20,})(?=\/|$)/gi, '/:id') : '');
  const nav = [...document.querySelectorAll('nav [aria-pressed="true"],[data-primary-nav] [aria-pressed="true"],nav [aria-selected="true"],nav [aria-current="page"],[data-primary-nav] [aria-selected="true"],header [role="tab"][aria-selected="true"],footer [role="tab"][aria-selected="true"]')].filter(el=>visible(el)&&(!el.closest('main section,main article,[role=region]')||el.closest('[data-primary-nav]')));
  const activeNav = nav.map(el => el.getAttribute('data-id') || el.getAttribute('href') || normalize(el.textContent));
  const heading = [...root.querySelectorAll('h1,[role="heading"][aria-level="1"]')].find(visible);
  const candidates = [...root.querySelectorAll('section,article,form,details,fieldset,[role="region"],[role="dialog"],dialog[open],[aria-modal="true"],[data-h2f-component],[class*="card"],[class*="panel"],[class*="module"],[class*="list-row"],[role="listitem"],li,label,[role="group"],[role="radiogroup"],[role="alert"],[class*="field-error"],[class*="form-field"],[class*="input-group"],[class*="picker"]')].filter(el => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    if (el.matches('main,[role="main"]') || el.querySelector('main,[role="main"]') || r.width < 24 || r.height < 12) return false;
    if (!el.matches('section,article,form,details,fieldset,label,[role],[aria-modal],[data-h2f-component]') && !/(?:^|[-_\s])(?:card|panel|module|list-row|field-error|form-field|input-group|picker)(?:$|[-_\s])/.test(el.className || '') && !el.matches('li')) return false;
    return true;
  });
  const dialogs = candidates.filter(el => el.matches('[role="dialog"],dialog[open],[aria-modal="true"]'));
  const activeDialog=dialogs[0]||null;
  const scoped=activeDialog?candidates.filter(el=>activeDialog.contains(el)&&el!==activeDialog):candidates;
  const atomic=el=>el.matches('details,fieldset,[data-h2f-component],[role="listitem"],[role="radiogroup"],li,[class*="list-row"]');
  const regions=scoped.filter(el=>!scoped.some(parent=>parent!==el&&parent.contains(el)&&atomic(parent)))
    .filter(el=>atomic(el)||!scoped.some(child=>child!==el&&el.contains(child)));
  if(activeDialog&&!regions.length)regions.push(activeDialog);
  const forms=[...root.querySelectorAll('form')].filter(visible),dominantForm=forms.length===1&&forms[0].getBoundingClientRect().height>=root.getBoundingClientRect().height*.4?forms[0]:null;
  const surfaceElement=activeDialog||dominantForm;
  const surfaceName=surfaceElement?clean((activeDialog?activeDialog.querySelector('h1,h2,h3,[role="heading"]'):heading)?.textContent||label(surfaceElement)):null;
  const surface=surfaceElement?{kind:activeDialog?'dialog':'form',key:normalize(surfaceName).split(/\s+[·|:]\s+|[：]/)[0],name:surfaceName}:null;

  const iconCache=new WeakMap();
  const iconHost=el=>{if(iconCache.has(el))return iconCache.get(el);const r=el.getBoundingClientRect();const svg=el.namespaceURI?.includes('svg'),image=el.tagName==='IMG',onlyIcon=!el.textContent?.trim()&&el.querySelector('svg,img')&&[...el.children].every(child=>child.namespaceURI?.includes('svg')||child.tagName==='IMG');const yes=r.width<=64&&r.height<=64&&(svg||image||onlyIcon);iconCache.set(el,yes);return yes;};
  const regionSet = new Set(regions), branchWords = /(?:^|[-_\s])(empty|error|invalid|loading|success|warning|disabled|expanded|collapsed|selected|active|checked)(?:$|[-_\s])/g;
  let dataOwner=null;
  const status = el => {
    const s = getComputedStyle(el), own = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
    const branches = [...String(el.className?.baseVal ?? el.className ?? '').matchAll(branchWords)].map(m => m[1]).filter(word => dataOwner || !['active','selected'].includes(word));
    if (/暂无|没有.*(?:记录|内容|数据)|空空|no (?:data|results)|nothing (?:here|found)/i.test(own)) branches.push('empty');
    if (/不能为空|请填写|格式.*错误|无效|失败|必填|invalid|required|error/i.test(own) && el.matches('p,small,span,[role="alert"]')) branches.push('error');
    if (el.matches('details')) branches.push(el.open ? 'expanded' : 'collapsed');
    for (const a of ['aria-pressed','aria-expanded','aria-invalid','aria-busy','aria-disabled','aria-checked','aria-selected']) if (el.hasAttribute(a)) branches.push(a + '=' + el.getAttribute(a));
    if (el.matches('input,textarea,select')) branches.push('value=' + (el.value ? 'filled' : 'empty'), 'checked=' + !!el.checked, 'disabled=' + !!el.disabled);
    if(dataOwner)return branches.sort().join(';');
    const styled = el.matches('button,input,select,textarea,[role="button"],[role="tab"],[role="alert"],h1,h2,h3,p,small,strong');
    return [s.display,s.flexDirection,s.gridTemplateColumns==='none'?'':s.gridTemplateColumns.split(/\s+/).length,s.borderRadius,s.borderWidth,s.backgroundColor].join('|') + branches.sort().join(';') + (styled ? [s.color,s.backgroundColor,s.fontWeight,s.opacity,s.borderColor].join('|') : '');
  };
  const compress = values => { const out = []; for (const value of values) if (out.at(-1) !== value) out.push(value); return out; };
  let walked = 0;
  const tree = (el, mode, owner) => {
    if (++walked > 30000 || !visible(el) || el.matches('script,style,link,meta,noscript,template')) return '';
    if (mode === 'page' && regionSet.has(el) && el !== owner) return '';
    if (mode !== 'value' && iconHost(el)) return '';
    if (el.namespaceURI?.includes('svg')) return 'svg:' + compress([...el.querySelectorAll('circle,path,rect,polyline,polygon,line,text')].map(n => n.tagName)).join(',');
    const tag = el.tagName.toLowerCase(), control = el.matches('button,summary,[role="button"],[role="tab"],label,legend,h1,h2,h3');
    const own = clean([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
    const dataBound = el.hasAttribute('data-id') || el.matches('h1,h2,h3,[role="listitem"],[role="option"]') || !!el.closest('[role="list"],ul,ol,tbody,[class*="list"],[class*="rail"],[class*="chart"]');
    const text = mode === 'value' ? own : own ? '<text>' : '';
    const signature = [tag,el.getAttribute('role') || '',el.getAttribute('type') || '',text];
    if (mode === 'state') signature.push(status(el));
    if (mode === 'shape' || mode === 'page') {const s=getComputedStyle(el);signature.push(s.display,s.flexDirection,s.gridTemplateColumns==='none'?'':String(s.gridTemplateColumns.split(/\s+/).length));}
    if (mode === 'page' && el === owner) {const s=getComputedStyle(el);signature.push(s.backgroundColor,s.backgroundImage,s.color);}
    if (mode === 'value' && el.matches('input,textarea,select')) signature.push(el.type === 'password' ? '<password>' : el.value);
    const children = tag === 'details' && !el.open ? [...el.children].filter(n => n.tagName === 'SUMMARY') : [...el.children];
    let parts = children.map(child => tree(child,mode,owner)).filter(Boolean);
    // A selected day/row moving through an otherwise identical chart or list is data,
    // rather than a new component style for each position in the repeated collection.
    const repeated = children.length > 1 && children.every(child=>child.tagName===children[0].tagName)
      && (el.matches('ul,ol,tbody,[role="list"],[class*="list"],[class*="rail"],[class*="chart"]') || children.every(child=>!child.children.length));
    if (mode === 'state' && repeated) parts = [...new Set(parts)].sort();
    signature.push(compress(parts).join(''));
    return '[' + signature.join('|') + ']';
  };
  const observe = el => {
    const r = el.getBoundingClientRect();
    dataOwner=el.matches('[data-id],[role="listitem"],li,[class*="list-row"]')?el:null;
    walked = 0; const shape = tree(el,'shape',el); walked = 0; const state = tree(el,'state',el); walked = 0; const value = tree(el,'value',el);
    const scroll = [el,...el.querySelectorAll('*')].filter(n => visible(n) && /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 40).map(n => css(n) + ':' + Math.round(n.scrollTop / 20));
    const expanded = el.matches('details[open],[aria-expanded="true"]') || [...el.querySelectorAll('details[open],[aria-expanded="true"]')].some(visible);
    const flags = [];
    if (el.matches('[role="dialog"],dialog[open],[aria-modal="true"]')) flags.push('dialog');
    if (expanded) flags.push('expanded');
    if (el.matches('[role="alert"],[aria-invalid="true"],.empty,.error,.loading,[class*="field-error"]') || [...el.querySelectorAll('[aria-invalid="true"],[role="alert"],.error,.empty,.loading')].some(visible)) flags.push('feedback');
    if ([...el.querySelectorAll('input,textarea')].some(n => n.value)) flags.push('filled');
    const componentType=el.matches('[class*="list-row"],[role="listitem"],li')?'row':el.matches('label,[class*="form-field"],[class*="input-group"]')?'field':el.matches('[role="alert"],[class*="field-error"]')?'feedback':el.tagName.toLowerCase();
    return { selector: css(el), explicitName:el.getAttribute('data-h2f-component')||'',componentType, ancestors: regions.filter(parent=>parent!==el&&parent.contains(el)).map(css), name: label(el), shape, state: state + scroll.join('|'), value, width: r.width, height: r.height, flags };
  };
  walked = 0; const skeleton = tree(root,'page',root);
  const expansion = regions.filter(el => el.matches('details[open],[aria-expanded="true"]') || [...el.querySelectorAll('[aria-expanded="true"]')].some(visible)).map(el => css(el));
  const overlays = dialogs.map(el => css(el) + ':' + normalize(label(el)));
  const observations = regions.map(observe).filter(r => r.selector.length <= 700);
  const visibleIcon=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(!r.width||!r.height||s.display==='none'||s.visibility==='hidden'||el.closest('[hidden]'))return false;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope > summary')?.contains(el))return false;return true;};
  const icons=[];
  for(const el of root.querySelectorAll('svg,img')){
    if(!visibleIcon(el)||!iconHost(el)||el.closest('[hidden]')||el.tagName==='IMG'&&!/icon|logo|symbol|glyph|brand|标志|图标/i.test(el.className+' '+(el.parentElement?.className||'')+' '+(el.getAttribute('alt')||'')))continue;
    if(el.namespaceURI?.includes('svg')&&(el.querySelector('text')||el.closest('svg')!==el))continue;
    const r=el.getBoundingClientRect();if(r.width<4||r.height<4)continue;
    const name=clean(el.getAttribute('aria-label')||el.querySelector('title')?.textContent||el.getAttribute('data-icon')||el.getAttribute('data-lucide')||el.getAttribute('alt')||el.getAttribute('id')||'');
    const attributes=['viewBox','d','points','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','width','height','transform','href','xlink:href'];
    const geometry=el.tagName==='IMG'?el.currentSrc||el.src:[el,...el.querySelectorAll('*')].filter(n=>!n.matches('title,desc')).map(n=>{const style=getComputedStyle(n);return[n.tagName,...attributes.filter(a=>n.hasAttribute(a)).map(a=>a+'='+n.getAttribute(a)),style.fill==='none'?'none':'fill',style.stroke==='none'?'none':'stroke',style.strokeWidth,style.strokeLinecap,style.strokeLinejoin,style.fillRule].join('|');}).join('\n');
    const selector=css(el);if(selector.length<=700)icons.push({selector,name,width:r.width,height:r.height,geometry});
  }

  return { identity: [route,activeNav.join('|'),normalize(heading?.textContent || '')].join('|'), layout: skeleton + expansion.join('|') + overlays.join('|'), expanded: expansion.length > 0 || overlays.length > 0,
    heading: clean(heading?.textContent || document.title), surface,regions: observations,icons };
}
const hash = value => createHash('sha256').update(value).digest('hex');
export async function inspectDesign(page, selector) {
  const raw = await page.evaluate(inspectDesignDOM,{selector});
  return { ...raw, identity: hash(raw.identity), layout: hash(raw.layout), icons:raw.icons.map(({geometry,...icon})=>({...icon,hash:hash(geometry)})), regions: raw.regions.map(r => ({ ...r, shape: hash(r.shape), state: hash(r.state), value: hash(r.value) })) };
}

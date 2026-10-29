import { randomBytes } from 'node:crypto';

// Runs only in the isolated capture page. All mutations are restored after DOM capture/preview.
export function expandLongPageDOM({ selector = 'body', key }) {
  const root = document.querySelector(selector); if (!root) throw new Error('没有找到捕获区域：' + selector);
  const visible = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[hidden],[inert],[aria-hidden="true"]'); };
  const dialogs=[...root.querySelectorAll('[role="dialog"],dialog[open],[aria-modal="true"]')].filter(visible);
  const scope=dialogs.at(-1)||root;
  const describe=el=>el.id?'#'+CSS.escape(el.id):el.getAttribute('data-pencil-name')||el.tagName.toLowerCase();
  const scrolling=[scope,...scope.querySelectorAll('*')].filter(el=>visible(el)&&el.clientHeight>=80&&el.scrollHeight>el.clientHeight+40&&/auto|scroll/.test(getComputedStyle(el).overflowY));
  if(scrolling.length>32)throw new Error('可滚动区域超过 32 个，请缩小捕获区域或关闭单张长页');
  const saved=new Map(),boxes=new Map(),scrolls=new Map(),windowScroll={x:scrollX,y:scrollY};
  const remember=el=>{if(!saved.has(el)){saved.set(el,el.getAttribute('style'));scrolls.set(el,{x:el.scrollLeft,y:el.scrollTop});const r=el.getBoundingClientRect(),cs=getComputedStyle(el);boxes.set(el,{height:el.offsetHeight||r.height,width:el.offsetWidth||r.width,screen:r.toJSON(),position:cs.position,display:cs.display,direction:cs.flexDirection,bottom:String(el.computedStyleMap?.().get('bottom')||cs.bottom),top:String(el.computedStyleMap?.().get('top')||cs.top)});}};
  const fixed=[...root.querySelectorAll('*')].filter(el=>visible(el)&&getComputedStyle(el).position==='fixed');
  for(const scroller of scrolling)for(let el=scroller;el;el=el.parentElement)remember(el);
  for(const el of fixed)remember(el);remember(document.documentElement);remember(document.body);
  const restore=()=>{for(const [el,style]of saved){if(style===null)el.removeAttribute('style');else el.setAttribute('style',style);}for(const[el,s]of scrolls){el.scrollLeft=s.x;el.scrollTop=s.y;}window.scrollTo(windowScroll.x,windowScroll.y);delete window[key];};
  window[key]=restore;
  try{
    // Reset scrolling only after state replay/fingerprint verification, preserving content state.
    for(const el of scrolling){el.scrollTop=0;el.scrollLeft=0;}window.scrollTo(0,0);
    const changes=new Map(),containers=[];
    for(const el of scrolling){
      const before=boxes.get(el),cs=getComputedStyle(el),height=el.scrollHeight+parseFloat(cs.borderTopWidth||0)+parseFloat(cs.borderBottomWidth||0);
      if(height>100000)throw new Error('长页超过 100000 px，请关闭单张长页后分段捕获');
      Object.assign(el.style,{boxSizing:'border-box',height:height+'px',maxHeight:'none',minHeight:'0',width:before.width+'px',flex:'0 0 auto',overflowY:'visible',scrollBehavior:'auto'});
      const delta=Math.max(0,el.offsetHeight-before.height);changes.set(el,delta);containers.push({name:describe(el).slice(0,150),width:el.offsetWidth,height:el.offsetHeight});
    }
    // Propagate only the direct children's expansion, without adding it twice to auto-sized ancestors.
    const ancestors=[...boxes.keys()].filter(el=>!changes.has(el)&&[...scrolling].some(s=>el.contains(s)));
    const depth=el=>{let n=0;for(;el;el=el.parentElement)n++;return n;};ancestors.sort((a,b)=>depth(b)-depth(a));
    for(const el of ancestors){const before=boxes.get(el),deltas=[...el.children].map(c=>changes.get(c)||0),extra=before.display==='flex'&&before.direction.startsWith('row')||before.display==='grid'?Math.max(0,...deltas):deltas.reduce((a,b)=>a+b,0);if(!extra)continue;
      const height=Math.max(el.offsetHeight,before.height+extra);if(height>100000)throw new Error('长页超过 100000 px，请缩小区域后捕获');
      Object.assign(el.style,{boxSizing:'border-box',height:height+'px',maxHeight:'none',minHeight:'0',flexShrink:'0'});
      changes.set(el,Math.max(0,el.offsetHeight-before.height));
    }
    const documentHeight=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),documentDelta=Math.max(0,documentHeight-innerHeight);
    // Root viewport-fixed chrome has one copy at the corresponding edge of the long page.
    for(const el of fixed){
      const before=boxes.get(el),expanded=changes.has(el);
      // Fixed descendants of transformed device frames already follow their containing block.
      let transformed=false;for(let p=el.parentElement;p;p=p.parentElement){const cs=getComputedStyle(p);if(cs.transform!=='none'||cs.perspective!=='none'||cs.filter!=='none'||/paint|layout/.test(cs.contain)){transformed=true;break;}}
      if(transformed)continue;
      const x=before.screen.x,y=before.screen.y+(!expanded&&before.bottom!=='auto'&&before.top==='auto'?documentDelta:0),height=expanded?el.offsetHeight:before.height;
      Object.assign(el.style,{position:'absolute',bottom:'auto',right:'auto',width:before.width+'px',height:height+'px',boxSizing:'border-box'});
      const parent=el.offsetParent,relative=parent&&getComputedStyle(parent).position!=='static',r=relative?parent.getBoundingClientRect():{x:0,y:0},cs=relative?getComputedStyle(parent):null;
      el.style.left=(x-r.x-(cs?parseFloat(cs.borderLeftWidth)||0:0))+'px';el.style.top=(y-r.y-(cs?parseFloat(cs.borderTopWidth)||0:0))+'px';
    }
    const height=Math.max(root.getBoundingClientRect().height,root.scrollHeight);
    if(height>100000)throw new Error('长页超过 100000 px，请分段捕获');
    return {containers,height,scrollContainers:scrolling.length,documentHeight};
  }catch(error){restore();throw error;}
}
export async function expandLongPage(page, selector){const key='__h2f_long_'+randomBytes(12).toString('hex');const result=await page.evaluate(expandLongPageDOM,{selector,key});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return{...result,restore:async()=>{await page.evaluate(key=>{if(typeof window[key]==='function')window[key]();},key).catch(()=>{});}};}

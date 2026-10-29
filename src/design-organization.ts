export const PAGE_LEVELS = { primary: '一级页面', secondary: '二级页面', feature: '功能页面', unclassified: '待确认页面' } as const;
export interface DesignOrganization {
  projectId: string; moduleId: string; moduleName: string; pageId: string; pageName: string;
  level: keyof typeof PAGE_LEVELS; parentPageId?: string;
  viewId: string; stateName: string; kind: 'page' | 'dialog' | 'form' | 'selection' | 'scroll' | 'state';
  confidence: 'high' | 'medium' | 'low'; reason: string;
  scroll: { container: string; x: number; y: number };
}
const short = (s: unknown, limit = 150) => String(s || '').trim().slice(0, limit);
export function organizationKey(...parts: string[]): string {
  let hash = 2166136261; const s = parts.join('\u001f');
  for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 16777619);
  return `d${(hash >>> 0).toString(16)}`;
}
export function validOrganization(v: unknown): v is DesignOrganization {
  const o = v as DesignOrganization;
  return !!o && typeof o === 'object' && !Array.isArray(o)
    && ['projectId', 'moduleId', 'pageId', 'viewId'].every(k => typeof (o as any)[k] === 'string' && /^[\w-]{1,200}$/.test((o as any)[k]))
    && (o.parentPageId === undefined || typeof o.parentPageId === 'string' && /^[\w-]{1,200}$/.test(o.parentPageId))
    && ['moduleName', 'pageName', 'stateName', 'reason'].every(k => typeof (o as any)[k] === 'string' && (o as any)[k].length > 0 && (o as any)[k].length <= 500)
    && Object.prototype.hasOwnProperty.call(PAGE_LEVELS, o.level) && ['page','dialog','form','selection','scroll','state'].includes(o.kind)
    && ['high','medium','low'].includes(o.confidence) && !!o.scroll && typeof o.scroll.container === 'string' && o.scroll.container.length <= 700
    && [o.scroll.x, o.scroll.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000000);
}
export interface OrganizationObservation {
  url: string; entryURL: string; heading?: string; title?: string; dialog?: boolean; viewFingerprint: string;
  primary?: { name: string; key: string }; hasPrimaryNavigation?: boolean;
  scrolls?: { container: string; x: number; y: number }[];
  name?: string; actionKind?: string; triggerFamily?: string; featureName?: string; parent?: DesignOrganization; parentURL?: string; explicitGroup?: string;
}
export function inferOrganization(o: OrganizationObservation): DesignOrganization {
  const source = new URL(o.url), entry = new URL(o.entryURL);
  const projectURL = new URL(entry); projectURL.hash = ''; projectURL.search = '';
  const projectId = organizationKey(projectURL.href), parent = o.parent;
  const primary = o.primary;
  const moduleName = short(primary?.name || parent?.moduleName || o.explicitGroup || o.heading || o.title || '未分类模块');
  const moduleId = primary ? organizationKey(projectId, primary.key) : parent?.moduleId || organizationKey(projectId, moduleName);
  const primaryPageId = organizationKey(moduleId, 'primary');
  const route = source.pathname + source.search + source.hash;
  const action = o.actionKind || '', isScroll = action === '滚动';
  const sampledScroll = o.scrolls?.find(s => s.y > 0 || s.x > 0) || o.scrolls?.[0] || { container: 'document', x: 0, y: 0 };
  const scroll = { container:short(sampledScroll.container,700),x:Math.max(0,Math.min(10000000,sampledScroll.x)),y:Math.max(0,Math.min(10000000,sampledScroll.y)) };
  const common = { projectId, moduleId, moduleName, viewId: organizationKey(projectId, route, o.viewFingerprint), scroll,
    stateName: short(isScroll && parent ? parent.stateName : o.name || primary?.name || o.heading || o.title || '默认状态') };
  if (isScroll && parent) return { ...parent, ...common, viewId:parent.viewId,kind: 'scroll' };
  if (o.dialog) {
    const continuation = parent?.level === 'feature' && (short(o.heading) === parent.pageName || ['表单','校验','选择'].includes(action));
    const pageName = continuation ? parent.pageName : short(o.heading || o.name || '弹窗');
    return { ...common, level: 'feature', pageId: continuation ? parent.pageId : organizationKey(moduleId, 'feature', pageName), pageName,
      parentPageId: continuation ? parent.parentPageId : parent?.pageId || primaryPageId,
      kind: action === '表单' || action === '校验' ? 'form' : action === '选择' ? 'selection' : 'dialog',
      confidence: 'high', reason: '检测到弹窗或表单，按打开它的所属页面归组' };
  }
  const parentRoute = (() => { try { const u=new URL(o.parentURL||o.url);return u.pathname+(u.hash.startsWith('#/')?u.hash.split('?')[0]:''); } catch {return '';} })();
  const ownRoute=source.pathname+(source.hash.startsWith('#/')?source.hash.split('?')[0]:'');
  if (parent && moduleId===parent.moduleId && (ownRoute!==parentRoute || action==='详情'&&!primary)) {
    const tail=short(o.name).split(/[，,]/).pop()||'';
    const pageName = short(/^(查看|打开|进入).*(详情|明细)$/.test(tail)?tail.replace(/^(查看|打开|进入)/,''):o.heading||o.name||'详情页');
    return { ...common, level: 'secondary', pageId: organizationKey(moduleId, 'secondary',o.triggerFamily||ownRoute), pageName, parentPageId: organizationKey(moduleId,'secondary',o.triggerFamily||ownRoute)===parent.pageId?parent.parentPageId||primaryPageId:parent.pageId,
      kind: 'page', confidence: 'medium', reason: '从所属页面进入独立详情或发生页面路由跳转' };
  }
  if(primary&&parent&&o.featureName&&!['导航','入口','滚动'].includes(action))return{...common,level:'feature',pageId:organizationKey(moduleId,'feature',o.featureName),pageName:short(o.featureName),parentPageId:primaryPageId,kind:action==='选择'?'selection':'state',confidence:'medium',reason:'控件位于同一功能区域，作为该功能的不同状态'};
  if (primary) return { ...common, level: 'primary', pageId: primaryPageId, pageName: moduleName,
    kind: isScroll ? 'scroll' : action === '选择' ? 'selection' : action && action !== '导航' ? 'state' : 'page', confidence: 'high', reason: '当前页对应已选中的主导航入口' };
  if (parent) return { ...parent, ...common, kind: action === '表单' || action === '校验' ? 'form' : action === '选择' ? 'selection' : 'state', reason: '路由与页面结构保持一致，作为同页的另一状态' };
  const pageName = short(o.heading || o.name || o.title || '当前页面');
  return { ...common, level: 'unclassified', pageId: organizationKey(moduleId, route, pageName), pageName, kind: 'page', confidence: 'low', reason: '未发现可靠主导航或进入关系，页面层级待确认' };
}
export interface OrganizedPage { name: string; width: number; height: number; design?: DesignOrganization }
export interface DesignGroup { id: string; name: string; x: number; y: number; width: number; height: number; indices: number[] }
export function designLayout(pages: OrganizedPage[]) {
  const sections = new Map<string, { design: DesignOrganization; indices: number[] }>();
  pages.forEach((p, index) => { if (!p.design) return; const d = p.design, key = [d.projectId,d.moduleId,d.level,d.pageId].join(':'); const s = sections.get(key); if (s) s.indices.push(index); else sections.set(key,{design:d,indices:[index]}); });
  const modules = new Map<string, typeof sections>();
  for (const [id,s] of sections) { const key=s.design.projectId+':'+s.design.moduleId; if(!modules.has(key))modules.set(key,new Map()); modules.get(key)!.set(id,s); }
  const groups: DesignGroup[] = [], positions = new Map<number,{x:number;y:number;groupId:string}>();
  let moduleY = 0, width = 0;
  for (const sectionMap of modules.values()) {
    let columnX = 0, moduleHeight = 0;
    for (const level of Object.keys(PAGE_LEVELS)) {
      let sectionY = moduleY, columnWidth = 0;
      for (const [id,s] of sectionMap) {
        if (s.design.level !== level) continue;
        const views = new Map<string,number[]>();
        for(const i of s.indices){const key=pages[i].design!.viewId;const v=views.get(key);if(v)v.push(i);else views.set(key,[i]);}
        let x=80,y=112,rowHeight=0,maxRight=80;
        const local = new Map<number,{x:number;y:number}>();
        for(const view of views.values()){
          view.sort((a,b)=>pages[a].design!.scroll.y-pages[b].design!.scroll.y||pages[a].design!.scroll.x-pages[b].design!.scroll.x||a-b);
          const viewWidth=view.reduce((sum,i)=>sum+pages[i].width,0)+24*Math.max(0,view.length-1);
          const viewHeight=view.reduce((max,i)=>Math.max(max,pages[i].height),0);
          if(x>80 && x+viewWidth>4800){x=80;y+=rowHeight+120;rowHeight=0;}
          let partX=x;for(const i of view){local.set(i,{x:partX,y});partX+=pages[i].width+24;}
          maxRight=Math.max(maxRight,x+viewWidth);x+=viewWidth+96;rowHeight=Math.max(rowHeight,viewHeight);
        }
        const sectionWidth=maxRight+80,sectionHeight=y+rowHeight+80;
        for(const [i,p] of local)positions.set(i,{x:columnX+p.x,y:sectionY+p.y,groupId:id});
        groups.push({id,name:`${PAGE_LEVELS[s.design.level]} · ${s.design.moduleName}${s.design.pageName===s.design.moduleName?'':' / '+s.design.pageName}`,x:columnX,y:sectionY,width:sectionWidth,height:sectionHeight,indices:[...views.values()].flat()});
        sectionY+=sectionHeight+160;columnWidth=Math.max(columnWidth,sectionWidth);
      }
      if(columnWidth){columnX+=columnWidth+200;moduleHeight=Math.max(moduleHeight,sectionY-moduleY);}
    }
    width=Math.max(width,Math.max(0,columnX-200));moduleY+=moduleHeight+240;
  }
  return { positions,groups,width,height:Math.max(0,moduleY-240) };
}

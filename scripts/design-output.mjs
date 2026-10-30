import { createHash } from 'node:crypto';
const key = (...values) => 'a' + createHash('sha256').update(values.join('\x1f')).digest('hex').slice(0,24);
const safe = value => String(value || '').trim().slice(0,120);
export function designOutput(entries, { dataSamples = 2 } = {}) {
  const pages = [], components = [], layouts = new Map(), pageFamilies = new Map(), families = new Map();
  let dataMerged = 0, structuralMerged = 0;
  const metadata = (kind, familyId, familyName, stateName, reason) => ({ kind, familyId, familyName: safe(familyName), stateName: safe(stateName), reason, sampleCount: 1 });
  const component = (entry, region, family, stateName, reason, variantKey) => {
    const id = key('component',family.id,variantKey);
    const artifact = metadata('component',family.id,family.name,stateName,reason);
    const design = { ...entry.design, level:'feature', pageId:family.id, pageName:family.name, viewId:key(variantKey), stateName, kind:'state', parentPageId:family.parentPageId, reason:'同一功能组件的局部状态，独立于页面模板展示' };
    const output = { ...entry, id, name: `组件 · ${family.name} · ${stateName}`, selector:region.selector, artifact, design, fingerprint:entry.fingerprint };
    components.push(output); return output;
  };
  for (const entry of entries) {
    const snapshot = entry.designSnapshot;
    if (!snapshot) { pages.push(entry); continue; }
    // Keep one representative expanded/overlay context per screen. Other local
    // expansion combinations are represented by component variants, not more full pages.
    const templateKey = key(snapshot.identity,snapshot.expanded ? 'expanded-context' : snapshot.layout);
    const known = layouts.get(templateKey);
    let page = known;
    if (!page) {
      const stateName = snapshot.expanded ? '展开' : '默认';
      const parent = pageFamilies.get(snapshot.identity) || entry.design; pageFamilies.set(snapshot.identity,parent);
      page = { ...entry, design:{...parent,viewId:templateKey,stateName,kind:snapshot.expanded?'state':'page'}, id:key('page',templateKey), name:`${snapshot.heading || entry.design.pageName} · ${stateName}`, artifact:metadata('page',key('page-family',snapshot.identity),snapshot.heading || entry.design.pageName,stateName,'按页面结构保留代表模板') };
      layouts.set(templateKey,page); pages.push(page);
    } else { page.artifact.sampleCount++; structuralMerged++; }
    let changed = false;
    const changes = snapshot.regions.filter(region=>{const family=families.get(key(snapshot.identity,region.selector));return family&&!family.states.get(region.state)?.has(region.value);});
    // A details/form inside a card is captured once at the smallest changed functional region.
    const regions = snapshot.regions.filter(region=>!changes.some(child=>child!==region&&child.ancestors?.includes(region.selector)));
    for (const region of regions) {
      const id = key(snapshot.identity,region.selector), previous = families.get(id);
      if (!previous) {
        const generic = {card:'卡片',section:'区域',article:'内容卡片',form:'表单',details:'折叠区域',panel:'面板'};
        const family = { id, name:safe(generic[region.name] ? `${generic[region.name]} ${families.size+1}` : region.name), parentPageId:page.design.pageId, base:{entry,region}, states:new Map(), variants:new Map(), emitted:false };
        family.states.set(region.state,new Set([region.value])); families.set(id,family);
        if (region.flags.includes('dialog')) { component(entry,region,family,'默认','独立弹窗组件',region.state); family.emitted = true; family.variants.set(region.state,1); }
        continue;
      }
      const baseline = previous.base.region;
      const stateValues = previous.states.get(region.state);
      if (stateValues?.has(region.value)) continue;
      changed = true;
      // Default plus a small number of representative data examples, never every date/record.
      const dataOnly = !!stateValues;
      if (dataOnly && (dataSamples === 0 || stateValues.size >= dataSamples)) { dataMerged++; continue; }
      if (!previous.emitted) {
        component(previous.base.entry,baseline,previous,'默认','组件的初始状态',baseline.state);
        previous.emitted = true; previous.variants.set(baseline.state,1);
      }
      const values = stateValues || new Set(); values.add(region.value); previous.states.set(region.state,values);
      const count = previous.variants.get(region.state) || 0;
      const flags = [region.flags.includes('expanded')?'展开':'',region.flags.includes('filled')?'已填写':'',region.flags.includes('feedback')?'反馈':''].filter(Boolean).join(' · ');
      const stem = dataOnly ? `数据样本 ${count + 1}` : flags || `状态 ${previous.variants.size + 1}`;
      const label = components.some(c=>c.artifact.familyId===previous.id&&c.artifact.stateName===stem) ? `${stem} ${previous.variants.size+1}` : stem;
      component(entry,region,previous,label,dataOnly?'相同结构的数据示例':'组件结构或控件视觉状态变化',dataOnly?region.state+':'+region.value:region.state);
      previous.variants.set(region.state,count+1);
    }
    if (known && !changed) dataMerged++;
  }
  const clean = entry => { const {designSnapshot,...rest}=entry; return rest; };
  return { pages:[...pages,...components].map(clean), summary:{pageTemplates:pages.length,componentStates:components.length,componentFamilies:components.length?new Set(components.map(c=>c.artifact.familyId)).size:0,observedStates:entries.length,wholePagesAvoided:structuralMerged,dataMerged} };
}

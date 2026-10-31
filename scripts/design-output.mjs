import { createHash } from 'node:crypto';
const key = (...values) => 'a' + createHash('sha256').update(values.join('\x1f')).digest('hex').slice(0,24);
const safe = value => String(value || '').trim().slice(0,120);
export function designOutput(entries, { dataSamples = 0 } = {}) {
  const pages=[],components=[],icons=[],layouts=new Map(),pageFamilies=new Map(),families=new Map(),glyphs=new Set();
  let dataMerged=0,structuralMerged=0;
  const metadata=(kind,familyId,familyName,stateName,reason)=>({kind,familyId,familyName:safe(familyName),stateName:safe(stateName),reason,sampleCount:1});
  const component=(entry,region,family,stateName,reason,variantKey)=>{
    const artifact=metadata('component',family.id,family.name,stateName,reason);
    const design={...entry.design,moduleId:key(entry.design.projectId,'component-library'),moduleName:'组件库',level:'feature',pageId:family.id,pageName:family.name,viewId:key(variantKey),stateName,kind:'state',parentPageId:family.parentPageId,reason:'按结构复用组件；局部交互和反馈保留为变体'};
    const output={...entry,id:key('component',family.id,variantKey),name:`组件 · ${family.name} · ${stateName}`,selector:region.selector,artifact,design};
    components.push(output);return output;
  };
  for(const entry of entries){
    const snapshot=entry.designSnapshot;if(!snapshot){pages.push(entry);continue;}
    const project=entry.design.projectId;
    // An active form/dialog owns its page identity; local controls and feedback never
    // create another whole screenshot of that same form, even from another entry point.
    const scope=snapshot.surface?key(project,'surface',snapshot.surface.kind==='form'?snapshot.identity:'dialog',snapshot.surface.key):key(project,snapshot.identity);
    const templateKey=key(scope,snapshot.surface?'surface':snapshot.expanded?'expanded-context':snapshot.layout);
    let page=layouts.get(templateKey);
    if(!page){
      const stateName=snapshot.surface?'默认':snapshot.expanded?'展开':'默认';
      const parent=pageFamilies.get(scope)||entry.design;pageFamilies.set(scope,parent);
      const name=snapshot.surface?.kind==='form'&&entry.design.level==='primary'?entry.design.pageName:snapshot.surface?.name||(entry.design.level==='primary'?entry.design.pageName:snapshot.heading)||entry.design.pageName;
      page={...entry,design:{...parent,pageName:snapshot.surface?safe(name):parent.pageName,viewId:templateKey,stateName,kind:snapshot.surface?'form':snapshot.expanded?'state':'page'},id:key('page',templateKey),name:`${name} · ${stateName}`,artifact:metadata('page',key('page-family',scope),name,stateName,'同一页面保留代表上下文，局部变化输出为组件')};
      layouts.set(templateKey,page);pages.push(page);
    }else{page.artifact.sampleCount++;structuralMerged++;}
    const familyKey=region=>key(project,region.explicitName||'',region.shape);
    const changes=snapshot.regions.filter(region=>{const family=families.get(familyKey(region));return family&&!family.states.get(region.state)?.has(region.value);});
    const regions=snapshot.regions.filter(region=>!changes.some(child=>child!==region&&child.ancestors?.includes(region.selector)));
    for(const region of regions){
      const id=familyKey(region);let family=families.get(id);
      if(!family){
        const generic={card:'卡片',section:'区域',article:'内容卡片',form:'表单',details:'折叠区域',panel:'面板',row:'列表项',field:'输入框',feedback:'反馈提示'};
        const type=region.componentType||region.name;
        family={id,name:safe(region.explicitName||(generic[type]?`${generic[type]} ${families.size+1}`:region.name)),parentPageId:page.design.pageId,states:new Map([[region.state,new Set([region.value])]]),variants:new Map([[region.state,1]])};families.set(id,family);
        component(entry,region,family,region.flags.includes('feedback')?'反馈':'默认','同类结构保留一个代表组件',region.state);continue;
      }
      const stateValues=family.states.get(region.state);
      if(stateValues?.has(region.value)){dataMerged++;continue;}
      const dataOnly=!!stateValues;
      if(dataOnly&&(dataSamples===0||stateValues.size>=dataSamples)){dataMerged++;continue;}
      const values=stateValues||new Set();values.add(region.value);family.states.set(region.state,values);
      const count=family.variants.get(region.state)||0;
      const flags=[region.flags.includes('expanded')?'展开':'',region.flags.includes('filled')?'已填写':'',region.flags.includes('feedback')?'反馈':''].filter(Boolean).join(' · ');
      const stem=dataOnly?`数据样本 ${count+1}`:flags||`状态 ${family.variants.size+1}`;
      const label=components.some(c=>c.artifact.familyId===id&&c.artifact.stateName===stem)?`${stem} ${family.variants.size+1}`:stem;
      component(entry,region,family,label,dataOnly?'可选的数据样本':'局部交互或反馈变化',dataOnly?region.state+':'+region.value:region.state);family.variants.set(region.state,count+1);
    }
    for(const icon of snapshot.icons||[]){
      const id=key(project,'icon',icon.hash);if(glyphs.has(id))continue;glyphs.add(id);
      const name=safe(icon.name||`图标 ${icons.length+1}`),artifact=metadata('icon',id,name,'默认','从页面与组件中提取，按图形去重');
      icons.push({...entry,id,name:`图标 · ${name}`,selector:icon.selector,artifact,design:{...entry.design,moduleId:key(project,'icon-library'),moduleName:'图标库',level:'feature',pageId:key(project,'icons'),pageName:'图标',viewId:id,stateName:name,kind:'state',reason:'图标集中整理，重复图形只保留一次'}});
    }
  }
  const clean=entry=>{const{designSnapshot,observationKey,...rest}=entry;return rest;};
  return{pages:[...pages,...components,...icons].map(clean),summary:{pageTemplates:pages.length,componentStates:components.length,componentFamilies:families.size,iconAssets:icons.length,observedStates:entries.length,wholePagesAvoided:structuralMerged,dataMerged}};
}

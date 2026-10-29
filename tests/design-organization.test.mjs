import test from 'node:test';import assert from 'node:assert/strict';
import{inferOrganization,designLayout,validOrganization,PAGE_LEVELS}from'../dist/lib/design-organization.js';
import{ImportBatch}from'../dist/lib/batch.js';import{BundleBuilder,validateBundle,hydratePage}from'../dist/lib/bundle.js';import{validateDocument}from'../dist/lib/schema.js';import{mockFigma}from'./helpers.mjs';
const observation={url:'file:///project/index.html#/planning',entryURL:'file:///project/index.html#/planning',primary:{name:'计划',key:'planning'},viewFingerprint:'base',name:'计划'};
const primary=inferOrganization(observation);
const lower=inferOrganization({...observation,actionKind:'滚动',parent:primary,name:'下半部分',viewFingerprint:'lazy-loaded',scrolls:[{container:'#view',x:0,y:1400}]});
const detail=inferOrganization({...observation,url:'file:///project/index.html#/detail/one',heading:'计划详情',triggerFamily:'detail',name:'查看计划详情',actionKind:'详情',parent:primary,parentURL:observation.url,viewFingerprint:'detail-one'});
const modal=inferOrganization({...observation,dialog:true,heading:'新增计划',actionKind:'交互',name:'新增计划',parent:primary,viewFingerprint:'dialog'});
const form=inferOrganization({...observation,dialog:true,heading:'新增计划',actionKind:'表单',name:'填写示例',parent:modal,viewFingerprint:'filled'});
const scene=id=>({id,kind:'frame',name:id,x:0,y:0,width:390,height:844,opacity:1,fills:[],children:[]});
const doc=(name,design)=>({schemaVersion:1,name,createdAt:'',source:{url:'file:///project/index.html',selector:'body',viewport:{width:1440,height:1000},...(design?{design}: {})},root:scene(name),assets:[],diagnostics:[],stats:{nodes:1,texts:0,images:0,vectors:0,missingAssets:0}});
const plan=pages=>pages.map(p=>({name:p.name,width:p.root.width,height:p.root.height,design:p.source.design}));
const absolute=n=>{let x=n.x,y=n.y;for(let p=n.parent;p&&p.type==='SECTION';p=p.parent){x+=p.x;y+=p.y;}return{x,y};};

test('primary navigation, route details and dialogs use evidence instead of click depth',()=>{
 assert.equal(primary.level,'primary');assert.equal(detail.level,'secondary');assert.equal(detail.moduleName,'计划');assert.equal(modal.level,'feature');assert.equal(form.pageId,modal.pageId);assert.equal(form.parentPageId,primary.pageId);assert.equal(form.pageName,'新增计划');assert.ok(validOrganization(form));
 const unknown=inferOrganization({url:'https://example.test/a',entryURL:'https://example.test/a',viewFingerprint:'x',heading:'Welcome'});assert.equal(unknown.level,'unclassified');assert.equal(unknown.confidence,'low');
});
test('different records share one detail function while different projects and modules stay separate',()=>{
 const second=inferOrganization({...observation,url:'file:///project/index.html#/detail/two',heading:'计划详情',triggerFamily:'detail',actionKind:'详情',parent:primary,parentURL:observation.url,viewFingerprint:'detail-two'});assert.equal(second.pageId,detail.pageId);assert.notEqual(second.viewId,detail.viewId);
 const other=inferOrganization({...observation,entryURL:'file:///another/index.html#/planning'});assert.notEqual(other.projectId,primary.projectId);
 const home=inferOrganization({...observation,primary:{name:'首页',key:'home'}});assert.notEqual(home.moduleId,primary.moduleId);
});
test('scroll captures retain the view identity even when scrolling loads more DOM',()=>{
 assert.equal(lower.viewId,primary.viewId);assert.equal(lower.pageId,primary.pageId);assert.equal(lower.kind,'scroll');assert.equal(lower.stateName,'计划');assert.equal(lower.scroll.y,1400);
});
test('inline component variants form a functional group without becoming a new primary page',()=>{
 const year=inferOrganization({...observation,name:'年',actionKind:'交互',featureName:'生活',triggerFamily:'period',parent:primary,viewFingerprint:'year'});
 const quarter=inferOrganization({...observation,name:'季',actionKind:'交互',featureName:'生活',triggerFamily:'period',parent:year,viewFingerprint:'quarter'});
 assert.equal(year.level,'feature');assert.equal(year.pageName,'生活');assert.equal(year.pageId,quarter.pageId);assert.notEqual(year.viewId,quarter.viewId);
});
test('layout places long-page segments next to one another despite interleaved discovery order',()=>{
 const data=[doc('top',primary),doc('dialog',modal),doc('detail',detail),doc('bottom',lower),doc('filled',form)];const p=designLayout(plan(data));
 assert.equal(p.groups.length,3);const a=p.positions.get(0),b=p.positions.get(3);assert.equal(a.groupId,b.groupId);assert.equal(a.y,b.y);assert.equal(b.x-a.x,414);
 assert.equal(p.positions.get(1).groupId,p.positions.get(4).groupId);assert.notEqual(p.positions.get(1).groupId,a.groupId);
 const ordered=p.groups.map(g=>g.name);assert.ok(ordered[0].startsWith(PAGE_LEVELS.primary));assert.ok(ordered[1].startsWith(PAGE_LEVELS.secondary));assert.ok(ordered[2].startsWith(PAGE_LEVELS.feature));
});
test('organized imports create named native Sections while every captured page remains an editable Frame',async()=>{
 const data=[doc('top',primary),doc('dialog',modal),doc('detail',detail),doc('bottom',lower),doc('filled',form)],mock=mockFigma(),batch=new ImportBatch(mock.api,'grouped',plan(data),'visual');
 for(let i=0;i<data.length;i++)assert.ok((await batch.importPage(i,data[i])).nodeId);const r=await batch.finish();assert.equal(r.completed,5);assert.equal(r.failed,0);assert.equal(mock.page.children.length,3);assert.ok(mock.page.children.every(n=>n.type==='SECTION'));
 const first=await mock.api.getNodeByIdAsync(r.results[0].nodeId),bottom=await mock.api.getNodeByIdAsync(r.results[3].nodeId);assert.equal(first.type,'FRAME');assert.equal(first.parent,bottom.parent);assert.equal(absolute(bottom).x-absolute(first).x,414);assert.equal(absolute(first).y,absolute(bottom).y);assert.equal(first.pluginData.h2fOrganization,JSON.stringify(primary));
});
test('selecting only some segments preserves grouping without blank Sections and old pages keep grid fallback',async()=>{
 const data=[doc('bottom',lower),doc('dialog',modal),doc('legacy')],mock=mockFigma(),batch=new ImportBatch(mock.api,'selected',plan(data),'visual');
 for(let i=0;i<data.length;i++)await batch.importPage(i,data[i]);assert.equal((await batch.finish()).completed,3);assert.equal(mock.page.children.filter(n=>n.type==='SECTION').length,2);assert.ok(mock.page.children.find(n=>n.name==='legacy'));
});
test('cancelling or failing grouped imports keeps completed Frames and avoids empty Sections',async()=>{
 const data=[doc('first',primary),doc('bad',modal),doc('last',detail)],mock=mockFigma(),batch=new ImportBatch(mock.api,'failure',plan(data),'visual');data[1].root.width=-1;
 assert.ok((await batch.importPage(0,data[0])).nodeId);assert.ok((await batch.importPage(1,data[1])).error);batch.cancel();const r=await batch.finish();assert.equal(r.completed,1);assert.equal(r.failed,1);assert.equal(mock.page.children.length,1);assert.equal(mock.page.children[0].children.length,1);
});
test('organization survives JSON, bundle hydration and direct-transfer data without requiring a state manifest',()=>{
 const builder=new BundleBuilder('flow');builder.add(doc('first',primary));builder.add(doc('second',lower));const parsed=JSON.parse(JSON.stringify(builder.bundle));validateBundle(parsed);assert.deepEqual(hydratePage(parsed,1).source.design,lower);
 const invalid=doc('bad',{...primary,level:'admin'});assert.throws(()=>validateDocument(invalid),/分类/);assert.throws(()=>new ImportBatch(mockFigma().api,'bad',plan([invalid]),'visual'),/计划/);
});
test('a missing Section API preserves successful import positions and reports the grouping fallback',async()=>{
 const data=[doc('first',primary),doc('second',lower)],mock=mockFigma();mock.api.createSection=()=>{throw new Error('Sections unavailable');};const batch=new ImportBatch(mock.api,'fallback',plan(data),'visual');
 for(let i=0;i<data.length;i++)await batch.importPage(i,data[i]);const r=await batch.finish();assert.equal(r.completed,2);assert.equal(mock.page.children.length,2);assert.equal(mock.page.children[1].x-mock.page.children[0].x,414);assert.ok(r.results[0].result.diagnostics.some(d=>d.code==='GROUP_LAYOUT_FALLBACK'));
});

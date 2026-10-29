import { designLayout, validOrganization, type DesignOrganization, type DesignGroup } from './design-organization';
import { importDocument, createImportContext, type ImportResult } from './importer';
import { BATCH_LIMITS } from './bundle';
import { validateDocument, countScene, isCanvasPlacement, type CanvasPlacement, type CaptureDocument, type ImportMode } from './schema';
export interface ImportPlanPage { name: string; width: number; height: number; canvas?: CanvasPlacement; design?: DesignOrganization }
export class ImportBatch {
  readonly results: { index: number; name: string; nodeId?: string; error?: string; result?: ImportResult }[] = [];
  cancelled = false; processing = false; next = 0;
  private nodeCount = 0; private assetBytes = 0; private assetIds = new Set<string>();
  private groupPlans = new Map<string, DesignGroup>(); private groups = new Map<string, SectionNode>(); private groupForIndex = new Map<number,string>();
  private context; private page: PageNode; private positions: { x: number; y: number }[]; private staging: FrameNode | null = null;
  constructor(private api: PluginAPI, readonly id: string, private plan: ImportPlanPage[], private mode: ImportMode) {
    if (!id || id.length > 100 || !Array.isArray(plan) || !plan.length || plan.some(p => !p || typeof p.name !== 'string' || !Number.isFinite(p.width) || p.width <= 0 || p.width > 100000 || !Number.isFinite(p.height) || p.height <= 0 || p.height > 100000 || (p.canvas !== undefined && !isCanvasPlacement(p.canvas)) || (p.design !== undefined && !validOrganization(p.design)))) throw new Error('批次计划无效');
    this.context = createImportContext(api); this.page = api.currentPage;
    const existing = this.page.children.filter(n => n.visible); const originX = existing.length ? existing.reduce((right, node) => Math.max(right, node.x + node.width), -Infinity) + 160 : Math.round(api.viewport.center.x);
    type Unit = { width: number; height: number; minX: number; minY: number; entries: { index: number; x: number; y: number }[]; groups?: DesignGroup[] };
    const units: Unit[] = [], canvases = new Map<string, Unit>();
    const organized=designLayout(plan.map(p=>p.canvas?{...p,design:undefined}:p)); let designUnit:Unit|undefined;
    plan.forEach((p, index) => {
      const c = p.canvas;
      if (!c && p.design) {
        if(!designUnit){designUnit={width:organized.width,height:organized.height,minX:0,minY:0,entries:[],groups:organized.groups};units.push(designUnit);}
        const pos=organized.positions.get(index)!;designUnit.entries.push({index,x:pos.x,y:pos.y});this.groupForIndex.set(index,pos.groupId);return;
      }
      if (!c) { units.push({ width: p.width, height: p.height, minX: 0, minY: 0, entries: [{ index, x: 0, y: 0 }] }); return; }
      let unit = canvases.get(c.id);
      if (!unit) { unit = { width: c.width, height: c.height, minX: 0, minY: 0, entries: [] }; canvases.set(c.id, unit); units.push(unit); }
      unit.minX = Math.min(unit.minX, c.x); unit.minY = Math.min(unit.minY, c.y);
      unit.width = Math.max(unit.width, c.width, c.x + p.width); unit.height = Math.max(unit.height, c.height, c.y + p.height);
      unit.entries.push({ index, x: c.x, y: c.y });
    });
    const originY = Math.round(api.viewport.center.y), columns = Math.min(8, Math.ceil(Math.sqrt(units.length)));
    let x = originX, y = originY, rowHeight = 0;
    this.positions = new Array(plan.length);
    units.forEach((unit, i) => {
      if (i > 0 && i % columns === 0) { x = originX; y += rowHeight + 120; rowHeight = 0; }
      for (const group of unit.groups || []) this.groupPlans.set(group.id,{...group,x:x+group.x,y:y+group.y});
      for (const entry of unit.entries) this.positions[entry.index] = { x: x + entry.x - unit.minX, y: y + entry.y - unit.minY };
      x += unit.width - unit.minX + 120; rowHeight = Math.max(rowHeight, unit.height - unit.minY);
    });
  }
  cancel() { this.cancelled = true; }
  cleanupOnClose() { this.cancelled = true; if (this.staging && !this.staging.removed) this.staging.remove(); }
  get total() { return this.plan.length; }
  async importPage(index: number, document: CaptureDocument, progress?: (done: number, total: number) => void) {
    if (this.processing || index !== this.next || index >= this.total || this.cancelled) throw new Error('批次已取消或页面顺序无效');
    this.processing = true;
    try {
      validateDocument(document);
      const count = countScene(document.root).nodes;
      if (this.nodeCount + count > BATCH_LIMITS.nodes) throw new Error('整批图层数量超过 120000，请分批导入');
      for (const asset of document.assets) if (!this.assetIds.has(asset.id)) {
        const bytes = (asset.base64?.length || 0) * .75;
        if (this.assetBytes + bytes > BATCH_LIMITS.assetBytes || this.assetIds.size >= BATCH_LIMITS.assets) throw new Error('整批图片资源超限');
        this.assetIds.add(asset.id); this.assetBytes += bytes;
      }
      this.nodeCount += count;
      const result = await importDocument(this.api, document, { mode: this.mode, context: this.context, page: this.page, focus: false, position: this.positions[index], cancelled: () => this.cancelled, progress, onStaging: node => { this.staging = node; } });
      const groupId=this.groupForIndex.get(index), spec=groupId?this.groupPlans.get(groupId):undefined;
      if(spec){
        // Native Sections label the classification without becoming Auto Layout containers.
        // Reparent only after the page has committed, so cancellation still preserves completed work.
        try {
          const node=await this.api.getNodeByIdAsync(result.nodeId);
          if(node&&'x' in node){
            let section=this.groups.get(spec.id);
            if(!section){section=this.api.createSection();this.page.appendChild(section);section.name=spec.name;section.resizeWithoutConstraints(spec.width,spec.height);section.x=spec.x;section.y=spec.y;section.setPluginData('h2fDesignGroup',spec.id);this.groups.set(spec.id,section);}
            section.appendChild(node as SceneNode);node.x=this.positions[index].x-spec.x;node.y=this.positions[index].y-spec.y;
            node.setPluginData('h2fOrganization',JSON.stringify(document.source.design));
          }
        }catch{const section=this.groups.get(spec.id);if(section&&!section.children.length){section.remove();this.groups.delete(spec.id);}result.diagnostics.push({code:'GROUP_LAYOUT_FALLBACK',message:'当前环境未能创建分类分区，保留页面的分组坐标',count:1});}
      }
      const entry = { index, name: document.name, nodeId: result.nodeId, result }; this.results.push(entry); this.next++; return entry;
    } catch (error) {
      const entry = { index, name: document?.name || this.plan[index].name, error: error instanceof Error ? error.message : String(error) }; this.results.push(entry); this.next++; return entry;
    } finally { this.processing = false; }
  }
  async finish() {
    if (this.processing) throw new Error('当前页面尚未完成');
    const nodes: SceneNode[] = [];
    for (const entry of this.results) if (entry.nodeId) { const n = await this.api.getNodeByIdAsync(entry.nodeId); if (n && 'visible' in n) nodes.push(n as SceneNode); }
    if (nodes.length && this.api.currentPage.id === this.page.id) { const sections=[...this.groups.values()].filter(n=>!n.removed&&n.children.length);const focus=sections.length?sections.slice(0,12):nodes.length>12?[nodes[0]]:nodes;this.page.selection=focus;this.api.viewport.scrollAndZoomIntoView(focus); }
    return { total: this.total, completed: this.results.filter(r => r.nodeId).length, failed: this.results.filter(r => r.error && r.error !== '导入已取消').length, cancelled: this.cancelled, results: this.results };
  }
}

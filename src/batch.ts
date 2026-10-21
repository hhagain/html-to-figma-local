import { importDocument, createImportContext, type ImportResult } from './importer';
import { BATCH_LIMITS } from './bundle';
import { validateDocument, countScene, type CaptureDocument, type ImportMode } from './schema';
export class ImportBatch {
  readonly results: { index: number; name: string; nodeId?: string; error?: string; result?: ImportResult }[] = [];
  cancelled = false; processing = false; next = 0;
  private nodeCount = 0; private assetBytes = 0; private assetIds = new Set<string>();
  private context; private page: PageNode; private positions: { x: number; y: number }[]; private staging: FrameNode | null = null;
  constructor(private api: PluginAPI, readonly id: string, private plan: { name: string; width: number; height: number }[], private mode: ImportMode) {
    if (!id || id.length > 100 || !Array.isArray(plan) || !plan.length || plan.length > BATCH_LIMITS.pages || plan.some(p => !p || typeof p.name !== 'string' || !Number.isFinite(p.width) || p.width <= 0 || p.width > 100000 || !Number.isFinite(p.height) || p.height <= 0 || p.height > 100000)) throw new Error('批次计划无效（最多 200 页）');
    this.context = createImportContext(api); this.page = api.currentPage;
    const existing = this.page.children.filter(n => n.visible); const originX = existing.length ? Math.max(...existing.map(n => n.x + n.width)) + 160 : Math.round(api.viewport.center.x);
    const originY = Math.round(api.viewport.center.y); const columns = Math.min(8, Math.ceil(Math.sqrt(plan.length))); let x = originX, y = originY, rowHeight = 0;
    this.positions = plan.map((p, i) => { if (i > 0 && i % columns === 0) { x = originX; y += rowHeight + 120; rowHeight = 0; } const pos = { x, y }; x += p.width + 120; rowHeight = Math.max(rowHeight, p.height); return pos; });
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
      const entry = { index, name: document.name, nodeId: result.nodeId, result }; this.results.push(entry); this.next++; return entry;
    } catch (error) {
      const entry = { index, name: document?.name || this.plan[index].name, error: error instanceof Error ? error.message : String(error) }; this.results.push(entry); this.next++; return entry;
    } finally { this.processing = false; }
  }
  async finish() {
    if (this.processing) throw new Error('当前页面尚未完成');
    const nodes: SceneNode[] = [];
    for (const entry of this.results) if (entry.nodeId) { const n = await this.api.getNodeByIdAsync(entry.nodeId); if (n && 'visible' in n) nodes.push(n as SceneNode); }
    if (nodes.length && this.api.currentPage.id === this.page.id) { this.page.selection = nodes.length > 12 ? [nodes[0]] : nodes; this.api.viewport.scrollAndZoomIntoView(nodes.length > 12 ? [nodes[0]] : nodes); }
    return { total: this.total, completed: this.results.filter(r => r.nodeId).length, failed: this.results.filter(r => r.error && r.error !== '导入已取消').length, cancelled: this.cancelled, results: this.results };
  }
}

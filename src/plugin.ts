import { importDocument } from './importer';
import { validateDocument } from './schema';
import { ImportBatch } from './batch';
figma.showUI(__html__, { width: 460, height: 760, themeColors: true, title: 'HTML to Figma · Local' });
let active = false, cancelled = false, batch: ImportBatch | null = null, staging: FrameNode | null = null;
figma.on('close', () => { cancelled = true; batch?.cleanupOnClose(); if (staging && !staging.removed) staging.remove(); });
figma.ui.onmessage = async (message: any) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'READY') { figma.ui.postMessage({ type: 'SETTINGS', settings: await figma.clientStorage.getAsync('h2f-settings-v1') || {} }); return; }
  if (message.type === 'SETTINGS') { await figma.clientStorage.setAsync('h2f-settings-v1', { mode: message.settings?.mode === 'auto' ? 'auto' : 'visual', token: typeof message.settings?.token === 'string' ? message.settings.token.slice(0, 120) : '' }); return; }
  if (message.type === 'CANCEL') {
    cancelled = true; batch?.cancel();
    if (batch && !batch.processing) { const result = await batch.finish(); figma.ui.postMessage({ type: 'BATCH_COMPLETE', id: batch.id, result }); batch = null; active = false; }
    return;
  }
  if (message.type === 'BATCH_START' && !active) {
    try { batch = new ImportBatch(figma, message.id, message.plan, message.mode === 'auto' ? 'auto' : 'visual'); active = true; cancelled = false; figma.ui.postMessage({ type: 'BATCH_READY', id: batch.id }); }
    catch (error) { figma.ui.postMessage({ type: 'ERROR', message: String(error) }); }
    return;
  }
  if (message.type === 'IMPORT_PAGE' && batch && batch.id === message.id) {
    const current = batch;
    try {
      const result = await current.importPage(message.index, message.document, (done, total) => figma.ui.postMessage({ type: 'PAGE_PROGRESS', id: current.id, index: message.index, done, total }));
      figma.ui.postMessage({ type: 'PAGE_COMPLETE', id: current.id, index: message.index, result });
      if (current.cancelled || current.next === current.total) { const result = await current.finish(); figma.ui.postMessage({ type: 'BATCH_COMPLETE', id: current.id, result }); batch = null; active = false; }
    } catch (error) { figma.ui.postMessage({ type: 'ERROR', message: String(error) }); current.cancel(); current.cleanupOnClose(); batch = null; active = false; }
    return;
  }
  if (message.type !== 'IMPORT' || active) return;
  active = true; cancelled = false;
  try {
    validateDocument(message.document);
    const result = await importDocument(figma, message.document, { mode: message.mode === 'auto' ? 'auto' : 'visual', cancelled: () => cancelled, onStaging: node => { staging = node; }, progress: (done, total) => figma.ui.postMessage({ type: 'PROGRESS', done, total }) });
    figma.ui.postMessage({ type: 'COMPLETE', result }); figma.notify(`已导入 ${result.nodes} 个图层`);
  } catch (error) { figma.ui.postMessage({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) }); }
  finally { active = false; }
};

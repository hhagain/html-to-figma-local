import { importDocument } from './importer';
import { validateDocument } from './schema';
import { ImportBatch } from './batch';
figma.showUI(__html__, { width: 460, height: 760, themeColors: true, title: 'HTML to Figma · Local' });
let active = false, cancelled = false, batch: ImportBatch | null = null, staging: FrameNode | null = null;
const currentContext = () => ({ documentName: figma.root?.name || '当前 Figma 文件', pageName: figma.currentPage.name || '当前页面', pageId: figma.currentPage.id });
figma.on('currentpagechange', () => figma.ui.postMessage({ type: 'CONTEXT', context: currentContext() }));
figma.on('close', () => { cancelled = true; batch?.cleanupOnClose(); if (staging && !staging.removed) staging.remove(); });
figma.ui.onmessage = async (message: any) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'OPEN_DESKTOP_ASSISTANT_DOWNLOAD') { figma.openExternal('https://github.com/hhagain/html-to-figma-local/releases'); return; }
  if (message.type === 'READY') { figma.ui.postMessage({ type: 'SETTINGS', settings: await figma.clientStorage.getAsync('h2f-settings-v1') || {}, assistant: await figma.clientStorage.getAsync('h2f-assistant-v1') || null, context: currentContext() }); return; }
  if (message.type === 'ASSISTANT_SETTINGS') { const a=message.assistant; if(a && /^figma-[a-f0-9-]{16,100}$/.test(a.clientId) && /^[a-f0-9]{64}$/.test(a.credential) && /^http:\/\/127\.0\.0\.1:(384[7-9]|385[01])$/.test(a.serviceURL)) await figma.clientStorage.setAsync('h2f-assistant-v1', {clientId:a.clientId,credential:a.credential,serviceURL:a.serviceURL}); return; }
  if (message.type === 'SETTINGS') { await figma.clientStorage.setAsync('h2f-settings-v1', { mode: message.settings?.mode === 'auto' ? 'auto' : 'visual', smartLayout:message.settings?.smartLayout!==false,longPage:message.settings?.longPage!==false, token: typeof message.settings?.token === 'string' ? message.settings.token.slice(0, 120) : '' }); return; }
  if (message.type === 'CANCEL') {
    cancelled = true; batch?.cancel();
    if (batch && !batch.processing) { const result = await batch.finish(); figma.ui.postMessage({ type: 'BATCH_COMPLETE', id: batch.id, result }); batch = null; active = false; }
    return;
  }
  if (['IMPORT','BATCH_START'].includes(message.type) && message.expectedPageId && message.expectedPageId !== figma.currentPage.id) { figma.ui.postMessage({type:'ERROR',message:'目标 Figma 页面已变化，未执行导入，请从助手重新选择目标。'});return; }
  if (message.type === 'BATCH_START' && !active) {
    try { batch = new ImportBatch(figma, message.id, message.plan, message.mode === 'auto' ? 'auto' : 'visual', message.smartLayout!==false); active = true; cancelled = false; figma.ui.postMessage({ type: 'BATCH_READY', id: batch.id }); }
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

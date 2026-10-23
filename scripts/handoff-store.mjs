import { randomBytes } from 'node:crypto';
import { validateBundle } from '../dist/lib/bundle.js';

export function createHandoffStore({ now = Date.now } = {}) {
  const items = new Map(), receivers = new Map();
  const summary = item => ({ id: item.id, name: item.name, pages: item.pages, mode: item.mode, status: item.status, completed: item.completed, failed: item.failed, createdAt: item.createdAt, updatedAt: item.updatedAt, autoImport: !!item.target, target: item.target ? { id: item.target.id, documentName: item.target.documentName, pageName: item.target.pageName, pageId: item.target.pageId, contextVersion: item.target.contextVersion } : null, error: item.error });
  const prune = () => { for (const [id, item] of items) { if (now() - item.updatedAt > 30 * 60 * 1000) items.delete(id); else if (item.target && item.status === 'pending') { const receiver = receivers.get(item.target.receiver); if (!receiver || now() - receiver.seenAt >= 15000) { item.status = 'failed'; item.error = '目标 Figma 插件已断开，未执行导入'; item.bundle = null; } } } for (const [key, receiver] of receivers) if (now() - receiver.seenAt > 30*60*1000) receivers.delete(key); };
  const get = id => { prune(); const item = items.get(id); if (!item) throw new Error('传输结果已过期，请在助手中重新发送'); return item; };
  return {
    heartbeat(receiver, data) {
      if (!data || typeof data.documentName !== 'string' || data.documentName.length > 300 || typeof data.pageName !== 'string' || data.pageName.length > 300 || !/^[\w:-]{1,100}$/.test(data.pageId || '') || !/^[a-f0-9]{32}$/.test(data.contextVersion || '')) throw new Error('Figma 目标信息无效');
      let entry = receivers.get(receiver); if (!entry) { entry = { id: randomBytes(12).toString('hex'), receiver }; receivers.set(receiver, entry); }
      Object.assign(entry, { documentName: data.documentName, pageName: data.pageName, pageId: data.pageId, contextVersion: data.contextVersion, busy: data.busy === true, seenAt: now() });
      return { id: entry.id };
    },
    targets() { return [...receivers.values()].filter(r => now() - r.seenAt < 15000).map(({ receiver, seenAt, ...r }) => r); },
    publish(sender, input) {
      prune();
      if (!input || !/^[a-f0-9-]{16,80}$/.test(input.requestId || '')) throw new Error('发送标识无效');
      const existing = [...items.values()].find(item => item.sender === sender && item.requestId === input.requestId);
      if (existing) return summary(existing);
      let target = null;
      if (input.targetId) {
        const receiver = [...receivers.values()].find(r => r.id === input.targetId && now() - r.seenAt < 15000);
        if (!receiver) throw new Error('目标 Figma 插件未连接，请打开插件后重试');
        if (receiver.busy) throw new Error('目标 Figma 插件正在处理其他任务，请稍后重试');
        if (receiver.contextVersion !== input.targetContext) throw new Error('Figma 文件或页面已变化，请核对目标后重试');
        target = { ...receiver };
      }
      validateBundle(input.bundle);
      // A newer pending result replaces only this sender's previous unclaimed result.
      for (const item of items.values()) if (item.sender === sender && item.status === 'pending') { item.status = 'replaced'; item.bundle = null; }
      for (const [id, item] of items) if (items.size >= 6 && !['pending', 'received', 'importing'].includes(item.status)) items.delete(id);
      if ([...items.values()].filter(item => item.bundle).length >= 3) throw new Error('已有三批结果等待处理，请先在 Figma 中完成导入');
      const item = { id: randomBytes(12).toString('hex'), requestId: input.requestId, sender, receiver: null, target, bundle: input.bundle, name: input.bundle.name, pages: input.bundle.pages.length, mode: input.mode === 'auto' ? 'auto' : 'visual', status: 'pending', completed: 0, failed: 0, createdAt: now(), updatedAt: now() };
      items.set(item.id, item); return summary(item);
    },
    latest(receiver) { prune(); const item = [...items.values()].reverse().find(item => item.status === 'pending' && (!item.target || item.target.receiver === receiver)); return item ? summary(item) : null; },
    status(id) { return summary(get(id)); },
    claim(id, receiver, contextVersion) {
      const item = get(id);
      if (!['pending', 'received'].includes(item.status)) throw new Error('这批结果已开始或已完成导入，请在助手中重新发送');
      if (item.target) {
        if (item.target.receiver !== receiver) throw new Error('这批结果指定了另一个 Figma 窗口');
        if (item.target.contextVersion !== contextVersion) { item.status = 'failed'; item.error = '目标页面已变化，未执行导入'; item.bundle = null; throw new Error(item.error); }
      }
      if (item.receiver && item.receiver !== receiver) throw new Error('这批结果已由另一个 Figma 插件接收，请勿重复导入');
      if (!['pending', 'received'].includes(item.status)) throw new Error('这批结果已开始或已完成导入，请在助手中重新发送');
      item.receiver = receiver; item.status = 'received'; item.updatedAt = now();
      return { ...summary(item), bundle: item.bundle };
    },
    progress(id, receiver, input) {
      const item = get(id);
      if (item.receiver !== receiver) throw new Error('只有接收这批结果的插件可以更新导入状态');
      if (!['importing', 'complete', 'partial', 'cancelled', 'failed'].includes(input.status)) throw new Error('导入状态无效');
      const completed = Number(input.completed ?? item.completed), failed = Number(input.failed ?? item.failed);
      if (![completed, failed].every(n => Number.isInteger(n) && n >= 0 && n <= item.pages) || completed + failed > item.pages) throw new Error('导入数量无效');
      if (input.status === 'complete' && (completed !== item.pages || failed)) throw new Error('尚未全部导入，不能标记为完成');
      if (item.status === 'complete') return summary(item);
      item.status = input.status; item.completed = completed; item.failed = failed; item.updatedAt = now();
      if (input.status === 'complete') item.bundle = null;
      return summary(item);
    },
    close() { items.clear(); receivers.clear(); },
  };
}

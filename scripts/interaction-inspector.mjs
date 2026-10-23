import { createHash } from 'node:crypto';

// This function runs inside the isolated page. Source text never becomes executable recipes.
export function inspectInteractiveDOM({ local = false } = {}) {
  const visible = el => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none' || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let node = el.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS' && !node.open && !node.querySelector(':scope > summary')?.contains(el)) return false;
    return true;
  };
  const text = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 90);
  const selector = el => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const peers = [...(node.parentElement?.children || [])].filter(p => p.tagName === node.tagName);
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (peers.indexOf(node) + 1) + ')');
    }
    return parts.join(' > ');
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open],[aria-modal="true"]')].filter(visible);
  const scope = dialogs.at(-1) || document.body;
  const heading = text(scope.querySelector('h1,h2,[role="heading"]') || scope).slice(0, 70);
  const controls = [...scope.querySelectorAll('button,a[href],summary,[role="button"],[role="tab"],input,select,textarea,[data-action],[onclick]')].filter(visible);
  const candidates = [], skipped = [], families = new Map();
  const add = candidate => {
    const count = families.get(candidate.family) || 0;
    if (count >= (candidate.sampleLimit || 2)) { skipped.push({ name: candidate.name, reason: '同类控件仅取代表样本' }); return; }
    families.set(candidate.family, count + 1); candidates.push(candidate);
  };
  const unsafe = /删除|清空|注销|重置|退出登录|支付|确认购买|确认提交|确认保存|转账成功|恢复备份|启用授权|允许.*麦克风|授权|\b(?:delete|remove|destroy|clear|reset|logout|signout|checkout|purchase|confirm|commit|consent|grant)\b/i;
  const device = /麦克风|录音|语音输入|语音录入|上传|下载|导出|拍照|选择文件|\b(?:voice|microphone|camera|upload|download|export|backup|restore)\b/i;
  const close = /^(返回|关闭|关闭面板|取消|取消操作|上一页|下一页|back|close|cancel)$/i;
  for (const el of controls) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const css = selector(el); if (!css || css.length > 650) continue;
    const name = text(el) || el.getAttribute('name') || el.id || el.tagName.toLowerCase();
    const action = el.getAttribute('data-action') || '', role = el.getAttribute('role') || '';
    const description = name + ' ' + action + ' ' + (el.getAttribute('href') || '');
    if (el.type === 'file' || el.type === 'password' || el.hasAttribute('download') || device.test(description)) { skipped.push({ name, reason: '文件、设备权限或账号敏感控件' }); continue; }
    if (unsafe.test(description)) { skipped.push({ name, reason: '可能产生提交、删除或授权效果' }); continue; }
    if (close.test(name)) continue;
    if (el.tagName === 'SELECT') {
      const options = [...el.options].filter(o => !o.disabled && o.value !== el.value).slice(0, 2);
      for (const option of options) add({ name: name + '：' + option.text.slice(0, 30), kind: '选择', family: 'select:' + css, key: 'select:' + css + ':' + option.value, steps: [{ type: 'select', selector: css, value: option.value }] });
      continue;
    }
    if (el.matches('input[type=checkbox],input[type=radio]')) {
      if (el.type === 'radio' && el.checked) continue;
      add({ name, kind: '选择', family: 'check:' + css, key: 'check:' + css, steps: [{ type: 'check', selector: css, checked: !el.checked }] }); continue;
    }
    if (el.matches('input,textarea')) continue; // Filled together as one representative form state below.
    const isSubmit = (el.tagName === 'BUTTON' && el.type === 'submit' && el.form) || /^(保存|提交|确认|发送|save|submit|send)$/i.test(name);
    if (isSubmit) {
      const form = el.form || el.closest('form');
      const empty = form && [...form.querySelectorAll('[required]')].some(field => !field.value && visible(field));
      if (local && empty && !/登录|密码|支付|购买|login|password/i.test(description)) {
        add({ name: '必填项校验', kind: '校验', family: 'validation:' + selector(form), key: 'validation:' + selector(form), steps: [{ type: 'click', selector: css }] });
      } else skipped.push({ name, reason: '不自动提交已填写表单或远程表单' });
      continue;
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (!href || /^(?:javascript:|mailto:|tel:|data:|blob:)/i.test(href) || /\.(?:pdf|zip|png|jpe?g|svg|json|csv)(?:$|[?#])/i.test(href)) continue;
      let url; try { url = new URL(href, document.baseURI); } catch { continue; }
      if (url.origin !== location.origin) { skipped.push({ name, reason: '跨站页面' }); continue; }
      if (href.startsWith('#') && !/^#!?\//.test(href) && !el.hasAttribute('data-action') && role !== 'tab') continue;
    }
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page') continue;
    const family = role === 'tab' ? 'tab:' + name : action || (el.tagName === 'A' ? 'link:' + name : css.replace(/:nth-of-type\(\d+\)/g, ''));
    const key = 'click:' + (action ? action + ':' + (el.getAttribute('data-id') || name) : css);
    const kind = role === 'tab' || el.closest('nav,[role=navigation]') ? '导航' : dialogs.length ? '弹窗操作' : /详情|查看|明细/.test(name) ? '详情' : '交互';
    const steps = [{ type: 'click', selector: css }];
    if (el.hasAttribute('aria-selected')) steps.push({ type: 'wait', selector: css + '[aria-selected="true"]' });
    add({ name, kind, family, key, steps, global: role === 'tab' || !!el.closest('header,footer'), priority: role === 'tab' ? 0 : /设置|添加|新增|详情|筛选|展开|编辑|分析|手动|记一笔/.test(name) ? 1 : /prev|next|period|month/.test(action) ? 4 : 2 });
  }
  for (const form of scope.querySelectorAll('form')) {
    const fields = [...form.querySelectorAll('input,textarea')].filter(el => visible(el) && !el.disabled && !el.readOnly && !['hidden','file','password','checkbox','radio','submit','button'].includes(el.type));
    if (!fields.length || fields.some(el => /账号|密码|登录|login|password/i.test((el.name || '') + (el.getAttribute('placeholder') || '')))) continue;
    const steps = [];
    for (const field of fields.slice(0, 6)) {
      if (field.value) continue;
      const hint = (field.name || '') + (field.getAttribute('inputmode') || '');
      const value = field.type === 'email' ? 'preview@example.test' : field.type === 'date' ? field.min || '2026-01-01' : field.type === 'number' || /amount|price|money|decimal|number/i.test(hint) ? field.min || '12.50' : '示例内容';
      const css = selector(field); if (css.length < 650) steps.push({ type: 'fill', selector: css, value });
    }
    if (steps.length) add({ name: '填写示例（未提交）', kind: '表单', family: 'fill:' + selector(form), key: 'fill:' + selector(form), steps, priority: 2 });
  }
  const signatureParts = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
  let el = scope, count = 0;
  while (el && count++ < 12000) {
    if (visible(el) && !el.matches('script,style,link,meta')) {
      const ownText = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim().replace(/\s+/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '<time>');
      if (ownText || el.matches('input,select,textarea,button,[role=tab]')) signatureParts.push([el.tagName, ownText.slice(0, 300), el.matches('input,select,textarea') ? el.type === 'password' ? '<password>' : el.value : '', el.checked || '', el.getAttribute('aria-selected') || '', el.getAttribute('aria-expanded') || ''].join('|'));
    }
    el = walker.nextNode();
  }
  // Top/bottom samples expose clipped scroll content without enumerating every pixel.
  const scrollables = [...scope.querySelectorAll('*')].filter(el => visible(el) && el.clientHeight > 100 && el.scrollHeight > el.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(el).overflowY)).slice(0, 2);
  for (const el of scrollables) {
    const css = selector(el);
    if (el.scrollTop < el.scrollHeight - el.clientHeight - 40 && css.length < 650) add({ name: '下半部分', kind: '滚动', family: 'scroll:' + css, key: 'scroll:' + css, steps: [{ type: 'scroll', selector: css, y: el.scrollHeight - el.clientHeight }], priority: 5 });
    signatureParts.push('scroll:' + css + ':' + Math.round(el.scrollTop / 20));
  }
  candidates.sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
  return { title: document.title.slice(0, 100), heading, dialog: dialogs.length > 0, signature: signatureParts.join('\n'), candidates: candidates.slice(0, 45), skipped: [...skipped, ...(candidates.length > 45 ? [{ name: '控件数量', reason: '每个状态最多探索 45 个候选动作' }] : [])] };
}
export async function inspectState(page, local) {
  const state = await page.evaluate(inspectInteractiveDOM, { local });
  return { ...state, fingerprint: createHash('sha256').update(state.signature).digest('hex') };
}

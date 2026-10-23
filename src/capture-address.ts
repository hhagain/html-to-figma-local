/** Accept copied macOS/Windows paths and browser URLs, preserving route suffixes. */
export function normalizeCaptureAddress(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请输入网页地址或本地 HTML 路径');
  let value = input.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  if (/^Users\//.test(value)) value = '/' + value;
  const windowsPath = /^[a-z]:[\\/]/i.test(value);
  if (windowsPath || (value.startsWith('/') && !value.startsWith('//'))) {
    if (windowsPath) value = value.replace(/\\/g, '/');
    const parts = value.match(/^(.+?\.html?)([?#].*)?$/i);
    if (!parts) throw new Error('本地路径需要指向 .html 或 .htm 文件');
    if (/%(?:2f|5c|00)/i.test(parts[1])) throw new Error('本地路径包含无效的编码分隔符');
    let pathname;
    try { pathname = decodeURIComponent(parts[1].replace(/%(?![\da-f]{2})/gi, '%25')); }
    catch { throw new Error('本地路径的百分号编码无效'); }
    if (windowsPath) {
      if (pathname.slice(2).includes(':')) throw new Error('不支持 Windows 设备路径或备用数据流');
      value = 'file:///' + pathname.slice(0,2).toUpperCase() + pathname.slice(2).split('/').map(encodeURIComponent).join('/') + (parts[2] || '');
    } else value = 'file://' + pathname.split('/').map(encodeURIComponent).join('/') + (parts[2] || '');
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入 http / https 地址，或 C:\\…\\index.html、/Users/…/index.html 本地路径'); }
  if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持网页地址和本地 HTML 路径，不能包含账号密码');
  return url.href;
}

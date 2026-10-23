import { normalizeCaptureAddress } from '../dist/lib/capture-address.js';
import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mime = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
export function safeLocalRelative(relative, { filesystem = false, windows = process.platform === 'win32' } = {}) {
  if (relative.includes('\0') || (relative.includes('\\') && !(windows && filesystem))) return false;
  const parts = windows && filesystem ? relative.split(/[\\/]/) : relative.split('/');
  return parts.every(part => !part.startsWith('.') && (!windows ||
    (!part.includes(':') && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))));
}
const safeRelative = (relative, filesystem = false) => safeLocalRelative(relative, { filesystem });

export function validateCaptureURL(value) {
  const url = new URL(normalizeCaptureAddress(value));
  if (url.href.length > 4096) throw new Error('URL 过长');
  if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password)
    throw new Error('只支持不含账号密码的 http、https 或 file:/// 本地 HTML 地址');
  if (url.protocol === 'file:') {
    let filename;
    try { filename = fileURLToPath(url); } catch { throw new Error('本地地址无效，请使用 file:/// 开头的本机文件地址'); }
    if (url.hostname || !path.isAbsolute(filename) || filename.includes('\0') || (process.platform !== 'win32' && filename.includes('\\')))
      throw new Error('只支持本机的 file:/// 文件地址');
    if (process.platform === 'win32' && !safeLocalRelative(filename.slice(path.parse(filename).root.length), { filesystem: true }))
      throw new Error('本地 Windows 文件或目录名不受支持');
    if (!/\.html?$/i.test(filename)) throw new Error('本地入口必须是 .html 或 .htm 文件');
    if (path.basename(filename).startsWith('.')) throw new Error('不能捕获隐藏文件');
    const canonical = pathToFileURL(filename); canonical.search = url.search; canonical.hash = url.hash;
    return canonical;
  }
  return url;
}

export function resolveStateURL(value, base) {
  const baseURL = validateCaptureURL(base);
  const target = baseURL.protocol === 'file:' && /^(?:\/|Users\/|[a-z]:[\\/])/i.test(value || '') ? normalizeCaptureAddress(value) : value || baseURL.href;
  const url = validateCaptureURL(new URL(target, baseURL).href);
  if (baseURL.protocol === 'file:') {
    const root = path.dirname(fileURLToPath(baseURL));
    if (url.protocol !== 'file:' || !inside(root, fileURLToPath(url)) || !safeRelative(path.relative(root, fileURLToPath(url)), true))
      throw new Error('本地状态地址必须位于入口 HTML 所在目录或其子目录中');
  } else if (url.protocol === 'file:' || url.origin !== baseURL.origin) {
    throw new Error('状态地址必须与入口同源且不含账号密码');
  }
  return url.href;
}

// A private origin exists only inside this capture's Playwright context. No HTTP
// listener or filesystem permission is exposed to another browser or website.
export async function openCaptureSource(value) {
  const original = validateCaptureURL(value);
  if (original.protocol !== 'file:') return {
    local: false, url: original.href, toBrowserURL: value => value, toSourceURL: value => value,
    read: async () => null,
  };
  const entry = fileURLToPath(original), root = path.dirname(entry);
  let realRoot;
  try {
    realRoot = await realpath(root);
    const realEntry = await realpath(entry);
    if (!inside(realRoot, realEntry)) throw new Error('本地入口不能通过符号链接指向目录外的文件');
    if (!(await stat(realEntry)).isFile()) throw new Error('本地入口必须是 HTML 文件');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('找不到本地 HTML 文件，请确认地址正确且文件仍在原位置');
    if (['EACCES', 'EPERM'].includes(error.code)) throw new Error('无法读取本地 HTML，请检查文件和目录的访问权限');
    throw error;
  }
  const origin = `http://h2f-${randomBytes(16).toString('hex')}.localhost`;
  const toBrowserURL = value => {
    const url = new URL(resolveStateURL(value, original.href));
    const relative = path.relative(root, fileURLToPath(url));
    const mapped = new URL('/' + relative.split(path.sep).map(encodeURIComponent).join('/'), origin);
    mapped.search = url.search; mapped.hash = url.hash;
    return mapped.href;
  };
  const toSourceURL = value => {
    const url = new URL(value);
    if (url.origin !== origin) return url.href;
    const relative = decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(root, relative);
    if (!inside(root, target) || !safeRelative(relative)) return original.href;
    const source = pathToFileURL(target); source.search = url.search; source.hash = url.hash;
    return source.href;
  };
  const response = (status, contentType, body) => ({ status, contentType, body,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  const read = async value => {
    const url = new URL(value);
    if (url.origin !== origin) return null;
    try {
      const relative = decodeURIComponent(url.pathname.slice(1));
      const candidate = path.resolve(root, relative);
      if (!safeRelative(relative) || !inside(root, candidate)) return response(403, 'text/plain', 'Local resource is outside the capture directory');
      const target = await realpath(candidate);
      if (!inside(realRoot, target) || !safeRelative(path.relative(realRoot, target), true)) return response(403, 'text/plain', 'Local resource is outside the capture directory');
      const contentType = mime[path.extname(target).toLowerCase()];
      if (!contentType) return response(403, 'text/plain', 'Unsupported local resource type');
      const info = await stat(target);
      if (!info.isFile()) return response(404, 'text/plain', 'Local resource not found');
      if (info.size > 32 * 1024 * 1024) return response(413, 'text/plain', 'Local resource exceeds 32 MB');
      return response(200, contentType, await readFile(target));
    } catch (error) {
      return response(error.code === 'ENOENT' ? 404 : 403, 'text/plain', 'Local resource is missing or unreadable');
    }
  };
  const listPages = async (limit = 200) => {
    const files = [], directories = [{ directory: root, depth: 0 }]; let examined = 0, limited = false;
    while (directories.length && files.length < limit && examined < 3000) {
      const { directory, depth } = directories.shift();
      let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++examined > 3000) { limited = true; break; }
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory() && depth < 2) directories.push({ directory: filename, depth: depth + 1 });
        else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
          files.push(pathToFileURL(filename).href);
          if (files.length >= limit) { limited = true; break; }
        }
      }
    }
    return { files, limited };
  };
  return { local: true, url: toBrowserURL(original.href), origin, toBrowserURL, toSourceURL, read, listPages };
}

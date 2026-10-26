const { app, BrowserWindow, Menu, Tray, ipcMain, shell, clipboard, dialog, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { nativeCommand, trustedOrigin } = require('./policy.cjs');
const { assertPackagedDependencies, redactStartupError } = require('./runtime-check.cjs');

app.setName('HTML to Figma Capture');
app.setPath('userData', path.join(app.getPath('appData'), 'HTML to Figma Capture'));
const dataDirectory = app.getPath('userData');
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../artifacts/windows/staging');
const engineRoot = path.join(resources, 'engine');
let window, tray, child, serviceURL, serviceToken = '', quitting = false, stopping = false;
let crashCount = 0, lastReadyAt = 0, recoveryTimer;
const pendingPairIDs = new Set();
const logPath = path.join(dataDirectory,'logs','capture-service.log');
function logStartup(message) {
  try { fs.mkdirSync(path.dirname(logPath),{recursive:true}); if(fs.existsSync(logPath)&&fs.statSync(logPath).size>128*1024){fs.copyFileSync(logPath,logPath+'.previous');fs.writeFileSync(logPath,'');} fs.appendFileSync(logPath,new Date().toISOString()+' '+redactStartupError(message,[dataDirectory,resources,app.getPath('home')])+'\n'); } catch {}
}
const iconPath = path.join(app.isPackaged ? resources : __dirname, 'icon.ico');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => { createWindow(); createMenus(); startEngine(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true; clearTimeout(recoveryTimer);
    stopEngine().finally(() => { tray?.destroy(); app.quit(); });
  });
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function loading(title, detail) {
  if (!window || window.isDestroyed()) return;
  const html = `<meta charset="utf-8"><style>body{margin:0;background:#f5f7f5;font:14px/1.8 "Segoe UI","Microsoft YaHei",sans-serif;color:#284b38;display:grid;place-items:center;height:100vh}div{max-width:580px;padding:40px}</style><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(detail)}</p></div>`;
  window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
}
function openPage(pathname = '/desktop') {
  if (serviceURL && window && !window.isDestroyed()) window.loadURL(new URL(pathname, serviceURL).href).catch(() => {});
  showWindow();
}
function createWindow() {
  window = new BrowserWindow({ width: 1120, height: 820, minWidth: 840, minHeight: 650,
    title: 'HTML to Figma 捕获助手', icon: iconPath, backgroundColor: '#f5f7f5',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, partition: 'h2f-capture-session' } });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    if (trustedOrigin(url, serviceURL) || url === 'about:blank') return;
    event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.on('will-download', (event, item, source) => {
    if (source !== contents || !trustedOrigin(item.getURL().replace(/^blob:/, ''), serviceURL)) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ title: '保存捕获数据', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
  ipcMain.on('h2f:assistant', (event, payload) => {
    const command = nativeCommand(payload, { url: event.senderFrame?.url, serviceURL,
      mainFrame: event.sender === contents && event.senderFrame === contents.mainFrame, pendingPairIDs });
    if (!command) return;
    if (command.action === 'pair-approve' || command.action === 'pair-reject') {
      send({ type: 'pair-decision', id: command.id, approved: command.action === 'pair-approve' });
      pendingPairIDs.delete(command.id);
    } else if (command.action === 'open-workbench') openPage('/');
    else if (command.action === 'show-plugin') exportPlugin();
    else if (command.action === 'restart') restartEngine();
    else if (command.action === 'quit') app.quit();
    else if (command.action === 'copy-code' && serviceToken) clipboard.writeText(serviceToken);
  });
  loading('正在启动捕获助手', '正在准备内置浏览器和本地捕获服务。');
}
function createMenus() {
  const actions = [
    { label: '显示捕获助手', click: showWindow },
    { label: '助手首页', accelerator: 'Ctrl+1', click: () => openPage('/desktop') },
    { label: '捕获工作台', accelerator: 'Ctrl+2', click: () => openPage('/') },
    { label: '显示 Figma 插件', click: exportPlugin },
    { type: 'separator' },
    { label: '重新启动捕获服务', click: restartEngine },
    { label: '显示启动诊断日志', click: () => { logStartup('Diagnostic log requested'); if(fs.existsSync(logPath))shell.showItemInFolder(logPath);else dialog.showErrorBox('无法写入诊断日志','请检查应用数据目录的写入权限。'); } },
    { label: '退出捕获助手', accelerator: 'Ctrl+Q', click: () => app.quit() },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '助手', submenu: actions },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' },{ role: 'redo', label: '重做' },{ type: 'separator' },{ role: 'cut', label: '剪切' },{ role: 'copy', label: '复制' },{ role: 'paste', label: '粘贴' },{ role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ label: '重新加载', accelerator: 'Ctrl+R', click: () => window?.webContents.reload() }] },
    { label: '帮助', submenu: [{ label: '关于', click: () => dialog.showMessageBox(window, { title: 'HTML to Figma 捕获助手', message: `版本 ${app.getVersion()} · Windows x64`, detail: '内置运行环境与捕获浏览器。当前为未进行代码签名的开发预览版。' }) }] },
  ]));
  tray = new Tray(nativeImage.createFromPath(iconPath)); tray.setToolTip('HTML to Figma · 正在启动');
  tray.setContextMenu(Menu.buildFromTemplate(actions)); tray.on('double-click', showWindow);
}
function startEngine() {
  if (quitting || child) return;
  serviceURL = undefined; serviceToken = ''; pendingPairIDs.clear();
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    logStartup('Starting service; assistant '+app.getVersion()+'; architecture '+process.arch);
    assertPackagedDependencies(engineRoot);
    const runtime = JSON.parse(fs.readFileSync(path.join(resources, 'runtime.json'), 'utf8'));
    const browser = path.join(resources, 'browser', runtime.browserExecutable);
    if (!fs.existsSync(browser) || !fs.existsSync(path.join(engineRoot, 'scripts/desktop-service.mjs'))) throw new Error('应用内置环境不完整，请完整解压或重新安装。');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', H2F_CHROME_PATH: browser, H2F_DESKTOP: '1' };
    for (const key of ['NODE_OPTIONS','NODE_PATH','ELECTRON_NO_ASAR','ELECTRON_ENABLE_LOGGING','ELECTRON_ENABLE_STACK_DUMPING']) delete env[key];
    const current = spawn(process.execPath, [path.join(engineRoot, 'scripts/desktop-service.mjs'), '--data-dir', dataDirectory], {
      cwd: engineRoot, env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    child = current; let output = '', errorTail = '';
    current.stdout.setEncoding('utf8'); current.stderr.setEncoding('utf8');
    current.stdout.on('data', text => {
      output += text;
      if (output.length > 1024 * 1024) { output = ''; return; }
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0,newline); output = output.slice(newline+1);
        if (child !== current || !line.startsWith('H2F_EVENT ')) continue;
        try { handleEvent(JSON.parse(line.slice(10))); } catch { /* Ignore malformed service events. */ }
      }
    });
    current.stderr.on('data', text => { errorTail = (errorTail + text).slice(-3000); logStartup(text); });
    current.stdin.on('error', () => {});
    current.on('error', error => { logStartup('Spawn error: '+error.message); if (child === current) child = undefined; loading('捕获服务未启动', '无法启动内置运行环境。请从“助手”菜单打开启动诊断日志。'); });
    current.on('exit', code => {
      if (child !== current) return;
      child = undefined; serviceURL = undefined; serviceToken = ''; pendingPairIDs.clear();
      logStartup('Service exited: '+String(code));
      if (quitting || stopping) return;
      if (lastReadyAt && Date.now()-lastReadyAt > 30000) crashCount = 0;
      lastReadyAt = 0;
      if (++crashCount <= 2) { loading('正在恢复捕获服务', '服务意外退出，助手正在重新启动。'); recoveryTimer = setTimeout(startEngine,1000); }
      else { tray?.setToolTip('HTML to Figma · 服务已停止'); loading('捕获服务已停止', `退出码：${code ?? '未知'}。请从“助手”菜单选择“显示启动诊断日志”。${errorTail ? '\n'+redactStartupError(errorTail,[dataDirectory,resources,app.getPath('home')]).slice(-700) : ''}`); }
    });
    const startupTimer = setTimeout(() => { if (child === current && !serviceURL) loading('启动时间较长', '可以从托盘菜单重新启动服务；请确认应用已完整解压。'); },18000);
    startupTimer.unref();
  } catch (error) { logStartup('Startup error: '+error.message); loading('捕获服务未启动', error.message+' 请从“助手”菜单查看启动诊断日志。'); }
}
function handleEvent(event) {
  if (event.type === 'ready') {
    if (!trustedOrigin(event.url,event.url) || !/^[a-f0-9]{64}$/.test(event.token || '')) return;
    serviceURL = event.url; serviceToken = event.token; lastReadyAt = Date.now(); tray?.setToolTip('HTML to Figma · 已就绪'); openPage('/desktop');
  } else if (event.type === 'pair-request' && typeof event.id === 'string') {
    pendingPairIDs.add(event.id); openPage('/desktop');
  } else if (event.type === 'activity') tray?.setToolTip(event.phase === 'capturing' ? 'HTML to Figma · 正在捕获' : 'HTML to Figma · 已就绪');
  else if (event.type === 'error') loading('捕获服务未启动', event.message || '请重新启动助手。');
}
function send(message) { if (child?.stdin.writable) child.stdin.write(JSON.stringify(message)+'\n'); }
async function stopEngine() {
  const current = child;
  if (!current || current.exitCode !== null) return;
  stopping = true;
  await new Promise(resolve => {
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => {
      if (current.exitCode === null) {
        const killer = spawn('taskkill.exe', ['/pid',String(current.pid),'/T','/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { current.kill(); finish(); }); killer.once('exit', finish);
      } else finish();
    },6000);
    current.once('exit',finish);
    if (current.stdin.writable) current.stdin.write('{"type":"shutdown"}\n'); else current.kill();
  });
  if (child === current) child = undefined;
  stopping = false;
}
async function restartEngine() {
  if (stopping || quitting) return;
  clearTimeout(recoveryTimer); crashCount = 0;
  loading('正在重新启动', '当前捕获会停止，已导入的 Figma 图层保留。');
  await stopEngine(); startEngine();
}
function exportPlugin() {
  try {
    const destination = path.join(dataDirectory,'Figma Plugin'), source = path.join(engineRoot,'figma-plugin');
    let preservedID;
    try { const previous = JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8')); if (/^[a-zA-Z0-9_-]{1,128}$/.test(previous.id || '')) preservedID = previous.id; } catch {}
    fs.mkdirSync(destination,{recursive:true});
    fs.cpSync(path.join(source,'dist'),path.join(destination,'dist'),{recursive:true});
    const manifest = JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
    if (preservedID) manifest.id = preservedID;
    fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    shell.showItemInFolder(path.join(destination,'manifest.json'));
  } catch (error) { dialog.showErrorBox('无法准备 Figma 插件',error.message); }
}

# Windows 捕获助手 v0.8.0

适用于 Windows 11 x64。Windows ARM64、Windows 10 和真实 Windows Figma 联调尚未验收。应用内置运行环境与 Chromium，使用者无需安装 Node.js、npm 或浏览器。

## 安装

1. 下载 `HTML-to-Figma-Capture-0.8.0-win-x64-Setup.exe` 并运行，按向导选择安装位置。默认按当前用户安装。
2. 或下载 `HTML-to-Figma-Capture-0.8.0-win-x64.zip`，完整解压后启动 `HTML to Figma Capture.exe`；不要只复制其中一个 EXE。
3. 打开应用，等待“捕获引擎已就绪”。本开发预览包未进行代码签名；Windows 可能显示未知发布者，请核对下载来源和 SHA-256。

## 连接 Figma

1. 在助手首页点击“显示 Figma 插件”，资源管理器会选中 `manifest.json`。
2. 在 Windows Figma 桌面端使用 Plugins → Development → Import plugin from manifest，选择该文件。
3. 运行插件，在“网页链接”中点击“连接桌面助手”，核对配对码并在助手首页允许连接。
4. 配对和导出的插件保存在 `%APPDATA%\HTML to Figma Capture`，更新应用时继续保留已有插件 ID。

## 捕获和导入

1. 打开捕获工作台，输入 `https://…`，或 `C:\Design Project\index.html#/dashboard`、`file:///C:/Design%20Project/index.html#/dashboard`。粘贴带引号的路径也可以。
2. 多状态选择“自动探索交互”，完成探索后勾选需要的状态并开始捕获，不需要预先编写 JSON。
3. 逐页检查预览，勾选页面并确认目标 Figma 文件/页面，然后点击“直接导入 Figma”。保持目标文件中的插件运行。
4. Ctrl + 滚轮缩放；按住空格并用鼠标左键拖拽；也可点击 100% 或适应窗口。预览操作不改变捕获尺寸。
5. 点击窗口关闭按钮后，捕获服务保留在系统托盘。双击托盘图标重新打开；从托盘菜单选择“退出捕获助手”才会停止后台。

支持本机盘符路径、中文和空格、query 与 hash 路由；不支持 UNC 网络共享、设备路径和备用数据流。本地资源限定在入口 HTML 所在目录内，指向目录外的符号链接会被拒绝。

## 开发与构建

在 Windows x64 构建机运行：

```powershell
npm ci
npx playwright install chromium
npm ci --prefix desktop/windows
npm run windows:package
npm run windows:smoke
node scripts/windows/checksums.mjs
```

GitHub Actions 工作流 `.github/workflows/windows-desktop.yml` 在 Windows runner 上执行回归、构建 NSIS 安装包与 ZIP、静默安装并验收真实 Electron 应用。输出位于 `artifacts/windows/`。

自动化验收包括内置服务、本地 HTML、交互探索、配对与插件导出、Ctrl 滚轮、空格拖拽、直接传输、关闭到托盘、重启与退出。导入接收端使用测试宿主，不把这项测试描述为真实 Windows Figma 文件验收。

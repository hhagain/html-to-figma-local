# 桌面助手 v0.5.1 多页预览验证

日期：2026-10-22。平台：Apple Silicon，macOS 15.5。

- 类型检查与最终回归全部通过，65 项测试，0 失败。
- 验证每个成功页都有独立 JPEG，失败状态不造成预览索引错位；取消保留已完成页的截图。
- 预览接口要求鉴权，任务淘汰后返回过期提示；临时存储覆盖第 0–199 页并在清理时移除。
- UI 验证上一页、下一页、下拉选页、左侧预览按钮、缓存命中、快速切换、失败重试和源地址变更后的失效；切换预览不改变导入勾选。
- 包内 Node/Chromium 测试通过，包括第二张图片接口返回与首图不同的数据。
- 用户实际本地页面在新包中自动发现并捕获 4/4。分别切换看板、明细、买不买、资产，页面名称、计数和图片一一对应。
- 已安装的 /Applications/HTML to Figma Capture.app 显示 v0.5.1；通过 Computer Use 在真实助手窗口逐个点击下一页，确认从 1/4 到 4/4，最后显示资产页，下一页禁用。
- 已同步导出插件。未新增 Figma 画布图层。

证据：`artifacts/test-0.5.1.log`、`artifacts/multi-page-preview.png`、`artifacts/desktop/preview-validation.json`、`preview-page-1.png` 至 `preview-page-4.png`、`preview-switcher-0.5.1.png`、`engine-smoke.json`。

旧版任务只有首图，需升级后重新捕获；预览随本机服务会话保存，不写入导出的图层 JSON。

---

# 桌面助手 v0.5.0 验证

日期：2026-10-22。平台：Apple Silicon，macOS 15.5。

## 自动发现与路径简写

- 最终完整回归 60 项测试通过，包含导航发现、跨站过滤、危险控件跳过、写请求阻止、路径归一化、候选去重、取消、200 页上限、UI 勾选与旧清单兼容性。
- 自动化界面测试：发现 5 页，只勾选 2 页后捕获结果为 2/2；清空时不能开始捕获，更换路径后旧发现与捕获结果失效。
- 用户的 Open Design 文件使用 `Users/huanghu/…/index.html#/dashboard` 简写路径，自动发现“看板、明细、买不买、资产”4 页。无需用户导入 JSON，生成的捕获任务成功 4/4，原文件 SHA-256 未改变。
- 真实 Figma 桌面端使用已安装助手：发现 4 页，取消勾选“资产”后显示“开始捕获（3 页）”，实际捕获成功 3/3、失败 0，得到 1145 图层、332 文字、73 SVG。
- 本次 Figma 联调保留在可导入状态，没有向既有设计新增测试图层。
- 包内运行验证通过：HTTP / file 单页与多状态、裸路径输入、自动发现接口、配对和图标素材均正常；PATH 只含系统目录，不依赖用户安装的 Node 或 Chrome。
- `/Applications/HTML to Figma Capture.app` 已更新至 0.5.0；旧 0.4.0 应用移至项目 `.cache/installed-app-backup-1792662010795/` 保留，应用数据与配对保持不变。

## 本次证据

`artifacts/test-0.5.0.log`、`artifacts/discovery-ui.png`、`artifacts/desktop/engine-smoke.json`、`artifacts/desktop/discovery-local-result.json`、`artifacts/desktop/discovery-local.h2f.json`、`artifacts/desktop/discovery-local.report.json`、`artifacts/desktop/figma-discovery-0.5.0.txt`。

发现最多返回 200 页，但初次只检查最多 30 页、两层导航、约 60 秒；页面显示是否已验证，未检查候选在捕获时处理。复杂弹窗、输入组合、权限和登录态不属于自动穷举范围。

---

# 桌面助手 v0.4.1 验证

日期：2026-10-22。平台：Apple Silicon，macOS 15.5。

## 本次验证

- 插件类型检查、构建通过；53 项回归测试全部通过。
- 新增 8 项本地来源测试，覆盖编码空格、中文、百分号和井号路径、query/hash、模块脚本、CSS、图片、JSON、多状态快照、独立会话、取消、缺失文件、隐藏文件和符号链接越界。
- 包内 Node / Chromium 在仅含系统目录的 PATH 下验证：HTTP 单页、HTTP 2 状态、file 单页、file 2 状态均成功；配对与凭据哈希持久化正常。
- 用户提供的 Open Design 本地入口在包内引擎中成功捕获：1440×900，202 节点，58 文字，11 SVG，0 缺失资源。四个 hash 主路由捕获 4/4，0 失败。
- 捕获前后原始 HTML 的 SHA-256 一致。
- 真实 Figma 桌面端重新启动开发插件后显示 v0.4.1，自动恢复桌面助手连接。粘贴用户原始 file URL 后显示“已准备好”，与包内捕获的 202 / 58 / 11 统计一致。
- 本次 Figma 验证停在导入前的就绪状态，没有向已有设计新增测试图层；图层导入能力由既有回归测试覆盖。
- 新 H 图标已在原生助手首页可见。应用图标使用转换后的 ICNS，菜单栏 PNG 与用户素材字节一致，首页内嵌同一素材。
- “显示 Figma 插件”导出后，ui.html 与 code.js 和构建文件逐字节一致，保留已分配的插件 ID。
- 重启前工作台现有的 67 页结果已另存到 `artifacts/desktop/pre-update-backup/`，不进入分发包。

## 本次证据

- `artifacts/test-0.4.1.log`
- `artifacts/desktop/build-info.json`、`engine-smoke.json`
- `artifacts/desktop/local-file-validation.json`、`local-dashboard.jpg`
- `artifacts/desktop/local-main-pages.h2f.json`、`local-main-pages.report.json`
- `artifacts/desktop/figma-local-file-0.4.1.txt`

本地页面仍有原转换器的效果限制：手机边框的伪元素、打孔的部分背景及 CSS 变换会给出转换说明。这些与 file 地址的加载修复无关。独立捕获不会继承 Open Design 预览的 localStorage 或登录状态。

---

# 桌面助手 v0.4.0 验证

日期：2026-10-22。平台：Apple Silicon，macOS 15.5。

## 自动化与包内运行

- 插件类型检查和构建通过。
- 完整回归：45 项测试通过，包括配对批准/拒绝/过期、凭据哈希持久化、重启后识别、HTTP 鉴权和已有捕获/导入能力。
- 使用应用包内的 Node v24.19.0 和 Chromium Headless Shell 145.0.7632.6，在 PATH 仅包含系统目录的条件下运行。
- 单页捕获成功：22 个节点、0 缺失图片。
- 多状态捕获成功：2 / 2 状态。
- 包内运行不依赖系统 Node、npm、Homebrew 或用户已安装的 Chrome。
- 应用签名验证通过：ad-hoc 签名；没有 Developer ID 签名或公证。

## 真实桌面与 Figma 联调

1. 原生助手窗口打开并显示“捕获引擎已就绪”。
2. 旧命令行服务占用 3847 时，助手自动使用 3848。
3. Figma 插件自动发现助手，显示六位配对码；助手首页显示相同码。
4. 在助手中允许后，Figma 显示“桌面助手已连接”。
5. 从 Figma 发起对助手内置示例网页的捕获，返回 1440×1082、106 个节点、41 段文字、1 张图片、2 个 SVG。
6. 重启助手服务，再关闭并重新运行 Figma 插件，自动恢复连接，没有再次要求配对。
7. 关闭助手窗口后，发现接口仍可访问；重新显示窗口正常。
8. 点击“显示 Figma 插件”后生成独立安装目录；manifest、code.js 和 ui.html 与应用包内容逐字节一致。
9. 点击“退出助手”后，本次服务端口停止响应。包内引擎测试还验证了捕获浏览器的正常关闭。

真实联调只解析捕获结果，没有向用户既有设计中新增测试 Frame。

## 证据

`artifacts/desktop/` 中保留 `build-info.json`、`engine-smoke.json`、`assistant-home.png`、`figma-desktop-capture.txt` 和 `figma-autoreconnect.txt`。安装包不包含用户的配对数据或测试截图。

## 限制

- 当前只交付 arm64 版本；Intel Mac 和 Windows 未实现。
- 声明支持 macOS 14+，实际测试机为 macOS 15.5；没有逐个 macOS 版本验证。
- 未经过 Apple Developer ID 公证；陌生设备上的首次打开流程需要用户处理系统确认。
- 首次仍需在 Figma 中加载开发插件并允许配对一次；没有自动接管 Figma 安装流程。
- 不继承用户日常浏览器登录状态，多状态捕获仍遵循清单及网络写请求限制。

## v0.6.0 交互与渐变验证

- 完整回归：73 项通过。新增像素/百分比渐变、双位置色标、边缘插值、渐变文字、缩放字体、交互探索、取消、状态变化拒绝及无 JSON 的界面操作测试。
- 实际 Open Design 原型的一轮限定探索：120 个不同状态、159 次尝试、0 操作失败；达到本次 120 状态上限时仍有 620 个候选动作未探索。对这 120 个状态逐一重放捕获，120/120 成功，0 失败，总计 27531 个图层。原始文件的探索前后哈希一致。
- 这些数字只代表该轮与该文件版本，不表示全覆盖。源文件后续被继续编辑，重新探索后的数量可能不同。
- 包内环境验证成功，新增模块已包含在应用中。
- 真实 Figma 在独立 Page 2 中导入修复后的当前页面：212 图层，顶部背景已恢复蓝色渐变，导航渐变文字不再显示成矩形色块。原 Page 1 未改写。
- 尚有既有渲染边界：伪元素、部分背景效果和变换可能近似；不宣称与浏览器逐像素一致。

证据：`artifacts/test-0.6.0.log`、`artifacts/desktop/interaction-exploration.json`、`interaction-replay-report.json`、`interaction-sample.h2f.json`、`gradient-fixed.h2f.json`、`current-source-reference.jpg`。

## v0.7.0 桌面一键导入与预览手势

日期：2026-10-23。

- 全套回归 82 项通过；最终重复接收保护调整后，传输相关 5 项再次通过。
- 测试宿主加载真实编译插件与原导入代码：桌面勾选第 1、3 页，手动接收和桌面一键导入两种方式均只生成所选两页，并向桌面回传 2/2 完成。
- 目标心跳携带文件/页面与上下文版本，测试覆盖指定窗口、上下文变化、真实写入前 pageId 校验、重复接收已完成批次不改写完成状态。
- 预览测试覆盖 100%、10%–400% 上限、适应窗口、截图/静态 iframe、翻页保留缩放、Cmd + 滚轮、空格拖拽与输入框空格不被劫持。
- 实际 148 页数据通过包内服务往返传输：16,543,196 字节、38,401 节点，接收数据与原 bundle 完全一致。该测试未向真实 Figma 文件写入 148 页。
- 用户已有 148 页捕获数据、148 张 JPEG 及状态清单保存于 `artifacts/desktop/pre-update-0.7/`；含预览恢复文件为 `capture-148-pages-with-previews.h2f.json`。解锁后已在安装的 v0.7.0 助手中恢复全部 148 页及预览，当前勾选前两页。文件选择器加载的是相同内容的临时副本，原始备份保留。
- 真实 Figma 验收：在测试文件中创建独立页面 `H2F v0.7 · 桌面直导验收`，启动开发插件。在桌面助手点击“直接导入 Figma（2 页）”后，插件自动接收并导入，无需在 Figma 再点导入。
- 助手显示“已导入 Figma：2 / 2 页”，插件显示“本次完成 2 / 2 页，失败 0 页。每页已创建独立 Frame。”导入内容为 `001 · 交互探索 · 灵妙 AI 记账`、`002 · 交互探索 · 明细`。本次实机只导入这两页；148 页数据往返测试不能等同于真实 Figma 已导入全部 148 页。
- 原生助手中的“100%”和“适应窗口”均已点击并观察到对应缩放；最终预览回到适应窗口（本机窗口尺寸下为 35%）。
- Cmd + 滚轮、空格 + 左键拖拽已通过自动化测试。Computer Use 未能可靠地在滚动或拖拽期间保持修饰键；空格拖拽尝试出现了图片选择，未确认原生平移。因此两项标为“自动化通过，原生手势尚未可靠验证”，不能据此判定实机手势通过或存在产品缺陷。
- 最终应用仍位于 `/Applications/HTML to Figma Capture.app`，插件文件已同步，助手运行中，148 页恢复数据可继续使用。本次补验没有修改功能代码，也没有重新生成安装包。

证据：`artifacts/test-0.7.0.log`、`artifacts/handoff-final-tests.log`、`artifacts/preview-zoom-ui.png`、`artifacts/desktop/large-handoff-validation.json`、`artifacts/desktop/engine-smoke.json`、`artifacts/desktop/native-validation-0.7.0.json`、`artifacts/desktop/native-assistant-restored-0.7.0.txt`、`artifacts/desktop/native-assistant-handoff-0.7.0.png`。


## v0.9.0 大批次与取消验证

2026-10-27。Mac arm64 包内服务与浏览器测试通过，包括捕获、多页预览、发现、交互探索、配对、直传与保留插件身份；1000 页完整数据通过包内 HTTP 服务往返，完成回执为 1000/1000。Mac 受影响浏览器回归 46 项通过。

Windows x64 构建运行 40451014139 全套回归 106 项通过，EXE 安装版和便携 ZIP 在仓库之外验收成功。两个运行依赖的 175 项包内文件仍逐项校验。

1000 页真实浏览器解析与编译插件 Figma API 测试宿主导入通过，不能等同于真实 Figma 客户端已经导入任意 1000 页项目。内存、图层和资源预算继续生效。

独立复现并修复了新页面初始化阶段取消导致关闭等待卡住的竞争；不改变当前用户正在运行的旧助手或已有捕获数据。

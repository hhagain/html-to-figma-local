# 实现结构

```text
HTML 文件 / HTML 代码 ─→ 安全预览 iframe ─┐
                                       ├→ DOM 捕获 → 资源内嵌 → h2f.json
URL / 本地目录 ─→ 本地服务 + Chromium ───┘                       │
                                                              ↓
                                              校验 → 字体匹配 → 创建 Figma 图层
                                                              ↓
                                                   完成 / 警告 / 失败回滚
```

## 代码分工

| 文件 | 职责 |
|---|---|
| `src/schema.ts` | 版本化文档格式、有限值/大小/深度/资源引用验证、诊断统计 |
| `src/capture.ts` | DOM 和计算样式捕获、逐行文字测量、SVG 内联、资源收集和浏览器内嵌 |
| `src/importer.ts` | 字体加载、图片解码、Figma 图层创建、保守的 Auto Layout、取消和回滚 |
| `src/plugin.ts` | Figma Worker 消息入口、用户设置、进度和结果通知 |
| `src/ui.ts` | 文件/代码/URL 入口、预览、数据导出和导入控制 |
| `scripts/browser.mjs` | 独立 Chromium 捕获、跨域资源读取、预览生成与超时控制 |
| `scripts/server.mjs` | Loopback 服务、连接码认证、受限静态目录、捕获接口 |
| `scripts/capture.mjs` | 文件与 URL 的命令行入口 |
| `scripts/build.mjs` | 输出无外部脚本依赖的 Figma Worker 与 UI |

## 数据格式

`CaptureDocument` 包含 `schemaVersion`、来源视口、根节点、内嵌资源、诊断与统计。节点只使用三个种类：`frame`、`text`、`svg`；图片是 Frame 的填充，因此可以保留同一元素的圆角、背景和边框。

坐标相对父节点，尺寸来自浏览器测量。文本使用 DOM Range 逐字符测量后按视觉行分组，每个样式段独立保留。JSON 中没有可以执行的 JavaScript。

SVG 在捕获时复制计算样式并移除事件、脚本、foreignObject 和不支持的外部引用。PNG/JPEG/GIF 可直接内嵌，SVG 图片及其他能在浏览器解码的格式会尽可能转成 PNG。

## 导入事务

1. 在改变画布前校验文档格式与预算。
2. 获取 Figma 可用字体，缓存成功加载的候选。
3. 创建隐藏的临时容器，所有新节点先写入该容器。
4. 每 30 个节点让出一次事件循环，允许处理取消请求和更新进度。
5. 完成后把根节点移到当前页视口中心，选中并缩放到该节点。
6. 任一步骤失败或取消，删除本次创建的根和临时容器，恢复原选择。

图片解码或单个 SVG 转换失败属于可报告的降级；结构错误、无法加载任何可用字体或整体节点创建失败会回滚。

## 本地处理边界

- Figma 插件内的文件预览禁用脚本和事件处理器。由用户输入的 URL 在独立 Chromium 中运行，以支持动态页面。
- URL 捕获上下文不复用用户的登录态，不设置浏览器远程调试端口。
- API 仅监听 loopback，需要随机连接码，校验 Host；不提供任意路径读取或远程 shell 接口。
- 静态目录限制在启动时的 `--root`，校验真实路径以防止穿越和符号链接逃逸，并拒绝隐藏路径。
- JSON 导入在 Figma Worker 再次校验，不能只信任 UI 的校验结果。
- 产品不包含分析上报、账号或云端文件上传接口。目标网页及远程资源的网络请求仍会发生。

## 后续扩展优先级

先在真实 Figma 中完成不同字体、中文排版、SVG 和图片的视觉对照，再根据实际样例补齐：整段富文本、伪元素、复杂层叠、图片位置、更多 CSS 效果及更完整的响应式约束。登录网站的捕获需要单独设计浏览器扩展流程，当前版本未实现。


## v0.2.0：样式编译和批量导入

`src/tailwind.ts` 使用随包保留的官方 Tailwind 3.4.17 浏览器编译器。配置通过 Acorn 读取为字面量对象，不执行用户 JavaScript。编译器只在独立、不允许联网的 opaque-origin iframe 中处理类名和 CSS，再把静态 CSS 加入禁用脚本的预览。构建时使用函数形式的字符串替换，避免编译器源码里的 `$&` 等文本被替换器解释。

`src/bundle.ts` 负责页识别、共享图片去重、便携多页格式和批次预算。每页保留自己的节点树，图片字节只存在于共享资源表。去重使用指纹分桶并比较完整内容，避免仅凭短 hash 合并不同图片。

`src/batch.ts` 负责逐页导入、共享字体/图片缓存和布局安排。UI 通过 BATCH_START → BATCH_READY → IMPORT_PAGE → PAGE_COMPLETE → BATCH_COMPLETE 握手，每次只发送一页，避免把整批场景塞入一次消息。批次开始时固定目标 Figma Page；中途切换页面不会把剩余内容写到其他 Page。

每页都有独立事务，失败不删除其他页。关闭插件时清理当前未完成的 staging；取消后保留已完成页。当前会话内的继续导入会跳过成功页。多页完成后，大批量默认聚焦第一张完成的 Frame，避免缩放到数万像素的总画布后无法阅读。

桌面 Figma 会经过不同层级的 sandbox 回传消息。UI 使用标准 `window.onmessage` 入口，并拒绝来自自身预览/编译子 iframe 的消息；不再假设来源一定是直接父窗口。


## v0.2.1：Auto Layout 几何验证

`src/auto-layout.ts` 在原生 API 转换前后做两层检查：先用捕获数据判断简单 Flex 的几何能否映射，再核对 Figma 已创建子节点的实际尺寸。启用 `layoutMode` 后固定容器与子容器尺寸、设置间距/对齐/内边距，最后通过 `resizeWithoutConstraints` 恢复捕获宽高。

转换后直接子节点位置或宽高偏差超过 1.5 px 时，关闭该容器的自动布局并显式恢复原始尺寸、位置及顺序。原生 API 设置失败也走同一恢复路径；恢复失败则由上层单页事务回滚。直接文本子节点保留视觉布局，避免 Figma 字体度量触发不可预测的排版。


## v0.3.0：动态状态任务

`scripts/state-capture.mjs` 校验同源状态清单、创建逐状态隔离上下文、运行受限动作、捕获稳定 UI 并组合共享资源包。`captureLoadedPage` 同时供普通 URL 和状态任务使用。`/api/states` 创建异步任务，状态/结果/取消接口均使用本机连接码认证，避免长请求阻塞插件。任务进度和覆盖结果独立于 Figma 导入结果。

`source.state` 保留状态 ID、名称、分组和操作数量。快照模式额外记录入口 HTML 的 SHA-256 与抓取时间。页面脚本只在隔离捕获浏览器执行，Figma 中生成的内容不包含脚本。


## v0.4.0：桌面助手

原生壳位于 `desktop/src/main.m`，使用 AppKit 与 WKWebView。应用通过私有 stdin/stdout 管道启动和管理包内 Node 服务；网页不能直接批准配对。首页的配对按钮通过限定来源、主框架和请求 ID 的原生桥发送决定。

`scripts/desktop-pairing.mjs` 管理随机凭据、短时请求、确认状态和持久化哈希。`desktop-service.mjs` 负责端口选择与原生事件。插件使用 `src/desktop-connection.ts` 自动发现助手并校验已保存凭据。

构建脚本把 Node、Chromium Headless Shell、Playwright、引擎、示例、兼容插件与许可证复制到应用包。用户设备不依赖构建机路径、Homebrew 或全局 npm。

## 本地动态页面来源

`scripts/capture-source.mjs` 将 file URL 解析为入口目录与带随机标识的临时 localhost origin。Playwright 的 context route 直接读取并 fulfill 允许的资源，不启动文件服务器。读取前校验路径及 realpath，不允许隐藏文件、目录越界或符号链接逃逸。只在隔离上下文中执行页面脚本，资源读取复用于入口快照与图片内嵌。导出时将来源映射回 file URL。

## 页面发现与地址归一化

`src/capture-address.ts` 在 UI 与 Node 引擎共用，构建到 `dist/lib/capture-address.js`，处理原生路径和 file URL，避免前后端校验不一致。`scripts/discover-pages.mjs` 使用独立上下文检查导航，输出可重放的 state plan 和候选页面元数据。`/api/discover` 创建异步任务，沿用鉴权、互斥、查询和取消机制；结果由用户勾选后发送到原 `/api/states` 捕获流程。发现不会创建 Figma 图层。

## 多状态截图预览

`scripts/preview-store.mjs` 将每个成功页面的 JPEG 保存到权限受限的任务临时目录。结果 JSON 仅带预览索引与原有首图；`GET /api/states/:job/preview/:pageIndex` 通过同一凭据鉴权，返回单张图片。页面索引以成功导出的 bundle 顺序分配，跳过失败状态。任务淘汰及服务正常关闭时清理对应目录。

工作台独立管理预览页与导入勾选，保留最多三张缓存、用请求序号与 AbortController 避免晚返回覆盖，并在源数据变更时取消请求和释放对象 URL。

## 交互探索

`interaction-inspector.mjs` 读取可见控件、活动对话框及状态摘要；`explore-states.mjs` 在独立上下文中有界遍历并记录动作路径，用摘要去重。表单示例与校验优先检查，重复全局导航和同类列表项受限。报告的 exhaustive 始终为 false，状态重放通过 expectedFingerprint 再校验。

`gradient.ts` 独立解析 CSS 线性渐变，按布局盒而非变换后包围盒计算像素色标，裁切区间外色标并插值边缘。background-clip:text 的填充转移到原生文本图层，父容器不再绘制矩形背景。

## 桌面直传与预览缩放

`handoff-store.mjs` 保存有时限的本机捕获批次。`POST /api/handoffs` 接收校验后的 bundle，插件轮询 `/latest` 获取元数据，显式点击后 `/claim` 以凭据及窗口标识认领，再复用原单页/逐页导入逻辑。`/progress` 回传导入结果。重复请求复用批次，认领后禁止其他窗口导入；完成后释放场景数据。

大体积 JSON 按字节收集后统一 UTF-8 解码，避免中文字符跨网络分块损坏；请求上限 128 MB，仍受bundle 的 12 万节点及资产预算约束，不再按固定页数拒绝。预览截图不加入传输 bundle。

缩放管理独立于场景数据。截图按 naturalWidth / naturalHeight，静态 iframe 按原布局视口计算显示尺寸；适应窗口按可见宽高缩放，手动缩放只改变预览 DOM。

Figma 插件以独立窗口标识和 contextVersion 心跳注册目标；桌面直导请求绑定该窗口/上下文。服务认领和插件主线程在写入前再次校验 pageId。目标更新不会把旧请求投递到其他文件。手动发送仍需插件按钮确认。快捷缩放在鼠标锚点调整滚动位置，平移使用 pointer capture 并在释放、取消或失焦时清理。

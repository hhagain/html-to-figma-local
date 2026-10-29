# 动态网页 → 多个静态 Figma 状态

从 v0.5.0 起，普通页面可通过“自动发现页面 → 勾选 → 捕获”完成，不必准备 JSON。本文描述“状态清单（高级）”模式，适合复杂交互和精确覆盖。自动发现范围见 `AUTO-DISCOVERY.md`。

v0.3.0 新增“网页链接 → 多状态捕获”。浏览器执行状态清单中的操作，等待目标界面出现，再把可见页面转换为可编辑的 Figma 图层。每个状态生成一个独立 Frame。

## 示例：multi-app-admin

示例地址：`https://hhagain.github.io/multi-app-admin/`。

内置清单：`examples/multi-app-admin.states.json`，共 69 个代表性状态，覆盖登录、应用、用户、会员、订单、事件、后台账号、埋点查询和可视化查询构建器。示例账号是页面上公开的本地演示账号，未连接真实认证或业务服务。

1. 打开桌面捕获助手；开发者也可以手动运行 `npm run serve`。
2. 在插件或浏览器工作台中选择“网页链接”。
3. 将捕获方式设为“多状态捕获”。
4. 页面来源改为“状态清单（高级）”，点击“载入 multi-app-admin 示例”，或选择自己的 `.states.json`。
5. 桌面助手用户点击“连接桌面助手”，首次核对配对码并在助手中确认。手动命令行服务仍可通过“开发模式”填写连接码。
6. 点击“解析并预览”。界面显示当前状态名称、完成数和失败数。可以取消，已完成状态保留。
7. 检查页面列表与覆盖报告，选中需要的状态后导入 Figma。
8. 需要 `.fig` 时，在 Figma 桌面端使用 File → Save local copy 导出原生文件。

状态数据 `.h2f.json` 与原生 `.fig` 是两个不同产物。前者供插件导入，后者由 Figma 保存；不能把 JSON 改扩展名当作 `.fig`。

## 命令行

```bash
npm run capture:states -- --plan examples/multi-app-admin.states.json --output artifacts/admin-states
```

只重跑指定状态：

```bash
npm run capture:states -- --plan examples/multi-app-admin.states.json --only apps-list,app-detail,data-sql --output artifacts/admin-subset
```

输出 `states.h2f.json`、`coverage.json`、`COVERAGE.md` 和每个成功状态的 JPEG 预览。生成可筛选预览索引：

```bash
node scripts/state-gallery.mjs artifacts/admin-states
```

## 状态清单

```json
{
  "schemaVersion": 1,
  "name": "我的动态页面",
  "url": "http://127.0.0.1:3000/",
  "viewport": { "width": 1440, "height": 1000 },
  "selector": "body",
  "captureMode": "viewport",
  "setup": [],
  "states": [
    { "id": "list", "name": "默认列表", "group": "应用", "steps": [] },
    {
      "id": "detail",
      "name": "详情弹窗",
      "group": "应用",
      "steps": [
        { "type": "click", "selector": "#open-detail" },
        { "type": "wait", "selector": "#dialog", "state": "visible" }
      ]
    }
  ]
}
```

每个状态会创建新的浏览器上下文，打开入口或该状态的同源 `url`，运行公共 `setup`，再运行自身 `steps`。状态设置 `setup: false` 可跳过公共步骤，例如登录前页面。

支持的动作：

| type | 常用字段 | 用途 |
|---|---|---|
| click | selector、可选 index | 点击按钮、导航、Tab |
| fill | selector、value | 输入表单值 |
| select | selector、value | 选择原生 select 选项 |
| check | selector、checked | 复选框/单选项状态 |
| press | selector、value | 键盘操作，例如 Enter |
| hover | selector | 悬停状态 |
| scroll | selector、x、y | 指定可滚动容器的位置 |
| wait | selector、state、text、ms | 等待可见元素/文本或短暂过渡 |

选择器匹配多个元素时应提供明确的 `index`，避免误点击。不设固定的状态数、每状态步数或整批操作数上限；HTTP 清单请求保留 128 MB 传输预算，捕获数据仍受图层、资源和内存预算约束。清单不接受任意 JavaScript `evaluate`。

## 快照模式

`"snapshotDocument": true` 会在开始时下载入口 HTML，并把同一路径的导航固定为该源码；查询参数仍交给原页面 JavaScript 处理。报告保存源码 SHA-256 和获取时间。

只对已经确认“不同查询参数返回同一份 HTML”的静态原型启用。内置 GitHub Pages 示例已核验此条件。对按 URL 在服务端生成不同页面的网站不要启用此模式。

## 捕获与网络边界

- 每个状态独立会话，不使用现有 Chrome 的 Cookie、登录状态或浏览器资料。
- 当前模式默认只允许 GET、HEAD、OPTIONS，阻止网络写请求和跨站主导航。需要真实登录 POST、保存到服务器或跨域 OAuth 的网站暂不在该模式支持范围内。
- 示例的新增应用成功态只写独立上下文中的演示本地存储。删除、修改密码只捕获表单/确认界面，清单不执行最终提交。
- 默认捕获视口快照。滚动列表/抽屉只保留当前可见部分；要展示后半段，应增加滚动后状态。
- 可编辑文字、Frame、图片与 SVG 会保留；Canvas 为位图。Monaco 等编辑器的超大虚拟布局会裁剪到可见区域，零像素辅助 Canvas 不产生占位图片。
- 图层不包含事件处理、数据库连接、真实交互和动画时间线。固定状态可以在 Figma 中继续编辑，但不会自动生成可运行产品。

## “每个状态”的含义

状态数量由清单定义，不能自动证明覆盖了所有输入值、筛选组合、权限、错误和网络条件。建议按业务分支列出初始、填写中、校验失败、加载完成、空结果、详情、弹窗和完成反馈。每个状态需要明确的就绪条件，防止把加载占位当作最终页面。

覆盖报告会区分 complete、failed、cancelled 和 not-run，不会把捕获失败当作成功。输入相同但视觉重复的状态可能标记 duplicateOf，仍保留原状态名称以便追溯。

## 本地动态 HTML（v0.4.1）

清单的 `url` 可以使用完整 `file:///` 入口。每个状态的 `url` 可以是 `#/dashboard` 这样的 hash 路由，也可以是入口目录内的 `./other.html`；缺省时使用入口地址。`snapshotDocument: true` 同样适用于本地文件。

本地状态的边界按入口目录判断，不使用 file URL 共用的 `null` origin。入口目录外的文件与符号链接目标被阻止；单个失败状态会记录在报告里，其余状态继续捕获。单页、状态报告与导出数据保留原始 file 来源路径。每个状态仍使用独立会话；不会修改源 HTML，也不会继承 Open Design 预览的本地存储。

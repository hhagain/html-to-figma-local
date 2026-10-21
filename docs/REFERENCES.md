# 公开参考与实现边界

检查日期：2026-10-21。

1. https://github.com/wangwang762/html-to-figma
   - 参考浏览器捕获布局数据、再由 Figma 插件重建图层的工作流。
   - 本项目重新实现了版本化格式、图片资源、真实尺寸、文字测量、导入回滚和界面。没有复制该仓库源码。
2. https://neil.yoga/plugins/html-to-figma
   - 参考官网公开说明的本地 HTML / URL 输入、可编辑 Frame / Text / 图片，以及本地处理功能边界。
   - 未获取对方私有源码，未验证其具体转换算法，也未进行质量对照。
3. https://developers.figma.com/docs/plugins/manifest/
4. https://developers.figma.com/docs/plugins/how-plugins-run/
5. https://developers.figma.com/docs/plugins/api/figma/
   - Figma Plugin API 与 manifest 的官方接口依据。
6. https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle
7. https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect
   - 浏览器样式与文字测量接口依据。

Node 开发依赖精确版本记录在 `package-lock.json`。本项目是独立的本地开发版，不是任何参考产品的官方版本。


## 新增打包依赖

- Tailwind Play CDN 3.4.17：`https://cdn.tailwindcss.com/3.4.17`，原始文件保存在 `vendor/tailwind-play-3.4.17.js`，SHA-256 `176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15`。保留脚本原有声明与 `vendor/tailwind-LICENSE.txt`。
- Acorn：用于静态读取 Tailwind 配置，版本锁定在 package-lock.json；许可证保存在 `vendor/acorn-LICENSE.txt`。

离线编译只执行随包审核的编译器，不执行导入 HTML 中的脚本。

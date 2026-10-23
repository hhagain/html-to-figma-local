"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/schema.ts
  var SCHEMA_VERSION = 1;
  var LIMITS = { nodes: 6e3, depth: 64, text: 25e4, assets: 300, assetBytes: 24 * 1024 * 1024, dimension: 1e5 };
  function countScene(root) {
    let nodes = 0, texts = 0, images = 0, vectors = 0;
    const walk = (n) => {
      var _a;
      nodes++;
      texts += Number(n.kind === "text");
      vectors += Number(n.kind === "svg");
      images += n.fills.filter((p) => p.type === "image").length;
      (_a = n.children) == null ? void 0 : _a.forEach(walk);
    };
    walk(root);
    return { nodes, texts, images, vectors };
  }
  function addDiagnostic(list, code, message, node) {
    const match = list.find((d) => d.code === code && d.message === message);
    if (match) match.count = (match.count || 1) + 1;
    else if (list.length < 200) list.push({ code, message, node, count: 1 });
  }
  function validateDocument(input) {
    const fail = (s) => {
      throw new Error(`\u6355\u83B7\u6570\u636E\u65E0\u6548\uFF1A${s}`);
    };
    const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const number = (v, max = LIMITS.dimension, min = -max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
    const color = (v) => object(v) && ["r", "g", "b", "a"].every((k) => number(v[k], 1, 0));
    const tuple = (v, len, min = 0) => Array.isArray(v) && v.length === len && v.every((x) => number(x, LIMITS.dimension, min));
    if (!object(input) || input.schemaVersion !== SCHEMA_VERSION) fail("\u7248\u672C\u4E0D\u517C\u5BB9\uFF0C\u8BF7\u4F7F\u7528\u672C\u63D2\u4EF6\u751F\u6210\u7684 .h2f.json \u6587\u4EF6");
    const doc = input;
    if (typeof doc.name !== "string" || doc.name.length > 500) fail("\u540D\u79F0\u8FC7\u957F\u6216\u7F3A\u5931");
    if (!object(doc.source) || !object(doc.source.viewport) || !number(doc.source.viewport.width, LIMITS.dimension, 1) || !number(doc.source.viewport.height, LIMITS.dimension, 1) || typeof doc.source.url !== "string" || typeof doc.source.selector !== "string") fail("\u7F3A\u5C11\u9875\u9762\u4FE1\u606F");
    if (!Array.isArray(doc.assets) || doc.assets.length > LIMITS.assets) fail("\u8D44\u6E90\u6570\u91CF\u8D85\u9650");
    const ids = /* @__PURE__ */ new Set();
    let assetBytes = 0;
    for (const a of doc.assets) {
      if (!object(a) || typeof a.id !== "string" || ids.has(a.id) || typeof a.url !== "string") fail("\u8D44\u6E90 ID \u6216\u5730\u5740\u65E0\u6548");
      ids.add(a.id);
      if (a.base64 !== void 0) {
        if (typeof a.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64) || a.base64.length % 4 !== 0) fail("\u56FE\u7247\u7F16\u7801\u65E0\u6548");
        assetBytes += a.base64.length * 0.75;
        if (assetBytes > LIMITS.assetBytes) fail("\u56FE\u7247\u8D44\u6E90\u8D85\u8FC7 24 MB");
      }
    }
    if (!Array.isArray(doc.diagnostics) || doc.diagnostics.length > 200 || doc.diagnostics.some((d) => !object(d) || typeof d.code !== "string" || typeof d.message !== "string" || d.message.length > 2e3)) fail("\u8BCA\u65AD\u6570\u636E\u65E0\u6548");
    const nodeIds = /* @__PURE__ */ new Set();
    let nodes = 0, chars = 0;
    const walk = (n, depth) => {
      var _a;
      if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail("\u56FE\u5C42\u6570\u91CF\u6216\u5D4C\u5957\u6DF1\u5EA6\u8D85\u9650");
      if (!object(n) || !["frame", "text", "svg"].includes(n.kind) || typeof n.name !== "string" || n.name.length > 500 || typeof n.id !== "string" || nodeIds.has(n.id)) fail("\u56FE\u5C42\u7C7B\u578B\u3001\u540D\u79F0\u6216 ID \u65E0\u6548");
      nodeIds.add(n.id);
      if (!number(n.x) || !number(n.y) || !number(n.width, LIMITS.dimension, 0.01) || !number(n.height, LIMITS.dimension, 0.01) || !number(n.opacity, 1, 0)) fail(`\u56FE\u5C42\u5750\u6807\u6216\u5C3A\u5BF8\u65E0\u6548\uFF1A${n.name} [${n.x}, ${n.y}, ${n.width}, ${n.height}]`);
      if (!Array.isArray(n.fills) || n.fills.length > 20) fail("\u586B\u5145\u65E0\u6548");
      for (const p of n.fills) {
        if (!object(p)) fail("\u586B\u5145\u683C\u5F0F\u65E0\u6548");
        if (p.type === "solid") {
          if (!color(p.color)) fail("\u989C\u8272\u65E0\u6548");
        } else if (p.type === "image") {
          if (!ids.has(p.assetId) || !["FILL", "FIT", "TILE"].includes(p.fit)) fail("\u56FE\u7247\u5F15\u7528\u65E0\u6548");
        } else if (p.type === "linear") {
          if (!Array.isArray(p.stops) || p.stops.length < 2 || p.stops.length > 50 || p.stops.some((s) => !object(s) || !color(s.color) || !number(s.position, 1, 0))) fail("\u6E10\u53D8\u8272\u6807\u65E0\u6548");
          if (!Array.isArray(p.transform) || p.transform.length !== 2 || !p.transform.every((row) => tuple(row, 3, -LIMITS.dimension))) fail("\u6E10\u53D8\u77E9\u9635\u65E0\u6548");
        } else fail("\u4E0D\u652F\u6301\u7684\u586B\u5145\u7C7B\u578B");
      }
      if (n.radius !== void 0 && !tuple(n.radius, 4)) fail("\u5706\u89D2\u65E0\u6548");
      if (n.border !== void 0 && (!object(n.border) || !color(n.border.color) || !tuple(n.border.widths, 4))) fail("\u8FB9\u6846\u65E0\u6548");
      if (n.effects !== void 0 && (!Array.isArray(n.effects) || n.effects.length > 10 || n.effects.some((e) => !object(e) || !color(e.color) || !number(e.x) || !number(e.y) || !number(e.blur, LIMITS.dimension, 0) || !number(e.spread)))) fail("\u9634\u5F71\u65E0\u6548");
      if (n.layout !== void 0) {
        const l = n.layout;
        if (!object(l) || !["HORIZONTAL", "VERTICAL"].includes(l.direction) || !number(l.gap, LIMITS.dimension, 0) || !tuple(l.padding, 4) || !["MIN", "CENTER", "MAX", "SPACE_BETWEEN"].includes(l.main) || !["MIN", "CENTER", "MAX"].includes(l.cross) || typeof l.eligible !== "boolean") fail("\u5E03\u5C40\u65E0\u6548");
      }
      if (n.kind === "text") {
        const t = n.text;
        if (!object(t) || typeof t.value !== "string" || !Array.isArray(t.families) || t.families.length > 30 || t.families.some((f) => typeof f !== "string" || f.length > 200) || !number(t.size, 1e3, 0.01) || !number(t.weight, 1e3, 1) || !number(t.lineHeight, 1e4, 0.01) || !number(t.letterSpacing, 1e3) || !color(t.color) || !["NONE", "UNDERLINE", "STRIKETHROUGH"].includes(t.decoration)) fail("\u6587\u5B57\u6837\u5F0F\u65E0\u6548");
        chars += t.value.length;
        if (chars > LIMITS.text) fail("\u6587\u5B57\u603B\u91CF\u8D85\u9650");
      }
      if (n.kind === "svg" && (typeof n.svg !== "string" || n.svg.length > 2 * 1024 * 1024 || !/^\s*<svg[\s>]/i.test(n.svg))) fail("SVG \u65E0\u6548");
      if (n.children !== void 0 && !Array.isArray(n.children)) fail("\u5B50\u56FE\u5C42\u65E0\u6548");
      (_a = n.children) == null ? void 0 : _a.forEach((child) => walk(child, depth + 1));
    };
    walk(doc.root, 0);
  }

  // src/auto-layout.ts
  var TOLERANCE = 1.5;
  var near = (actual, expected) => Math.abs(actual - expected) <= TOLERANCE;
  function canApplyAutoLayout(spec) {
    const l = spec.layout, children = spec.children || [];
    if (!(l == null ? void 0 : l.eligible) || !children.length || children.some((child) => child.kind === "text")) return false;
    const horizontal = l.direction === "HORIZONTAL";
    const [top, right, bottom, left] = l.padding;
    const start = horizontal ? left : top, end = horizontal ? right : bottom;
    const size = horizontal ? spec.width : spec.height;
    const sum = children.reduce((n, c) => n + (horizontal ? c.width : c.height), 0);
    const free = size - start - end - sum;
    if (free < -0.5) return false;
    const gap = l.main === "SPACE_BETWEEN" && children.length > 1 ? free / (children.length - 1) : l.gap;
    const remaining = free - gap * Math.max(0, children.length - 1);
    let cursor = start + (l.main === "CENTER" ? remaining / 2 : l.main === "MAX" ? remaining : 0);
    for (const child of children) {
      if (!near(horizontal ? child.x : child.y, cursor)) return false;
      const crossSize = horizontal ? spec.height : spec.width, crossStart = horizontal ? top : left, crossEnd = horizontal ? bottom : right;
      const childCross = horizontal ? child.height : child.width;
      const expected = l.cross === "CENTER" ? crossStart + (crossSize - crossStart - crossEnd - childCross) / 2 : l.cross === "MAX" ? crossSize - crossEnd - childCross : crossStart;
      if (!near(horizontal ? child.y : child.x, expected)) return false;
      cursor += (horizontal ? child.width : child.height) + gap;
    }
    return true;
  }
  function geometryMatches(frame, spec) {
    var _a;
    return near(frame.width, spec.width) && near(frame.height, spec.height) && frame.children.length === ((_a = spec.children) == null ? void 0 : _a.length) && frame.children.every((node, i) => {
      const expected = spec.children[i];
      return near(node.x, expected.x) && near(node.y, expected.y) && near(node.width, expected.width) && near(node.height, expected.height);
    });
  }
  function applyAutoLayoutPreservingGeometry(frame, spec) {
    if (!canApplyAutoLayout(spec) || !geometryMatches(frame, spec) || frame.children.some((child) => child.type !== "FRAME")) return "skipped";
    const layout = spec.layout;
    const before = {
      width: frame.width,
      height: frame.height,
      clip: frame.clipsContent,
      children: frame.children.map((node) => ({ node, x: node.x, y: node.y, width: node.width, height: node.height, primary: node.primaryAxisSizingMode, counter: node.counterAxisSizingMode }))
    };
    const restore = () => {
      frame.layoutMode = "NONE";
      frame.resizeWithoutConstraints(before.width, before.height);
      frame.clipsContent = before.clip;
      before.children.forEach((saved, i) => {
        if (frame.children[i] !== saved.node) frame.insertChild(i, saved.node);
        if (saved.node.layoutMode && saved.node.layoutMode !== "NONE") {
          saved.node.primaryAxisSizingMode = saved.primary;
          saved.node.counterAxisSizingMode = saved.counter;
        }
        saved.node.resizeWithoutConstraints(saved.width, saved.height);
        saved.node.x = saved.x;
        saved.node.y = saved.y;
      });
    };
    try {
      frame.layoutMode = layout.direction;
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "FIXED";
      frame.layoutWrap = "NO_WRAP";
      frame.strokesIncludedInLayout = false;
      [frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft] = layout.padding;
      frame.itemSpacing = layout.gap;
      frame.primaryAxisAlignItems = layout.main;
      frame.counterAxisAlignItems = layout.cross;
      for (const saved of before.children) {
        saved.node.layoutGrow = 0;
        saved.node.layoutAlign = "INHERIT";
        saved.node.layoutSizingHorizontal = "FIXED";
        saved.node.layoutSizingVertical = "FIXED";
        saved.node.resizeWithoutConstraints(saved.width, saved.height);
      }
      frame.resizeWithoutConstraints(before.width, before.height);
      frame.clipsContent = before.clip;
      if (geometryMatches(frame, spec)) return "applied";
    } catch (e) {
    }
    restore();
    return "reverted";
  }

  // src/importer.ts
  function createImportContext(api) {
    return { fonts: api.listAvailableFontsAsync(), fontCache: /* @__PURE__ */ new Map(), loaded: /* @__PURE__ */ new Set(), imageHashes: /* @__PURE__ */ new Map() };
  }
  var rgb = (c) => ({ r: c.r, g: c.g, b: c.b });
  var weightOf = (style) => {
    const s = style.toLowerCase().replace(/[ -]/g, "");
    if (/thin/.test(s)) return 100;
    if (/extralight|ultralight/.test(s)) return 200;
    if (/light/.test(s)) return 300;
    if (/medium/.test(s)) return 500;
    if (/semibold|demibold/.test(s)) return 600;
    if (/extrabold|ultrabold/.test(s)) return 800;
    if (/black|heavy/.test(s)) return 900;
    if (/bold/.test(s)) return 700;
    return 400;
  };
  async function importDocument(api, document, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    validateDocument(document);
    const diagnostics = document.diagnostics.map((d) => __spreadValues({}, d));
    const warn = (code, message, node) => addDiagnostic(diagnostics, code, message, node);
    const check = () => {
      var _a2;
      if ((_a2 = options.cancelled) == null ? void 0 : _a2.call(options)) throw new Error("\u5BFC\u5165\u5DF2\u53D6\u6D88");
    };
    const context = options.context || createImportContext(api);
    const targetPage = options.page || api.currentPage;
    const fonts = await context.fonts;
    check();
    const fontCache = context.fontCache;
    const loaded = context.loaded;
    const generic = { "sans-serif": ["Arial", "Inter"], "system-ui": ["Inter", "Arial"], "-apple-system": ["SF Pro Text", "Inter"], "BlinkMacSystemFont": ["SF Pro Text", "Inter"], serif: ["Times New Roman", "Noto Serif"], monospace: ["SF Mono", "Roboto Mono", "Courier New"] };
    const resolveFont = async (text) => {
      const key = JSON.stringify([text.families, text.weight, text.italic, /[\u3400-\u9fff]/.test(text.value)]);
      if (fontCache.has(key)) return fontCache.get(key);
      const candidates = text.families.flatMap((f) => generic[f] || [f]);
      if (/[\u3400-\u9fff]/.test(text.value)) candidates.push("Noto Sans SC", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei");
      candidates.push("Inter", "Arial");
      for (const family of candidates) {
        const matches = fonts.filter((f) => f.fontName.family.toLowerCase() === family.toLowerCase()).sort((a, b) => {
          const score = (f) => Math.abs(weightOf(f.fontName.style) - text.weight) + (/(italic|oblique)/i.test(f.fontName.style) !== text.italic ? 1e3 : 0);
          return score(a) - score(b);
        });
        for (const match of matches) {
          try {
            const id = JSON.stringify(match.fontName);
            if (!loaded.has(id)) {
              await api.loadFontAsync(match.fontName);
              loaded.add(id);
            }
            if (!text.families.some((f) => f.toLowerCase() === family.toLowerCase() || (generic[f] || []).some((g) => g.toLowerCase() === family.toLowerCase()))) warn("FONT_SUBSTITUTED", `\u5B57\u4F53 ${text.families[0] || "\u9ED8\u8BA4\u5B57\u4F53"} \u66FF\u6362\u4E3A ${match.fontName.family}`);
            if (Math.abs(weightOf(match.fontName.style) - text.weight) >= 100 || /(italic|oblique)/i.test(match.fontName.style) !== text.italic) warn("FONT_STYLE_SUBSTITUTED", `${match.fontName.family} \u7684\u90E8\u5206\u5B57\u91CD\u6216\u659C\u4F53\u4F7F\u7528\u8FD1\u4F3C\u6837\u5F0F`);
            fontCache.set(key, match.fontName);
            return match.fontName;
          } catch (e) {
          }
        }
      }
      throw new Error("Figma \u4E2D\u6CA1\u6709\u53EF\u7528\u5B57\u4F53\uFF0C\u8BF7\u5148\u5B89\u88C5\u6216\u542F\u7528 Inter");
    };
    const imageHashes = context.imageHashes;
    for (const a of document.assets) {
      check();
      if (imageHashes.has(a.id)) continue;
      if (!a.base64) {
        warn("ASSET_MISSING", "\u56FE\u7247\u7F3A\u5931\uFF0C\u5DF2\u4FDD\u7559\u7070\u8272\u5360\u4F4D\u56FE\u5C42", a.url.slice(0, 180));
        continue;
      }
      try {
        imageHashes.set(a.id, api.createImage(api.base64Decode(a.base64)).hash);
      } catch (e) {
        warn("IMAGE_FORMAT", "\u56FE\u7247\u683C\u5F0F\u65E0\u6CD5\u89E3\u7801\uFF0C\u5DF2\u4FDD\u7559\u5360\u4F4D\u56FE\u5C42", a.url.slice(0, 180));
      }
    }
    const paints = (values) => values.map((p) => {
      if (p.type === "solid") return { type: "SOLID", color: rgb(p.color), opacity: p.color.a };
      if (p.type === "linear") return { type: "GRADIENT_LINEAR", gradientStops: p.stops.map((s) => ({ position: s.position, color: __spreadProps(__spreadValues({}, rgb(s.color)), { a: s.color.a }) })), gradientTransform: p.transform, opacity: 1 };
      const imageHash = imageHashes.get(p.assetId);
      if (!imageHash) return { type: "SOLID", color: { r: 0.9, g: 0.91, b: 0.93 } };
      return __spreadValues({ type: "IMAGE", imageHash, scaleMode: p.fit }, p.fit === "TILE" ? { scalingFactor: 1 } : {});
    });
    const setFrameStyle = (node, spec) => {
      node.fills = paints(spec.fills);
      node.opacity = spec.opacity;
      node.clipsContent = !!spec.clip;
      if (spec.radius) [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = spec.radius;
      if (spec.border) {
        node.strokes = [{ type: "SOLID", color: rgb(spec.border.color), opacity: spec.border.color.a }];
        [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight] = spec.border.widths;
        node.strokeAlign = "INSIDE";
        if (spec.border.dashed) node.dashPattern = [4, 4];
      }
      node.effects = (spec.effects || []).map((e) => ({ type: e.inner ? "INNER_SHADOW" : "DROP_SHADOW", color: __spreadProps(__spreadValues({}, rgb(e.color)), { a: e.color.a }), offset: { x: e.x, y: e.y }, radius: e.blur, spread: e.spread, visible: true, blendMode: "NORMAL" }));
    };
    let done = 0, autoLayouts = 0;
    const total = countScene(document.root).nodes;
    const staging2 = api.createFrame();
    staging2.name = `${document.name} \xB7 \u5BFC\u5165\u4E2D`;
    staging2.fills = [];
    staging2.clipsContent = false;
    staging2.visible = false;
    targetPage.appendChild(staging2);
    (_a = options.onStaging) == null ? void 0 : _a.call(options, staging2);
    const originalSelection = [...targetPage.selection];
    let transferred = null;
    try {
      const build = async (spec, parent) => {
        var _a2;
        check();
        let node;
        if (spec.kind === "text") {
          const font = await resolveFont(spec.text);
          check();
          const t = api.createText();
          parent.appendChild(t);
          node = t;
          const text = spec.text;
          t.fontName = font;
          t.fontSize = text.size;
          t.characters = text.value;
          t.lineHeight = { unit: "PIXELS", value: text.lineHeight };
          t.letterSpacing = { unit: "PIXELS", value: text.letterSpacing };
          t.textDecoration = text.decoration;
          t.textAutoResize = "WIDTH_AND_HEIGHT";
          t.fills = spec.fills.length ? paints(spec.fills) : [{ type: "SOLID", color: rgb(text.color), opacity: text.color.a }];
          t.opacity = spec.opacity;
        } else {
          const f = api.createFrame();
          parent.appendChild(f);
          node = f;
          f.resize(spec.width, spec.height);
          setFrameStyle(f, spec);
          if (spec.kind === "svg") {
            try {
              const vector = api.createNodeFromSvg(spec.svg);
              f.appendChild(vector);
              vector.x = vector.y = 0;
              vector.name = "SVG";
              if (vector.width > 0 && Math.abs(vector.width - spec.width) > 0.1) vector.rescale(spec.width / vector.width);
              if (Math.abs(vector.height - spec.height) > 1) warn("SVG_SIZE", "SVG \u5BBD\u9AD8\u6BD4\u4E0E\u6D4F\u89C8\u5668\u663E\u793A\u5B58\u5728\u5DEE\u5F02", spec.name);
            } catch (e) {
              warn("SVG_FAILED", "SVG \u65E0\u6CD5\u8F6C\u6362\uFF0C\u5DF2\u4FDD\u7559\u5BB9\u5668", spec.name);
            }
          }
          for (const child of spec.children || []) await build(child, f);
          if (spec.layout) {
            f.setPluginData("htmlFlex", JSON.stringify(spec.layout));
            if (options.mode === "auto") {
              const result = applyAutoLayoutPreservingGeometry(f, spec);
              f.setPluginData("h2fAutoLayout", result);
              if (result === "applied") autoLayouts++;
              else if (result === "reverted") warn("AUTO_LAYOUT_REVERTED", "\u81EA\u52A8\u5E03\u5C40\u6539\u53D8\u4E86\u5C3A\u5BF8\u6216\u4F4D\u7F6E\uFF0C\u5DF2\u6062\u590D\u8BE5\u5BB9\u5668\u7684\u539F\u59CB\u5E03\u5C40", spec.name);
              else warn("AUTO_LAYOUT_SKIPPED", "\u90E8\u5206 Flex \u5BB9\u5668\u4FDD\u7559\u539F\u59CB\u4F4D\u7F6E\uFF0C\u4EE5\u907F\u514D\u5E03\u5C40\u53D1\u751F\u53D8\u5316", spec.name);
            }
          }
        }
        node.name = spec.name;
        node.x = spec.x;
        node.y = spec.y;
        node.setPluginData("htmlNodeId", spec.id);
        done++;
        if (done % 30 === 0) {
          (_a2 = options.progress) == null ? void 0 : _a2.call(options, done, total);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return node;
      };
      const built = await build(document.root, staging2);
      check();
      targetPage.appendChild(built);
      transferred = built;
      const center = api.viewport.center;
      built.x = (_c = (_b = options.position) == null ? void 0 : _b.x) != null ? _c : Math.round(center.x - built.width / 2);
      built.y = (_e = (_d = options.position) == null ? void 0 : _d.y) != null ? _e : Math.round(center.y - built.height / 2);
      built.name = document.name;
      built.setPluginData("h2fSource", JSON.stringify(document.source));
      built.setPluginData("h2fVersion", "1");
      staging2.remove();
      (_f = options.onStaging) == null ? void 0 : _f.call(options, null);
      if (options.focus !== false) {
        targetPage.selection = [built];
        api.viewport.scrollAndZoomIntoView([built]);
      }
      (_g = options.progress) == null ? void 0 : _g.call(options, total, total);
      return { nodeId: built.id, nodes: done, autoLayouts, diagnostics };
    } catch (error) {
      if (transferred && !transferred.removed) transferred.remove();
      if (!staging2.removed) staging2.remove();
      (_h = options.onStaging) == null ? void 0 : _h.call(options, null);
      if (options.focus !== false) targetPage.selection = originalSelection.filter((n) => !n.removed);
      throw error;
    }
  }

  // src/bundle.ts
  var BATCH_LIMITS = { pages: 200, nodes: 12e4, assets: 2e3, assetBytes: 64 * 1024 * 1024 };

  // src/batch.ts
  var ImportBatch = class {
    constructor(api, id, plan, mode) {
      this.api = api;
      this.id = id;
      this.plan = plan;
      this.mode = mode;
      this.results = [];
      this.cancelled = false;
      this.processing = false;
      this.next = 0;
      this.nodeCount = 0;
      this.assetBytes = 0;
      this.assetIds = /* @__PURE__ */ new Set();
      this.staging = null;
      if (!id || id.length > 100 || !Array.isArray(plan) || !plan.length || plan.length > BATCH_LIMITS.pages || plan.some((p) => !p || typeof p.name !== "string" || !Number.isFinite(p.width) || p.width <= 0 || p.width > 1e5 || !Number.isFinite(p.height) || p.height <= 0 || p.height > 1e5)) throw new Error("\u6279\u6B21\u8BA1\u5212\u65E0\u6548\uFF08\u6700\u591A 200 \u9875\uFF09");
      this.context = createImportContext(api);
      this.page = api.currentPage;
      const existing = this.page.children.filter((n) => n.visible);
      const originX = existing.length ? Math.max(...existing.map((n) => n.x + n.width)) + 160 : Math.round(api.viewport.center.x);
      const originY = Math.round(api.viewport.center.y);
      const columns = Math.min(8, Math.ceil(Math.sqrt(plan.length)));
      let x = originX, y = originY, rowHeight = 0;
      this.positions = plan.map((p, i) => {
        if (i > 0 && i % columns === 0) {
          x = originX;
          y += rowHeight + 120;
          rowHeight = 0;
        }
        const pos = { x, y };
        x += p.width + 120;
        rowHeight = Math.max(rowHeight, p.height);
        return pos;
      });
    }
    cancel() {
      this.cancelled = true;
    }
    cleanupOnClose() {
      this.cancelled = true;
      if (this.staging && !this.staging.removed) this.staging.remove();
    }
    get total() {
      return this.plan.length;
    }
    async importPage(index, document, progress) {
      var _a;
      if (this.processing || index !== this.next || index >= this.total || this.cancelled) throw new Error("\u6279\u6B21\u5DF2\u53D6\u6D88\u6216\u9875\u9762\u987A\u5E8F\u65E0\u6548");
      this.processing = true;
      try {
        validateDocument(document);
        const count = countScene(document.root).nodes;
        if (this.nodeCount + count > BATCH_LIMITS.nodes) throw new Error("\u6574\u6279\u56FE\u5C42\u6570\u91CF\u8D85\u8FC7 120000\uFF0C\u8BF7\u5206\u6279\u5BFC\u5165");
        for (const asset of document.assets) if (!this.assetIds.has(asset.id)) {
          const bytes = (((_a = asset.base64) == null ? void 0 : _a.length) || 0) * 0.75;
          if (this.assetBytes + bytes > BATCH_LIMITS.assetBytes || this.assetIds.size >= BATCH_LIMITS.assets) throw new Error("\u6574\u6279\u56FE\u7247\u8D44\u6E90\u8D85\u9650");
          this.assetIds.add(asset.id);
          this.assetBytes += bytes;
        }
        this.nodeCount += count;
        const result = await importDocument(this.api, document, { mode: this.mode, context: this.context, page: this.page, focus: false, position: this.positions[index], cancelled: () => this.cancelled, progress, onStaging: (node) => {
          this.staging = node;
        } });
        const entry = { index, name: document.name, nodeId: result.nodeId, result };
        this.results.push(entry);
        this.next++;
        return entry;
      } catch (error) {
        const entry = { index, name: (document == null ? void 0 : document.name) || this.plan[index].name, error: error instanceof Error ? error.message : String(error) };
        this.results.push(entry);
        this.next++;
        return entry;
      } finally {
        this.processing = false;
      }
    }
    async finish() {
      if (this.processing) throw new Error("\u5F53\u524D\u9875\u9762\u5C1A\u672A\u5B8C\u6210");
      const nodes = [];
      for (const entry of this.results) if (entry.nodeId) {
        const n = await this.api.getNodeByIdAsync(entry.nodeId);
        if (n && "visible" in n) nodes.push(n);
      }
      if (nodes.length && this.api.currentPage.id === this.page.id) {
        this.page.selection = nodes.length > 12 ? [nodes[0]] : nodes;
        this.api.viewport.scrollAndZoomIntoView(nodes.length > 12 ? [nodes[0]] : nodes);
      }
      return { total: this.total, completed: this.results.filter((r) => r.nodeId).length, failed: this.results.filter((r) => r.error && r.error !== "\u5BFC\u5165\u5DF2\u53D6\u6D88").length, cancelled: this.cancelled, results: this.results };
    }
  };

  // src/plugin.ts
  figma.showUI(__html__, { width: 460, height: 760, themeColors: true, title: "HTML to Figma \xB7 Local" });
  var active = false;
  var cancelled = false;
  var batch = null;
  var staging = null;
  var currentContext = () => {
    var _a;
    return { documentName: ((_a = figma.root) == null ? void 0 : _a.name) || "\u5F53\u524D Figma \u6587\u4EF6", pageName: figma.currentPage.name || "\u5F53\u524D\u9875\u9762", pageId: figma.currentPage.id };
  };
  figma.on("currentpagechange", () => figma.ui.postMessage({ type: "CONTEXT", context: currentContext() }));
  figma.on("close", () => {
    cancelled = true;
    batch == null ? void 0 : batch.cleanupOnClose();
    if (staging && !staging.removed) staging.remove();
  });
  figma.ui.onmessage = async (message) => {
    var _a, _b;
    if (!message || typeof message.type !== "string") return;
    if (message.type === "READY") {
      figma.ui.postMessage({ type: "SETTINGS", settings: await figma.clientStorage.getAsync("h2f-settings-v1") || {}, assistant: await figma.clientStorage.getAsync("h2f-assistant-v1") || null, context: currentContext() });
      return;
    }
    if (message.type === "ASSISTANT_SETTINGS") {
      const a = message.assistant;
      if (a && /^figma-[a-f0-9-]{16,100}$/.test(a.clientId) && /^[a-f0-9]{64}$/.test(a.credential) && /^http:\/\/127\.0\.0\.1:(384[7-9]|385[01])$/.test(a.serviceURL)) await figma.clientStorage.setAsync("h2f-assistant-v1", { clientId: a.clientId, credential: a.credential, serviceURL: a.serviceURL });
      return;
    }
    if (message.type === "SETTINGS") {
      await figma.clientStorage.setAsync("h2f-settings-v1", { mode: ((_a = message.settings) == null ? void 0 : _a.mode) === "auto" ? "auto" : "visual", token: typeof ((_b = message.settings) == null ? void 0 : _b.token) === "string" ? message.settings.token.slice(0, 120) : "" });
      return;
    }
    if (message.type === "CANCEL") {
      cancelled = true;
      batch == null ? void 0 : batch.cancel();
      if (batch && !batch.processing) {
        const result = await batch.finish();
        figma.ui.postMessage({ type: "BATCH_COMPLETE", id: batch.id, result });
        batch = null;
        active = false;
      }
      return;
    }
    if (["IMPORT", "BATCH_START"].includes(message.type) && message.expectedPageId && message.expectedPageId !== figma.currentPage.id) {
      figma.ui.postMessage({ type: "ERROR", message: "\u76EE\u6807 Figma \u9875\u9762\u5DF2\u53D8\u5316\uFF0C\u672A\u6267\u884C\u5BFC\u5165\uFF0C\u8BF7\u4ECE\u52A9\u624B\u91CD\u65B0\u9009\u62E9\u76EE\u6807\u3002" });
      return;
    }
    if (message.type === "BATCH_START" && !active) {
      try {
        batch = new ImportBatch(figma, message.id, message.plan, message.mode === "auto" ? "auto" : "visual");
        active = true;
        cancelled = false;
        figma.ui.postMessage({ type: "BATCH_READY", id: batch.id });
      } catch (error) {
        figma.ui.postMessage({ type: "ERROR", message: String(error) });
      }
      return;
    }
    if (message.type === "IMPORT_PAGE" && batch && batch.id === message.id) {
      const current = batch;
      try {
        const result = await current.importPage(message.index, message.document, (done, total) => figma.ui.postMessage({ type: "PAGE_PROGRESS", id: current.id, index: message.index, done, total }));
        figma.ui.postMessage({ type: "PAGE_COMPLETE", id: current.id, index: message.index, result });
        if (current.cancelled || current.next === current.total) {
          const result2 = await current.finish();
          figma.ui.postMessage({ type: "BATCH_COMPLETE", id: current.id, result: result2 });
          batch = null;
          active = false;
        }
      } catch (error) {
        figma.ui.postMessage({ type: "ERROR", message: String(error) });
        current.cancel();
        current.cleanupOnClose();
        batch = null;
        active = false;
      }
      return;
    }
    if (message.type !== "IMPORT" || active) return;
    active = true;
    cancelled = false;
    try {
      validateDocument(message.document);
      const result = await importDocument(figma, message.document, { mode: message.mode === "auto" ? "auto" : "visual", cancelled: () => cancelled, onStaging: (node) => {
        staging = node;
      }, progress: (done, total) => figma.ui.postMessage({ type: "PROGRESS", done, total }) });
      figma.ui.postMessage({ type: "COMPLETE", result });
      figma.notify(`\u5DF2\u5BFC\u5165 ${result.nodes} \u4E2A\u56FE\u5C42`);
    } catch (error) {
      figma.ui.postMessage({ type: "ERROR", message: error instanceof Error ? error.message : String(error) });
    } finally {
      active = false;
    }
  };
})();

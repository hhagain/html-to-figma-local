// src/design-artifact.ts
function validArtifact(value) {
  const v = value;
  return !!v && typeof v === "object" && !Array.isArray(v) && ["page", "component", "icon"].includes(v.kind) && typeof v.familyId === "string" && /^[\w-]{1,200}$/.test(v.familyId) && ["familyName", "stateName", "reason"].every((k) => typeof v[k] === "string" && v[k].length > 0 && v[k].length <= 500) && Number.isSafeInteger(v.sampleCount) && v.sampleCount >= 1;
}

// src/design-organization.ts
var PAGE_LEVELS = { primary: "\u4E00\u7EA7\u9875\u9762", secondary: "\u4E8C\u7EA7\u9875\u9762", feature: "\u529F\u80FD\u9875\u9762", unclassified: "\u5F85\u786E\u8BA4\u9875\u9762" };
function validOrganization(v) {
  const o = v;
  return !!o && typeof o === "object" && !Array.isArray(o) && ["projectId", "moduleId", "pageId", "viewId"].every((k) => typeof o[k] === "string" && /^[\w-]{1,200}$/.test(o[k])) && (o.parentPageId === void 0 || typeof o.parentPageId === "string" && /^[\w-]{1,200}$/.test(o.parentPageId)) && ["moduleName", "pageName", "stateName", "reason"].every((k) => typeof o[k] === "string" && o[k].length > 0 && o[k].length <= 500) && Object.prototype.hasOwnProperty.call(PAGE_LEVELS, o.level) && ["page", "dialog", "form", "selection", "scroll", "state"].includes(o.kind) && ["high", "medium", "low"].includes(o.confidence) && !!o.scroll && typeof o.scroll.container === "string" && o.scroll.container.length <= 700 && [o.scroll.x, o.scroll.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e7);
}

// src/schema.ts
var SCHEMA_VERSION = 1;
var LIMITS = { nodes: 6e3, depth: 64, text: 25e4, assets: 300, assetBytes: 24 * 1024 * 1024, dimension: 1e5 };
function isCanvasPlacement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const canvas = value, max = 1e7;
  return typeof canvas.id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(canvas.id) && [canvas.x, canvas.y].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max) && [canvas.width, canvas.height].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max);
}
function validImportSettings(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.smartLayout === "boolean";
}
function countScene(root) {
  let nodes = 0, texts = 0, images = 0, vectors = 0;
  const walk = (n) => {
    nodes++;
    texts += Number(n.kind === "text");
    vectors += Number(n.kind === "svg");
    images += n.fills.filter((p) => p.type === "image").length;
    n.children?.forEach(walk);
  };
  walk(root);
  return { nodes, texts, images, vectors };
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
  if (doc.importOptions !== void 0 && !validImportSettings(doc.importOptions)) fail("\u5BFC\u5165\u8BBE\u7F6E\u65E0\u6548");
  if (typeof doc.name !== "string" || doc.name.length > 500) fail("\u540D\u79F0\u8FC7\u957F\u6216\u7F3A\u5931");
  if (!object(doc.source) || !object(doc.source.viewport) || !number(doc.source.viewport.width, LIMITS.dimension, 1) || !number(doc.source.viewport.height, LIMITS.dimension, 1) || typeof doc.source.url !== "string" || typeof doc.source.selector !== "string") fail("\u7F3A\u5C11\u9875\u9762\u4FE1\u606F");
  if (doc.source.artifact !== void 0 && !validArtifact(doc.source.artifact)) fail("\u8BBE\u8BA1\u7A3F\u9879\u4FE1\u606F\u65E0\u6548");
  if (doc.source.canvas !== void 0 && !isCanvasPlacement(doc.source.canvas)) fail("\u539F\u753B\u5E03\u4F4D\u7F6E\u4FE1\u606F\u65E0\u6548");
  if (doc.source.design !== void 0 && !validOrganization(doc.source.design)) fail("\u9875\u9762\u5206\u7C7B\u4FE1\u606F\u65E0\u6548");
  if (doc.source.longPage !== void 0) {
    const p = doc.source.longPage;
    if (!object(p) || p.expanded !== true || !Array.isArray(p.containers) || p.containers.length > 32 || p.containers.some((c) => !object(c) || typeof c.name !== "string" || c.name.length > 150 || !number(c.width, LIMITS.dimension, 0.01) || !number(c.height, LIMITS.dimension, 0.01)) || !Array.isArray(p.mergedStateIds) || p.mergedStateIds.some((id) => typeof id !== "string" || !/^[\w-]{1,80}$/.test(id))) fail("\u957F\u9875\u4FE1\u606F\u65E0\u6548");
  }
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
    if (n.border !== void 0 && (!object(n.border) || !color(n.border.color) || !tuple(n.border.widths, 4) || n.border.align !== void 0 && !["INSIDE", "CENTER", "OUTSIDE"].includes(n.border.align))) fail("\u8FB9\u6846\u65E0\u6548");
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
    n.children?.forEach((child) => walk(child, depth + 1));
  };
  walk(doc.root, 0);
}

// src/bundle.ts
var BATCH_LIMITS = { nodes: 12e4, assets: 2e3, assetBytes: 64 * 1024 * 1024 };
function isBundle(value) {
  return value?.format === "h2f-bundle";
}
function hydratePage(bundle, index) {
  const page = bundle.pages[index];
  if (!page) throw new Error("\u9875\u9762\u4E0D\u5B58\u5728");
  const shared = new Map(bundle.assets.map((a) => [a.id, a]));
  return { ...page, assets: page.assets.map((a) => {
    const resolved = shared.get(a.id);
    if (!resolved) throw new Error("\u9875\u9762\u8D44\u6E90\u5F15\u7528\u4E0D\u5B58\u5728");
    return resolved;
  }) };
}
function fingerprint(a) {
  let hash = 2166136261;
  const value = a.base64 || a.url;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${a.mime}:${value.length}:${hash >>> 0}`;
}
var BundleBuilder = class {
  constructor(name) {
    this.buckets = /* @__PURE__ */ new Map();
    this.bytes = 0;
    this.nodes = 0;
    this.bundle = { schemaVersion: 1, format: "h2f-bundle", name, createdAt: (/* @__PURE__ */ new Date()).toISOString(), pages: [], assets: [], errors: [] };
  }
  add(input) {
    validateDocument(input);
    const count = countScene(input.root).nodes;
    if (this.nodes + count > BATCH_LIMITS.nodes) throw new Error("\u6574\u6279\u8D85\u8FC7 120000 \u4E2A\u56FE\u5C42\uFF0C\u8BF7\u5206\u6279\u6355\u83B7");
    const mapping = /* @__PURE__ */ new Map();
    const refs = [];
    for (const a of input.assets) {
      const key = fingerprint(a);
      let common = this.buckets.get(key)?.find((x) => x.mime === a.mime && (a.base64 ? x.base64 === a.base64 : x.url === a.url));
      if (!common) {
        const bytes = (a.base64?.length || 0) * 0.75;
        if (this.bytes + bytes > BATCH_LIMITS.assetBytes || this.bundle.assets.length >= BATCH_LIMITS.assets) throw new Error("\u6574\u6279\u56FE\u7247\u8D44\u6E90\u8D85\u9650\uFF08\u53BB\u91CD\u540E\u6700\u591A 64 MB\u30012000 \u4E2A\uFF09");
        common = { ...a, id: `asset-${this.bundle.assets.length + 1}`, url: a.base64 && a.url.startsWith("data:") ? "embedded-image" : a.url };
        this.bundle.assets.push(common);
        this.bytes += bytes;
        this.buckets.set(key, [...this.buckets.get(key) || [], common]);
      }
      mapping.set(a.id, common.id);
      if (!refs.some((ref) => ref.id === common.id)) refs.push({ id: common.id, url: `asset:${common.id}`, mime: common.mime });
    }
    const clone = (n) => ({ ...n, fills: n.fills.map((p) => p.type === "image" ? { ...p, assetId: mapping.get(p.assetId) } : p), ...n.children ? { children: n.children.map(clone) } : {} });
    this.bundle.pages.push({ ...input, root: clone(input.root), assets: refs });
    this.nodes += count;
  }
  addBundle(bundle) {
    validateBundle(bundle);
    const namespace = `bundle-${this.bundle.pages.length}`, canvases = /* @__PURE__ */ new Map();
    bundle.pages.forEach((_, i) => {
      const page = hydratePage(bundle, i), canvas = page.source.canvas;
      if (canvas) {
        if (!canvases.has(canvas.id)) canvases.set(canvas.id, `${namespace}-${canvases.size}`);
        page.source = { ...page.source, canvas: { ...canvas, id: canvases.get(canvas.id) } };
      }
      this.add(page);
    });
    for (const error of bundle.errors) this.bundle.errors.push(error);
  }
  error(name, error) {
    this.bundle.errors.push({ name, message: error instanceof Error ? error.message : String(error) });
  }
};
function validateBundle(value) {
  const b = value;
  if (!b || b.schemaVersion !== 1 || b.format !== "h2f-bundle" || typeof b.name !== "string" || b.name.length > 500 || !Array.isArray(b.pages) || !b.pages.length || !Array.isArray(b.assets) || b.assets.length > BATCH_LIMITS.assets || !Array.isArray(b.errors)) throw new Error("\u591A\u9875\u6570\u636E\u683C\u5F0F\u65E0\u6548");
  if (b.importOptions !== void 0 && !validImportSettings(b.importOptions)) throw new Error("\u5BFC\u5165\u8BBE\u7F6E\u65E0\u6548");
  const ids = /* @__PURE__ */ new Set();
  let bytes = 0, nodes = 0;
  for (const a of b.assets) {
    if (!a || typeof a.id !== "string" || ids.has(a.id) || typeof a.url !== "string" || a.base64 !== void 0 && typeof a.base64 !== "string") throw new Error("\u5171\u4EAB\u8D44\u6E90\u65E0\u6548");
    ids.add(a.id);
    bytes += (a.base64?.length || 0) * 0.75;
  }
  if (bytes > BATCH_LIMITS.assetBytes) throw new Error("\u6574\u6279\u56FE\u7247\u8D85\u8FC7 64 MB");
  for (let i = 0; i < b.pages.length; i++) {
    const page = hydratePage(b, i);
    validateDocument(page);
    nodes += countScene(page.root).nodes;
  }
  if (nodes > BATCH_LIMITS.nodes) throw new Error("\u6574\u6279\u8D85\u8FC7 120000 \u4E2A\u56FE\u5C42");
  if (b.errors.some((e) => !e || typeof e.name !== "string" || typeof e.message !== "string")) throw new Error("\u9875\u9762\u9519\u8BEF\u8BB0\u5F55\u65E0\u6548");
}
function discoverPages(doc, baseSelector, split, pageSelector = "", canvasId = `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  let root;
  try {
    root = doc.querySelector(baseSelector || "body");
  } catch {
    throw new Error("\u6355\u83B7\u533A\u57DF\u9009\u62E9\u5668\u683C\u5F0F\u4E0D\u6B63\u786E");
  }
  if (!root) throw new Error(`\u6CA1\u6709\u627E\u5230\u9009\u62E9\u5668\uFF1A${baseSelector}`);
  let pages = [];
  if (split) {
    if (pageSelector.trim()) {
      try {
        pages = Array.from(root.querySelectorAll(pageSelector));
        if (root.matches(pageSelector)) pages.unshift(root);
      } catch {
        throw new Error("\u9875\u9762\u9009\u62E9\u5668\u683C\u5F0F\u4E0D\u6B63\u786E");
      }
      if (!pages.length) throw new Error(`\u6CA1\u6709\u627E\u5230\u9875\u9762\uFF1A${pageSelector}`);
    } else {
      for (const candidate of ["[data-pencil-name]", "[data-artboard]", "[data-page]", ".page", ".slide", ".artboard"]) {
        const elements = Array.from(root.querySelectorAll(candidate));
        const top = elements.filter((el) => {
          const ancestor = el.parentElement?.closest(candidate);
          return !ancestor || !root.contains(ancestor);
        });
        if (top.length >= 2) {
          pages = top;
          break;
        }
      }
    }
  }
  if (!pages.length) pages = [root];
  const placements = /* @__PURE__ */ new Map();
  if (split && pages.length > 1 && doc.defaultView) {
    const groups = /* @__PURE__ */ new Map();
    for (const page of pages) {
      if (!page.parentElement) continue;
      const siblings = groups.get(page.parentElement);
      if (siblings) siblings.push(page);
      else groups.set(page.parentElement, [page]);
    }
    let groupIndex = 0;
    for (const [parent, siblings] of groups) {
      if (siblings.length < 2 || !siblings.every((el) => doc.defaultView.getComputedStyle(el).position === "absolute")) continue;
      const base = parent.getBoundingClientRect(), bounds = siblings.map((el) => el.getBoundingClientRect());
      const round = (n) => Math.round(n * 100) / 100;
      const width = round(bounds.reduce((max, r) => Math.max(max, r.right - base.left), Math.max(base.width, parent.scrollWidth)));
      const height = round(bounds.reduce((max, r) => Math.max(max, r.bottom - base.top), Math.max(base.height, parent.scrollHeight)));
      const id = `${canvasId}-${groupIndex++}`;
      siblings.forEach((el, i) => placements.set(el, { id, x: round(bounds[i].left - base.left), y: round(bounds[i].top - base.top), width, height }));
    }
  }
  return pages.map((element, i) => {
    element.setAttribute("data-h2f-capture-page", String(i));
    const name = element.getAttribute("data-pencil-name") || element.getAttribute("data-page-name") || element.getAttribute("aria-label") || element.getAttribute("data-page") || element.querySelector("h1,h2")?.textContent?.trim() || `${doc.title || "\u9875\u9762"} ${String(i + 1).padStart(3, "0")}`;
    return { element, selector: `[data-h2f-capture-page="${i}"]`, name: name.slice(0, 150), ...placements.has(element) ? { canvas: placements.get(element) } : {} };
  });
}
export {
  BATCH_LIMITS,
  BundleBuilder,
  discoverPages,
  hydratePage,
  isBundle,
  validateBundle
};

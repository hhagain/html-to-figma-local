// src/schema.ts
var SCHEMA_VERSION = 1;
var LIMITS = { nodes: 6e3, depth: 64, text: 25e4, assets: 300, assetBytes: 24 * 1024 * 1024, dimension: 1e5 };
function isCanvasPlacement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const canvas = value, max = 1e7;
  return typeof canvas.id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(canvas.id) && [canvas.x, canvas.y].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max) && [canvas.width, canvas.height].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max);
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
  if (doc.source.canvas !== void 0 && !isCanvasPlacement(doc.source.canvas)) fail("\u539F\u753B\u5E03\u4F4D\u7F6E\u4FE1\u606F\u65E0\u6548");
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
export {
  LIMITS,
  SCHEMA_VERSION,
  addDiagnostic,
  countScene,
  isCanvasPlacement,
  validateDocument
};

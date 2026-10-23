"use strict";
(() => {
  // src/gradient.ts
  function tokens(value, separator) {
    const result = [];
    let depth = 0, start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      if (depth === 0 && (separator === "," ? value[i] === "," : /\s/.test(value[i]))) {
        if (value.slice(start, i).trim()) result.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    if (value.slice(start).trim()) result.push(value.slice(start).trim());
    return result;
  }
  function linearGradient(value, width, height, readColor) {
    var _a, _b;
    const match = value.match(/^linear-gradient\((.*)\)$/s);
    if (!match) return null;
    const parts = tokens(match[1], ",");
    let angle = Math.PI, direction = parts[0];
    const unit = direction.match(/^(-?[\d.]+)(deg|turn|rad|grad)$/);
    if (unit) {
      parts.shift();
      angle = Number(unit[1]) * { deg: Math.PI / 180, turn: Math.PI * 2, rad: 1, grad: Math.PI / 200 }[unit[2]];
    } else if (/^to /.test(direction)) {
      parts.shift();
      const horizontal = /right/.test(direction) ? 1 : /left/.test(direction) ? -1 : 0;
      const vertical = /bottom/.test(direction) ? 1 : /top/.test(direction) ? -1 : 0;
      if (!horizontal && !vertical) return null;
      angle = Math.atan2(horizontal * (vertical ? height : 1), -vertical * (horizontal ? width : 1));
    }
    const dx = Math.sin(angle), dy = -Math.cos(angle), length = Math.abs(width * dx) + Math.abs(height * dy) || 1;
    const position = (token) => {
      const value2 = token.trim();
      if (value2 === "0") return 0;
      const m = value2.match(/^(-?(?:\d*\.)?\d+)(%|px)$/);
      if (m) return Number(m[1]) / (m[2] === "%" ? 100 : length);
      if (/^calc\(/.test(value2)) {
        const inner = value2.slice(5, -1).replace(/\s+/g, "");
        const terms = inner.match(/[+-]?(?:\d*\.)?\d+(?:%|px)/g);
        if (terms?.join("") === inner) return terms.reduce((sum, t) => sum + Number(t.replace(/%|px/g, "")) / (t.endsWith("%") ? 100 : length), 0);
      }
      return null;
    };
    const stops = [];
    for (const part of parts) {
      const pieces = tokens(part, " "), offsets = [];
      while (pieces.length > 1 && offsets.length < 2) {
        const offset = position(pieces[pieces.length - 1]);
        if (offset === null) break;
        pieces.pop();
        offsets.unshift(offset);
      }
      const color = readColor(pieces.join(" "));
      if (!color) return null;
      for (const offset of offsets.length ? offsets : [null]) stops.push({ color, position: offset });
    }
    if (stops.length < 2 || stops.length > 50) return null;
    (_a = stops[0]).position ?? (_a.position = 0);
    (_b = stops[stops.length - 1]).position ?? (_b.position = 1);
    let previous = 0;
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].position === null) continue;
      stops[i].position = Math.max(stops[previous].position, stops[i].position);
      for (let j = previous + 1; j < i; j++) stops[j].position = stops[previous].position + (stops[i].position - stops[previous].position) * (j - previous) / (i - previous);
      previous = i;
    }
    const resolved = stops;
    const sample = (p) => {
      if (p < resolved[0].position) return resolved[0].color;
      for (let i = 1; i < resolved.length; i++) if (p < resolved[i].position) {
        const left = resolved[i - 1], right = resolved[i], t = (p - left.position) / (right.position - left.position);
        const a2 = left.color.a * (1 - t) + right.color.a * t;
        const channel = (key) => a2 ? (left.color[key] * left.color.a * (1 - t) + right.color[key] * right.color.a * t) / a2 : 0;
        return { r: channel("r"), g: channel("g"), b: channel("b"), a: a2 };
      }
      return resolved[resolved.length - 1].color;
    };
    const clipped = resolved.filter((stop) => stop.position >= 0 && stop.position <= 1);
    if (!clipped.length || clipped[0].position > 0) clipped.unshift({ position: 0, color: sample(0) });
    if (clipped[clipped.length - 1].position < 1) clipped.push({ position: 1, color: sample(1) });
    if (clipped.length > 50) return null;
    const a = width * dx / length, b = height * dy / length;
    return { type: "linear", stops: clipped, transform: [[a, b, 0.5 - (a + b) / 2], [-b, a, 0.5 - (a - b) / 2]] };
  }

  // src/schema.ts
  var SCHEMA_VERSION = 1;
  var LIMITS = { nodes: 6e3, depth: 64, text: 25e4, assets: 300, assetBytes: 24 * 1024 * 1024, dimension: 1e5 };
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

  // src/capture.ts
  var round = (v) => Math.round(v * 100) / 100;
  var px = (v) => parseFloat(v) || 0;
  function splitCSS(value, delimiter = ",") {
    const out = [];
    let depth = 0, quote = "", start = 0;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (quote) {
        if (c === quote && value[i - 1] !== "\\") quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === delimiter && depth === 0) {
        out.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(value.slice(start).trim());
    return out;
  }
  async function captureDOM(doc = document, options = {}) {
    const win = doc.defaultView;
    const selector = options.selector?.trim() || "body";
    let rootEl;
    try {
      rootEl = doc.querySelector(selector);
    } catch {
      throw new Error("CSS \u9009\u62E9\u5668\u683C\u5F0F\u4E0D\u6B63\u786E");
    }
    if (!rootEl) throw new Error(`\u6CA1\u6709\u627E\u5230\u9009\u62E9\u5668\uFF1A${selector}`);
    await Promise.race([doc.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 2500))]);
    const diagnostics = [], assets = [];
    const warn = (code, message, node) => addDiagnostic(diagnostics, code, message, node);
    const colorCanvas = doc.createElement("canvas");
    colorCanvas.width = colorCanvas.height = 1;
    const ctx = colorCanvas.getContext("2d", { willReadFrequently: true });
    const color = (value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "transparent";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
    };
    let sequence = 0, textChars = 0;
    const base = (kind, name, rect, parent) => {
      if (++sequence > Math.min(options.maxNodes || LIMITS.nodes, LIMITS.nodes)) throw new Error(`\u9875\u9762\u8D85\u8FC7 ${LIMITS.nodes} \u4E2A\u56FE\u5C42\uFF0C\u8BF7\u7528\u9009\u62E9\u5668\u7F29\u5C0F\u6355\u83B7\u533A\u57DF`);
      return { id: `n${sequence}`, kind, name: name.slice(0, 150), x: round(rect.x - parent.x), y: round(rect.y - parent.y), width: Math.max(0.1, round(rect.width)), height: Math.max(0.1, round(rect.height)), opacity: 1, fills: [] };
    };
    const asset = (url) => {
      let resolved = url;
      try {
        resolved = new URL(url, doc.baseURI).href;
      } catch {
      }
      let a = assets.find((a2) => a2.url === resolved);
      if (!a) {
        if (assets.length >= LIMITS.assets) throw new Error("\u9875\u9762\u56FE\u7247\u8D44\u6E90\u8D85\u8FC7 300 \u4E2A\uFF0C\u8BF7\u7F29\u5C0F\u6355\u83B7\u533A\u57DF");
        a = { id: `a${assets.length + 1}`, url: resolved };
        const m = resolved.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/);
        if (m) {
          a.mime = m[1];
          a.base64 = m[2].replace(/\s/g, "");
        }
        assets.push(a);
      }
      return a.id;
    };
    const effects = (value) => {
      if (value === "none") return [];
      return splitCSS(value).slice(0, 10).flatMap((part) => {
        const match = part.match(/(?:rgba?|color|oklch|oklab)\([^)]*\)/);
        if (!match) return [];
        const c = color(match[0]), rest = part.replace(match[0], "");
        const numbers = [...rest.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
        if (numbers.length < 2) return [];
        return [{ inner: /\binset\b/.test(rest), color: c, x: numbers[0], y: numbers[1], blur: Math.max(0, numbers[2] || 0), spread: numbers[3] || 0 }];
      });
    };
    const scaleCache = /* @__PURE__ */ new WeakMap();
    const uniformScale = (el) => {
      if (!el) return 1;
      const cached = scaleCache.get(el);
      if (cached !== void 0) return cached;
      let scale = uniformScale(el.parentElement);
      const transform = win.getComputedStyle(el).transform;
      if (transform && transform !== "none") {
        try {
          const matrix = new DOMMatrixReadOnly(transform);
          if (Math.abs(matrix.b) < 1e-5 && Math.abs(matrix.c) < 1e-5 && Math.abs(matrix.a - matrix.d) < 1e-5 && matrix.a > 0) scale *= matrix.a;
        } catch {
        }
      }
      scaleCache.set(el, scale);
      return scale;
    };
    const textNodes = (node, parentRect, cs, textPaints) => {
      const value = node.nodeValue || "";
      if (!value.trim() && !/pre|break-spaces/.test(cs.whiteSpace)) return [];
      textChars += value.length;
      if (textChars > LIMITS.text) throw new Error("\u9875\u9762\u6587\u5B57\u8FC7\u591A\uFF0C\u8BF7\u7F29\u5C0F\u6355\u83B7\u533A\u57DF");
      const range = doc.createRange();
      const lines = [];
      let index = 0, lastRect = null;
      for (const char of value) {
        const start = index;
        index += char.length;
        if (char === "\n" && !/pre|break-spaces/.test(cs.whiteSpace)) {
        }
        range.setStart(node, start);
        range.setEnd(node, index);
        const rect = range.getBoundingClientRect();
        if (rect.height < 0.1 || rect.width < 0.01 || lastRect && /^\s$/.test(char) && Math.abs(rect.x - lastRect.x) < 0.01 && Math.abs(rect.width - lastRect.width) < 0.01) continue;
        let visible = /[\r\n\t]/.test(char) && !/pre|break-spaces/.test(cs.whiteSpace) ? " " : char;
        if (visible === "\n" || visible === "\r") continue;
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.y - rect.y) < Math.max(2, rect.height * 0.2)) {
          line.value += visible;
          const right = Math.max(line.x + line.width, rect.right);
          line.x = Math.min(line.x, rect.x);
          line.width = right - line.x;
          line.height = Math.max(line.height, rect.height);
        } else lines.push({ value: visible, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        lastRect = rect;
      }
      range.detach();
      return lines.filter((l) => l.value.trim() || /pre|break-spaces/.test(cs.whiteSpace)).map((line) => {
        let text = line.value;
        if (cs.textTransform === "uppercase") text = text.toUpperCase();
        if (cs.textTransform === "lowercase") text = text.toLowerCase();
        if (cs.textTransform === "capitalize") text = text.replace(/(^|\s)(\S)/g, (_, space, ch) => space + ch.toUpperCase());
        const scale = uniformScale(node.parentElement);
        const lineHeight = (px(cs.lineHeight) || px(cs.fontSize) * 1.2) * scale;
        const n = base("text", text.trim().slice(0, 45) || "\u6587\u5B57", { ...line, y: line.y - (lineHeight - line.height) / 2, height: lineHeight }, parentRect);
        n.text = { value: text, families: splitCSS(cs.fontFamily).map((f) => f.replace(/^['"]|['"]$/g, "")), size: (px(cs.fontSize) || 16) * scale, weight: px(cs.fontWeight) || 400, italic: cs.fontStyle !== "normal", lineHeight, letterSpacing: px(cs.letterSpacing) * scale, color: color(cs.getPropertyValue("-webkit-text-fill-color") || cs.color), decoration: cs.textDecorationLine.includes("line-through") ? "STRIKETHROUGH" : cs.textDecorationLine.includes("underline") ? "UNDERLINE" : "NONE" };
        if (textPaints?.length) n.fills = textPaints.map((paint) => {
          if (paint.type !== "linear") return paint;
          const [a, b] = paint.transform, sx = n.width / parentRect.width, sy = n.height / parentRect.height, x = n.x / parentRect.width, y = n.y / parentRect.height;
          return { ...paint, transform: [[a[0] * sx, a[1] * sy, a[0] * x + a[1] * y + a[2]], [b[0] * sx, b[1] * sy, b[0] * x + b[1] * y + b[2]]] };
        });
        return n;
      });
    };
    const svgString = (el, rect) => {
      const clone = el.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(rect.width));
      clone.setAttribute("height", String(rect.height));
      const originals = [el, ...el.querySelectorAll("*")], copies = [clone, ...clone.querySelectorAll("*")];
      const properties = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "font-family", "font-size", "font-weight"];
      originals.forEach((original, i) => {
        const copy = copies[i], style = win.getComputedStyle(original);
        for (const attr of Array.from(copy.attributes)) if (/^on/i.test(attr.name)) copy.removeAttribute(attr.name);
        for (const prop of properties) {
          const value = style.getPropertyValue(prop);
          if (value && !value.includes("url(")) copy.setAttribute(prop, value);
        }
        copy.removeAttribute("class");
        copy.removeAttribute("style");
        if (["script", "foreignobject"].includes(copy.tagName.toLowerCase())) {
          copy.remove();
          warn("SVG_UNSUPPORTED", "SVG \u4E2D\u7684\u811A\u672C\u548C foreignObject \u672A\u5BFC\u5165", el.id || "SVG");
        }
        const href = copy.getAttribute("href") || copy.getAttribute("xlink:href");
        if (href && !href.startsWith("#") && !href.startsWith("data:image/")) {
          copy.remove();
          warn("SVG_EXTERNAL", "SVG \u7684\u5916\u90E8\u5F15\u7528\u672A\u5BFC\u5165\uFF0C\u8BF7\u5148\u5185\u5D4C\u8BE5\u8D44\u6E90");
        }
      });
      clone.setAttribute("opacity", "1");
      return new XMLSerializer().serializeToString(clone);
    };
    const clips = (value) => ["hidden", "clip", "scroll", "auto"].includes(value);
    const walk = (el, parent, depth, inheritedClip) => {
      if (depth > LIMITS.depth) throw new Error("\u9875\u9762\u5D4C\u5957\u8FC7\u6DF1\uFF0C\u8BF7\u7F29\u5C0F\u6355\u83B7\u533A\u57DF");
      if (["SCRIPT", "STYLE", "LINK", "META", "HEAD", "NOSCRIPT", "TEMPLATE"].includes(el.tagName) || el.hasAttribute("data-h2f-ignore")) return null;
      const cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
      let rect = el.getBoundingClientRect();
      if (rect.width > LIMITS.dimension || rect.height > LIMITS.dimension || Math.abs(rect.x - parent.x) > LIMITS.dimension || Math.abs(rect.y - parent.y) > LIMITS.dimension) {
        if (inheritedClip) {
          const left = Math.max(rect.left, inheritedClip.left), top = Math.max(rect.top, inheritedClip.top), right = Math.min(rect.right, inheritedClip.right), bottom = Math.min(rect.bottom, inheritedClip.bottom);
          if (right <= left || bottom <= top) return null;
          rect = new DOMRect(left, top, right - left, bottom - top);
          warn("VIRTUAL_CANVAS_CLIPPED", "\u8D85\u5927\u865A\u62DF\u5E03\u5C40\u5BB9\u5668\u5DF2\u6309\u5B9E\u9645\u53EF\u89C1\u533A\u57DF\u88C1\u526A", el.id || el.tagName.toLowerCase());
        }
      }
      if (rect.width <= 0 && rect.height <= 0 && cs.display !== "contents") return null;
      const name = el.getAttribute("aria-label") || el.getAttribute("data-pencil-name") || el.id || `${el.tagName.toLowerCase()}${el.classList.length ? "." + el.classList[0] : ""}`;
      const n = base(el.tagName.toLowerCase() === "svg" ? "svg" : "frame", name, rect, parent);
      n.opacity = Math.max(0, Math.min(1, Number(cs.opacity) || 1));
      const bg = color(cs.backgroundColor);
      if (bg.a) n.fills.push({ type: "solid", color: bg });
      const backgrounds = splitCSS(cs.backgroundImage);
      const sizes = splitCSS(cs.backgroundSize);
      for (let i = backgrounds.length - 1; i >= 0; i--) {
        const layer = backgrounds[i];
        if (layer === "none") continue;
        const g = linearGradient(layer, el.offsetWidth || rect.width, el.offsetHeight || rect.height, (value) => win.CSS.supports("color", value) ? color(value) : null);
        if (g) n.fills.push(g);
        else if (/^url\(/.test(layer)) {
          const url = layer.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
          n.fills.push({ type: "image", assetId: asset(url), fit: sizes[i] === "contain" ? "FIT" : cs.backgroundRepeat === "repeat" ? "TILE" : "FILL" });
          if (!["cover", "contain", "auto"].includes(sizes[i] || sizes[0])) warn("BACKGROUND_SIZE", "\u81EA\u5B9A\u4E49\u80CC\u666F\u56FE\u7247\u5C3A\u5BF8\u4EE5\u586B\u5145\u6A21\u5F0F\u5BFC\u5165", name);
        } else warn("BACKGROUND_UNSUPPORTED", "\u90E8\u5206\u80CC\u666F\u6548\u679C\u672A\u8F6C\u6362\uFF08\u652F\u6301\u7EAF\u8272\u548C\u7EBF\u6027\u6E10\u53D8\uFF09", name);
      }
      const textPaints = /(?:^|,\s*)text(?:,|$)/.test(cs.backgroundClip || cs.getPropertyValue("-webkit-background-clip")) ? n.fills.splice(0) : void 0;
      const radius = (value) => value.includes("%") ? Math.min(rect.width, rect.height) * px(value) / 100 : px(value);
      n.radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => Math.min(radius(v), Math.min(rect.width, rect.height) / 2));
      const widths = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
      if (widths.some((w) => w > 0)) {
        const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
        const first = widths.findIndex((w) => w > 0);
        n.border = { color: color(colors[first]), widths, dashed: /dashed|dotted/.test([cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle][first]) };
        if (colors.some((c, i) => widths[i] && c !== colors[first])) warn("BORDER_COLORS", "\u591A\u8272\u8FB9\u6846\u91C7\u7528\u7B2C\u4E00\u4E2A\u53EF\u89C1\u8FB9\u7684\u989C\u8272", name);
      }
      n.effects = effects(cs.boxShadow);
      n.clip = clips(cs.overflowX) || clips(cs.overflowY);
      const childClip = n.clip ? { left: Math.max(inheritedClip?.left ?? -Infinity, clips(cs.overflowX) ? rect.left : -Infinity), right: Math.min(inheritedClip?.right ?? Infinity, clips(cs.overflowX) ? rect.right : Infinity), top: Math.max(inheritedClip?.top ?? -Infinity, clips(cs.overflowY) ? rect.top : -Infinity), bottom: Math.min(inheritedClip?.bottom ?? Infinity, clips(cs.overflowY) ? rect.bottom : Infinity) } : inheritedClip;
      if (cs.transform !== "none") warn("TRANSFORM", "CSS \u53D8\u6362\u6309\u5C4F\u5E55\u5305\u56F4\u76D2\u6355\u83B7\uFF0C\u65CB\u8F6C\u548C\u503E\u659C\u53EF\u80FD\u6709\u5DEE\u5F02", name);
      if (cs.filter !== "none" || cs.backdropFilter !== "none" || cs.clipPath !== "none") warn("VISUAL_EFFECT", "\u6EE4\u955C\u3001\u80CC\u666F\u6A21\u7CCA\u548C clip-path \u672A\u8F6C\u6362", name);
      for (const pseudo of ["::before", "::after"]) {
        const style = win.getComputedStyle(el, pseudo);
        if (style.content && !["none", "normal"].includes(style.content) && style.display !== "none" && (!['""', "''"].includes(style.content) || color(style.backgroundColor).a > 0 || px(style.borderTopWidth) > 0 || style.backgroundImage !== "none")) warn("PSEUDO_ELEMENT", "\u4F2A\u5143\u7D20\u5185\u5BB9\u672A\u5BFC\u5165\uFF0C\u5EFA\u8BAE\u6539\u4E3A\u771F\u5B9E DOM \u6216 SVG", name);
      }
      if (n.kind === "svg") {
        n.svg = svgString(el, rect);
        return n;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === "img") {
        const img = el;
        if (img.currentSrc || img.src) {
          const id = asset(img.currentSrc || img.src);
          n.fills.push({ type: "image", assetId: id, fit: cs.objectFit === "contain" || cs.objectFit === "scale-down" ? "FIT" : "FILL" });
          if (!img.complete || !img.naturalWidth) warn("IMAGE_NOT_READY", "\u90E8\u5206\u56FE\u7247\u672A\u5B8C\u6210\u52A0\u8F7D\uFF0C\u5BFC\u5165\u65F6\u4F1A\u5C1D\u8BD5\u91CD\u65B0\u83B7\u53D6", name);
          try {
            if (img.naturalWidth > 0 && img.naturalWidth * img.naturalHeight <= 16e6) {
              const canvas = doc.createElement("canvas");
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              canvas.getContext("2d").drawImage(img, 0, 0);
              const data = canvas.toDataURL("image/png");
              Object.assign(assets.find((a) => a.id === id), { mime: "image/png", base64: data.split(",")[1] });
            }
          } catch {
          }
        }
        return n;
      }
      if (["canvas", "video", "iframe"].includes(tag)) {
        if (tag === "canvas") {
          if (!el.width || !el.height) return n;
          try {
            n.fills.push({ type: "image", assetId: asset(el.toDataURL("image/png")), fit: "FILL" });
            warn("CANVAS_RASTER", "Canvas \u4EE5\u4F4D\u56FE\u5BFC\u5165\uFF0C\u5185\u90E8\u5185\u5BB9\u4E0D\u53EF\u5355\u72EC\u7F16\u8F91", name);
          } catch {
            warn("CANVAS_BLOCKED", "\u53D7\u8DE8\u57DF\u9650\u5236\u7684 Canvas \u672A\u80FD\u6355\u83B7", name);
          }
        } else warn("EMBED_UNSUPPORTED", "\u89C6\u9891\u548C iframe \u4EC5\u4FDD\u7559\u5BB9\u5668", name);
        return n;
      }
      if (tag === "input" && ["checkbox", "radio"].includes(el.type)) {
        const control = el, radio = control.type === "radio", checked = control.checked;
        const accent = color(cs.accentColor === "auto" ? "#2563eb" : cs.accentColor);
        const ink = `rgb(${Math.round(accent.r * 255)},${Math.round(accent.g * 255)},${Math.round(accent.b * 255)})`;
        n.kind = "svg";
        n.fills = [];
        n.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n.width}" height="${n.height}" viewBox="0 0 16 16">${radio ? `<circle cx="8" cy="8" r="6.5" fill="white" stroke="${checked ? ink : "#8a94a3"}"/>${checked ? `<circle cx="8" cy="8" r="3.5" fill="${ink}"/>` : ""}` : `<rect x="1" y="1" width="14" height="14" rx="3" fill="${checked ? ink : "white"}" stroke="${checked ? ink : "#8a94a3"}"/>${checked ? '<path d="m4 8 2.5 2.5L12 5" fill="none" stroke="white" stroke-width="1.7" stroke-linecap="round"/>' : ""}`}</svg>`;
        return n;
      }
      if (el.shadowRoot) warn("SHADOW_DOM", "Shadow DOM \u7684\u5185\u90E8\u5185\u5BB9\u672A\u6355\u83B7", name);
      n.children = [];
      for (const child of ["input", "textarea", "select"].includes(tag) ? [] : Array.from(el.childNodes)) {
        if (child.nodeType === 3) n.children.push(...textNodes(child, rect, cs, textPaints));
        else if (child.nodeType === 1) {
          const childNode = walk(child, rect, depth + 1, childClip);
          if (childNode) n.children.push(childNode);
        }
      }
      if (["input", "textarea", "select"].includes(tag)) {
        const value = tag === "select" ? Array.from(el.selectedOptions).map((o) => o.textContent || "").join(", ") : el.value || el.placeholder;
        if (value) {
          const placeholder = tag !== "select" && !el.value && !!el.placeholder;
          const textColor = color(placeholder ? win.getComputedStyle(el, "::placeholder").color || cs.color : cs.color);
          if (placeholder) {
            const alpha = Number(win.getComputedStyle(el, "::placeholder").opacity);
            if (Number.isFinite(alpha)) textColor.a *= alpha;
          }
          const t = base("text", "\u8868\u5355\u6587\u5B57", { x: rect.x + px(cs.paddingLeft) + widths[3], y: rect.y + px(cs.paddingTop) + widths[0], width: Math.max(1, rect.width - px(cs.paddingLeft) - px(cs.paddingRight)), height: px(cs.lineHeight) || px(cs.fontSize) * 1.2 }, rect);
          t.text = { value: el.type === "password" && !placeholder ? "\u2022".repeat(Math.min(value.length, 20)) : value, families: splitCSS(cs.fontFamily).map((f) => f.replace(/^['"]|['"]$/g, "")), size: px(cs.fontSize) || 16, weight: px(cs.fontWeight) || 400, italic: cs.fontStyle !== "normal", lineHeight: px(cs.lineHeight) || px(cs.fontSize) * 1.2, letterSpacing: px(cs.letterSpacing), color: textColor, decoration: "NONE" };
          n.children.push(t);
        }
        if (tag === "select" && !el.multiple) {
          const arrow = base("svg", "\u4E0B\u62C9\u7BAD\u5934", { x: rect.right - 22, y: rect.y + rect.height / 2 - 5, width: 12, height: 10 }, rect);
          arrow.svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 10" width="12" height="10"><path d="m2 3 4 4 4-4" fill="none" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/></svg>';
          n.children.push(arrow);
        }
      }
      if (cs.display === "flex" || cs.display === "inline-flex") {
        const horizontal = cs.flexDirection.startsWith("row");
        const main = cs.justifyContent === "center" ? "CENTER" : /^(flex-)?end$/.test(cs.justifyContent) ? "MAX" : cs.justifyContent === "space-between" ? "SPACE_BETWEEN" : "MIN";
        const cross = cs.alignItems === "center" ? "CENTER" : /^(flex-)?end$/.test(cs.alignItems) ? "MAX" : "MIN";
        const eligible = cs.flexWrap === "nowrap" && !cs.flexDirection.endsWith("reverse") && !["space-around", "space-evenly"].includes(cs.justifyContent) && !["baseline", "last baseline"].includes(cs.alignItems) && n.children.length === el.children.length && Array.from(el.children).every((c) => {
          const s = win.getComputedStyle(c);
          return !["absolute", "fixed"].includes(s.position) && [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft].every((m) => m === "0px");
        });
        n.layout = { direction: horizontal ? "HORIZONTAL" : "VERTICAL", gap: px(horizontal ? cs.columnGap : cs.rowGap), padding: [px(cs.paddingTop) + widths[0], px(cs.paddingRight) + widths[1], px(cs.paddingBottom) + widths[2], px(cs.paddingLeft) + widths[3]], main, cross, eligible };
      }
      return n;
    };
    const rootRect = rootEl.getBoundingClientRect();
    const root = walk(rootEl, rootRect, 0, options.clipToViewport ? { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight } : void 0);
    if (!root) throw new Error("\u6355\u83B7\u533A\u57DF\u4E0D\u53EF\u89C1\u6216\u6CA1\u6709\u53EF\u5BFC\u5165\u5185\u5BB9");
    root.x = root.y = 0;
    if (rootEl === doc.body || rootEl === doc.documentElement) {
      root.width = Math.max(root.width, rootEl.scrollWidth);
      root.height = Math.max(root.height, rootEl.scrollHeight);
      root.clip = false;
    }
    const result = { schemaVersion: SCHEMA_VERSION, name: options.name?.trim() || doc.title || "HTML \u9875\u9762", createdAt: (/* @__PURE__ */ new Date()).toISOString(), source: { title: doc.title, url: win.location.href, viewport: { width: win.innerWidth, height: win.innerHeight }, selector }, root, assets, diagnostics, stats: { ...countScene(root), missingAssets: assets.filter((a) => !a.base64).length } };
    return result;
  }
  async function embedBrowserAssets(document2) {
    let bytes = document2.assets.reduce((n, a) => n + (a.base64?.length || 0) * 0.75, 0);
    for (const a of document2.assets) {
      if (a.base64) continue;
      try {
        if (!/^(https?:|blob:|data:image\/)/i.test(a.url)) throw new Error("\u8D44\u6E90\u8DEF\u5F84\u65E0\u6CD5\u76F4\u63A5\u8BFB\u53D6");
        const response = await fetch(a.url, { signal: AbortSignal.timeout(6e3), credentials: "omit" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (blob.size > 8 * 1024 * 1024 || bytes + blob.size > LIMITS.assetBytes) throw new Error("\u56FE\u7247\u4F53\u79EF\u8D85\u9650");
        if (!blob.type.startsWith("image/")) throw new Error("\u8D44\u6E90\u4E0D\u662F\u56FE\u7247");
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        a.base64 = data.split(",")[1];
        a.mime = blob.type;
        bytes += blob.size;
      } catch {
        addDiagnostic(document2.diagnostics, "ASSET_MISSING", "\u56FE\u7247\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u4F7F\u7528\u672C\u5730\u670D\u52A1\u6355\u83B7\uFF0C\u6216\u5C06\u56FE\u7247\u5185\u5D4C\u5230 HTML", a.url.slice(0, 180));
      }
    }
    for (const a of document2.assets) {
      if (!a.base64 || !a.mime || ["image/png", "image/jpeg", "image/gif"].includes(a.mime)) continue;
      try {
        const image = new Image();
        image.src = `data:${a.mime};base64,${a.base64}`;
        await image.decode();
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16e6) throw new Error("\u56FE\u7247\u5C3A\u5BF8\u8D85\u9650");
        const canvas = window.document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const base64 = canvas.toDataURL("image/png").split(",")[1];
        const nextBytes = bytes - a.base64.length * 0.75 + base64.length * 0.75;
        if (nextBytes > LIMITS.assetBytes) throw new Error("\u56FE\u7247\u4F53\u79EF\u8D85\u9650");
        bytes = nextBytes;
        a.base64 = base64;
        a.mime = "image/png";
      } catch {
        delete a.base64;
        addDiagnostic(document2.diagnostics, "IMAGE_FORMAT", "\u90E8\u5206\u56FE\u7247\u65E0\u6CD5\u89E3\u7801\uFF0C\u5DF2\u4FDD\u7559\u5360\u4F4D", a.url.slice(0, 180));
      }
    }
    document2.stats.missingAssets = document2.assets.filter((a) => !a.base64).length;
    return document2;
  }
  if (typeof window !== "undefined") window.HTMLToFigma = { captureDOM, embedBrowserAssets };
})();

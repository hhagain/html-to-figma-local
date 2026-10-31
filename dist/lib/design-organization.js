// src/design-organization.ts
var PAGE_LEVELS = { primary: "\u4E00\u7EA7\u9875\u9762", secondary: "\u4E8C\u7EA7\u9875\u9762", feature: "\u529F\u80FD\u9875\u9762", unclassified: "\u5F85\u786E\u8BA4\u9875\u9762" };
var short = (s, limit = 150) => String(s || "").trim().slice(0, limit);
function organizationKey(...parts) {
  let hash = 2166136261;
  const s = parts.join("");
  for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 16777619);
  return `d${(hash >>> 0).toString(16)}`;
}
function validOrganization(v) {
  const o = v;
  return !!o && typeof o === "object" && !Array.isArray(o) && ["projectId", "moduleId", "pageId", "viewId"].every((k) => typeof o[k] === "string" && /^[\w-]{1,200}$/.test(o[k])) && (o.parentPageId === void 0 || typeof o.parentPageId === "string" && /^[\w-]{1,200}$/.test(o.parentPageId)) && ["moduleName", "pageName", "stateName", "reason"].every((k) => typeof o[k] === "string" && o[k].length > 0 && o[k].length <= 500) && Object.prototype.hasOwnProperty.call(PAGE_LEVELS, o.level) && ["page", "dialog", "form", "selection", "scroll", "state"].includes(o.kind) && ["high", "medium", "low"].includes(o.confidence) && !!o.scroll && typeof o.scroll.container === "string" && o.scroll.container.length <= 700 && [o.scroll.x, o.scroll.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e7);
}
function inferOrganization(o) {
  const source = new URL(o.url), entry = new URL(o.entryURL);
  const projectURL = new URL(entry);
  projectURL.hash = "";
  projectURL.search = "";
  const projectId = organizationKey(projectURL.href), parent = o.parent;
  const primary = o.primary;
  const moduleName = short(primary?.name || parent?.moduleName || o.explicitGroup || o.heading || o.title || "\u672A\u5206\u7C7B\u6A21\u5757");
  const moduleId = primary ? organizationKey(projectId, primary.key) : parent?.moduleId || organizationKey(projectId, moduleName);
  const primaryPageId = organizationKey(moduleId, "primary");
  const route = source.pathname + source.search + source.hash;
  const action = o.actionKind || "", isScroll = action === "\u6EDA\u52A8";
  const sampledScroll = o.scrolls?.find((s) => s.y > 0 || s.x > 0) || o.scrolls?.[0] || { container: "document", x: 0, y: 0 };
  const scroll = { container: short(sampledScroll.container, 700), x: Math.max(0, Math.min(1e7, sampledScroll.x)), y: Math.max(0, Math.min(1e7, sampledScroll.y)) };
  const common = {
    projectId,
    moduleId,
    moduleName,
    viewId: organizationKey(projectId, route, o.viewFingerprint),
    scroll,
    stateName: short(isScroll && parent ? parent.stateName : o.name || primary?.name || o.heading || o.title || "\u9ED8\u8BA4\u72B6\u6001")
  };
  if (isScroll && parent) return { ...parent, ...common, viewId: parent.viewId, kind: "scroll" };
  if (o.dialog) {
    const continuation = parent?.level === "feature" && (short(o.heading) === parent.pageName || ["\u8868\u5355", "\u6821\u9A8C", "\u9009\u62E9"].includes(action));
    const pageName2 = continuation ? parent.pageName : short(o.heading || o.name || "\u5F39\u7A97");
    return {
      ...common,
      level: "feature",
      pageId: continuation ? parent.pageId : organizationKey(moduleId, "feature", pageName2),
      pageName: pageName2,
      parentPageId: continuation ? parent.parentPageId : parent?.pageId || primaryPageId,
      kind: action === "\u8868\u5355" || action === "\u6821\u9A8C" ? "form" : action === "\u9009\u62E9" ? "selection" : "dialog",
      confidence: "high",
      reason: "\u68C0\u6D4B\u5230\u5F39\u7A97\u6216\u8868\u5355\uFF0C\u6309\u6253\u5F00\u5B83\u7684\u6240\u5C5E\u9875\u9762\u5F52\u7EC4"
    };
  }
  const parentRoute = (() => {
    try {
      const u = new URL(o.parentURL || o.url);
      return u.pathname + (u.hash.startsWith("#/") ? u.hash.split("?")[0] : "");
    } catch {
      return "";
    }
  })();
  const ownRoute = source.pathname + (source.hash.startsWith("#/") ? source.hash.split("?")[0] : "");
  if (parent && moduleId === parent.moduleId && (ownRoute !== parentRoute || action === "\u8BE6\u60C5" && !primary)) {
    const tail = short(o.name).split(/[，,]/).pop() || "";
    const pageName2 = short(/^(查看|打开|进入).*(详情|明细)$/.test(tail) ? tail.replace(/^(查看|打开|进入)/, "") : o.heading || o.name || "\u8BE6\u60C5\u9875");
    return {
      ...common,
      level: "secondary",
      pageId: organizationKey(moduleId, "secondary", o.triggerFamily || ownRoute),
      pageName: pageName2,
      parentPageId: organizationKey(moduleId, "secondary", o.triggerFamily || ownRoute) === parent.pageId ? parent.parentPageId || primaryPageId : parent.pageId,
      kind: "page",
      confidence: "medium",
      reason: "\u4ECE\u6240\u5C5E\u9875\u9762\u8FDB\u5165\u72EC\u7ACB\u8BE6\u60C5\u6216\u53D1\u751F\u9875\u9762\u8DEF\u7531\u8DF3\u8F6C"
    };
  }
  if (primary && parent && o.featureName && !["\u5BFC\u822A", "\u5165\u53E3", "\u6EDA\u52A8"].includes(action)) return { ...common, level: "feature", pageId: organizationKey(moduleId, "feature", o.featureName), pageName: short(o.featureName), parentPageId: primaryPageId, kind: action === "\u9009\u62E9" ? "selection" : "state", confidence: "medium", reason: "\u63A7\u4EF6\u4F4D\u4E8E\u540C\u4E00\u529F\u80FD\u533A\u57DF\uFF0C\u4F5C\u4E3A\u8BE5\u529F\u80FD\u7684\u4E0D\u540C\u72B6\u6001" };
  if (primary) return {
    ...common,
    level: "primary",
    pageId: primaryPageId,
    pageName: moduleName,
    kind: isScroll ? "scroll" : action === "\u9009\u62E9" ? "selection" : action && action !== "\u5BFC\u822A" ? "state" : "page",
    confidence: "high",
    reason: "\u5F53\u524D\u9875\u5BF9\u5E94\u5DF2\u9009\u4E2D\u7684\u4E3B\u5BFC\u822A\u5165\u53E3"
  };
  if (parent) return { ...parent, ...common, kind: action === "\u8868\u5355" || action === "\u6821\u9A8C" ? "form" : action === "\u9009\u62E9" ? "selection" : "state", reason: "\u8DEF\u7531\u4E0E\u9875\u9762\u7ED3\u6784\u4FDD\u6301\u4E00\u81F4\uFF0C\u4F5C\u4E3A\u540C\u9875\u7684\u53E6\u4E00\u72B6\u6001" };
  const pageName = short(o.heading || o.name || o.title || "\u5F53\u524D\u9875\u9762");
  return { ...common, level: "unclassified", pageId: organizationKey(moduleId, route, pageName), pageName, kind: "page", confidence: "low", reason: "\u672A\u53D1\u73B0\u53EF\u9760\u4E3B\u5BFC\u822A\u6216\u8FDB\u5165\u5173\u7CFB\uFF0C\u9875\u9762\u5C42\u7EA7\u5F85\u786E\u8BA4" };
}
function designLayout(pages) {
  const sections = /* @__PURE__ */ new Map();
  pages.forEach((p, index) => {
    if (!p.design) return;
    const d = p.design, key = [d.projectId, d.moduleId, d.level, d.pageId].join(":");
    const s = sections.get(key);
    if (s) s.indices.push(index);
    else sections.set(key, { design: d, indices: [index] });
  });
  const modules = /* @__PURE__ */ new Map();
  for (const [id, s] of sections) {
    const key = s.design.projectId + ":" + s.design.moduleId;
    if (!modules.has(key)) modules.set(key, /* @__PURE__ */ new Map());
    modules.get(key).set(id, s);
  }
  const groups = [], positions = /* @__PURE__ */ new Map();
  let moduleY = 0, width = 0;
  for (const sectionMap of modules.values()) {
    let columnX = 0, moduleHeight = 0;
    for (const level of Object.keys(PAGE_LEVELS)) {
      let sectionY = moduleY, columnWidth = 0;
      for (const [id, s] of sectionMap) {
        if (s.design.level !== level) continue;
        const views = /* @__PURE__ */ new Map();
        for (const i of s.indices) {
          const key = pages[i].design.viewId;
          const v = views.get(key);
          if (v) v.push(i);
          else views.set(key, [i]);
        }
        let x = 80, y = 112, rowHeight = 0, maxRight = 80;
        const local = /* @__PURE__ */ new Map();
        if (pages[s.indices[0]].artifact?.kind === "icon") {
          const columns = Math.min(12, s.indices.length);
          s.indices.forEach((i, n) => local.set(i, { x: 80 + n % columns * 96, y: 112 + Math.floor(n / columns) * 96 }));
          maxRight = 80 + columns * 96 - 24;
          y = 112 + Math.floor((s.indices.length - 1) / columns) * 96;
          rowHeight = 64;
        } else for (const view of views.values()) {
          view.sort((a, b) => pages[a].design.scroll.y - pages[b].design.scroll.y || pages[a].design.scroll.x - pages[b].design.scroll.x || a - b);
          const viewWidth = view.reduce((sum, i) => sum + pages[i].width, 0) + 24 * Math.max(0, view.length - 1);
          const viewHeight = view.reduce((max, i) => Math.max(max, pages[i].height), 0);
          if (x > 80 && x + viewWidth > 4800) {
            x = 80;
            y += rowHeight + 120;
            rowHeight = 0;
          }
          let partX = x;
          for (const i of view) {
            local.set(i, { x: partX, y });
            partX += pages[i].width + 24;
          }
          maxRight = Math.max(maxRight, x + viewWidth);
          x += viewWidth + 96;
          rowHeight = Math.max(rowHeight, viewHeight);
        }
        const sectionWidth = maxRight + 80, sectionHeight = y + rowHeight + 80;
        for (const [i, p] of local) positions.set(i, { x: columnX + p.x, y: sectionY + p.y, groupId: id });
        groups.push({ id, name: pages[s.indices[0]].artifact?.kind === "icon" ? "\u56FE\u6807\u5E93" : `${pages[s.indices[0]].artifact?.kind === "component" ? "\u7EC4\u4EF6\u72B6\u6001" : PAGE_LEVELS[s.design.level]} \xB7 ${s.design.moduleName}${s.design.pageName === s.design.moduleName ? "" : " / " + s.design.pageName}`, x: columnX, y: sectionY, width: sectionWidth, height: sectionHeight, indices: [...views.values()].flat() });
        sectionY += sectionHeight + 160;
        columnWidth = Math.max(columnWidth, sectionWidth);
      }
      if (columnWidth) {
        columnX += columnWidth + 200;
        moduleHeight = Math.max(moduleHeight, sectionY - moduleY);
      }
    }
    width = Math.max(width, Math.max(0, columnX - 200));
    moduleY += moduleHeight + 240;
  }
  return { positions, groups, width, height: Math.max(0, moduleY - 240) };
}
export {
  PAGE_LEVELS,
  designLayout,
  inferOrganization,
  organizationKey,
  validOrganization
};

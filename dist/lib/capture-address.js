// src/capture-address.ts
function normalizeCaptureAddress(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("\u8BF7\u8F93\u5165\u7F51\u9875\u5730\u5740\u6216\u672C\u5730 HTML \u8DEF\u5F84");
  let value = input.trim();
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).trim();
  if (/^Users\//.test(value)) value = "/" + value;
  if (value.startsWith("/") && !value.startsWith("//")) {
    const parts = value.match(/^(.+?\.html?)([?#].*)?$/i);
    if (!parts) throw new Error("\u672C\u5730\u8DEF\u5F84\u9700\u8981\u6307\u5411 .html \u6216 .htm \u6587\u4EF6");
    if (/%(?:2f|5c|00)/i.test(parts[1])) throw new Error("\u672C\u5730\u8DEF\u5F84\u5305\u542B\u65E0\u6548\u7684\u7F16\u7801\u5206\u9694\u7B26");
    let pathname;
    try {
      pathname = decodeURIComponent(parts[1].replace(/%(?![\da-f]{2})/gi, "%25"));
    } catch {
      throw new Error("\u672C\u5730\u8DEF\u5F84\u7684\u767E\u5206\u53F7\u7F16\u7801\u65E0\u6548");
    }
    value = "file://" + pathname.split("/").map(encodeURIComponent).join("/") + (parts[2] || "");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("\u8BF7\u8F93\u5165 http / https \u5730\u5740\uFF0C\u6216 /Users/\u2026/index.html \u672C\u5730\u8DEF\u5F84");
  }
  if (!["http:", "https:", "file:"].includes(url.protocol) || url.username || url.password) throw new Error("\u4EC5\u652F\u6301\u7F51\u9875\u5730\u5740\u548C\u672C\u5730 HTML \u8DEF\u5F84\uFF0C\u4E0D\u80FD\u5305\u542B\u8D26\u53F7\u5BC6\u7801");
  return url.href;
}
export {
  normalizeCaptureAddress
};

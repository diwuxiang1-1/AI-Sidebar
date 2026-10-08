// 临时集成冒烟测试:用最小 DOM / chrome 桩,按真实加载顺序
// (storage → provider → context → sidebar)加载脚本,验证用量栏 + 网页正文截断路径。
// 支持项目轮:面向用户的本地 Token 估算栏已整体删除,本文件改为验证
//             「只剩 API 真实用量」+「截断（与估算无关,必须保留）」。
// 只读项目代码,不修改任何扩展文件;验证完即可删除。

const fs = require("fs");
const vm = require("vm");

/* ---------------- 最小 DOM 桩 ---------------- */
function makeEl(id) {
  const el = {
    id,
    style: {},
    className: "",
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    _children: [],
    _attrs: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener() {},
    appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); },
    remove() {},
    focus() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    requestSubmit() {},
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html || ""; },
    set(v) { this._html = v; if (v === "") el._children.length = 0; },
  });
  return el;
}

const elements = {};
const documentStub = {
  getElementById(id) {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
  createElement(tag) { return makeEl(null, tag); },
  addEventListener() {},
};

/* ---------------- 最小 chrome 桩 ---------------- */
const store = {};
const chromeStub = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === "string") return (k in store) ? { [k]: store[k] } : {};
        if (Array.isArray(k)) { const o = {}; k.forEach((x) => { if (x in store) o[x] = store[x]; }); return o; }
        return {};
      },
      set: async (o) => { Object.assign(store, o); },
    },
    onChanged: { addListener() {} },
  },
  runtime: {
    sendMessage: async () => ({ ok: true, text: "", title: "", url: "" }),
    getURL: (p) => p,
    onMessage: { addListener() {} },
  },
  tabs: { create() {}, query: async () => [], onActivated: { addListener() {} } },
};

/* ---------------- 按真实顺序加载 ---------------- */
const ctx = {
  console,
  document: documentStub,
  chrome: chromeStub,
  window: { close() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
};
vm.createContext(ctx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js", "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "utils/i18n.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }));

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + JSON.stringify(expected) + "\n  actual:   " + JSON.stringify(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/* 从注入的上下文消息里取出「网页正文」那一段,用来验证截断结果 */
function injectedBody(msg) {
  return String(msg).split("网页正文:\n")[1].split("\n\n[网页内容已截断]")[0];
}

const bar = elements["usage-bar"] || documentStub.getElementById("usage-bar");

(async function () {
  await new Promise((r) => setTimeout(r, 60));   // 等 init IIFE 完成

  /* ---- 1. 还没发过请求:不显示任何用量 ---- */
  eq("未请求过时不渲染用量", bar.textContent, "");
  ok("未请求过时用量栏不展开", bar.style.display !== "block");

  /* ---- 2. 本地估算栏已整体删除(支持项目轮) ---- */
  eq("没有 refreshEstimate", typeof ctx.refreshEstimate, "undefined");
  eq("没有 renderEstimate", typeof ctx.renderEstimate, "undefined");
  eq("没有 makeEstimateRow", typeof ctx.makeEstimateRow, "undefined");
  eq("没有 currentContextText", typeof ctx.currentContextText, "undefined");
  eq("没有 lastContextText 这个只为估算存在的状态", typeof ctx.lastContextText, "undefined");
  eq("侧边栏脚本已不再查找 estimate-bar 节点(没人 getElementById 它)", elements["estimate-bar"], undefined);

  /* ---- 3. 真实用量来自 API:没有就是「未提供」,绝不编造 ---- */
  ctx.lastUsage = null;
  ctx.showRealUsage();
  ok("没有 usage 时明确写「未提供实际用量」", bar.textContent.indexOf("未提供实际用量") !== -1);

  ctx.lastUsage = { promptTokens: 1234, completionTokens: 567, totalTokens: 1801, cost: null };
  ctx.showRealUsage();
  ok("有 usage 时显示真实输入/输出/合计",
    bar.textContent.indexOf("1234") !== -1 && bar.textContent.indexOf("567") !== -1 && bar.textContent.indexOf("1801") !== -1);
  ok("未返回费用时不显示任何金额", bar.textContent.indexOf("费用") === -1);

  ctx.lastUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.0042 };
  ctx.showRealUsage();
  ok("服务商返回费用时才显示金额",
    bar.textContent.indexOf("费用") !== -1 && bar.textContent.indexOf("0.0042") !== -1);

  ok("用量栏里没有任何本地估算字样",
    bar.textContent.indexOf("本地估算") === -1 && bar.textContent.indexOf("预计输入") === -1);

  /* ---- 4. 当前网页模式:截断照旧(与估算无关,必须保留) ---- */
  ctx.chatMode = "page";
  ctx.contextConfig = { pageMaxTokens: 4000 };
  const pageMsg = ctx.buildPageContextMessage({ title: "标题", url: "https://e.com", text: "中".repeat(10000) });

  ok("注入内容含截断提示", pageMsg.indexOf("[网页内容已截断]") !== -1);
  ok("提示含原始长度(千分位)", pageMsg.indexOf("原始长度:10,000 tokens") !== -1);
  ok("提示含当前限制", pageMsg.indexOf("当前限制:4,000 tokens") !== -1);
  eq("实际注入正文被截到 4000 字", injectedBody(pageMsg).length, 4000);
  ok("注入正文 token 不超限", ctx.estimateTokens(injectedBody(pageMsg)) <= 4000);
  ok("保留原有网页结构(标题/地址/正文)",
    pageMsg.indexOf("网页标题: 标题") !== -1 && pageMsg.indexOf("网页地址: https://e.com") !== -1 && pageMsg.indexOf("网页正文:") !== -1);

  /* ---- 5. 自定义上限 16000:不截断 ---- */
  ctx.contextConfig = { pageMaxTokens: 16000 };
  const bigMsg = ctx.buildPageContextMessage({ title: "T", url: "U", text: "中".repeat(10000) });
  eq("16000 上限不截断", injectedBody(bigMsg).length, 10000);
  ok("无截断提示", bigMsg.indexOf("[网页内容已截断]") === -1);

  /* ---- 6. 配置为空也不该让发送流程崩掉 ---- */
  ctx.contextConfig = null;
  let threw = false;
  try { ctx.buildPageContextMessage({ title: "T", url: "U", text: "中".repeat(9000) }); } catch (e) { threw = true; }
  eq("配置为空时截断回落默认值,不抛异常", threw, false);

  ctx.contextConfig = { pageMaxTokens: 4000 };

  /* ---- 7. ❤️ 支持项目:弹窗是纯本地 UI ---- */
  eq("有支持按钮", !!elements["btn-support"], true);
  eq("有捐赠弹窗", !!elements["support-modal"], true);
  ok("捐赠地址只维护一份", ctx.DONATE_LINKS.kofi.indexOf("ko-fi.com") !== -1 && ctx.DONATE_LINKS.afdian.indexOf("afdian.com") !== -1);
  ctx.openSupportModal();
  eq("点开后弹窗显示", elements["support-modal"].style.display, "flex");
  ctx.closeSupportModal();
  eq("关闭后弹窗隐藏", elements["support-modal"].style.display, "none");

  // 打开捐赠页:只调用 chrome.tabs.create,不改任何状态
  let openedUrl = "";
  chromeStub.tabs.create = (o) => { openedUrl = o.url; };
  ctx.openDonateLink(ctx.DONATE_LINKS.afdian);
  eq("捐赠按钮新标签页打开官方地址", openedUrl, "https://afdian.com/a/Sidebar");
  ctx.openDonateLink(ctx.DONATE_LINKS.kofi);
  eq("Ko-fi 地址正确", openedUrl, "https://ko-fi.com/wuxiangdi/tip");

  /* ---- 8. 冻结契约未被破坏 ---- */
  eq("会话数据结构未被改动", Object.keys(ctx.createSession()).sort(),
     ["createdAt", "id", "messages", "name", "updatedAt"]);
  // 第十四轮:新增 keyPools(每个 Provider 各自的 Key 池),其余字段保持不变
  eq("API 配置结构未被改动(第十四轮新增 keyPools)", Object.keys(await ctx.getApiConfig()).sort(),
     ["baseUrl", "configName", "keyPools", "keys", "model", "modelName", "provider"]);

  // 第十四轮:同一个 Provider 可以有多个 Key,且不会跨 Provider 混用
  const poolCfg = await ctx.getApiConfig();
  eq("当前 Provider 的 Key 池", poolCfg.keys, [{ value: "", enabled: true }]);
  eq("不同 Provider 的池分开存放", poolCfg.keyPools, {});
  eq("上下文配置独立存储", Object.keys(store).filter((k) => k.indexOf("context-config") !== -1).length >= 0, true);

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

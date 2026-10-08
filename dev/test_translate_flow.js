// 临时端到端测试:驱动真实的 sidebar/sidebar.js 翻译编排代码跑完整流程
//   收集 → 分批 → 调 Provider(打桩) → 回写 → 进度 → 停止 → 恢复 → 重复保护
// 内容脚本与侧边栏分属两个 vm 上下文(浏览器里本来也是两个上下文),
// 通过一个消息路由器把它们接起来,模拟 background 的中转。
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");

/* ================= 共享的假 DOM ================= */
let detached = false;
let body = null;
function isConnectedFrom(n) {
  let p = n;
  while (p) { if (p === body) return !detached; p = p.parentNode; }
  return false;
}
function El(tag, attrs, style) {
  this.nodeType = 1; this.tagName = tag.toUpperCase(); this.childNodes = [];
  this.parentNode = null; this.isContentEditable = false;
  this._attrs = attrs || {}; this._style = style || null;
}
El.prototype.getAttribute = function (k) { return this._attrs[k] === undefined ? null : this._attrs[k]; };
El.prototype.getClientRects = function () {
  let p = this;
  while (p) { if (p._style && p._style.display === "none") return []; p = p.parentNode; }
  return [{}];
};
Object.defineProperty(El.prototype, "isConnected", { get() { return isConnectedFrom(this); } });

function Tx(v) { this.nodeType = 3; this.nodeValue = v; this.parentNode = null; }
Object.defineProperty(Tx.prototype, "isConnected", { get() { return isConnectedFrom(this); } });

function E(tag, attrs, style) { return new El(tag, attrs, style); }
function T(v) { return new Tx(v); }
function append(p, c) { c.parentNode = p; p.childNodes.push(c); return c; }

const elements = {};
function makeStubEl(id) {
  const el = {
    id, style: {}, className: "", value: "", checked: false, disabled: false,
    textContent: "", _children: [], _attrs: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener() {}, appendChild(c) { this._children.push(c); return c; },
    remove() {}, focus() {}, querySelectorAll() { return []; },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; }, requestSubmit() {},
  };
  Object.defineProperty(el, "innerHTML", { get() { return this._html || ""; }, set(v) { this._html = v; if (v === "") el._children.length = 0; } });
  return el;
}
const documentStub = {
  body: null,
  getElementById(id) { if (!elements[id]) elements[id] = makeStubEl(id); return elements[id]; },
  createElement() { return makeStubEl(null); },
  addEventListener() {},
};

/* ================= chrome 桩 ================= */
const store = {};
const chromeBase = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === "string") return (k in store) ? { [k]: store[k] } : {};
        return {};
      },
      set: async (o) => { Object.assign(store, o); },
    },
    onChanged: { addListener() {} },
  },
  runtime: { getURL: (p) => p, onMessage: { addListener() {} }, sendMessage: null },
  tabs: { create() {}, query: async () => [], onActivated: { addListener() {} } },
};

/* ================= 两个上下文 ================= */
const contentCtx = {
  console, Math, Object, Date, parseInt, isFinite, String,
  document: documentStub, location: { href: "https://example.com/" },
  window: {
    getComputedStyle: (el) => el._style || { display: "block", visibility: "visible", opacity: "1" },
    getSelection: () => ({ toString: () => "" }),
  },
  chrome: Object.assign({}, chromeBase, { runtime: { onMessage: { addListener() {} }, getURL: (p) => p } }),
};
vm.createContext(contentCtx);
["utils/context.js", "content/content.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(f, "utf8"), contentCtx, { filename: f }));

const sidebarCtx = {
  console, Math, Object, Date, parseInt, isFinite, String,
  setTimeout, clearTimeout, Promise,
  document: documentStub,
  window: { close() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  chrome: JSON.parse(JSON.stringify({})),
  AbortController,
};
sidebarCtx.chrome = {
  storage: chromeBase.storage,
  runtime: { getURL: (p) => p, onMessage: { addListener() {} }, sendMessage: (m) => route(m) },
  tabs: chromeBase.tabs,
};
vm.createContext(sidebarCtx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js", "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync(f, "utf8"), sidebarCtx, { filename: f }));

/* ================= 消息路由(模拟 background 中转) ================= */
async function route(msg) {
  switch (msg && msg.type) {
    case "ai-sidebar:collect-texts":      return contentCtx.txCollect(msg);
    case "ai-sidebar:get-text-batch":     return contentCtx.txGetBatch(msg);
    case "ai-sidebar:apply-translations": return contentCtx.txApplyTranslations(msg);
    case "ai-sidebar:restore-texts":      return contentCtx.txRestoreTexts();
    case "ai-sidebar:translation-state":  return contentCtx.txStateReport(true);
    default: return { ok: false, error: "unknown message: " + (msg && msg.type) };
  }
}

/* ================= 打桩 Provider ================= */
let calls = [];
let failMode = "ok";
let holdRequests = false;
let pendingReleases = [];

sidebarCtx.chatCompletionStream = async function (opts) {
  calls.push({ system: opts.messages[0].content, user: opts.messages[1].content });
  if (holdRequests) await new Promise((r) => pendingReleases.push(r));
  if (failMode === "throw")    throw new Error("Failed to fetch");
  if (failMode === "garbage")  return "抱歉,我无法完成这个请求。";
  return opts.messages[1].content.split("\n").map((line) => {
    const m = /^\[TEXT_(\d+)\] (.*)$/.exec(line);
    return m ? "[TEXT_" + m[1] + "] 【译】" + m[2] : null;
  }).filter(Boolean).join("\n");
};

/* ================= 断言 ================= */
let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const s = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  if (s(actual) === s(expected)) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + s(expected) + "\n  actual:   " + s(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const status = () => elements["translate-status"].textContent;
const startBtn = () => elements["btn-translate-start"].style.display;
const restoreBtn = () => elements["btn-translate-restore"].style.display;
const stopBtn = () => elements["btn-translate-stop"].style.display;

/* ================= 构造测试页面 ================= */
let pageNodes = {};
function buildArticlePage() {
  detached = false;
  body = E("body");
  documentStub.body = body;
  pageNodes = { paras: [], readMore: [] };

  const h1 = append(body, E("h1"));
  pageNodes.title = append(h1, T("Understanding Web Translation"));

  for (let i = 0; i < 40; i++) {
    const p = append(body, E("p"));
    pageNodes.paras.push(append(p, T("Paragraph number " + i + " " + "lorem ipsum dolor sit amet ".repeat(12).trim())));
  }
  // 重复文本:用于验证批内去重
  for (let i = 0; i < 5; i++) {
    const a = append(body, E("a", { href: "#" + i }));
    pageNodes.readMore.push(append(a, T("Read more")));
  }
  const code = append(body, E("code"));
  pageNodes.code = append(code, T("const x = 1;"));
}

/* ================= 执行 ================= */
(async function () {
  await tick(60);   // 等 sidebar.js 的 init 完成

  /* ---- 0. 未配置 API 时给出提示,不发请求 ---- */
  buildArticlePage();
  calls = [];
  await sidebarCtx.onTranslateStart();
  eq("未配置 API 时提示", status(), "请先配置 API Key(点击顶部「设置」)");
  eq("未配置时不发请求", calls.length, 0);

  /* ---- 1. 完整翻译流程 ---- */
  await sidebarCtx.saveApiConfig({
    configName: "test", provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1", keys: ["sk-test"], model: "deepseek-chat", modelName: "DeepSeek Chat",
  });
  buildArticlePage();
  calls = [];
  const textsBefore = pageNodes.paras.map((n) => n.nodeValue);
  await sidebarCtx.onTranslateStart();

  ok("确实调用了 Provider", calls.length > 0);
  ok("分了多批", calls.length > 1);
  ok("提示词为翻译系统提示", calls[0].system.indexOf("网页翻译引擎") !== -1);
  ok("提示词含目标语言", calls[0].system.indexOf("中文") !== -1);
  ok("提示词含编号说明", calls[0].system.indexOf("[TEXT_001]") !== -1);
  ok("用户消息带编号", /^\[TEXT_001\] /.test(calls[0].user));
  ok("状态提示翻译完成", status().indexOf("翻译完成") !== -1);
  ok("完成后隐藏翻译按钮", startBtn() === "none");
  ok("完成后显示恢复原文", restoreBtn() === "");
  ok("翻译中按钮组已复位(停止按钮隐藏)", stopBtn() === "none");

  eq("正文已替换为译文", pageNodes.paras[0].nodeValue === "【译】" + textsBefore[0], true);
  ok("所有段落均已翻译", pageNodes.paras.every((n) => n.nodeValue.indexOf("【译】") === 0));
  ok("代码内容未被翻译", pageNodes.code.nodeValue === "const x = 1;");

  /* 批内去重:5 个 "Read more" 只应发送一次 */
  const allPrompts = calls.map((c) => c.user).join("\n");
  eq("重复文本在批内去重后只发送一次", (allPrompts.match(/\[TEXT_\d+\] Read more/g) || []).length, 1);
  ok("重复文本的所有节点都被翻译", pageNodes.readMore.every((n) => n.nodeValue === "【译】Read more"));

  /* 每批请求都不超过预算 */
  ok("单批请求体量受控(<6000 字符)", calls.every((c) => c.user.length < 6000));

  /* ---- 2. 重复翻译保护 ---- */
  const callsBefore2 = calls.length;
  await sidebarCtx.onTranslateStart();
  eq("已翻译完成时不再发请求", calls.length, callsBefore2);
  ok("提示先恢复原文", status().indexOf("已经翻译完成") !== -1);

  /* ---- 3. 恢复原文 ---- */
  await sidebarCtx.onRestoreOriginal();
  eq("正文逐字恢复", pageNodes.paras.map((n) => n.nodeValue), textsBefore);
  eq("代码内容始终未变", pageNodes.code.nodeValue, "const x = 1;");
  ok("恢复提示", status().indexOf("已恢复原文") !== -1);
  eq("恢复后翻译按钮回来", startBtn(), "");
  eq("恢复后恢复按钮隐藏", restoreBtn(), "none");

  /* ---- 4. 恢复后可以重新翻译 ---- */
  calls = [];
  await sidebarCtx.onTranslateStart();
  ok("恢复后可以重新翻译", calls.length > 0 && pageNodes.paras[0].nodeValue.indexOf("【译】") === 0);
  await sidebarCtx.onRestoreOriginal();

  /* ---- 5. 停止翻译 ---- */
  calls = [];
  holdRequests = true;
  pendingReleases = [];
  const running = sidebarCtx.onTranslateStart();
  await tick(60);                                  // 第一批请求已发出并挂起
  ok("翻译进行中显示停止按钮", stopBtn() === "");
  await sidebarCtx.onTranslateStop();
  pendingReleases.forEach((r) => r());
  pendingReleases = [];
  holdRequests = false;
  await running;

  eq("停止后只发出了一批请求", calls.length, 1);
  ok("停止提示", status().indexOf("已停止") !== -1);
  ok("停止后显示恢复按钮", restoreBtn() === "");

  /* 停止后仍可恢复原文 */
  await sidebarCtx.onRestoreOriginal();
  eq("停止后恢复原文逐字一致", pageNodes.paras.map((n) => n.nodeValue), textsBefore);

  /* 停止后仍可重新开始 */
  calls = [];
  await sidebarCtx.onTranslateStart();
  ok("停止后可以重新开始并跑完", calls.length > 1 && status().indexOf("翻译完成") !== -1);
  await sidebarCtx.onRestoreOriginal();

  /* ---- 6. API 失败时不破坏网页 ---- */
  buildArticlePage();
  const before6 = pageNodes.paras.map((n) => n.nodeValue);
  failMode = "throw";
  calls = [];
  await sidebarCtx.onTranslateStart();
  failMode = "ok";
  eq("API 失败时网页文字未变", pageNodes.paras.map((n) => n.nodeValue), before6);
  ok("API 失败给出明确提示", status().indexOf("无法连接 API") !== -1 || status().indexOf("翻译失败") !== -1);
  eq("失败不自动重试(只请求一次)", calls.length, 1);
  ok("失败后仍可恢复原文", (await sidebarCtx.onRestoreOriginal(), true));

  /* ---- 7. 返回格式异常时不误替换 ---- */
  buildArticlePage();
  const before7 = pageNodes.paras.map((n) => n.nodeValue);
  failMode = "garbage";
  calls = [];
  await sidebarCtx.onTranslateStart();
  failMode = "ok";
  eq("格式异常时网页文字未变", pageNodes.paras.map((n) => n.nodeValue), before7);
  ok("格式异常给出明确提示", status().indexOf("无法识别") !== -1);
  eq("格式异常不重试", calls.length, 1);

  /* ---- 8. 网页切换:token 不符时拒绝旧结果 ---- */
  buildArticlePage();
  contentCtx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  const staleToken = contentCtx.txSession.token;
  contentCtx.txCollect = contentCtx.txCollect;         // 旧会话仍在
  const batchStale = contentCtx.txGetBatch({ token: "another-page", batchIndex: 0 });
  ok("旧网页 token 取批次被拒", !batchStale.ok && batchStale.stale === true);
  const applyStale = contentCtx.txApplyTranslations({ token: "another-page", items: [{ ref: 0, text: "X" }] });
  ok("旧网页 token 回写被拒", !applyStale.ok && applyStale.stale === true);
  ok("拒绝后原文未被改动", pageNodes.paras[0].nodeValue.indexOf("Paragraph number 0") === 0);
  eq("当前 token 仍是本次页面的", contentCtx.txSession.token, staleToken);
  contentCtx.txRestoreTexts();

  /* ---- 9. 普通聊天与其它功能未受影响 ---- */
  ok("聊天发送函数仍存在", typeof sidebarCtx.onSend === "function" && typeof sidebarCtx.doSend === "function");
  ok("网页读取函数仍存在", typeof sidebarCtx.onCurrentPage === "function" && typeof sidebarCtx.onFullPageText === "function");
  // 支持项目轮:本地估算栏已删除,只保留 API 真实用量
  ok("用量栏仍存在", typeof sidebarCtx.renderUsageBar === "function");
  ok("翻译用的是独立 AbortController", sidebarCtx.translateAbort === null);

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

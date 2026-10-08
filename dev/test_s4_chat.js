// 第四阶段专项测试 4/4:聊天与目标网页结合
//   对应验收项 36–42
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");

const R = (function () {
  let pass = 0, fail = 0;
  return {
    eq(l, a, e) {
      const s = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
      if (s(a) === s(e)) pass++;
      else { fail++; console.log("FAIL " + l + "\n  expected: " + s(e) + "\n  actual:   " + s(a)); }
    },
    ok(l, c) { this.eq(l, !!c, true); },
    done() { console.log("\n[聊天 × 目标网页] 通过 " + pass + " 项,失败 " + fail + " 项"); process.exit(fail ? 1 : 0); },
  };
})();

/* ---------------- DOM 桩 ---------------- */
function makeEl(id) {
  const el = {
    id, style: {}, className: "", value: "", checked: false, textContent: "", title: "",
    _children: [], _attrs: {}, _listeners: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener(ev, fn) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    fire(ev) { (el._listeners[ev] || []).forEach((f) => f.call(el, { target: el })); },
    appendChild(c) { el._children.push(c); return c; },
    removeChild(c) { const i = el._children.indexOf(c); if (i >= 0) el._children.splice(i, 1); },
    remove() {},
    get children() { return el._children; },
    focus() {}, requestSubmit() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
    setAttribute(k, v) { el._attrs[k] = v; }, removeAttribute(k) { delete el._attrs[k]; },
    scrollTop: 0, scrollHeight: 0,
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._html || ""; },
    set(v) { el._html = v; if (v === "") el._children.length = 0; },
  });
  return el;
}

const elements = {};
const documentStub = {
  getElementById(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; },
  createElement(t) { return makeEl(t); },
  addEventListener() {},
};

/* ---------------- chrome + 后台桩 ---------------- */
const store = {};
const sent = [];
const tabs = [
  { id: 12, windowId: 1, url: "https://bilibili.example.com/video/1", title: "Bilibili 视频" },
  { id: 15, windowId: 1, url: "https://news.example.com/a", title: "某篇文章" },
  { id: 18, windowId: 1, url: "https://test.example.com/", title: "测试页面" },
];
let activeTabId = 15;
let locked = [
  { tabId: 12, windowId: 1, url: tabs[0].url, title: tabs[0].title, favicon: "", lockedAt: 1, lastSeenUrl: tabs[0].url, state: "locked" },
  { tabId: 15, windowId: 1, url: tabs[1].url, title: tabs[1].title, favicon: "", lockedAt: 2, lastSeenUrl: tabs[1].url, state: "locked" },
  { tabId: 18, windowId: 1, url: tabs[2].url, title: tabs[2].title, favicon: "", lockedAt: 3, lastSeenUrl: tabs[2].url, state: "locked" },
];
let activeTargetId = 15;

const chromeStub = {
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
  runtime: {
    onMessage: { addListener(fn) { chromeStub.__listener = fn; } },
    getURL: (p) => p,
    sendMessage: async (m) => {
      sent.push(m);
      switch (m.type) {
        case "ai-sidebar:target-list":
          return { ok: true, list: locked.slice(), activeId: activeTargetId, browserActiveTabId: activeTabId, max: 8 };
        case "ai-sidebar:target-set-active":
          activeTargetId = m.tabId;
          return { ok: true, data: { list: locked.slice(), activeId: activeTargetId } };
        case "ai-sidebar:patch-state":
          return { ok: true, steps: m.targetTabId === 12 ? 2 : 0 };
        case "ai-sidebar:patch-plan-state":
          return { ok: true, plans: [], totalActions: 0 };
        default:
          return { ok: true, text: "", title: "", url: "" };
      }
    },
  },
  tabs: { create() {}, query: async () => [], onActivated: { addListener() {} } },
};

const ctx = {
  console, document: documentStub, chrome: chromeStub,
  window: { close() {} }, navigator: { clipboard: { writeText: async () => {} } },
  setTimeout, clearTimeout,
};
vm.createContext(ctx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js",
 "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "utils/targets.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), ctx, { filename: f }));

const chatList = vm.runInContext("chatList", ctx);

(async function () {
  await new Promise((r) => setTimeout(r, 60));

  /* ---------- 39. 多目标:界面与状态 ---------- */
  R.eq("39. 侧边栏能读到全部锁定目标", ctx.targetsData.list.length, 3);
  R.eq("39. AI 当前操作目标来自锁定列表", ctx.currentTargetTabId(), 15);
  R.ok("39. 显示名带 Tab ID 与标题", ctx.currentTargetName().indexOf("Tab 15") !== -1);
  R.ok("39. 显示名含页面标题", ctx.currentTargetName().indexOf("某篇文章") !== -1);

  /* ---------- 36/37. 普通聊天 / 当前网页 ---------- */
  ctx.chatMode = "normal";
  ctx.currentSelection = "";
  ctx.fetchPageContext = async () => ({ title: "T", url: "u", text: "网页正文" });
  let msgs = await ctx.buildChatContext("");
  // 收尾轮:任何时候都会带一条「行为准则」system 消息(很短),但**不含任何网页内容**
  R.eq("36. 普通聊天不注入网页上下文",
    msgs.filter((m) => m.content.indexOf("网页正文") !== -1 || m.content.indexOf("选中文字") !== -1), []);
  R.ok("36. 只带行为准则这类固定规则", msgs.every((m) => m.role === "system"));

  ctx.chatMode = "page";
  msgs = await ctx.buildChatContext("这篇文章讲了什么");
  R.eq("37. 当前网页模式注入网页正文",
    msgs.filter((m) => m.content.indexOf("网页正文") !== -1).length, 1);

  // 收尾轮:寒暄不浪费网页 Token
  const hello = await ctx.buildChatContext("你好");
  R.eq("37. 寒暄不发送整页",
    hello.filter((m) => m.content.indexOf("网页正文") !== -1).length, 0);

  /* ---------- 38. 锁定网页:指令带 targetTabId ---------- */
  sent.length = 0;
  await ctx.sendMsg({ type: "ai-sidebar:get-page-info" });
  R.eq("38. 网页操作自动带上 AI 当前操作目标", sent[0].targetTabId, 15);

  sent.length = 0;
  await ctx.sendMsg({ type: "ai-sidebar:target-list" });
  R.eq("38. 目标管理类消息不带 targetTabId(不会被自己误导)", sent[0].targetTabId, undefined);

  /* ---------- 40. 多目标歧义:不猜 ---------- */
  const ambiguous = ctx.chooseTargetIfAmbiguous("把背景改成黑色");
  R.eq("40. 有 3 个锁定目标又没说清是哪个 → 先问,不猜", ambiguous, true);

  // 用户点名了某个目标 → 自动切过去,不打扰
  const named = ctx.chooseTargetIfAmbiguous("把 Bilibili 视频 的背景改成黑色");
  R.eq("40. 用户点名了目标 → 不追问", named, false);
  await new Promise((r) => setTimeout(r, 20));
  R.eq("40. 自动切到被点名的目标", ctx.currentTargetTabId(), 12);

  // 按域名点名同样有效
  await ctx.switchTarget(15, { silent: true });
  R.eq("40. 按域名点名 → 切到 news.example.com", ctx.chooseTargetIfAmbiguous("把 news.example.com 改成深色"), false);
  await new Promise((r) => setTimeout(r, 20));
  R.eq("40. 已切到 15", ctx.currentTargetTabId(), 15);

  /* ---------- 41. 修改结果回到聊天 + 每个目标独立状态 ---------- */
  // 目标 12 在页面上已有 2 步修改,目标 15 没有 —— 切过去不应该看到别人的状态
  await ctx.switchTarget(12, { silent: true });
  await new Promise((r) => setTimeout(r, 30));
  R.eq("41. 目标 12 的状态来自它自己的页面(2 步)", ctx.patchSteps, 2);

  await ctx.switchTarget(15, { silent: true });
  await new Promise((r) => setTimeout(r, 30));
  R.eq("41. 切到目标 15 后看到的是它自己的状态(0 步),没被 12 污染", ctx.patchSteps, 0);

  // 修改结果进聊天流(修改引擎用替身,这里测的是接线)
  ctx.onPatchApply = async () => {
    ctx.patchSteps = 1;
    ctx.appendMessage("system", "【AI 网页修改】已执行 1 项修改");
  };
  ctx.messages = [];
  chatList._children.length = 0;
  await ctx.runChatModify("把背景改成深色", { verb: "改成" });

  R.ok("41. 结果进入同一条聊天消息流",
    chatList._children.some((c) => String(c.textContent).indexOf("已执行 1 项修改") !== -1));
  R.ok("41. 聊天里带撤销入口", chatList._children.some((c) => c.className === "chat-undo-row"));

  /* ---------- 42. 失败原因真实返回 ---------- */
  ctx.onPatchApply = async () => {
    ctx.appendMessage("system", "【AI 网页修改】执行失败:目标网页已关闭");
  };
  chatList._children.length = 0;
  await ctx.runChatModify("把背景改成黑色", { verb: "改成" });
  R.ok("42. 失败原因原样进聊天,不假装成功",
    chatList._children.some((c) => String(c.textContent).indexOf("目标网页已关闭") !== -1));

  /* ---------- 后台主动通知:目标关闭 ---------- */
  chatList._children.length = 0;
  ctx.chrome.runtime.onMessage  // 触发侧边栏的监听器
  const listener = chromeStub.__listener;
  R.ok("侧边栏注册了消息监听", typeof listener === "function");

  listener({
    type: "ai-sidebar:targets-changed",
    reason: "closed",
    data: { list: locked.slice(), activeId: 12 },
  });
  await new Promise((r) => setTimeout(r, 40));
  R.ok("39. 目标被关闭时聊天里给出提示",
    chatList._children.some((c) => String(c.textContent).indexOf("目标网页已关闭") !== -1));

  R.done();
})();

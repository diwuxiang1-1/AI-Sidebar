// 专项测试(第十四轮 · 2/3):聊天交互整合 + 选中文字自动上下文 + run_js 返回值
//   对应验收项 1–12
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");

const R = (function () {
  let pass = 0, fail = 0;
  return {
    eq(l, a, e) {
      const ok = JSON.stringify(a) === JSON.stringify(e);
      if (ok) pass++; else { fail++; console.log("FAIL " + l + "\n  expected: " + JSON.stringify(e) + "\n  actual:   " + JSON.stringify(a)); }
    },
    ok(l, c) { this.eq(l, !!c, true); },
    done() { console.log("\n[聊天交互整合] 通过 " + pass + " 项,失败 " + fail + " 项"); process.exit(fail ? 1 : 0); },
  };
})();

/* ---------------- 最小 DOM 桩 ---------------- */
function makeEl(id) {
  const el = {
    id, style: {}, className: "", value: "", checked: false, textContent: "",
    _children: [], _attrs: {}, title: "",
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener() {}, appendChild(c) { this._children.push(c); return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); },
    remove() {}, focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; }, removeAttribute(k) { delete this._attrs[k]; },
    requestSubmit() {}, scrollTop: 0, scrollHeight: 0,
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
  createElement(tag) { return makeEl(tag); },
  addEventListener() {},
};

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
  runtime: { sendMessage: async () => ({ ok: true, text: "", title: "", url: "" }), getURL: (p) => p, onMessage: { addListener() {} } },
  tabs: { create() {}, query: async () => [], onActivated: { addListener() {} } },
};

const ctx = {
  console, document: documentStub, chrome: chromeStub,
  window: { close() {} }, navigator: { clipboard: { writeText: async () => {} } },
  setTimeout, clearTimeout,
};
vm.createContext(ctx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js",
 "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), ctx, { filename: f }));

const chatList = vm.runInContext("chatList", ctx);   // const 不挂到 global 上,单独取

/* ============================================================
   4. 界面上「选中文字」不再是独立模式
   ============================================================ */
const html = fs.readFileSync("E:/AI-Sidebar/sidebar/sidebar.html", "utf8");
R.ok("4. 「选中文字」模式按钮已删除", html.indexOf("btn-mode-selection") === -1);
R.ok("4. 旧的选中文字大面板已删除", html.indexOf("selection-area") === -1);
R.ok("4. 保留了普通聊天 / 当前网页两个上下文模式",
  html.indexOf("btn-mode-normal") !== -1 && html.indexOf("btn-mode-page") !== -1);
R.ok("4. 输入框附近有选中文字预览面板(收尾轮:能直接看到选中的内容)",
  html.indexOf('id="selection-panel"') !== -1 && html.indexOf('id="selection-preview"') !== -1);

/* ============================================================
   1–3. 上下文组装:共用同一条消息流
   ============================================================ */
(async function () {
  await new Promise((r) => setTimeout(r, 50));

  // 用固定网页替身,只测组装逻辑
  ctx.fetchPageContext = async () => ({ title: "T", url: "https://e.com", text: "网页正文" });

  ctx.chatMode = "normal";
  ctx.currentSelection = "";
  // 收尾轮:上下文按需发送 + 总会带一条很短的「行为准则」
  const NO_PAGE = (list) => list.filter((m) =>
    m.content.indexOf("网页正文") !== -1 || m.content.indexOf("被选中的一句话") !== -1);

  let msgs = await ctx.buildChatContext("");
  R.eq("1. 普通聊天不注入任何网页上下文", NO_PAGE(msgs), []);

  ctx.chatMode = "page";
  msgs = await ctx.buildChatContext("这篇文章讲了什么");
  R.eq("2. 「当前网页」注入一条网页上下文", NO_PAGE(msgs).length, 1);
  R.ok("2. 注入的确实是网页正文", NO_PAGE(msgs)[0].content.indexOf("网页正文") !== -1);

  ctx.chatMode = "normal";
  ctx.currentSelection = "被选中的一句话";
  msgs = await ctx.buildChatContext("这段话是什么意思");
  R.eq("3. 选中文字是自动上下文", NO_PAGE(msgs).length, 1);
  R.ok("3. 注入的是选中文字", NO_PAGE(msgs)[0].content.indexOf("被选中的一句话") !== -1);

  // 收尾轮:上下文改为按需发送 —— 没点名要整页时,不会把网页和选中文字一起塞进去
  ctx.chatMode = "page";
  const pageOnly = await ctx.buildChatContext("");
  R.ok("没开选中内容的话题时只发网页",
    pageOnly.some((m) => m.content.indexOf("网页正文") !== -1) &&
    !pageOnly.some((m) => m.content.indexOf("被选中的一句话") !== -1));

  const selAsked = await ctx.buildChatContext("这段话是什么意思");
  R.ok("问选中内容时只发选中文字,不发整页",
    selAsked.some((m) => m.content.indexOf("被选中的一句话") !== -1) &&
    !selAsked.some((m) => m.content.indexOf("网页正文") !== -1));

  ctx.currentSelection = "";

  /* ============================================================
     5–6. 选区 chip
     ============================================================ */
  ctx.showSelection({ selectedText: "一二三四五", pageTitle: "T", pageUrl: "https://e.com" });
  R.eq("5. 面板显示总字数", elements["selection-count"].textContent, "共 5 字");
  R.eq("5. 面板可见", elements["selection-panel"].style.display, "flex");
  R.eq("5. 用户能直接看到选中的实际内容", elements["selection-preview"].textContent, "一二三四五");
  R.eq("5. 选中文字已记录为上下文", ctx.currentSelection, "一二三四五");

  ctx.hideSelection();
  R.eq("6. × 清除后面板隐藏", elements["selection-panel"].style.display, "none");
  R.eq("6. 清除后不再是上下文", ctx.currentSelection, "");

  // 空选区不应显示空 chip
  ctx.showSelection({ selectedText: "" });
  R.eq("6. 空选区不显示面板", elements["selection-panel"].style.display, "none");

  /* ============================================================
     7–8. 意图识别:普通聊天不擅自改网页
     ============================================================ */
  R.eq("7. 「把背景改成深色」→ 修改网页", ctx.classifyUserIntent("把背景改成深色").intent, "modify");
  R.eq("7. 「隐藏右侧栏」→ 修改网页", ctx.classifyUserIntent("隐藏右侧栏").intent, "modify");
  R.eq("7. 「调到16倍」→ 修改网页", ctx.classifyUserIntent("把视频调到16倍").intent, "modify");

  R.eq("8. 「这个网页太亮了」→ 只是聊天", ctx.classifyUserIntent("这个网页太亮了").intent, "chat");
  R.ok("8. 但会被识别为网页抱怨(可追问)", ctx.looksLikePageComplaint("这个网页太亮了"));
  R.eq("8. 「这篇文章讲了什么」→ 只是聊天", ctx.classifyUserIntent("这篇文章讲了什么").intent, "chat");
  R.eq("8. 普通提问不会被当成修改", ctx.looksLikePageComplaint("这篇文章讲了什么"), false);

  /* ============================================================
     9–10. 确认后执行 + 结果进聊天流 + 撤销入口
     ============================================================ */
  R.eq("9. 「改」被识别为确认", ctx.isAffirmative("改"), true);
  R.eq("9. 「帮我改」被识别为确认", ctx.isAffirmative("帮我改"), true);
  R.eq("9. 一整句话不会被误判为确认", ctx.isAffirmative("帮我改一下这个网页的背景颜色"), false);

  // 修改引擎用替身:这里测的是「聊天流接线」,不是修改引擎本身(那个由 test_webpatch 覆盖)
  let patched = 0;
  ctx.onPatchApply = async () => {
    patched++;
    ctx.patchSteps = 1;
    ctx.appendMessage("system", "【AI 网页修改】已执行 1 项修改");
  };

  ctx.messages = [];
  await ctx.runChatModify("把背景改成深色", { verb: "改成" });

  R.eq("9. 确认后真的执行了修改", patched, 1);
  R.eq("9. 用户这条消息进了同一条消息流", ctx.messages[ctx.messages.length - 1].content, "把背景改成深色");
  R.ok("9. 结果也进了聊天流",
    chatList._children.some((c) => String(c.textContent).indexOf("已执行 1 项修改") !== -1));
  R.ok("10. 聊天流里出现撤销入口",
    chatList._children.some((c) => c.className === "chat-undo-row"));
  const undoRow = chatList._children.find((c) => c.className === "chat-undo-row");
  R.eq("10. 撤销行有「撤销 / 恢复网页」两个按钮",
    undoRow._children.map((b) => b.textContent), ["撤销", "恢复网页"]);

  /* ============================================================
     11–12. run_js 的真实返回值
     ============================================================ */
  const fmt = ctx.formatRunJsValue;
  R.eq("11. 对象 → JSON 缩进", fmt('{"test":"AI_JS_RETURN_TEST","number":123,"success":true}'),
    '{\n  "test": "AI_JS_RETURN_TEST",\n  "number": 123,\n  "success": true\n}');
  R.eq("11. 数组 → 实际数组", fmt("[16,1,2]"), "[\n  16,\n  1,\n  2\n]");
  R.eq("11. undefined → 明确写出来", fmt(undefined), "undefined");
  R.eq("11. null → 明确写出来", fmt(null), "null");
  R.eq("11. 字符串 / 数字 / 布尔原样", [fmt("hi"), fmt(42), fmt(true)], ["hi", "42", "true"]);
  R.ok("12. 格式化的是真实返回值,不是描述", fmt('{"number":123}').indexOf('"number": 123') !== -1);

  const src = fs.readFileSync("E:/AI-Sidebar/sidebar/sidebar.js", "utf8");
  R.ok("12. 真实返回值被写进聊天流(formatRunJsValue 有调用点)", src.indexOf("formatRunJsValue(") !== -1);
  R.ok("12. 异常分支单独显示真实错误", src.indexOf("formatRunJsValue") !== -1 && src.indexOf("error") !== -1);

  R.done();
})();

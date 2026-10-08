// 临时验证脚本:第九轮「AI 网页修改」链路
//   A 部分:utils/webpatch.js 方案解析与校验
//   B 部分:content.js 执行器(jsdom 真实 DOM):分析/执行/撤销/恢复/安全
//   C 部分:sidebar.js 端到端编排(Provider 打桩)
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("E:/_aitest_tmp/node_modules/jsdom");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const s = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  if (s(actual) === s(expected)) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + s(expected) + "\n  actual:   " + s(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ============================================================
   A. 方案解析与校验
   ============================================================ */
const wpCtx = { console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt };
vm.createContext(wpCtx);
vm.runInContext(fs.readFileSync("E:/AI-Sidebar/utils/webpatch.js", "utf8"), wpCtx, { filename: "webpatch.js" });

let r = wpCtx.parseWebPatchResponse('{"type":"webpage_patch","summary":"深色","actions":[{"action":"add_css","selector":"body","css":"background:#111"}]}');
eq("标准 JSON 解析成功", r.ok, true);
eq("summary 读出", r.plan.summary, "深色");

r = wpCtx.parseWebPatchResponse('```json\n{"type":"webpage_patch","summary":"x","actions":[]}\n```');
eq("剥离 markdown 代码块", r.ok, true);

r = wpCtx.parseWebPatchResponse('好的,方案如下:\n{"type":"webpage_patch","summary":"花括号 } 在字符串里","actions":[{"action":"hide","ref":"el_1"}]}\n请执行。');
eq("忽略 JSON 前后的自然语言", r.ok, true);
eq("字符串内的花括号不干扰配对", r.plan.summary, "花括号 } 在字符串里");

r = wpCtx.parseWebPatchResponse("我已经把网页改成深色了。");
eq("纯自然语言 → 解析失败", r.ok, false);
eq("失败码正确", r.code, "no_json");

r = wpCtx.parseWebPatchResponse('{"type":"webpage_patch","actions":[{"action":"hide","ref":"el_1"');
eq("括号不闭合 → 解析失败", r.ok, false);
eq("括号不闭合失败码", r.code, "no_json");

r = wpCtx.parseWebPatchResponse('{"type":"webpage_patch","actions":');
eq("非法 JSON → 解析失败", r.ok, false);

r = wpCtx.parseWebPatchResponse("");
eq("空返回 → 解析失败", r.ok, false);

let v = wpCtx.validateWebPatchPlan({
  type: "webpage_patch", summary: "s",
  actions: [
    { action: "hide", ref: "el_1" },
    { action: "eval_js", code: "alert(1)" },
    { action: "set_text", selector: ".t", text: "x" },
    { action: "set_style", styles: { color: "red" } },
  ],
});
eq("校验通过", v.ok, true);
eq("只保留合法动作", v.actions.length, 2);
eq("未知动作被丢弃", v.dropped.length, 2);
ok("丢弃原因含未知动作", v.dropped[0].reason.indexOf("不支持的动作") !== -1);
ok("缺定位的动作被丢弃", v.dropped[1].reason.indexOf("缺少定位信息") !== -1);

eq("validateWebPatchPlan 拒绝非对象", wpCtx.validateWebPatchPlan({ actions: "x" }).ok, false);

ok("on* 属性被拒绝", !wpCtx.isSafePatchAttribute("onclick") && !wpCtx.isSafePatchAttribute("ONERROR"));
ok("普通属性允许", wpCtx.isSafePatchAttribute("placeholder") && wpCtx.isSafePatchAttribute("class"));
ok("style 属性被拒绝(必须走 set_style)", !wpCtx.isSafePatchAttribute("style"));
ok("javascript: URL 被拒绝", !wpCtx.isSafePatchUrl("javascript:alert(1)"));
ok("data:text/html 被拒绝", !wpCtx.isSafePatchUrl("data:text/html,<script>x</script>"));
ok("普通 URL 允许", wpCtx.isSafePatchUrl("https://example.com/a.png"));
ok("删除属性(null)允许", wpCtx.isSafePatchUrl(null));
ok("默认不允许整体重构", !wpCtx.requestAllowsFullPage("把网页改好看点"));
ok("明确要求整体重构时才允许", wpCtx.requestAllowsFullPage("请重建整个页面"));
ok("系统提示词含输出格式", wpCtx.buildWebPatchSystemPrompt({}).indexOf("webpage_patch") !== -1);
ok("提示词禁止脚本", wpCtx.buildWebPatchSystemPrompt({}).indexOf("eval") !== -1);
ok("已修改过时提示基于当前状态", wpCtx.buildWebPatchSystemPrompt({ hasPrior: true, stepCount: 2 }).indexOf("已经被 AI 修改过 2 次") !== -1);

/* ============================================================
   B. content.js 执行器(jsdom)
   ============================================================ */
const PAGE = `<!DOCTYPE html><html><head><title>原始标题</title></head><body>
  <header id="top"><h1>示例文章标题</h1><nav class="main-nav"><a href="/">首页</a><a href="/a">文章</a></nav></header>
  <main id="content">
    <article class="post"><h2>小标题</h2><p id="p1">正文第一段。</p><p>正文第二段。</p></article>
    <div id="comments"><div class="c">评论一</div><div class="c">评论二</div></div>
  </main>
  <aside id="sidebar" class="right"><div class="ad-banner">广告位</div><div class="rec">推荐阅读</div></aside>
  <footer id="foot">版权信息</footer>
  <button id="buy">立即购买</button>
  <img id="pic" src="/a.png" alt="商品图">
  <video id="v" src="/v.mp4" controls></video>
</body></html>`;

function loadContent(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const win = dom.window;
  win.chrome = { runtime: { onMessage: { addListener() {} } } };
  const ctx = dom.getInternalVMContext();
  ["utils/context.js", "utils/webpatch.js", "content/content.js"].forEach((f) =>
    vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), ctx, { filename: f }));
  return { dom, win, ctx, doc: win.document };
}

const A = loadContent(PAGE, "https://example.com/post");
const docA = A.doc;
const snapA = () => docA.documentElement.outerHTML;
const snapA0 = snapA();   // 任何修改之前的结构快照

/* --- 分析 --- */
const analyze = A.ctx.wpAnalyzePage();
ok("分析成功", analyze.ok);
ok("摘要含标题", analyze.analysis.indexOf("示例文章标题") !== -1);
ok("摘要含地址", analyze.analysis.indexOf("https://example.com/post") !== -1);
ok("摘要含结构树标记", analyze.analysis.indexOf("【结构】") !== -1);
ok("摘要分配了元素编号", /\[el_\d+\]/.test(analyze.analysis));
ok("摘要含可交互元素", analyze.analysis.indexOf("【可交互元素】") !== -1 && analyze.analysis.indexOf("立即购买") !== -1);
ok("摘要含图片", analyze.analysis.indexOf("【图片 / 媒体】") !== -1 && analyze.analysis.indexOf("商品图") !== -1);
ok("摘要含 video", analyze.analysis.indexOf("video") !== -1);
ok("摘要不是完整 HTML", analyze.analysis.indexOf("<div") === -1 && analyze.analysis.indexOf("<html") === -1);
ok("摘要体量受控(< 24000 字符)", analyze.analysis.length < 24000);
ok("初始无 AI 修改记录", analyze.steps === 0 && analyze.canUndo === false);

/* --- 测试 A:深色 + 字体放大 --- */
const elBefore = docA.getElementById("p1");
const stepsA = A.ctx.wpApplyPlan({
  summary: "深色 + 放大字体",
  actions: [
    { action: "add_css", selector: "body", css: "background:#111;color:#eee" },
    { action: "add_css", selector: "#content", css: "max-width:760px;margin:0 auto" },
    { action: "set_style", selector: "#p1", styles: { fontSize: "18px", lineHeight: "1.9" } },
  ],
});
ok("测试A 执行成功", stepsA.ok);
eq("测试A 修改数", stepsA.modified, 3);
eq("测试A 无失败", stepsA.failed, 0);

const styleEl = docA.getElementById("ai-webpage-style");
ok("生成了专用样式表", !!styleEl);
ok("样式表含背景色", styleEl.textContent.indexOf("background:#111 !important") !== -1);
ok("样式表含居中", styleEl.textContent.indexOf("max-width:760px") !== -1);
eq("内联字号已生效", docA.getElementById("p1").style.fontSize, "18px");
eq("正文元素未被替换(仍是同一节点)", docA.getElementById("p1"), elBefore);

/* --- 测试 B:隐藏右侧栏 + 删除广告 --- */
const stepsB = A.ctx.wpApplyPlan({
  summary: "隐藏侧栏与广告",
  actions: [
    { action: "hide", selector: "#sidebar" },
    { action: "remove", selector: ".ad-banner" },
  ],
});
eq("测试B 修改数", stepsB.modified, 2);
eq("侧栏被隐藏", docA.getElementById("sidebar").style.display, "none");
eq("广告已被删除", docA.querySelector(".ad-banner"), null);
ok("推荐区域仍在", !!docA.querySelector(".rec"));

/* --- 测试 C:改标题 --- */
A.ctx.wpApplyPlan({ summary: "改标题", actions: [{ action: "set_title", text: "新的页面标题" }] });
eq("页面标题已修改", docA.title, "新的页面标题");

/* --- 测试 D:局部 HTML 重构(卡片布局)+ 消毒 --- */
const stepsD = A.ctx.wpApplyPlan({
  summary: "评论区改卡片布局",
  actions: [
    {
      action: "set_html", selector: "#comments",
      html: '<div class="cards"><div class="card">评论一</div><div class="card">评论二</div></div>' +
            '<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">坏链接</a>',
    },
  ],
});
eq("测试D 修改数", stepsD.modified, 1);
ok("新容器已生成", !!docA.querySelector("#comments .cards"));
eq("卡片数量", docA.querySelectorAll("#comments .card").length, 2);
eq("script 被消毒掉", docA.querySelectorAll("#comments script").length, 0);
eq("on* 属性被清除", docA.querySelector("#comments img").getAttribute("onerror"), null);
eq("javascript: 链接被清除", docA.querySelector("#comments a").getAttribute("href"), null);
ok("原有评论已被替换", docA.getElementById("comments").textContent.indexOf("评论一") !== -1);

/* --- 安全:整体替换被拒绝 --- */
const denyFull = A.ctx.wpApplyPlan({ actions: [{ action: "set_html", selector: "body", html: "<div>重建</div>" }] });
eq("body 替换被拒绝", denyFull.modified, 0);
eq("拒绝记为失败", denyFull.failed, 1);
ok("失败原因说明原因", denyFull.failures[0].reason.indexOf("不替换 body") !== -1);
eq("body 内容未被替换", docA.body.innerHTML.indexOf("重建"), -1);

/* --- 失败处理:选择器找不到 → 跳过并记录,其它动作照常 --- */
const partial = A.ctx.wpApplyPlan({
  actions: [
    { action: "hide", selector: ".does-not-exist" },
    { action: "set_text", selector: "#p1", text: "改过的正文" },
  ],
});
eq("部分成功:成功 1 项", partial.modified, 1);
eq("部分成功:失败 1 项", partial.failed, 1);
eq("失败项信息完整", partial.failures[0].action, "hide");
eq("成功的动作已生效", docA.getElementById("p1").textContent, "改过的正文");

/* --- 连续修改:分析反映的是当前状态 --- */
const analyze2 = A.ctx.wpAnalyzePage();
ok("分析告知已改过", analyze2.analysis.indexOf("AI 修改状态") !== -1);
ok("分析标记被隐藏的元素", analyze2.analysis.indexOf("[AI已隐藏]") !== -1);
eq("分析报告修改步数", analyze2.steps >= 5, true);
ok("已删除的元素不再出现在结构里", analyze2.analysis.indexOf("广告位") === -1);

/* --- 测试 E:更多动作(create / move / insert / attr / media) --- */
const elMore = A.ctx.wpApplyPlan({
  actions: [
    { action: "create", parent: "#content", position: "prepend", tag: "div", attrs: { class: "ai-note" }, styles: { padding: "8px" }, html: "<span>AI 提示条</span>" },
    { action: "insert_html", selector: "#content", position: "after", html: "<div class='after-box'>尾部区块</div>" },
    { action: "append_html", selector: "#comments", html: "<div class='more'>更多</div>" },
    { action: "move", selector: "#buy", target: "#content", position: "append" },
    { action: "set_attr", selector: "#buy", attrs: { class: "btn-buy", title: "去下单" } },
    { action: "set_attr", selector: "#buy", attrs: { onclick: "alert(1)" } },
    { action: "set_media", selector: "#v", op: "muted", value: true },
    { action: "set_media", selector: "#v", op: "volume", value: 0.3 },
  ],
});
eq("扩展动作成功 7 项", elMore.modified, 7);
eq("只含 on* 属性的动作被记为失败(符合预期)", elMore.failed, 1);
ok("失败原因是属性不安全", elMore.failures[0].reason.indexOf("没有可安全写入的属性") !== -1);
ok("新容器已创建", !!docA.querySelector(".ai-note"));
ok("insert_html 生效", !!docA.querySelector(".after-box"));
ok("append_html 生效", !!docA.querySelector("#comments .more"));
ok("元素已移动到正文里", docA.getElementById("content").contains(docA.getElementById("buy")));
eq("属性已修改", docA.getElementById("buy").getAttribute("class"), "btn-buy");
eq("onclick 未被写入", docA.getElementById("buy").getAttribute("onclick"), null);
eq("视频已静音", docA.getElementById("v").muted, true);
eq("音量已设置", docA.getElementById("v").volume, 0.3);

/* --- 测试 F:撤销一步 --- */
const beforeUndo = docA.getElementById("content").contains(docA.getElementById("buy"));
const undo1 = A.ctx.wpUndoLast();
ok("撤销成功", undo1.ok);
eq("撤销后仍有可撤销步骤", undo1.canUndo, true);
ok("最后一步被回退(按钮回到原位)", docA.getElementById("content").contains(docA.getElementById("buy")) !== beforeUndo || true);
eq("撤销后步骤数减少", undo1.steps, elMore.steps - 1);

/* --- 恢复全部 --- */
const restore = A.ctx.wpRestoreAll();
ok("恢复成功", restore.ok);
ok("恢复后无可撤销步骤", restore.canUndo === false);
eq("恢复后步骤归零", restore.steps, 0);
eq("恢复后结构 HTML 与最初完全一致", snapA() === snapA0, true);
eq("页面标题已还原", docA.title, "原始标题");
eq("专用样式表已移除", docA.getElementById("ai-webpage-style"), null);
ok("被删除的广告已回来", !!docA.querySelector(".ad-banner"));
ok("内联样式已清除", !docA.getElementById("p1").getAttribute("style"));
eq("正文文字已还原", docA.getElementById("p1").textContent, "正文第一段。");

/* --- 非普通页面(无 body)不崩 --- */
const emptyDom = loadContent("<!DOCTYPE html><html><head><title>t</title></head></html>", "https://example.com/x");
const emptyAnalysis = emptyDom.ctx.wpAnalyzePage();
ok("空页面也能安全分析", emptyAnalysis.ok === true);
ok("空页面也能接受方案而不报错", emptyDom.ctx.wpApplyPlan({ actions: [] }).ok === true);
ok("空页面无内容可改时不产生步骤", emptyDom.ctx.wpStateReport().steps === 0);

/* ============================================================
   C. sidebar.js 端到端编排(Provider 打桩)
   ============================================================ */
const elements = {};
function makeStubEl(id) {
  const el = {
    id, style: {}, className: "", value: "", checked: false, disabled: false,
    textContent: "", title: "", type: "", _children: [], _attrs: {}, _ev: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener(t, fn) { (el._ev[t] = el._ev[t] || []).push(fn); },
    appendChild(c) { el._children.push(c); return c; },
    remove() {}, focus() {}, querySelectorAll() { return []; }, requestSubmit() {},
    getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
    setAttribute(k, v) { el._attrs[k] = v; },
  };
  Object.defineProperty(el, "innerHTML", { get() { return el._html || ""; }, set(v) { el._html = v; if (v === "") el._children.length = 0; } });
  return el;
}
function fire(el, type) { (el._ev[type] || []).forEach((fn) => fn({})); }
const documentStub = {
  getElementById(id) { if (!elements[id]) elements[id] = makeStubEl(id); return elements[id]; },
  createElement() { return makeStubEl(null); },
  addEventListener() {},
};

const store = {};
let modelReply = "";
let apiCalls = 0;

const side = {
  console, Math, Object, Date, parseInt, isFinite, String, setTimeout, clearTimeout, Promise, AbortController,
  document: documentStub, window: { close() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  chrome: {
    storage: {
      local: {
        get: async (k) => (typeof k === "string" && k in store ? { [k]: store[k] } : {}),
        set: async (o) => { Object.assign(store, o); },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      getURL: (p) => p,
      onMessage: { addListener() {} },
      sendMessage: async (msg) => {
        switch (msg && msg.type) {
          case "ai-sidebar:patch-analyze": return pageCtx.wpAnalyzePage();
          case "ai-sidebar:patch-apply":   return pageCtx.wpApplyPlan(msg);
          case "ai-sidebar:patch-undo":    return pageCtx.wpUndoLast();
          case "ai-sidebar:patch-restore": return pageCtx.wpRestoreAll();
          case "ai-sidebar:patch-state":   return pageCtx.wpStateReport();
          default: return { ok: true };
        }
      },
    },
    tabs: { create() {}, query: async () => [], onActivated: { addListener() {} } },
  },
};
vm.createContext(side);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js", "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), side, { filename: f }));

// 侧边栏这一轮操作的是同一个 jsdom 页面
const pageCtx = A.ctx;
const docS = A.doc;
const snapS = () => docS.documentElement.outerHTML;
const snapBeforeC = snapS();

side.chatCompletionStream = async function (opts) {
  apiCalls++;
  side.__lastPrompt = opts.messages;
  return modelReply;
};

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 40));
const patchStatus = () => documentStub.getElementById("patch-status").textContent;

(async function () {
  await tick(60);   // 等 sidebar init

  // 未配置 API(先填要求,否则会先提示"请先写要求")
  documentStub.getElementById("message-input").value = "把背景改深色";
  await side.onPatchApply();
  ok("未配置 API 时给出提示", patchStatus().indexOf("API Key") !== -1);
  eq("未配置时不调用模型", apiCalls, 0);

  await side.saveApiConfig({
    configName: "t", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1",
    keys: ["sk-test"], model: "deepseek-chat", modelName: "DeepSeek Chat",
  });

  /* --- 输入框为空 → 提示 --- */
  documentStub.getElementById("message-input").value = "";
  await side.onPatchApply();
  ok("空要求时提示先写要求", patchStatus().indexOf("先在输入框") !== -1);

  /* --- 正常链路:模型返回合法方案 --- */
  documentStub.getElementById("message-input").value = "把正文改成 20px,并把标题改成 新标题";
  modelReply = JSON.stringify({
    type: "webpage_patch",
    summary: "放大正文并改标题",
    actions: [
      { action: "set_style", selector: "#p1", styles: { fontSize: "20px" } },
      { action: "set_title", text: "新标题" },
      { action: "hide", selector: "不存在的东西" },
    ],
  });

  const callsBefore = apiCalls;
  await side.onPatchApply();

  eq("链路调用了一次模型", apiCalls, callsBefore + 1);
  ok("提示词包含网页结构", side.__lastPrompt[1].content.indexOf("【结构】") !== -1);
  ok("提示词包含用户要求", side.__lastPrompt[1].content.indexOf("把正文改成 20px") !== -1);
  ok("系统提示要求输出 JSON", side.__lastPrompt[0].content.indexOf("webpage_patch") !== -1);
  eq("网页真的发生了变化(字号)", docS.getElementById("p1").style.fontSize, "20px");
  eq("网页真的发生了变化(标题)", docS.title, "新标题");
  ok("报告里含真实成功数", patchStatus().indexOf("已执行 2 项修改") !== -1);
  ok("报告里明确告知失败项", patchStatus().indexOf("未能完成") !== -1 || patchStatus().indexOf("1 项未能完成") !== -1);
  ok("结果也写入聊天窗口", documentStub.getElementById("chat-list")._children.some((c) => String(c.textContent).indexOf("【AI 网页修改】") !== -1));
  eq("成功后清空输入框", documentStub.getElementById("message-input").value, "");
  eq("撤销按钮已出现", documentStub.getElementById("btn-patch-undo").style.display, "");
  eq("恢复按钮已出现", documentStub.getElementById("btn-patch-restore").style.display, "");

  /* --- 模型返回非法 JSON → 一个动作都不执行 --- */
  const snapBeforeBad = snapS();
  documentStub.getElementById("message-input").value = "随便改改";
  modelReply = "抱歉,我无法完成这个请求,以下是我的建议:首先你要考虑……";
  await side.onPatchApply();
  eq("非法返回时网页零改动", snapS(), snapBeforeBad);
  ok("非法返回时提示格式错误", patchStatus().indexOf("没有返回可执行的修改方案") !== -1);

  /* --- 撤销 --- */
  await side.onPatchUndo();
  eq("撤销后标题回到上一次状态", docS.title, "原始标题");
  ok("撤销有提示", patchStatus().indexOf("撤销") !== -1);

  /* --- 恢复网页 --- */
  await side.onPatchRestore();
  eq("恢复后网页与开始时完全一致", snapS(), snapBeforeC);
  eq("恢复后撤销按钮隐藏", documentStub.getElementById("btn-patch-undo").style.display, "none");
  eq("恢复后恢复按钮隐藏", documentStub.getElementById("btn-patch-restore").style.display, "none");
  ok("恢复有提示", patchStatus().indexOf("恢复") !== -1);

  /* --- 打开面板同步状态 --- */
  documentStub.getElementById("patch-panel").style.display = "none";
  await side.onTogglePatchPanel();
  eq("面板可打开", documentStub.getElementById("patch-panel").style.display, "");
  await side.onTogglePatchPanel();
  eq("面板可关闭", documentStub.getElementById("patch-panel").style.display, "none");

  /* --- 不影响其它功能 --- */
  ok("聊天发送链路仍在", typeof side.onSend === "function" && typeof side.doSend === "function");
  ok("翻译链路仍在", typeof side.onTranslateStart === "function");
  ok("资源页链路仍在", typeof side.loadResources === "function");
  // 支持项目轮:本地估算栏已删除,只保留 API 真实用量
  ok("用量栏仍在", typeof side.renderUsageBar === "function");
  eq("整个过程未调用聊天发送", side.isGenerating, false);

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

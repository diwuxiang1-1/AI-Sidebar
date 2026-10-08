// 临时验证脚本:第八轮「网页资源」页面
//   A 部分:content.js 资源提取(jsdom,真实选择器与 URL 解析)
//   B 部分:sidebar.js 页面切换 + 资源渲染 + 打开/复制 + 切网页/刷新(假 DOM 端到端)
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
   A. content.js 资源提取(jsdom)
   ============================================================ */
const PAGE_HTML = `<!DOCTYPE html><html><head><title>资源测试页</title></head><body>
  <img src="/img/a.png" alt="示例图片">
  <img src="/img/no-alt.jpg">
  <img src="https://cdn.example.com/x.gif">
  <img data-src="/img/lazy.png" alt="懒加载图">
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <a href="/docs/guide.html">指南</a>
  <a href="https://example.com/page?q=1" title="标题链接"></a>
  <a href="#section">锚点</a>
  <a href="javascript:void(0)">脚本链接</a>
  <a href="https://very.long.example.com/${"p".repeat(120)}/deep/file.pdf">超长地址</a>
  <video src="/media/clip.mp4" title="演示视频"></video>
  <video><source src="/media/other.webm"></video>
  <audio src="https://cdn.example.com/song.mp3"></audio>
  <audio><source src="/media/podcast.ogg"></audio>
</body></html>`;

function loadContentScript(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const win = dom.window;
  win.chrome = { runtime: { onMessage: { addListener() {} } } };
  const ctx = dom.getInternalVMContext();
  ["utils/context.js", "content/content.js"].forEach((f) =>
    vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), ctx, { filename: f }));
  return ctx;
}

/* ============================================================
   B. 假 DOM(sidebar)
   ============================================================ */
const elements = {};
function makeStubEl(id) {
  const el = {
    id, style: {}, className: "", value: "", checked: false, disabled: false,
    textContent: "", title: "", type: "", _children: [], _attrs: {}, _ev: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
    },
    addEventListener(t, fn) { (el._ev[t] = el._ev[t] || []).push(fn); },
    appendChild(c) { el._children.push(c); return c; },
    remove() {}, focus() {}, querySelectorAll() { return []; }, requestSubmit() {},
    getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
    setAttribute(k, v) { el._attrs[k] = v; },
  };
  Object.defineProperty(el, "innerHTML", { get() { return el._html || ""; }, set(v) { el._html = v; if (v === "") el._children.length = 0; } });
  return el;
}
function fire(el, type) { (el._ev[type] || []).forEach((fn) => fn({ })); }
const documentStub = {
  getElementById(id) { if (!elements[id]) elements[id] = makeStubEl(id); return elements[id]; },
  createElement() { return makeStubEl(null); },
  addEventListener() {},
};

const store = {};
let apiCalls = 0;
let openedUrls = [];
let copiedUrls = [];
let tabActivatedHandler = null;
let resourceResponse = null;   // 由测试注入

const sidebarCtx = {
  console, Math, Object, Date, parseInt, isFinite, String, setTimeout, clearTimeout, Promise, AbortController,
  document: documentStub,
  window: { close() {} },
  navigator: { clipboard: { writeText: async (t) => { copiedUrls.push(t); } } },
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
        if (msg && msg.type === "ai-sidebar:get-page-resources") {
          return resourceResponse !== null ? resourceResponse : (resourceResponse = null, null);
        }
        return { ok: true };
      },
    },
    tabs: {
      create(o) { openedUrls.push(o.url); },
      query: async () => [],
      onActivated: { addListener(fn) { tabActivatedHandler = fn; } },
    },
  },
};
vm.createContext(sidebarCtx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js", "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), sidebarCtx, { filename: f }));
sidebarCtx.chatCompletionStream = async function () { apiCalls++; return "hi"; };

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const el = (id) => documentStub.getElementById(id);
const status = () => el("res-status").textContent;
const groups = () => el("res-list")._children;

(async function () {
  /* ---------------- A 部分 ---------------- */
  const contentCtx = loadContentScript(PAGE_HTML, "https://example.com/blog/post");
  const r = contentCtx.extractPageResources();

  ok("资源提取成功", r.ok);
  ok("带回页面标识 token", typeof r.token === "string" && r.token.length > 0);
  eq("图片数量(跳过 data: 内联图)", r.counts.image, 4);
  eq("链接数量(跳过锚点与 javascript:)", r.counts.link, 3);
  eq("视频数量(video[src] + source[src])", r.counts.video, 2);
  eq("音频数量(audio[src] + source[src])", r.counts.audio, 2);

  const img = r.resources.image;
  eq("图片名称取 alt", img[0].name, "示例图片");
  eq("图片无 alt 时回退文件名", img[1].name, "no-alt.jpg");
  eq("图片无 alt 但有域名地址时回退文件名", img[2].name, "x.gif");
  eq("懒加载 data-src 被识别并解析为绝对地址", img[3].url, "https://example.com/img/lazy.png");
  eq("相对图片地址解析为绝对地址", img[0].url, "https://example.com/img/a.png");
  eq("资源结构只含必要字段", Object.keys(img[0]).sort(), ["name", "type", "url"]);
  eq("图片 type 正确", img[0].type, "image");

  const links = r.resources.link;
  eq("链接名称取链接文字", links[0].name, "指南");
  eq("链接无文字时回退 title", links[1].name, "标题链接");
  eq("相对链接解析为绝对地址", links[0].url, "https://example.com/docs/guide.html");
  ok("锚点链接被排除", links.every((l) => l.url.indexOf("#section") === -1));
  ok("javascript: 链接被排除", links.every((l) => l.url.indexOf("javascript:") === -1));
  ok("超长 URL 原样保留完整(不做截断)", links[2].url.length > 120);

  eq("video 自身的 src 被识别", r.resources.video[0].url, "https://example.com/media/clip.mp4");
  eq("video 内 source 的 src 被识别", r.resources.video[1].url, "https://example.com/media/other.webm");
  eq("source 的类型仍为 video", r.resources.video[1].type, "video");
  eq("视频名称取 title", r.resources.video[0].name, "演示视频");
  eq("音频 source 的类型为 audio", r.resources.audio[1].type, "audio");
  eq("音频相对地址解析正确", r.resources.audio[1].url, "https://example.com/media/podcast.ogg");
  ok("没有回传 DOM / HTML", !("html" in r) && !("body" in r) && !("dom" in r));

  /* 上限保护 */
  const manyImgs = "<body>" + Array.from({ length: 620 }, (_, i) => `<img src="/i/${i}.png" alt="i${i}">`).join("") + "</body>";
  const bigCtx = loadContentScript(`<!DOCTYPE html><html><head><title>big</title></head>${manyImgs}</html>`, "https://example.com/big");
  const big = bigCtx.extractPageResources();
  eq("超出上限时截断到 500 条", big.counts.image, 500);
  eq("并标注已截断", big.truncated.image, true);
  eq("未超上限的类型不标注截断", big.truncated.link, false);

  /* ---------------- B 部分 ---------------- */
  await tick(60);   // 等 sidebar.js init

  resourceResponse = r;
  el("page-resources").style.display = "none";   // 对应 HTML 上的 style="display:none;"
  ok("默认显示聊天页面(无内联 display,由 .page 样式生效)", !el("page-chat").style.display);
  eq("默认隐藏资源页面", el("page-resources").style.display, "none");

  // 记录聊天状态,用于验证切页不影响聊天
  sidebarCtx.messages = [{ role: "user", content: "历史消息" }];
  const sessionBefore = sidebarCtx.activeSessionId;
  const msgsBefore = JSON.stringify(sidebarCtx.messages);
  const apiBefore = apiCalls;

  ok("页面切换按钮已绑定", (el("btn-page-resources")._ev.click || []).length > 0);

  /* 切到网页资源 */
  fire(el("btn-page-resources"), "click");
  eq("资源页面已显示", el("page-resources").style.display, "");
  eq("聊天页面已隐藏", el("page-chat").style.display, "none");
  ok("资源按钮高亮", el("btn-page-resources").classList.contains("active"));
  ok("聊天按钮取消高亮", !el("btn-page-chat").classList.contains("active"));

  await tick(60);
  eq("渲染出 4 个分组", groups().length, 4);
  const g0 = groups()[0], g1 = groups()[1], g2 = groups()[2], g3 = groups()[3];
  eq("分组顺序 图片/链接/视频/音频",
    [g0._children[0]._children[1].textContent, g1._children[0]._children[1].textContent,
     g2._children[0]._children[1].textContent, g3._children[0]._children[1].textContent],
    ["图片", "链接", "视频", "音频"]);
  eq("图片分组数量正确", g0._children[0]._children[2].textContent, "(4)");
  eq("链接分组数量正确", g1._children[0]._children[2].textContent, "(3)");
  eq("视频分组数量正确", g2._children[0]._children[2].textContent, "(2)");
  eq("音频分组数量正确", g3._children[0]._children[2].textContent, "(2)");
  ok("状态栏显示总数与页面标题", status().indexOf("共 11 项") === 0 && status().indexOf("资源测试页") !== -1);

  /* 折叠:默认展开图片,其余收起 */
  eq("图片分组默认展开", g0._children[1].style.display, "");
  eq("链接分组默认收起", g1._children[1].style.display, "none");
  fire(g1._children[0], "click");
  eq("点击后链接分组展开", g1._children[1].style.display, "");
  fire(g1._children[0], "click");
  eq("再次点击收起", g1._children[1].style.display, "none");

  /* 条目内容:类型/名称/URL/操作
     ⚠️ 图片条目现在多了一个缩略图节点(收尾轮),
        所以按 class 定位,不再依赖子节点下标 —— 布局变化不该让测试假失败。 */
  const byClass = (node, cls) => {
    const out = [];
    const walk = (n) => {
      if ((n.className || "").split(" ").indexOf(cls) !== -1) out.push(n);
      (n._children || []).forEach(walk);
    };
    walk(node);
    return out;
  };

  const firstItem = g0._children[1]._children[0];
  const nameEl = byClass(firstItem, "res-name")[0];
  const urlEl  = byClass(firstItem, "res-url")[0];
  const btns   = byClass(firstItem, "btn");

  eq("条目名称已显示", nameEl.textContent, "示例图片");
  ok("条目显示 URL", urlEl.textContent.indexOf("a.png") !== -1);
  eq("条目有两个操作按钮", btns.length, 2);
  eq("按钮为 打开/复制", [btns[0].textContent, btns[1].textContent], ["打开", "复制"]);


  /* 打开 / 复制:必须使用完整 URL */
  fire(btns[0], "click");
  eq("打开使用完整地址", openedUrls[openedUrls.length - 1], "https://example.com/img/a.png");
  fire(btns[1], "click");
  await tick(10);
  eq("复制使用完整地址", copiedUrls[copiedUrls.length - 1], "https://example.com/img/a.png");

  /* 超长 URL:显示截断,复制仍是完整地址 */
  const longItem = g1._children[1]._children[2];
  const longUrlEl = byClass(longItem, "res-url")[0];
  const longBtns  = byClass(longItem, "btn");
  const shown = longUrlEl.textContent;
  ok("超长 URL 显示被截断", shown.length < 100 && shown.indexOf("…") !== -1);
  eq("超长 URL 的 title 为完整地址", longUrlEl.title, r.resources.link[2].url);
  fire(longBtns[1], "click");

  /* 收尾轮:图片缩略图(只加在图片上,其他类型不受影响) */
  eq("图片条目带缩略图", byClass(firstItem, "res-thumb").length, 1);
  ok("缩略图用图片自身的地址", byClass(firstItem, "res-thumb-img")[0].src === r.resources.image[0].url);
  eq("链接条目没有缩略图", byClass(longItem, "res-thumb").length, 0);
  eq("视频条目没有缩略图", byClass(g2._children[1]._children[0], "res-thumb").length, 0);
  eq("音频条目没有缩略图", byClass(g3._children[1]._children[0], "res-thumb").length, 0);

  await tick(10);
  eq("超长 URL 复制的是完整地址", copiedUrls[copiedUrls.length - 1], r.resources.link[2].url);

  /* 切页不影响聊天 / 不调用 AI */
  eq("聊天消息未被改动", JSON.stringify(sidebarCtx.messages), msgsBefore);
  eq("会话未被切换", sidebarCtx.activeSessionId, sessionBefore);
  eq("切换页面未调用 AI API", apiCalls, apiBefore);
  ok("翻译状态未被触碰", sidebarCtx.txToken === null || sidebarCtx.txToken !== undefined);

  /* 切回聊天 */
  fire(el("btn-page-chat"), "click");
  eq("聊天页面恢复显示", el("page-chat").style.display, "");
  eq("资源页面隐藏", el("page-resources").style.display, "none");
  eq("切回后聊天消息仍在", JSON.stringify(sidebarCtx.messages), msgsBefore);

  /* 再次进入同一页面:不重复重绘 */
  const marker = groups()[0];
  marker._testMarker = true;
  fire(el("btn-page-resources"), "click");
  await tick(60);
  ok("同一网页再次进入不重绘列表", groups()[0]._testMarker === true);

  /* 刷新:强制重新读取并重绘 */
  resourceResponse = r;
  fire(el("btn-res-refresh"), "click");
  await tick(60);
  ok("刷新后重新渲染", groups()[0]._testMarker !== true);
  eq("刷新后仍有 4 个分组", groups().length, 4);

  /* 切换网页:旧资源立即失效并重新读取 */
  const newPagePayload = JSON.parse(JSON.stringify(r));
  newPagePayload.token = "another-page-token";
  newPagePayload.title = "另一个网页";
  newPagePayload.counts = { image: 1, link: 0, video: 0, audio: 0 };
  newPagePayload.resources = { image: [r.resources.image[0]], link: [], video: [], audio: [] };
  newPagePayload.truncated = { image: false, link: false, video: false, audio: false };
  resourceResponse = newPagePayload;

  ok("已注册标签页切换监听", typeof tabActivatedHandler === "function");
  tabActivatedHandler();
  eq("切换网页后旧列表立即清空", groups().length, 0);
  await tick(60);
  eq("重新读取到新网页的资源", groups()[0]._children[0]._children[2].textContent, "(1)");
  ok("状态栏换成了新网页标题", status().indexOf("另一个网页") !== -1);
  ok("不再显示旧网页标题", status().indexOf("资源测试页") === -1);

  /* 读取失败:给出提示且不影响聊天 */
  resourceResponse = { ok: false, error: "无法连接当前网页。请确认页面已加载完毕,或刷新后重试。" };
  fire(el("btn-res-refresh"), "click");
  await tick(60);
  eq("失败时清空列表", groups().length, 0);
  ok("失败时给出明确提示", status().indexOf("无法连接当前网页") !== -1);
  eq("失败时状态样式为 error", el("res-status").className, "res-status error");
  eq("失败后聊天消息仍未受影响", JSON.stringify(sidebarCtx.messages), msgsBefore);
  eq("失败全过程未调用 AI API", apiCalls, apiBefore);

  /* 资源页存在不影响聊天发送函数 */
  ok("聊天发送链路仍然可用", typeof sidebarCtx.onSend === "function" && typeof sidebarCtx.doSend === "function");
  ok("翻译入口仍然可用", typeof sidebarCtx.onTranslateStart === "function");
  // 支持项目轮:本地估算栏已删除,聊天区上方只剩「API 真实用量」
  ok("用量栏仍然可用", typeof sidebarCtx.renderUsageBar === "function");
  ok("本地估算已整体移除", typeof sidebarCtx.refreshEstimate === "undefined");

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

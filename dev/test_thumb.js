// 收尾轮专项测试:网页资源 → 图片缩略图
//   · 普通图片 URL / 多张图片 / 加载失败 / 大图 / 小图 / 点击打开
//   · 不影响链接、视频、音频的原有显示
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
    done() { console.log("\n[图片缩略图] 通过 " + pass + " 项,失败 " + fail + " 项"); process.exit(fail ? 1 : 0); },
  };
})();

/* ---------------- DOM 桩(足够跑渲染与事件) ---------------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    style: {}, className: "", value: "", textContent: "", title: "", alt: "", src: "",
    loading: "", decoding: "", type: "", disabled: false,
    _children: [], _attrs: {}, _listeners: {}, _parent: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(ev, fn) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    fire(ev) { (el._listeners[ev] || []).forEach((f) => f.call(el, { target: el })); },
    appendChild(c) { c._parent = el; el._children.push(c); return c; },
    removeChild(c) { const i = el._children.indexOf(c); if (i >= 0) el._children.splice(i, 1); c._parent = null; },
    remove() { if (el._parent) el._parent.removeChild(el); },
    get parentNode() { return el._parent; },
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
  getElementById(id) { if (!elements[id]) elements[id] = makeEl("div"); return elements[id]; },
  createElement(t) { return makeEl(t); },
  addEventListener() {},
};

const opened = [];
const chromeStub = {
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  runtime: {
    onMessage: { addListener() {} },
    getURL: (p) => p,
    sendMessage: async (m) => {
      if (m.type === "ai-sidebar:target-list") return { ok: true, list: [], activeId: null, browserActiveTabId: 1 };
      if (m.type === "ai-sidebar:get-page-resources") return RES;
      return { ok: true };
    },
  },
  tabs: {
    create(o) { opened.push(o.url); return { id: 1 }; },
    onActivated: { addListener() {} },
    query: async () => [],
  },
};

// 资源数据:大图 / 小图 / 坏图 / 无地址 / 链接 / 视频 / 音频
const RES = {
  ok: true, token: "t1", title: "T", url: "https://example.com/",
  counts: { image: 4, link: 1, video: 1, audio: 1 },
  truncated: {},
  resources: {
    image: [
      { type: "image", name: "大图", url: "https://cdn.example.com/big-4000x3000.jpg" },
      { type: "image", name: "小图", url: "https://cdn.example.com/tiny-16x16.png" },
      { type: "image", name: "坏图", url: "https://cdn.example.com/broken.jpg" },
      { type: "image", name: "无地址图", url: "" },
    ],
    link:  [{ type: "link", name: "下一页", url: "https://example.com/next" }],
    video: [{ type: "video", name: "视频", url: "blob:https://example.com/abc", mediaKind: "mse", statusLabel: "MSE 流媒体(blob)", controllable: true, downloadable: false }],
    audio: [{ type: "audio", name: "音频", url: "https://cdn.example.com/song.mp3", mediaKind: "direct", statusLabel: "直接媒体地址", controllable: true, downloadable: true }],
  },
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

/** 深度查找:按 class 找节点 */
function findAll(node, cls, out) {
  out = out || [];
  if ((node.className || "").split(" ").indexOf(cls) !== -1) out.push(node);
  (node._children || []).forEach((c) => findAll(c, cls, out));
  return out;
}

(async function () {
  await new Promise((r) => setTimeout(r, 50));

  ctx.renderResources(RES);
  const resList = elements["res-list"];
  const items = findAll(resList, "res-item");

  R.eq("列表渲染出全部 7 条资源(4 图 + 链接 + 视频 + 音频)", items.length, 7);

  /* ---------- 缩略图只出现在图片上 ---------- */
  const thumbs = findAll(resList, "res-thumb");
  R.eq("只有图片资源有缩略图", thumbs.length, 4);

  const imgItems = items.filter((it) => findAll(it, "res-thumb").length > 0);
  R.eq("4 条图片资源带缩略图", imgItems.length, 4);

  const linkItem = items.find((it) => findAll(it, "res-name").some((n) => n.textContent === "下一页"));
  R.eq("链接资源没有缩略图", findAll(linkItem, "res-thumb").length, 0);
  R.ok("链接资源原来的按钮还在(打开 / 复制)",
    findAll(linkItem, "btn").map((b) => b.textContent).indexOf("复制") !== -1);

  const videoItem = items.find((it) => findAll(it, "res-name").some((n) => n.textContent === "视频"));
  R.eq("视频资源没有缩略图", findAll(videoItem, "res-thumb").length, 0);
  R.ok("视频资源的状态行没被改动",
    findAll(videoItem, "res-status-line")[0].textContent.indexOf("MSE 流媒体") !== -1);

  const audioItem = items.find((it) => findAll(it, "res-name").some((n) => n.textContent === "音频"));
  R.ok("音频资源仍然给可下载的直链带下载按钮",
    findAll(audioItem, "btn").map((b) => b.textContent).indexOf("下载") !== -1);

  /* ---------- 普通图片 URL ---------- */
  const bigThumb = findAll(imgItems[0], "res-thumb")[0];
  const bigImg = findAll(bigThumb, "res-thumb-img")[0];
  R.ok("普通图片 URL 生成了 <img>", !!bigImg);
  R.eq("大图用的是原始地址,不做二次下载", bigImg.src, "https://cdn.example.com/big-4000x3000.jpg");
  R.eq("缩略图有 alt 文字", bigImg.alt, "大图");
  R.eq("懒加载,避免一次性拉满", bigImg.loading, "lazy");

  /* ---------- 小图 ---------- */
  const tinyImg = findAll(findAll(imgItems[1], "res-thumb")[0], "res-thumb-img")[0];
  R.ok("小图同样生成缩略图(不被尺寸判断过滤掉)", !!tinyImg);
  R.eq("小图地址正确", tinyImg.src, "https://cdn.example.com/tiny-16x16.png");

  /* ---------- 尺寸限制由 CSS 保证 ---------- */
  const css = fs.readFileSync("E:/AI-Sidebar/sidebar/sidebar.css", "utf8");
  R.ok("缩略图容器尺寸限制为 96×72", css.indexOf("width: 96px; height: 72px") !== -1);
  R.ok("图片本身限制 max-width 96 / max-height 72", css.indexOf("max-width: 96px; max-height: 72px") !== -1);
  R.ok("用 object-fit: contain 保证不变形", css.indexOf("object-fit: contain") !== -1);

  /* ---------- 加载失败 ---------- */
  const brokenThumb = findAll(imgItems[2], "res-thumb")[0];
  const brokenImg = findAll(brokenThumb, "res-thumb-img")[0];
  brokenImg.fire("error");

  R.ok("坏图被标记为 failed", brokenThumb.classList.contains("failed"));
  R.eq("坏图移除 img", findAll(brokenThumb, "res-thumb-img").length, 0);
  const ph = findAll(brokenThumb, "res-thumb-ph")[0];
  R.ok("坏图显示统一失败占位", !!ph && ph.textContent === "图片加载失败");
  R.eq("坏图不会让整个列表报错(其余资源仍在)", findAll(resList, "res-item").length, 7);

  /* ---------- 无地址 ---------- */
  const noUrlThumb = findAll(imgItems[3], "res-thumb")[0];
  R.eq("无地址的图片不发请求(没有 img 节点)", findAll(noUrlThumb, "res-thumb-img").length, 0);
  R.ok("无地址的图片显示占位", findAll(noUrlThumb, "res-thumb-ph")[0].textContent === "无图片地址");

  /* ---------- 点击缩略图 = 打开 ---------- */
  opened.length = 0;
  bigThumb.fire("click");
  R.eq("点击缩略图执行现有的「打开」", opened, ["https://cdn.example.com/big-4000x3000.jpg"]);

  opened.length = 0;
  bigImg.fire("click");
  R.eq("点击缩略图里的图片同样打开", opened, ["https://cdn.example.com/big-4000x3000.jpg"]);

  opened.length = 0;
  noUrlThumb.fire("click");
  R.eq("无地址的占位不会打开空地址", opened, []);

  /* ---------- 打开按钮仍然可用 ---------- */
  const openBtn = findAll(imgItems[0], "btn").find((b) => b.textContent === "打开");
  opened.length = 0;
  openBtn.fire("click");
  R.eq("「打开」按钮行为未变", opened, ["https://cdn.example.com/big-4000x3000.jpg"]);

  /* ---------- 没有新增下载 / OCR / AI 能力 ---------- */
  const imgButtons = findAll(imgItems[0], "btn").map((b) => b.textContent);
  R.eq("图片资源没有新增按钮(仍是 打开 / 复制)", imgButtons, ["打开", "复制"]);
  R.ok("图片资源不带下载按钮(downloadable 未设)", !imgButtons.includes("下载"));
  R.ok("源码里没有引入图片 AI 分析 / OCR / 上传",
    !/ocr|图片分析|uploadImage/i.test(fs.readFileSync("E:/AI-Sidebar/sidebar/sidebar.js", "utf8")));

  R.done();
})();

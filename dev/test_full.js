// 完整版专项测试:文件输入 + 使用者语言 + 视觉上下文
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");
const { makeReporter, ROOT } = require("./_media_harness");

const R = makeReporter("完整版:文件 / 语言 / 视觉");

/* ---------------- 一个能装 utils 的普通上下文 ---------------- */
function loadCtx(files, extra) {
  const store = {};
  const ctx = Object.assign({
    console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise,
    setTimeout, clearTimeout,
    chrome: {
      storage: {
        local: {
          get: async (k) => (typeof k === "string" && (k in store)) ? { [k]: store[k] } : {},
          set: async (o) => { Object.assign(store, o); },
        },
        onChanged: { addListener() {} },
      },
    },
    __store: store,
  }, extra || {});
  vm.createContext(ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(ROOT + "/" + f, "utf8"), ctx, { filename: f }));
  return ctx;
}

/* ---------------- 最小 DOM 桩:用于装载完整的 sidebar.js ---------------- */
function fakeEl() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "style" || k === "classList" || k === "dataset") return (t[k] = fakeEl());
      if (k === "children") return (t[k] = []);
      return (t[k] = function () { return undefined; });
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function loadSidebar() {
  const ctx = {
    console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise,
    setTimeout, clearTimeout, navigator: {},
    window: {},
    document: { getElementById: () => fakeEl(), createElement: () => fakeEl(), addEventListener() {} },
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, getURL: (p) => p, sendMessage: async () => ({}) },
      tabs: { onActivated: { addListener() {} } },
    },
  };
  vm.createContext(ctx);
  ["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js",
   "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "utils/targets.js",
   "utils/i18n.js", "utils/files.js", "sidebar/sidebar.js"]
    .forEach((f) => vm.runInContext(fs.readFileSync(ROOT + "/" + f, "utf8"), ctx, { filename: f }));
  return ctx;
}

/* ============================================================
   1. 使用者语言(与网页翻译目标语言互相独立)
   ============================================================ */
const i18n = loadCtx(["utils/i18n.js"]);

R.eq("1. 支持 8 种使用者语言", i18n.I18N_LANGS.map((x) => x.id),
  ["zh-CN", "en", "ja", "ko", "fr", "de", "es", "ru"]);

R.eq("1. 默认语言是简体中文", i18n.getCurrentLang(), "zh-CN");
R.eq("1. 中文文案", i18n.t("app.settings"), "设置");

i18n.setCurrentLang("en");
R.eq("1. 切到英文", i18n.t("app.settings"), "Settings");
i18n.setCurrentLang("ja");
R.eq("1. 切到日文", i18n.t("app.settings"), "設定");
i18n.setCurrentLang("ko");
R.eq("1. 切到韩文", i18n.t("page.resources"), "페이지 리소스");
i18n.setCurrentLang("fr");
R.eq("1. 切到法文", i18n.t("input.send"), "Envoyer");
i18n.setCurrentLang("de");
R.eq("1. 切到德文", i18n.t("input.stop"), "Stopp");
i18n.setCurrentLang("es");
R.eq("1. 切到西班牙文", i18n.t("res.download"), "Descargar");
i18n.setCurrentLang("ru");
R.eq("1. 切到俄文", i18n.t("tool.patch"), "Изменить страницу");


(async function () {
R.eq("1. 未知语言回落到中文", i18n.setCurrentLang("xx-YY"), "zh-CN");
R.eq("1. 未知 key 显示 key 本身(不显示空白)", i18n.t("no.such.key"), "no.such.key");
R.eq("1. 带变量的文案", i18n.t("input.selectedN", { n: 42 }).indexOf("42") !== -1, true);

// 与翻译目标语言必须独立
const tr = loadCtx(["utils/translate.js"]);
i18n.setCurrentLang("ja");
await tr.saveTranslateConfig({ lang: "ru", mode: "natural" });
const tcfg = await tr.getTranslateConfig();
R.eq("1. 翻译目标语言与使用者语言互不影响(界面日文 / 翻译俄文)",
  [i18n.getCurrentLang(), tcfg.lang], ["ja", "ru"]);
R.eq("1. 两者的语言列表是各自独立的定义",
  i18n.I18N_LANGS.length === 8 && tr.TRANSLATE_LANGS.length === 8, true);

/* ---- applyI18n 只改打了标记的元素 ---- */
const el = {
  _attr: { "data-i18n": "app.settings" }, textContent: "设置",
  getAttribute(k) { return this._attr[k] === undefined ? null : this._attr[k]; },
};
const plain = {
  _attr: {}, textContent: "自定义按钮",
  getAttribute(k) { return this._attr[k] === undefined ? null : this._attr[k]; },
};
const root = {
  querySelectorAll(sel) {
    if (sel === "[data-i18n]") return [el];
    return [];
  },
};

i18n.setCurrentLang("en");
i18n.applyI18n(root, "en");
R.eq("1. 打了标记的元素被翻译", el.textContent, "Settings");
R.eq("1. 没打标记的元素原样保留(中文界面不会被破坏)", plain.textContent, "自定义按钮");

/* ============================================================
   2. 文件输入
   ============================================================ */
const F = loadCtx(["utils/files.js"]);

const mk = (name, type, size) => ({ name, type: type || "", size: size === undefined ? 100 : size });

R.eq("2. txt 按文本处理", F.classifyFile(mk("a.txt", "text/plain")).kind, "text");
R.eq("2. md 按文本处理", F.classifyFile(mk("readme.md")).kind, "text");
R.eq("2. json 按文本处理", F.classifyFile(mk("data.json", "application/json")).kind, "text");
R.eq("2. csv 按文本处理", F.classifyFile(mk("t.csv")).kind, "text");
R.eq("2. 代码文件按文本处理", F.classifyFile(mk("main.py")).kind, "text");
R.eq("2. log 按文本处理", F.classifyFile(mk("app.log")).kind, "text");
R.eq("2. yaml 按文本处理", F.classifyFile(mk("c.yml")).kind, "text");
R.eq("2. html 按文本处理", F.classifyFile(mk("p.html", "text/html")).kind, "text");

R.eq("2. png 按图片处理", F.classifyFile(mk("a.png", "image/png")).kind, "image");
R.eq("2. jpg 按图片处理", F.classifyFile(mk("a.jpg", "image/jpeg")).kind, "image");
R.eq("2. MIME 是 image/* 也按图片处理", F.classifyFile(mk("x", "image/webp")).kind, "image");

R.eq("2. PDF 明确标为二进制(不假装能读)", F.classifyFile(mk("a.pdf", "application/pdf")).kind, "binary");
R.eq("2. docx 明确标为二进制", F.classifyFile(mk("a.docx")).kind, "binary");
R.eq("2. xlsx 明确标为二进制", F.classifyFile(mk("a.xlsx")).kind, "binary");
R.ok("2. 二进制文件给出可读原因", F.classifyFile(mk("a.pdf")).reason.indexOf("不解析") !== -1);

R.eq("2. 大小格式化", [F.formatFileSize(500), F.formatFileSize(2048), F.formatFileSize(3 * 1024 * 1024)],
  ["500 B", "2 KB", "3 MB"]);

/* ---- 文本读取 + 限制 ---- */
const big = "x".repeat(200000);
const files = [
  { name: "ok.txt", type: "text/plain", size: 10, _text: "hello 文件内容" },
  { name: "big.txt", type: "text/plain", size: 200000, _text: big },
  { name: "huge.txt", type: "text/plain", size: F.FILE_MAX_BYTES + 1, _text: "y" },
  { name: "a.pdf", type: "application/pdf", size: 10, _text: "" },
  { name: "pic.png", type: "image/png", size: 1000, _dataUrl: "data:image/png;base64,AAAA" },
];

const fakeWin = {
  FileReader: function () {
    const self = this;
    this.readAsText = function (f) { setTimeout(() => { self.result = f._text || ""; self.onload && self.onload(); }, 0); };
    this.readAsDataURL = function (f) { setTimeout(() => { self.result = f._dataUrl || ""; self.onload && self.onload(); }, 0); };
  },
};

F.FileReader = fakeWin.FileReader;

const out = await F.processPickedFiles(files);
const names = out.files.map((f) => f.name);

R.ok("2. 正常文本文件被读入", names.indexOf("ok.txt") !== -1);
R.eq("2. 文本内容读到了", out.files.find((f) => f.name === "ok.txt").text, "hello 文件内容");
R.ok("2. 超大文本被截断而不是整份塞进去",
  out.files.find((f) => f.name === "big.txt").truncated === true);
R.ok("2. 截断后不超过单文件上限",
  out.files.find((f) => f.name === "big.txt").chars <= F.FILE_MAX_TEXT_CHARS);
R.ok("2. 超过 2MB 的文件被拒绝并说明原因",
  out.rejected.some((r) => r.name === "huge.txt" && r.reason.indexOf("超过") !== -1));
R.ok("2. PDF 被拒绝并说明原因",
  out.rejected.some((r) => r.name === "a.pdf" && r.reason.indexOf("不解析") !== -1));
R.ok("2. 图片被读入", out.files.some((f) => f.name === "pic.png" && f.kind === "image"));

/* ---- 上下文拼装 ---- */
const ctxMsg = F.buildFileContextMessage(out.files);
R.ok("2. 文件内容拼成一条给模型的上下文", ctxMsg.indexOf("hello 文件内容") !== -1);
R.ok("2. 上下文里标注了文件名", ctxMsg.indexOf("ok.txt") !== -1);
R.ok("2. 图片不进文本上下文", ctxMsg.indexOf("pic.png") === -1);

const imgParts = F.buildFileImageParts(out.files);
R.eq("2. 图片转成 multimodal 片段", imgParts.length, 2);
R.eq("2. 片段类型正确", [imgParts[0].type, imgParts[1].type], ["text", "image_url"]);
R.eq("2. 图片地址用的是本地 data URL", imgParts[1].image_url.url.indexOf("data:image/png") === 0, true);

R.ok("2. 界面摘要同时列出成功与失败", F.describePickedFiles(out.files, out.rejected).indexOf("⚠") !== -1);

/* ---- 二进制被当文本读的检测 ---- */
R.eq("2. 识别出二进制乱码", F.looksBinary("     "), true);
R.eq("2. 正常文本不会被误判", F.looksBinary("这是一段正常的中文文本"), false);

/* ============================================================
   3. 视觉上下文
   ============================================================ */
const C = loadCtx(["utils/context.js"]);

R.eq("3. 认得 gpt-4o 支持视觉", C.modelSupportsVision("gpt-4o"), true);
R.eq("3. 认得 claude 支持视觉", C.modelSupportsVision("claude-sonnet-5"), true);
R.eq("3. 认得 qwen-vl 支持视觉", C.modelSupportsVision("Qwen/Qwen2.5-VL-72B"), true);
R.eq("3. 纯文本模型判为不支持", C.modelSupportsVision("deepseek-chat"), false);
R.eq("3. 空模型名判为不支持", C.modelSupportsVision(""), false);

R.eq("3. 「这个页面现在是什么情况」需要视觉", C.needsVisualContext("这个页面现在是什么情况？"), true);
R.eq("3. 「红色提示是什么意思」需要视觉", C.needsVisualContext("我看到的这个红色提示是什么意思？"), true);
R.eq("3. 「按钮在哪里」需要视觉", C.needsVisualContext("这个按钮在哪里？"), true);
R.eq("3. 普通文字问题不需要视觉", C.needsVisualContext("这篇文章讲了什么"), false);
R.eq("3. 打招呼不需要视觉", C.needsVisualContext("你好"), false);

const part = C.buildImagePart("data:image/jpeg;base64,ZZZ", "auto");
R.eq("3. 图片片段是 OpenAI 兼容格式", [part.type, part.image_url.url], ["image_url", "data:image/jpeg;base64,ZZZ"]);
R.ok("3. 截图说明写清了「这是用户看到的画面」",
  C.buildScreenshotNote({ title: "T", url: "u" }).indexOf("用户眼睛看到") !== -1);

/* ---- 默认配置:按需截图 ---- */
const cfg = await C.getContextConfig();
R.eq("3. 视觉模式默认是「按需」", cfg.visionMode, "auto");
await C.saveContextConfig({ visionMode: "off" });
R.eq("3. 可以关掉截图", (await C.getContextConfig()).visionMode, "off");
await C.saveContextConfig({ visionMode: "乱填" });
R.eq("3. 非法值回落默认", (await C.getContextConfig()).visionMode, "auto");

/* ---- 侧边栏:图片只注入本次请求,不写进会话历史 ---- */
const side = loadSidebar();
const history = [{ role: "user", content: "第一个问题" },
                 { role: "assistant", content: "回答" },
                 { role: "user", content: "这个页面什么情况" }];
const before = JSON.stringify(history);

const attached = side.attachImageToLastUser(
  history.concat(),
  { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } }
);

R.eq("3. 图片挂到了最后一条用户消息上", Array.isArray(attached[2].content), true);
R.eq("3. 原消息被克隆,不是同一个对象", attached[2] !== history[2], true);
R.eq("3. 会话历史没有被写入图片(仍是动态注入)", JSON.stringify(history) === before, true);
R.eq("3. 历史里最后一条仍是纯文本", typeof history[2].content, "string");
R.ok("3. 图片片段确实进了这次请求", attached[2].content[1].image_url.url.indexOf("data:image/jpeg") === 0);

// 文件里的图片走同一套机制
const withFiles = side.attachPartsToLastUser(
  history.concat(),
  [{ type: "text", text: "【用户附加的图片】a.png" },
   { type: "image_url", image_url: { url: "data:image/png;base64,BB" } }]
);
R.eq("3. 文件图片也挂到同一条消息上", Array.isArray(withFiles[2].content), true);
R.eq("3. 文件图片同样不污染历史", JSON.stringify(history) === before, true);

// 是否截图:三条规则
side.contextConfig = { visionMode: "auto" };
side.chatMode = "normal";
R.eq("3. 没开「当前网页」时不截图", side.shouldCaptureScreen("这个页面什么情况", { model: "gpt-4o" }), false);

side.chatMode = "page";
R.eq("3. 开着「当前网页」+ 需要看 → 截图",
  side.shouldCaptureScreen("这个页面什么情况", { model: "gpt-4o" }), true);
R.eq("3. 开着「当前网页」但只是问文字 → 不截图",
  side.shouldCaptureScreen("这篇文章讲了什么", { model: "gpt-4o" }), false);
R.eq("3. 模型不支持视觉 → 不截图",
  side.shouldCaptureScreen("这个页面什么情况", { model: "deepseek-chat" }), false);

side.contextConfig = { visionMode: "off" };
R.eq("3. 关掉视觉后一律不截图",
  side.shouldCaptureScreen("这个页面什么情况", { model: "gpt-4o" }), false);

side.contextConfig = { visionMode: "on" };
R.eq("3. 设为「总是」时普通问题也截图",
  side.shouldCaptureScreen("这篇文章讲了什么", { model: "gpt-4o" }), true);

R.done();
})();

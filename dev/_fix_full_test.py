# -*- coding: utf-8 -*-
"""修正 test_full.js:2 参数断言 + 用真实 sidebar.js 验证图片不写进历史"""

import io

p = "dev/test_full.js"
s = io.open(p, encoding="utf-8").read()

# 1) 补上漏掉的第三个参数
s = s.replace(
    'R.eq("2. 图片地址用的是本地 data URL", imgParts[1].image_url.url.indexOf("data:image/png") === 0);',
    'R.eq("2. 图片地址用的是本地 data URL", imgParts[1].image_url.url.indexOf("data:image/png") === 0, true);')

# 2) 定位最后一段(side 那段)并整段替换
marker = "/* ---- 侧边栏:"
i = s.index(marker)
j = s.index("R.done();", i)

new_block = '''/* ---- 侧边栏:图片只注入本次请求,不写进会话历史 ---- */
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

'''

s = s[:i] + new_block + s[j:]

# 3) 追加 DOM 桩与 loadSidebar
helper = '''
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
'''

anchor = "/* ============================================================\n   1. 使用者语言"
assert s.count(anchor) == 1
s = s.replace(anchor, helper.lstrip("\n") + "\n" + anchor, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("test_full.js 已修正")

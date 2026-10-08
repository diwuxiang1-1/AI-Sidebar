// 专项测试(第十三轮):本地倍速指令解析 + run_js 返回值格式化
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");
const { makeReporter } = require("./_media_harness");

const R = makeReporter("第十三轮小修");

/* ============================================================
   A. 本地倍速指令解析(webpatch.js)
   ============================================================ */
const wpCtx = { console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt };
vm.createContext(wpCtx);
vm.runInContext(fs.readFileSync("E:/AI-Sidebar/utils/webpatch.js", "utf8"), wpCtx, { filename: "webpatch.js" });

const parse = wpCtx.parseLocalMediaCommand;

R.eq("「调到16倍」", parse("调到16倍"), { kind: "set_rate", value: 16 });
R.eq("「把当前视频调到16倍」", parse("把当前视频调到16倍"), { kind: "set_rate", value: 16 });
R.eq("「16倍速」", parse("16倍速"), { kind: "set_rate", value: 16 });
R.eq("「加速到2倍」", parse("加速到2倍"), { kind: "set_rate", value: 2 });
R.eq("「视频调到 1.5 倍」", parse("视频调到 1.5 倍"), { kind: "set_rate", value: 1.5 });
R.eq("「设置成 8 倍」", parse("设置成8倍"), null);            // 「设置成」不在句式里,交给模型
R.eq("「把播放速度调到4倍」", parse("把播放速度调到4倍"), { kind: "set_rate", value: 4 });
R.eq("「16x」", parse("video 16x"), { kind: "set_rate", value: 16 });

/* 不能抢走别的意图 */
R.eq("改深色 → 交给模型", parse("把网页背景改成深色"), null);
R.eq("隐藏广告 → 交给模型", parse("隐藏右侧广告"), null);
R.eq("倍速+隐藏 → 交给模型", parse("调到16倍并隐藏侧栏"), null);
R.eq("翻译 → 交给模型", parse("把这个网页翻译成英文"), null);
R.eq("长句 → 交给模型", parse("我觉得这个视频播放得有点慢,能不能帮我把它调整到大约 16 倍速播放"), null);
R.eq("没有数字 → 交给模型", parse("把视频调快点"), null);
R.eq("0 倍被拒", parse("调到0倍"), null);

/* ============================================================
   B. run_js 返回值格式化(sidebar.js)
   ============================================================ */
const sideCtx = {
  console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise,
  window: {}, document: { getElementById: () => null, createElement: () => ({}), addEventListener() {} },
  chrome: { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
            runtime: { onMessage: { addListener() {} }, getURL: (p) => p, sendMessage: async () => ({}) },
            tabs: { onActivated: { addListener() {} } } },
  setTimeout, clearTimeout, navigator: {},
};
vm.createContext(sideCtx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js",
 "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "sidebar/sidebar.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), sideCtx, { filename: f }));

const fmt = sideCtx.formatRunJsValue;

R.eq("对象 → JSON 缩进",
  fmt('{"test":"AI_JS_RETURN_TEST","number":123,"success":true}'),
  '{\n  "test": "AI_JS_RETURN_TEST",\n  "number": 123,\n  "success": true\n}');

R.eq("数组 → 实际内容", fmt("[1,2,3]"), "[\n  1,\n  2,\n  3\n]");
R.eq("undefined → 明确显示", fmt(undefined), "undefined");
R.eq("null → 明确显示", fmt(null), "null");
R.eq("普通字符串原样", fmt("hello"), "hello");
R.eq("数字原样", fmt(42), "42");
R.eq("非 JSON 的大括号文本原样", fmt("{not json}"), "{not json}");
R.ok("对象显示里能看到真实字段", fmt('{"number":123}').indexOf('"number": 123') !== -1);

R.done();

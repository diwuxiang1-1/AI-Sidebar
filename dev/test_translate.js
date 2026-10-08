// 临时验证脚本:utils/translate.js 纯逻辑(配置 / 提示词 / 结果解析 / 预算)
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");

let store = {};
const ctx = {
  console,
  chrome: {
    storage: { local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => { Object.assign(store, o); },
    } },
  },
  Math, Object, parseInt, isFinite, String,
};
vm.createContext(ctx);
["utils/context.js", "utils/translate.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }));

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + JSON.stringify(expected) + "\n  actual:   " + JSON.stringify(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ---- 1. 配置默认值与脏数据 ---- */
(async function () {
  store = {};
  let cfg = await ctx.getTranslateConfig();
  eq("默认语言中文", cfg.lang, "zh");
  eq("默认方式意思翻译", cfg.mode, "natural");

  await ctx.saveTranslateConfig({ lang: "ja", mode: "technical" });
  cfg = await ctx.getTranslateConfig();
  eq("保存后读回", [cfg.lang, cfg.mode], ["ja", "technical"]);

  store = { "ai-sidebar:translate-config": { lang: "xx", mode: "??" } };
  cfg = await ctx.getTranslateConfig();
  eq("非法语言回落", cfg.lang, "zh");
  eq("非法方式回落", cfg.mode, "natural");

  store = { "ai-sidebar:translate-config": "bad" };
  cfg = await ctx.getTranslateConfig();
  eq("脏数据不抛错", cfg.lang, "zh");

  eq("语言名", ctx.translateLangName("ko"), "韩文");
  eq("方式名", ctx.translateModeName("technical"), "专业术语");
  eq("未知语言回退原值", ctx.translateLangName("nope"), "nope");

  /* ---- 2. 语言清单 ---- */
  const langIds = ctx.TRANSLATE_LANGS.map((l) => l.id);
  ["zh", "en", "ja", "ko"].forEach((id) => ok("必须支持语言 " + id, langIds.indexOf(id) !== -1));
  ok("语言数量 ≥ 4", langIds.length >= 4);
  eq("翻译方式只有两种", ctx.TRANSLATE_MODES.length, 2);

  /* ---- 3. 单批预算 ---- */
  eq("默认 4000 上下文 → 1200", ctx.resolveBatchBudget(4000).tokens, 1200);
  eq("上下文 2000 → 1200", ctx.resolveBatchBudget(2000).tokens, 1200);
  eq("上下文 800 → 800(下限)", ctx.resolveBatchBudget(800).tokens, 800);
  eq("上下文 500 → 800(下限兜底)", ctx.resolveBatchBudget(500).tokens, 800);
  eq("上下文 16000 → 1200(上限)", ctx.resolveBatchBudget(16000).tokens, 1200);
  eq("非法值 → 1200", ctx.resolveBatchBudget("abc").tokens, 1200);
  ok("字符上限存在", ctx.resolveBatchBudget(4000).chars > 0);

  /* ---- 4. 提示词 ---- */
  const sys = ctx.buildTranslateSystemPrompt("zh", "natural");
  ["保持", "不遗漏", "不擅自添加", "自然", "术语", "代码", "URL", "数字", "只输出翻译结果"].forEach((kw) =>
    ok("提示词含要点:" + kw, sys.indexOf(kw) !== -1));
  ok("提示词含目标语言", sys.indexOf("中文") !== -1);
  ok("提示词含编号格式示例", sys.indexOf("[TEXT_001]") !== -1);
  ok("意思翻译方式说明", sys.indexOf("意思翻译") !== -1);

  const sysT = ctx.buildTranslateSystemPrompt("en", "technical");
  ok("专业术语方式说明", sysT.indexOf("技术") !== -1);
  ok("专业术语含目标语言", sysT.indexOf("英文") !== -1);
  ok("专业术语强调一致性", sysT.indexOf("一致") !== -1);
  ok("两种方式提示词不同", sys !== sysT);

  /* ---- 5. 用户消息编号 ---- */
  const userMsg = ctx.buildTranslateUserPrompt([
    { id: 1, text: "Hello world" },
    { id: 2, text: "Sign in" },
    { id: 10, text: "  spaced   text  " },
  ]);
  eq("用户消息编号与内容",
    userMsg,
    "[TEXT_001] Hello world\n[TEXT_002] Sign in\n[TEXT_010] spaced text");

  /* ---- 6. 结果解析 ---- */
  let r = ctx.parseTranslateResponse("[TEXT_001] 你好世界\n[TEXT_002] 登录\n[TEXT_003] 欢迎回来", 3);
  eq("标准格式 ok", r.ok, true);
  eq("标准格式内容", [r.map[1], r.map[2], r.map[3]], ["你好世界", "登录", "欢迎回来"]);
  eq("无缺失", r.missing, []);

  r = ctx.parseTranslateResponse("```\n[TEXT_001] 你好\n[TEXT_002] 世界\n```", 2);
  eq("剥离代码块", [r.map[1], r.map[2]], ["你好", "世界"]);

  r = ctx.parseTranslateResponse("好的,以下是翻译结果:\n[TEXT_002] 第二\n[TEXT_001] 第一", 2);
  eq("顺序打乱仍正确对应", [r.map[1], r.map[2]], ["第一", "第二"]);
  ok("忽略编号前的开场白", r.map[1] === "第一");

  r = ctx.parseTranslateResponse("[TEXT_001] 第一行\n续行内容\n[TEXT_002] 第二", 2);
  eq("译文内部换行续接", r.map[1], "第一行\n续行内容");

  r = ctx.parseTranslateResponse("[TEXT_001] 甲\n[TEXT_003] 丙", 3);
  eq("缺失编号仍 ok", r.ok, true);
  eq("缺失编号被报告", r.missing, [2]);
  eq("已有编号可用", r.map[1], "甲");

  r = ctx.parseTranslateResponse("你好世界", 1);
  eq("单条无编号容错", r.map[1], "你好世界");

  r = ctx.parseTranslateResponse("抱歉,我无法完成", 3);
  eq("多条无编号判定失败", r.ok, false);
  ok("失败给出原因", r.reason.length > 0);

  r = ctx.parseTranslateResponse("", 2);
  eq("空返回判定失败", r.ok, false);

  r = ctx.parseTranslateResponse("【TEXT_001】全角括号\nTEXT_002: 冒号形式", 2);
  eq("全角括号", r.map[1], "全角括号");
  eq("冒号形式", r.map[2], "冒号形式");

  r = ctx.parseTranslateResponse("[TEXT_001] 第一次\n[TEXT_001] 第二次", 1);
  eq("重复编号取第一条", r.map[1], "第一次");

  r = ctx.parseTranslateResponse("[TEXT_001]   \n[TEXT_002] 有内容", 2);
  eq("空白译文保留为空串", r.map[1], "");
  eq("不影响其它条目", r.map[2], "有内容");

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

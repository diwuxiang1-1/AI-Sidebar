// 临时验证脚本:在 Node 中加载 utils/context.js(stub chrome.storage),校验截断/配置迁移。
// 支持项目轮:面向用户的估算明细(buildEstimateBreakdown / Report / Warning)已整体删除,
//             estimateTokens 只作为截断定位工具保留,因此这里只测它 + 截断 + 配置。

const fs = require("fs");
const vm = require("vm");

let store = {};
const chromeStub = {
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => { Object.assign(store, o); },
    },
  },
};

const ctx = { chrome: chromeStub, console, Date, Math, Object, isFinite, parseInt, String };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("utils/context.js", "utf8"), ctx);

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log("FAIL " + label + "\n  expected: " + JSON.stringify(expected) + "\n  actual:   " + JSON.stringify(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ---- 1. Token 估算(仅截断用,不产出任何用户可见数字) ---- */
eq("estimateTokens('') => 0", ctx.estimateTokens(""), 0);
eq("estimateTokens(null) => 0", ctx.estimateTokens(null), 0);
eq("estimateTokens 中文 2 字 => 2", ctx.estimateTokens("你好"), 2);
eq("estimateTokens 'hello' => 2", ctx.estimateTokens("hello"), 2);
eq("estimateTokens '你好world' => 4", ctx.estimateTokens("你好world"), 4);
ok("estimateTokens 英文长文显著小于字符数", ctx.estimateTokens("a".repeat(400)) === 100);

/* ---- 2. 面向用户的估算明细已删除(支持项目轮) ---- */
eq("没有 buildEstimateBreakdown", typeof ctx.buildEstimateBreakdown, "undefined");
eq("没有 buildEstimateReport", typeof ctx.buildEstimateReport, "undefined");
eq("没有 buildContextWarning", typeof ctx.buildContextWarning, "undefined");
eq("没有 estimateMessagesTokens(只服务估算栏,已随估算栏删除)", typeof ctx.estimateMessagesTokens, "undefined");
eq("没有本地费用推算", typeof ctx.estimateCost, "undefined");
eq("没有本地价格表", typeof ctx.MODEL_PRICES, "undefined");

/* ---- 3. 截断:核心不变量 estimateTokens(结果) <= limit ---- */
const cjk10k = "中".repeat(10000);
let r = ctx.truncateTextToTokens(cjk10k, 4000);
ok("中文 10000 字 / limit 4000 触发截断", r.truncated === true);
ok("截断后不超过 limit", ctx.estimateTokens(r.text) <= 4000);
ok("保留长度接近 limit", r.text.length === 4000);
eq("原始 token 数保留", r.originalTokens, 10000);

r = ctx.truncateTextToTokens(cjk10k, 16000);
ok("limit 16000 不截断", r.truncated === false && r.text.length === 10000);

const mixed = ("中文abc " .repeat(3000));  // 混合内容
[500, 2000, 4000, 8000].forEach(function (lim) {
  const t = ctx.truncateTextToTokens(mixed, lim);
  ok("混合内容 limit=" + lim + " 不超限", ctx.estimateTokens(t.text) <= lim);
});
ok("截断结果是原文本前缀", mixed.indexOf(ctx.truncateTextToTokens(mixed, 500).text) === 0);
eq("空文本不报错", ctx.truncateTextToTokens("", 4000).truncated, false);
eq("非法 limit 回落默认 4000", ctx.truncateTextToTokens(cjk10k, 0).keptTokens, 4000);

/* ---- 4. 截断提示格式 ---- */
eq("截断提示", ctx.buildPageTruncationNote(12000, 4000),
  "\n\n[网页内容已截断]\n原始长度:12,000 tokens\n当前限制:4,000 tokens");

/* ---- 5. 费用/用量:本地估算与价格表已整体移除 ---- */
/*      现在只显示服务商在 usage 里直接返回的真实数据(见 providers/openai-compatible.js) */

/* ---- 6. 配置读写与迁移 ---- */
(async function () {
  store = {};
  let cfg = await ctx.getContextConfig();
  eq("默认 4000", cfg.pageMaxTokens, 4000);

  await ctx.saveContextConfig({ pageMaxTokens: 12000 });
  cfg = await ctx.getContextConfig();
  eq("保存后读回 12000", cfg.pageMaxTokens, 12000);

  store = { "ai-sidebar:context-config": { pageMaxTokens: 8000 } };
  cfg = await ctx.getContextConfig();
  eq("旧数据缺字段用默认补齐", cfg.pageMaxTokens, 8000);

  store = { "ai-sidebar:context-config": { pageMaxTokens: "abc" } };
  eq("非法值回落 4000", (await ctx.getContextConfig()).pageMaxTokens, 4000);

  store = { "ai-sidebar:context-config": { pageMaxTokens: 100 } };
  eq("低于下限回落 4000", (await ctx.getContextConfig()).pageMaxTokens, 4000);

  store = { "ai-sidebar:context-config": { pageMaxTokens: 999999 } };
  eq("超过上限夹到 200000", (await ctx.getContextConfig()).pageMaxTokens, 200000);

  store = { "ai-sidebar:context-config": "not-an-object" };
  eq("脏数据不抛错", (await ctx.getContextConfig()).pageMaxTokens, 4000);

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

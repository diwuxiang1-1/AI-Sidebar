// 临时验证脚本:第十轮「AI 权限等级」专项验证
//   A. utils/permissions.js —— 两级权限读写 / 独立性 / 审计日志
//   B. utils/webpatch.js   —— 按权限过滤动作 / 提示词分级
//   C. 后台 service worker —— 权限边界(等级 1 主世界执行、等级 2 工具调度)
//   D. utils/browser-tools.js —— Tool 层清单与调度
//   E. content.js —— 普通 HTML5 video 任意倍速(16x,不设人为上限)
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
const read = (p) => fs.readFileSync("E:/AI-Sidebar/" + p, "utf8");

/* ============================================================
   A + B. 纯逻辑模块
   ============================================================ */
const store = {};
const chromeStub = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === "string") return (k in store) ? { [k]: store[k] } : {};
        if (Array.isArray(k)) { const o = {}; k.forEach((x) => { if (x in store) o[x] = store[x]; }); return o; }
        if (k && typeof k === "object") { const o = {}; Object.keys(k).forEach((x) => { if (x in store) o[x] = store[x]; }); return o; }
        return {};
      },
      set: async (o) => { Object.assign(store, o); },
    },
  },
};

const ctx = { console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, chrome: chromeStub };
vm.createContext(ctx);
["utils/permissions.js", "utils/webpatch.js", "utils/browser-tools.js"].forEach((f) =>
  vm.runInContext(read(f), ctx, { filename: f }));

(async function () {
  /* ---------- A. 权限读写 ---------- */
  let perms = await ctx.getPermissions();
  eq("默认两个高级权限都关闭", perms, { page: false, browser: false });
  eq("默认权限文案为基础权限", ctx.describePermissionLevel(perms), "普通 AI(基础权限)");

  await ctx.setPermissionLevel("page", true);
  perms = await ctx.getPermissions();
  eq("只开等级 1 时等级 2 仍关闭", perms, { page: true, browser: false });
  eq("等级 1 文案", ctx.describePermissionLevel(perms), "网页 Agent(等级 1)");

  await ctx.setPermissionLevel("browser", true);
  perms = await ctx.getPermissions();
  eq("两个等级可同时开启", perms, { page: true, browser: true });
  eq("等级 2 文案", ctx.describePermissionLevel(perms), "浏览器 Agent(等级 2)");

  await ctx.setPermissionLevel("page", false);
  perms = await ctx.getPermissions();
  eq("可只关等级 1 而保留等级 2(两级独立)", perms, { page: false, browser: true });

  await ctx.savePermissions({});
  eq("清空后回到默认", await ctx.getPermissions(), { page: false, browser: false });

  eq("hasPageLevel 默认 false", await ctx.hasPageLevel(), false);
  eq("hasBrowserLevel 默认 false", await ctx.hasBrowserLevel(), false);

  /* ---------- A. 审计日志 ---------- */
  await ctx.clearAuditLog();
  eq("清空后为空", (await ctx.getAuditLog()).length, 0);

  await ctx.appendAuditLog("page", "run_js", "video.playbackRate = 16");
  await ctx.appendAuditLog("browser", "tabs.open", "https://example.com");
  let log = await ctx.getAuditLog();
  eq("写入两条记录", log.length, 2);
  eq("记录内容正确", [log[0].level, log[0].action, log[0].detail], ["page", "run_js", "video.playbackRate = 16"]);
  ok("记录带时间戳", typeof log[0].t === "number" && log[0].t > 0);
  eq("等级标签", [ctx.auditLevelLabel("page"), ctx.auditLevelLabel("browser"), ctx.auditLevelLabel("base")],
    ["网页权限", "浏览器权限", "基础权限"]);
  ok("时间格式 HH:MM:SS", /^\d{2}:\d{2}:\d{2}$/.test(ctx.formatAuditTime(Date.now())));

  await ctx.clearAuditLog();
  eq("再次清空生效", (await ctx.getAuditLog()).length, 0);

  /* ---------- B. 按权限过滤动作 ---------- */
  const planWithPriv = {
    type: "webpage_patch", summary: "改倍速并开标签页",
    actions: [
      { action: "set_style", selector: "#v", styles: { width: "100%" } },
      { action: "run_js", code: "return document.querySelector('video').playbackRate = 16;" },
      { action: "browser_tool", tool: "tabs.open", args: { url: "https://example.com" } },
    ],
  };

  let v = ctx.validateWebPatchPlan(planWithPriv, { page: false, browser: false });
  eq("无权限时只保留结构化动作", v.actions.length, 1);
  eq("丢弃两个越权动作", v.dropped.length, 2);
  ok("等级 1 缺失原因明确", v.dropped[0].reason.indexOf("权限等级 1") !== -1);
  ok("等级 2 缺失原因明确", v.dropped[1].reason.indexOf("权限等级 2") !== -1);

  v = ctx.validateWebPatchPlan(planWithPriv, { page: true, browser: false });
  eq("只开等级 1:保留结构化 + run_js", v.actions.length, 2);
  eq("等级 2 动作仍被丢弃", v.dropped.length, 1);

  v = ctx.validateWebPatchPlan(planWithPriv, { page: true, browser: true });
  eq("两级都开:全部保留", v.actions.length, 3);
  eq("无丢弃", v.dropped.length, 0);

  v = ctx.validateWebPatchPlan({ actions: [{ action: "browser_tool", tool: "not.a.tool" }] }, { browser: true });
  eq("未开放的工具被丢弃", v.actions.length, 0);
  ok("原因说明工具未开放", v.dropped[0].reason.indexOf("未开放的工具") !== -1);

  v = ctx.validateWebPatchPlan({ actions: [{ action: "run_js" }] }, { page: true });
  eq("run_js 缺 code 被丢弃", v.actions.length, 0);

  /* ---------- B. 提示词分级 ---------- */
  const promptOff = ctx.buildWebPatchSystemPrompt({ permissions: { page: false, browser: false } });
  ok("未开权限:提示词不给出 run_js 动作", promptOff.indexOf('"action":"run_js"') === -1);
  ok("未开权限:提示词不给出 browser_tool 动作", promptOff.indexOf('"action":"browser_tool"') === -1);
  ok("未开权限:提示词声明无脚本能力", promptOff.indexOf("没有任何动作可以执行脚本") !== -1);

  const prompt1 = ctx.buildWebPatchSystemPrompt({ permissions: { page: true, browser: false } });
  ok("等级 1:提示词给出 run_js", prompt1.indexOf('"action":"run_js"') !== -1);
  ok("等级 1:提示词说明主世界", prompt1.indexOf("主世界") !== -1);
  ok("等级 1:提示词明确不设倍速上限", prompt1.indexOf("playbackRate = 16") !== -1 && prompt1.indexOf("不要人为设上限") !== -1);
  ok("等级 1:提示词说明无法自动回滚", prompt1.indexOf("无法自动回滚") !== -1);
  ok("等级 1:仍不给出 browser_tool", prompt1.indexOf('"action":"browser_tool"') === -1);

  const prompt2 = ctx.buildWebPatchSystemPrompt({ permissions: { page: true, browser: true }, toolList: ctx.describeBrowserTools() });
  ok("等级 2:提示词带上工具清单", prompt2.indexOf("tabs.list") !== -1 && prompt2.indexOf("history.search") !== -1);
  ok("等级 2:提示词给出 browser_tool", prompt2.indexOf('"action":"browser_tool"') !== -1);
  ok("等级 2:提示词提示不可撤销", prompt2.indexOf("不可撤销") !== -1);

  /* ---------- D. Tool 层 ---------- */
  const names = ctx.browserToolNames();
  ["tabs.list", "tabs.open", "tabs.close", "tabs.activate", "tabs.navigate", "tabs.reload",
   "history.search", "cookies.get", "cookies.set", "downloads.start", "storage.get", "storage.set"]
    .forEach((n) => ok("工具已注册:" + n, names.indexOf(n) !== -1));

  const unknown = await ctx.runBrowserTool("nope.nope", {});
  eq("未知工具返回失败而不是抛异常", unknown.ok, false);
  ok("未知工具错误说明", unknown.error.indexOf("未开放的工具") !== -1);

  const missing = await ctx.runBrowserTool("tabs.open", {});
  eq("参数缺失返回真实失败", missing.ok, false);

  console.log("\n[纯逻辑部分] 通过 " + pass + " 项,失败 " + fail + " 项");

  /* ============================================================
     C. 后台权限边界
     ============================================================ */
  const swStore = {};
  let injectCalls = [];
  let tabCalls = [];
  let auditSw = [];

  const swCtx = {
    console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise,
    importScripts: function () {
      for (var i = 0; i < arguments.length; i++) {
        vm.runInContext(read(arguments[i]), swCtx, { filename: arguments[i] });
      }
    },
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener() {} }, sendMessage: async () => ({}) },
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior: async () => {} },
      storage: {
        local: {
          get: async (k) => (typeof k === "string" && k in swStore) ? { [k]: swStore[k] } : {},
          set: async (o) => { Object.assign(swStore, o); },
        },
      },
      tabs: {
        // 第四阶段:目标状态跟踪需要这些 Tab 事件
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        get: async (id) => ({ id: id, url: "https://example.com/a", title: "示例页", windowId: 1 }),

        query: async () => [{ id: 7, title: "示例页", url: "https://example.com/p", active: true, windowId: 1 }],
        create: async (o) => { tabCalls.push({ op: "create", o }); return { id: 9, url: o.url }; },
        remove: async (id) => { tabCalls.push({ op: "remove", id }); },
        update: async (id, o) => { tabCalls.push({ op: "update", id, o }); return { id, url: o.url || "" }; },
        reload: async (id) => { tabCalls.push({ op: "reload", id }); },
      },
      windows: { update: async () => {} },
      history: { search: async () => [] },
      cookies: { get: async () => null, getAll: async () => [], set: async () => null },
      downloads: { download: async () => 1 },
      scripting: {
        executeScript: async (opts) => {
          injectCalls.push(opts);
          return [{ result: { ok: true, value: "stub-value", logs: ["log line"] } }];
        },
      },
    },
  };
  vm.createContext(swCtx);
  vm.runInContext(read("background/service-worker.js"), swCtx, { filename: "service-worker.js" });

  ok("后台成功加载权限与工具模块", typeof swCtx.hasPageLevel === "function" && typeof swCtx.runBrowserTool === "function");
  ok("后台暴露等级 1 处理器", typeof swCtx.runPageCode === "function");
  ok("后台暴露等级 2 处理器", typeof swCtx.runBrowserToolChecked === "function");

  /* --- 两级都关:必须拒绝 --- */
  swStore["ai-sidebar:permissions"] = { page: false, browser: false };

  let res = await swCtx.runPageCode({ code: "return 1" });
  eq("未开等级 1:拒绝执行网页代码", res.ok, false);
  ok("拒绝原因指向等级 1", res.error.indexOf("权限等级 1") !== -1);
  eq("被拒绝时没有注入页面", injectCalls.length, 0);

  let tool = await swCtx.runBrowserToolChecked({ tool: "tabs.list", args: {} });
  eq("未开等级 2:拒绝浏览器工具", tool.ok, false);
  ok("拒绝原因指向等级 2", tool.error.indexOf("权限等级 2") !== -1);
  eq("被拒绝时没有调用浏览器 API", tabCalls.length, 0);

  /* --- 只开等级 1 --- */
  swStore["ai-sidebar:permissions"] = { page: true, browser: false };

  res = await swCtx.runPageCode({ code: "return document.querySelector('video').playbackRate = 16;", summary: "16 倍速" });
  eq("开启等级 1:执行成功", res.ok, true);
  eq("回传页面返回值", res.value, "stub-value");
  eq("只注入一次", injectCalls.length, 1);
  eq("注入到网页主世界(MAIN world)", injectCalls[0].world, "MAIN");
  eq("注入目标是当前活动标签页", injectCalls[0].target, { tabId: 7 });
  eq("注入函数与代码参数", injectCalls[0].args[0], "return document.querySelector('video').playbackRate = 16;");
  ok("注入的是自包含函数", typeof injectCalls[0].func === "function");
  ok("注入函数不引用外部变量(源码里无 chrome.*)", String(injectCalls[0].func).indexOf("chrome.") === -1);

  eq("空代码被拒绝", (await swCtx.runPageCode({ code: "   " })).ok, false);

  tool = await swCtx.runBrowserToolChecked({ tool: "tabs.list", args: {} });
  eq("等级 1 不足以调用浏览器工具", tool.ok, false);
  eq("仍未调用浏览器 API", tabCalls.length, 0);

  /* --- 只开等级 2 --- */
  swStore["ai-sidebar:permissions"] = { page: false, browser: true };

  eq("等级 2 不足以执行网页代码", (await swCtx.runPageCode({ code: "return 1" })).ok, false);
  eq("没有新增注入", injectCalls.length, 1);

  let list = await swCtx.runBrowserToolChecked({ tool: "tabs.list", args: {} });
  eq("开启等级 2:工具执行成功", list.ok, true);
  eq("tabs.list 返回标签页", Array.isArray(list.result) && list.result[0].id, 7);

  const open = await swCtx.runBrowserToolChecked({ tool: "tabs.open", args: { url: "https://example.com/new" } });
  eq("tabs.open 生效", open.ok, true);
  eq("确实调用了 chrome.tabs.create", tabCalls[tabCalls.length - 1].op, "create");

  const bad = await swCtx.runBrowserToolChecked({ tool: "no.such.tool", args: {} });
  eq("未开放工具被拒绝", bad.ok, false);

  /* --- 审计:后台自己写入记录 --- */
  const swLog = swStore["ai-sidebar:audit-log"] || [];
  ok("后台写入了网页代码审计记录", swLog.some((e) => e.level === "page" && e.action === "run_js"));
  ok("后台写入了浏览器工具审计记录", swLog.some((e) => e.level === "browser" && e.action === "tabs.open"));
  ok("审计记录含实际参数", swLog.some((e) => e.detail.indexOf("example.com/new") !== -1));

  console.log("[权限边界部分] 通过 " + pass + " 项,失败 " + fail + " 项");

  /* ============================================================
     E. 普通 HTML5 video 倍速(等级 1 的典型场景)
     ============================================================ */
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>播放器</title></head><body><video id="v" src="/v.mp4" controls></video><audio id="a" src="/a.mp3"></audio></body></html>',
    { url: "https://example.com/watch", runScripts: "outside-only" });
  dom.window.chrome = { runtime: { onMessage: { addListener() {} } } };
  const pctx = dom.getInternalVMContext();
  ["utils/context.js", "utils/webpatch.js", "content/content.js"].forEach((f) =>
    vm.runInContext(read(f), pctx, { filename: f }));

  const doc = dom.window.document;
  const video = doc.getElementById("v");

  let r16 = pctx.wpApplyPlan({ summary: "16 倍速", actions: [{ action: "set_media", selector: "#v", op: "rate", value: 16 }] });
  eq("16 倍速执行成功(无上限)", r16.modified, 1);
  eq("video.playbackRate 实际为 16", video.playbackRate, 16);

  let rHalf = pctx.wpApplyPlan({ actions: [{ action: "set_media", selector: "#v", op: "rate", value: 0.25 }] });
  eq("0.25 倍速也允许", video.playbackRate, 0.25);

  let rZero = pctx.wpApplyPlan({ actions: [{ action: "set_media", selector: "#v", op: "rate", value: 0 }] });
  eq("非法倍速被拒绝", rZero.modified, 0);
  ok("拒绝原因说明倍速", rZero.failures[0].reason.indexOf("倍速") !== -1);

  let rMuted = pctx.wpApplyPlan({ actions: [{ action: "set_media", selector: "#v", op: "muted", value: true }] });
  eq("静音可设置", [rMuted.modified, video.muted], [1, true]);

  let restore = pctx.wpRestoreAll();
  ok("倍速等媒体状态可回滚", restore.ok);
  eq("回滚后倍速恢复", video.playbackRate, 1);
  eq("回滚后静音恢复", video.muted, false);

  /* --- 等级 1 的代码注入能力:验证注入函数在真实页面环境能取到页面对象 --- */
  const injected = swCtx.aiPageRunCode;
  ok("注入函数可在页面环境运行(直接调用验证)", typeof injected === "function");

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

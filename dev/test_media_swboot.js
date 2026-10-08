// 专项测试 H(已按第十二轮架构更新):Service Worker 启动 + 跨 frame 媒体/深度分析汇总
// 用浏览器真实的 importScripts 路径解析规则(相对 worker 自身),
// 确保新增模块不会拖死 SW 启动 —— 那是第十轮回归的根因,必须持续守住。
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeReporter, ROOT } = require("./_media_harness");

const WORKER = "background/service-worker.js";
const R = makeReporter("SW 启动 + 跨 frame 汇总");

function resolveImport(workerPath, spec) {
  if (spec.startsWith("/")) return spec.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(workerPath), spec));
}

/** @param {{breakPerms?:boolean}} opts */
function boot(opts) {
  opts = opts || {};
  const state = { listener: null, bootError: null, relayed: [], injected: [] };

  const frameResult = (frameId) => ({
    frameId: frameId,
    result: {
      ok: true,
      frame: "https://example.com/frame" + frameId,
      counts: { dom: 10, video: 1, audio: 0, iframe: 0, shadow: 0, media: 1, playing: 1 },
      media: [{ id: "media_1", type: "video", paused: false, playbackRate: 1, srcType: "blob" }],
      iframes: [], shadows: [],
      applied: 1, failed: 0,
      results: [{ id: "media_1", ok: true, detail: "media_1 倍速 1 -> 16", actualValue: 16 }],
    },
  });

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise, Map, Set, Error, TypeError,

    importScripts: function () {
      if (opts.breakPerms) throw new Error("模拟:权限模块不可用");
      for (let i = 0; i < arguments.length; i++) {
        const abs = path.join(ROOT, resolveImport(WORKER, arguments[i]));
        if (!fs.existsSync(abs)) throw new Error("Could not load script: " + arguments[i]);
        vm.runInContext(fs.readFileSync(abs, "utf8"), ctx, { filename: arguments[i] });
      }
    },

    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(fn) { state.listener = fn; } },
        sendMessage: async () => ({}),
      },
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior: async () => {} },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: {
        // 第四阶段:目标状态跟踪需要这些 Tab 事件
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        get: async (id) => ({ id: id, url: "https://example.com/a", title: "示例页", windowId: 1 }),

        query: async () => [{ id: 3, url: "https://example.com/a", title: "示例", active: true }],
        sendMessage: async (id, m) => { state.relayed.push(m && m.type); return { ok: true, steps: 1 }; },
      },
      scripting: {
        executeScript: async (o) => {
          state.injected.push({ target: o.target, args: o.args, func: String(o.func).slice(0, 40) });
          if (o.target.allFrames) return [frameResult(0), frameResult(3)];
          return (o.target.frameIds || [0]).map(frameResult);
        },
      },
    },
  };

  vm.createContext(ctx);
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, WORKER), "utf8"), ctx, { filename: WORKER });
  } catch (e) {
    state.bootError = e;
  }
  return { ctx, state };
}

function send(state, message) {
  return new Promise((resolve) => {
    if (!state.listener) return resolve({ __noListener: true });
    let done = false;
    const sendResponse = (r) => { if (!done) { done = true; resolve(r); } };
    if (!state.listener(message, {}, sendResponse)) setTimeout(() => sendResponse(undefined), 20);
    setTimeout(() => { if (!done) { done = true; resolve({ __timeout: true }); } }, 900);
  });
}

(async function () {
  const b = boot();
  R.ok("Service Worker 启动无异常", !b.state.bootError);
  R.ok("已注册消息监听器", typeof b.state.listener === "function");
  R.ok("权限模块加载成功", typeof b.ctx.hasPageLevel === "function");

  /* ---- 深度分析:改为后台注入所有 frame 并汇总 ---- */
  b.state.injected.length = 0;
  const deep = await send(b.state, { type: "ai-sidebar:deep-analyze" });

  R.ok("深度分析有响应", !!(deep && deep.ok));
  R.eq("用 allFrames 注入", b.state.injected[0].target.allFrames, true);
  R.eq("汇总了两个 frame", deep.frameCount, 2);
  R.eq("媒体计数跨 frame 累加", deep.counts.media, 2);
  R.eq("媒体编号带 frame 前缀(0)", deep.media[0].id, "f0_media_1");
  R.eq("媒体编号带 frame 前缀(3)", deep.media[1].id, "f3_media_1");
  R.ok("报告含 frame 地址", deep.report.indexOf("frame3") !== -1);

  /* ---- 媒体执行:默认所有 frame ---- */
  b.state.injected.length = 0;
  const media = await send(b.state, { type: "ai-sidebar:media-apply", op: "rate", value: 16 });

  R.ok("媒体执行有响应", !!(media && media.ok));
  R.eq("用 allFrames 注入", b.state.injected[0].target.allFrames, true);
  R.eq("作业参数正确", b.state.injected[0].args[0].value, 16);
  R.eq("默认开启保持倍速", b.state.injected[0].args[0].keep, true);
  R.eq("汇总生效数(2 个 frame 各 1 个)", media.applied, 2);
  R.eq("回报真实生效值", media.actualValues[0], 16);
  R.ok("消息含生效值", media.message.indexOf("16") !== -1);

  /* ---- 指定 frame 编号时只打该 frame ---- */
  b.state.injected.length = 0;
  const scoped = await send(b.state, { type: "ai-sidebar:media-apply", op: "rate", value: 8, target: "f3_media_1" });

  R.ok("指定 frame 的媒体操作有响应", !!(scoped && scoped.ok));
  R.eq("只注入指定 frame", b.state.injected[0].target.frameIds, [3]);
  R.eq("target 前缀被剥离", b.state.injected[0].args[0].target, "media_1");

  /* ---- 撤销 / 恢复:顶层走内容脚本 + 其它 frame 扇出 ---- */
  b.state.relayed.length = 0;
  b.state.injected.length = 0;
  const undo = await send(b.state, { type: "ai-sidebar:patch-undo" });

  R.eq("撤销仍转发给顶层内容脚本", b.state.relayed[0], "ai-sidebar:patch-undo");
  R.eq("同时扇出到所有 frame", b.state.injected[0].target.allFrames, true);
  R.ok("撤销有响应", !!(undo && undo.ok));

  /* ---- 既有网页功能仍能中转 ---- */
  for (const t of ["get-page-info", "get-page-resources", "patch-analyze", "patch-apply", "collect-texts"]) {
    b.state.relayed.length = 0;
    const r = await send(b.state, { type: "ai-sidebar:" + t });
    R.eq(t + " 仍可中转", b.state.relayed.length, 1);
    R.ok(t + " 有正常响应", !!(r && r.ok));
  }

  /* ---- 降级:权限模块不可用时 SW 仍须启动 ---- */
  const d = boot({ breakPerms: true });
  R.ok("权限模块不可用时 SW 仍能启动", !d.state.bootError);
  R.ok("仍注册了消息监听", typeof d.state.listener === "function");

  d.state.relayed.length = 0;
  const dr = await send(d.state, { type: "ai-sidebar:get-page-info" });
  R.ok("降级后网页读取仍可中转", d.state.relayed.length === 1 && !!(dr && dr.ok));

  const pr = await send(d.state, { type: "ai-sidebar:page-run-js", code: "1" });
  R.ok("权限功能自身降级为明确报错", pr && pr.ok === false);

  R.done();
})();

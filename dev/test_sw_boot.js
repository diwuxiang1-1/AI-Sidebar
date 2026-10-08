// 回归定位:后台 Service Worker 启动链 + 消息中转链
//
// 重点:复现浏览器的 importScripts 路径解析规则 ——
//   在 /background/service-worker.js 里写 importScripts("utils/x.js"),
//   解析结果是 /background/utils/x.js(相对 worker 自身),而不是 /utils/x.js。
//   一旦解析到不存在的文件,importScripts 抛错 → SW 顶层后续代码(包括
//   chrome.runtime.onMessage.addListener)**全部不执行** → 所有网页功能瘫痪。
//
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = "E:/AI-Sidebar";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const s = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  if (s(actual) === s(expected)) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + s(expected) + "\n  actual:   " + s(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/**
 * 按浏览器的规则把 importScripts 的参数解析成扩展内路径
 * @param {string} workerPath 形如 "background/service-worker.js"
 */
function resolveImport(workerPath, spec) {
  if (spec.startsWith("/")) return spec.slice(1);              // 以扩展根为基准
  const dir = path.posix.dirname(workerPath);
  return path.posix.normalize(path.posix.join(dir, spec));     // 相对 worker 自身
}

const WORKER_PATH = "background/service-worker.js";

/** 启动一个 SW 上下文,返回 { ctx, listener, bootError, injected } */
function bootServiceWorker(opts) {
  opts = opts || {};

  const state = { listener: null, bootError: null, relayed: [], createdTabs: [] };

  const store = opts.store || {};

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise, Map, Set,
    Error, TypeError,

    // —— 关键:按浏览器语义解析路径,文件不存在就抛错(和浏览器一致) ——
    importScripts: function () {
      for (let i = 0; i < arguments.length; i++) {
        const spec = arguments[i];
        const resolved = resolveImport(WORKER_PATH, spec);
        const abs = path.join(ROOT, resolved);
        if (!fs.existsSync(abs)) {
          throw new Error("Could not load script: " + spec + " (resolved: " + resolved + ")");
        }
        vm.runInContext(fs.readFileSync(abs, "utf8"), ctx, { filename: resolved });
      }
    },

    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(fn) { state.listener = fn; } },
        sendMessage: async () => ({}),
      },
      action: { onClicked: { addListener() {} } },
      sidePanel: {
        setPanelBehavior: async () => {},
        getState: async () => "closed",
        setOptions: async () => {},
        open: async () => {},
      },
      storage: {
        local: {
          get: async (k) => (typeof k === "string" && k in store) ? { [k]: store[k] } : {},
          set: async (o) => { Object.assign(store, o); },
        },
      },
      tabs: {
        // 第四阶段:目标状态跟踪需要这些 Tab 事件
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        get: async (id) => ({ id: id, url: "https://example.com/a", title: "示例页", windowId: 1 }),

        query: async () => [{ id: 5, title: "示例页", url: "https://example.com/a", active: true }],
        sendMessage: async (tabId, message) => {
          state.relayed.push({ tabId, type: message && message.type });
          if (opts.contentFails) throw new Error("Could not establish connection");
          return { ok: true, echoed: message && message.type };
        },
        create: async (o) => { state.createdTabs.push(o); return { id: 1, url: o.url }; },
      },
      scripting: { executeScript: async () => [{ result: { ok: true, value: "v", logs: [] } }] },
      windows: { update: async () => {} },
      history: { search: async () => [] },
      cookies: { getAll: async () => [], get: async () => null, set: async () => null },
      downloads: { download: async () => 1 },
    },
  };

  vm.createContext(ctx);

  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, WORKER_PATH), "utf8"), ctx, { filename: WORKER_PATH });
  } catch (e) {
    state.bootError = e;
  }

  return { ctx, state };
}

/** 像浏览器那样调用 onMessage 监听器 */
function sendToServiceWorker(state, message) {
  return new Promise((resolve) => {
    if (!state.listener) { resolve({ __noListener: true }); return; }
    let done = false;
    const sendResponse = (r) => { if (!done) { done = true; resolve(r); } };
    const keep = state.listener(message, { id: "ext" }, sendResponse);
    if (!keep) setTimeout(() => sendResponse(undefined), 20);
    setTimeout(() => { if (!done) { done = true; resolve({ __timeout: true }); } }, 500);
  });
}

(async function () {
  console.log("=== 1. Service Worker 能否正常启动 ===");

  const boot = bootServiceWorker();

  if (boot.state.bootError) {
    console.log("  SW 启动异常: " + boot.state.bootError.message);
  }

  ok("Service Worker 启动无异常", !boot.state.bootError);
  ok("SW 注册了消息监听器(原有功能的前提)", typeof boot.state.listener === "function");
  ok("权限模块加载成功", typeof boot.ctx.hasPageLevel === "function" && typeof boot.ctx.runBrowserTool === "function");

  if (!boot.state.listener) {
    console.log("\n>>> 启动失败:消息监听器未注册,侧边栏所有网页请求都会卡住/失败。");
    console.log("通过 " + pass + " 项,失败 " + fail + " 项");
    process.exit(1);
  }

  console.log("\n=== 2. 三个网页功能的消息中转链 ===");

  const cases = [
    { name: "当前网页读取", type: "ai-sidebar:get-page-info" },
    { name: "网页资源读取", type: "ai-sidebar:get-page-resources" },
    { name: "AI 修改网页(分析)", type: "ai-sidebar:patch-analyze" },
    { name: "AI 修改网页(执行)", type: "ai-sidebar:patch-apply" },
    { name: "网页翻译(收集)", type: "ai-sidebar:collect-texts" },
    { name: "读取完整网页", type: "ai-sidebar:get-page-text" },
  ];

  for (const c of cases) {
    boot.state.relayed.length = 0;
    const res = await sendToServiceWorker(boot.state, { type: c.type });

    ok(c.name + ":后台有响应", res && !res.__noListener && !res.__timeout);
    eq(c.name + ":已转发到当前标签页", boot.state.relayed.length, 1);
    ok(c.name + ":转发目标正确", res && res.ok === true);
  }

  console.log("\n=== 3. 无法连接页面时要有友好错误(不悬挂) ===");

  const boot2 = bootServiceWorker({ contentFails: true });
  const res2 = await sendToServiceWorker(boot2.state, { type: "ai-sidebar:get-page-info" });
  ok("页面不可注入时返回明确错误", res2 && res2.ok === false && typeof res2.error === "string");
  // 第四阶段:操作目标不一定是「当前网页」了,文案随之改为「目标网页」
  ok("错误信息说明原因", res2 && res2.error.indexOf("无法连接目标网页") !== -1);

  console.log("\n=== 4. 权限层初始化失败必须降级,不能拖死原有功能 ===");

  // 模拟权限模块缺失:importScripts 始终抛错
  const boot3 = (function () {
    const state = { listener: null, bootError: null, relayed: [] };
    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise, Map, Set, Error, TypeError,
      importScripts: function () { throw new Error("模拟:权限模块不可用"); },
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

          query: async () => [{ id: 5, url: "https://example.com/a", active: true }],
          sendMessage: async (id, m) => { state.relayed.push(m && m.type); return { ok: true }; },
        },
      },
    };
    vm.createContext(ctx);
    try {
      vm.runInContext(fs.readFileSync(path.join(ROOT, WORKER_PATH), "utf8"), ctx, { filename: WORKER_PATH });
    } catch (e) { state.bootError = e; }
    return { ctx, state };
  })();

  ok("权限模块不可用时 SW 仍能启动", !boot3.state.bootError);
  ok("权限模块不可用时仍注册了消息监听", typeof boot3.state.listener === "function");

  if (boot3.state.listener) {
    boot3.state.relayed.length = 0;
    const r3 = await sendToServiceWorker(boot3.state, { type: "ai-sidebar:get-page-info" });
    ok("原有网页读取不受权限模块影响", r3 && r3.ok === true);
    eq("确实转发了", boot3.state.relayed.length, 1);

    const r3b = await sendToServiceWorker(boot3.state, { type: "ai-sidebar:page-run-js", code: "1" });
    ok("权限功能自身降级为明确报错", r3b && r3b.ok === false);
  }

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

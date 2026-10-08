// 第四阶段专项测试 1/4:锁定目标 + Tab 生命周期 + 多目标互不污染
//   对应验收项 1–10
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
    done() { console.log("\n[锁定目标 / Tab 生命周期] 通过 " + pass + " 项,失败 " + fail + " 项"); process.exit(fail ? 1 : 0); },
  };
})();

/* ============================================================
   装载内容脚本 + 后台(与真实加载顺序一致)
   ============================================================ */
function boot(opts) {
  opts = opts || {};
  const state = { listener: null, relayed: [], store: {}, removed: [], updated: [], createdSidePanel: 0 };
  const tabs = opts.tabs || [
    { id: 12, windowId: 1, url: "https://a.example.com/page", title: "网页 A", favIconUrl: "fav-a.ico" },
    { id: 15, windowId: 1, url: "https://b.example.com/post", title: "网页 B", favIconUrl: "fav-b.ico" },
    { id: 18, windowId: 1, url: "https://c.example.com/test", title: "网页 C", favIconUrl: "" },
  ];
  let activeTabId = opts.activeTabId === undefined ? 15 : opts.activeTabId;

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise, Map, Set, Error,
    setTimeout, clearTimeout,

    importScripts: function () {
      for (let i = 0; i < arguments.length; i++) {
        const spec = String(arguments[i]).replace(/^\//, "");
        vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + spec, "utf8"), ctx, { filename: spec });
      }
    },

    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(fn) { state.listener = fn; } },
        sendMessage: async (m) => { state.broadcast = m; return {}; },
      },
      action: { onClicked: { addListener() {} } },
      sidePanel: { setPanelBehavior: async () => {}, open: async () => { state.createdSidePanel++; } },
      storage: {
        local: {
          get: async (k) => {
            if (typeof k === "string") return (k in state.store) ? { [k]: state.store[k] } : {};
            return {};
          },
          set: async (o) => { Object.assign(state.store, o); },
        },
        onChanged: { addListener() {} },
      },
      tabs: {
        onRemoved: { addListener(fn) { state.onRemoved = fn; } },
        onUpdated: { addListener(fn) { state.onUpdated = fn; } },
        get: async (id) => {
          const t = tabs.find((x) => x.id === id);
          if (!t) throw new Error("No tab with id: " + id);
          return Object.assign({}, t);
        },
        query: async () => {
          const t = tabs.find((x) => x.id === activeTabId);
          return t ? [Object.assign({}, t)] : [];
        },
        sendMessage: async (tabId, m) => {
          state.relayed.push({ tabId, type: m && m.type, targetTabId: m && m.targetTabId });
          return { ok: true, steps: 0, modified: 0 };
        },
        create: async (o) => ({ id: 99, url: o.url }),
      },
      scripting: {
        executeScript: async (o) => {
          state.injected = state.injected || [];
          state.injected.push(o.target);
          return [{ frameId: 0, result: { ok: true, counts: {}, media: [], iframes: [], shadows: [] } }];
        },
      },
      windows: { update: async () => {} },
      history: { search: async () => [] },
      cookies: { getAll: async () => [], get: async () => null, set: async () => null },
      downloads: { download: async () => 1 },
    },
  };

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("E:/AI-Sidebar/background/service-worker.js", "utf8"), ctx, { filename: "background/service-worker.js" });

  return {
    ctx, state,
    setActive(id) { activeTabId = id; },
    ask: (message) => new Promise((resolve) => {
      let done = false;
      const sendResponse = (r) => { if (!done) { done = true; resolve(r); } };
      const keep = state.listener(message, { id: "ext" }, sendResponse);
      if (!keep) setTimeout(() => sendResponse(undefined), 10);
      setTimeout(() => { if (!done) { done = true; resolve({ __timeout: true }); } }, 800);
    }),
  };
}

(async function () {
  /* ---------- 1. 锁定当前 Tab ---------- */
  let b = boot({ activeTabId: 15 });
  let res = await b.ask({ type: "ai-sidebar:target-lock" });

  R.ok("1. 锁定当前 Tab 成功", res && res.ok);
  R.eq("1. 记录的是浏览器当前活动的 Tab(15)", res.target.tabId, 15);
  R.eq("1. 记录了标题", res.target.title, "网页 B");
  R.eq("1. 记录了 URL", res.target.url, "https://b.example.com/post");
  R.eq("1. 记录了 favicon", res.target.favicon, "fav-b.ico");
  R.ok("1. 有锁定时间", typeof res.target.lockedAt === "number" && res.target.lockedAt > 0);
  R.eq("1. 初始状态为已锁定", res.target.state, "locked");
  R.ok("1. 新锁定的目标自动成为 AI 当前目标", res.data.activeId === 15);

  /* ---------- 2/3/4. 切到别的 Tab 后,操作仍打在锁定目标上 ---------- */
  b.setActive(18);   // 浏览器现在显示网页 C

  const list = await b.ask({ type: "ai-sidebar:target-list" });
  R.eq("2. 后台能区分「浏览器活动 Tab」与「AI 操作目标」",
    [list.browserActiveTabId, list.activeId], [18, 15]);

  // 跨 Tab 操作(目标不是浏览器当前显示的网页)需要权限等级 1
  b.state.relayed.length = 0;
  const noPerm = await b.ask({ type: "ai-sidebar:patch-analyze", targetTabId: 15 });
  R.eq("3. 未开启等级 1 时,跨 Tab 操作被拒绝", noPerm.ok, false);
  R.eq("3. 拒绝原因是权限不足,不是 JS 报错", noPerm.code, "permission-denied");
  R.ok("3. 提示指向设置里的权限开关", noPerm.error.indexOf("权限") !== -1);
  R.eq("3. 被拒绝时不会打到任何页面", b.state.relayed.length, 0);

  // 开启等级 1 后,同一个请求应该精确打在 Tab 15 上
  b.state.store["ai-sidebar:permissions"] = { page: true, browser: false };
  b.state.relayed.length = 0;
  await b.ask({ type: "ai-sidebar:patch-analyze", targetTabId: 15 });
  R.eq("3/4. 开启等级 1 后,修改指令打在锁定的 Tab 15 上,而不是当前显示的 18",
    b.state.relayed.map((x) => x.tabId), [15]);

  b.state.relayed.length = 0;
  await b.ask({ type: "ai-sidebar:get-page-info", targetTabId: 15 });
  R.eq("4. 网页读取同样按目标 Tab 走", b.state.relayed[0].tabId, 15);

  /* ---------- 5. 锁定第二个 Tab ---------- */
  b.setActive(12);
  res = await b.ask({ type: "ai-sidebar:target-lock" });
  R.ok("5. 可以锁定第二个网页", res && res.ok);

  const list2 = await b.ask({ type: "ai-sidebar:target-list" });
  R.eq("5. 同时存在两个锁定目标", list2.list.length, 2);
  R.eq("5. 新锁定的成为当前目标(12)", list2.activeId, 12);

  /* ---------- 6/7. 两个 Tab 分别操作,状态互不污染 ---------- */
  b.state.relayed.length = 0;
  await b.ask({ type: "ai-sidebar:patch-apply", targetTabId: 12, actions: [] });
  R.eq("6. 目标 12 的操作只发给 12", b.state.relayed[0].tabId, 12);

  b.state.relayed.length = 0;
  await b.ask({ type: "ai-sidebar:patch-apply", targetTabId: 15, actions: [] });
  R.eq("7. 目标 15 的操作只发给 15,不会串到 12", b.state.relayed[0].tabId, 15);

  // 切换当前目标后,后台仍严格按 targetTabId 执行
  await b.ask({ type: "ai-sidebar:target-set-active", tabId: 15 });
  b.state.relayed.length = 0;
  await b.ask({ type: "ai-sidebar:get-page-info", targetTabId: 12 });
  R.eq("7. 当前目标是 15 时,显式指定 12 依然打给 12", b.state.relayed[0].tabId, 12);

  /* ---------- 8/9. 关闭其中一个 Tab ---------- */
  const before = (await b.ask({ type: "ai-sidebar:target-list" })).list.length;
  b.state.tabs = null;
  // 模拟浏览器关闭 Tab 12
  const idx = 0; // tabs[0] 就是 12
  b.state.removed.push(12);
  // 触发 onRemoved
  await b.state.onRemoved(12);

  // 让 tabs.get(12) 抛错 = Tab 已不存在
  const origGet = b.ctx.chrome.tabs.get;
  b.ctx.chrome.tabs.get = async (id) => {
    if (id === 12) throw new Error("No tab with id: 12");
    return origGet(id);
  };

  const list3 = await b.ask({ type: "ai-sidebar:target-list" });
  const t12 = list3.list.find((x) => x.tabId === 12);
  R.eq("8. 关闭后目标仍在列表里(让用户看到真实情况)", list3.list.length, before);
  R.eq("9. 正确标记为「目标网页已关闭」", t12.state, "closed");

  b.state.relayed.length = 0;
  const closedRes = await b.ask({ type: "ai-sidebar:patch-analyze", targetTabId: 12 });
  R.eq("9. 已关闭的目标不再被执行", closedRes.ok, false);
  R.eq("9. 给出明确原因", closedRes.code, "target-closed");
  R.ok("9. 提示文案说明已关闭", closedRes.error.indexOf("已关闭") !== -1);
  R.eq("9. 不会转发到任何页面", b.state.relayed.length, 0);

  /* ---------- 10. Tab 导航到新 URL ---------- */
  b.ctx.chrome.tabs.get = origGet;
  await b.state.onUpdated(18, { url: "https://new.example.com/other" }, { id: 18, title: "新页面", url: "https://new.example.com/other" });
  // 18 没被锁定,不应影响列表
  const list4 = await b.ask({ type: "ai-sidebar:target-list" });
  R.eq("10. 未锁定的 Tab 变化不影响目标列表", list4.list.length, before);

  // 锁定的 15 跳转到新地址
  await b.state.onUpdated(15, { url: "https://b.example.com/moved" }, { id: 15, title: "网页 B(改版)", url: "https://b.example.com/moved" });
  const list5 = await b.ask({ type: "ai-sidebar:target-list" });
  const t15 = list5.list.find((x) => x.tabId === 15);
  R.eq("10. 锁定的目标跳到新地址后标记为已导航", t15.state, "navigated");

  const navRes = await b.ask({ type: "ai-sidebar:patch-analyze", targetTabId: 15 });
  R.eq("10. 已导航的目标默认不继续当作原网页操作", navRes.ok, false);
  R.eq("10. 给出「需要重新确认」", navRes.code, "target-navigated");
  R.ok("10. 不把网页 B 的新地址当成原来那个网页", navRes.error.indexOf("已导航") !== -1);

  // 用户点「重新确认」后恢复正常
  const confirm = await b.ask({ type: "ai-sidebar:target-confirm", tabId: 15 });
  R.ok("10. 重新确认成功", confirm && confirm.ok);
  const t15b = confirm.data.list.find((x) => x.tabId === 15);
  R.eq("10. 确认后回到正常锁定状态", t15b.state, "locked");

  /* 解除锁定 */
  const un = await b.ask({ type: "ai-sidebar:target-unlock", tabId: 15 });
  R.ok("解除锁定成功", un && un.ok);
  R.eq("解除后只剩一个目标", un.data.list.length, 1);

  R.done();
})();

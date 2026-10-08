// ============================================================
// AI Sidebar · Browser Agent Tool 层(第十轮 · 新增)
// ------------------------------------------------------------
// 等级 2 的能力出口。原则:**不把 chrome.* 直接交给 AI**,
// 而是由这里明确列出「本扩展愿意开放的能力」,逐个实现、逐个记录。
//
// 加载方式:
//   - 后台 service worker 通过 importScripts 加载(实际执行)
//   - 侧边栏页面通过 <script> 加载(只用于给模型描述工具清单)
// 因此所有实现**只能在函数体内部**访问 chrome.*,加载时不得调用。
// ============================================================

"use strict";

/* ==================================================================
   工具清单
   ----------------------------------------------------------------
   注意:新增浏览器能力 = 往这个数组里加一条,不要在别处散落 chrome.* 调用。
   ================================================================== */

var BROWSER_TOOLS = [

  /* ---------------- 标签页 ---------------- */
  {
    name: "tabs.list",
    desc: "列出标签页(id / 标题 / 地址 / 是否当前标签)",
    params: { allWindows: "boolean,可选,默认 false 只列当前窗口" },
    run: async function (a) {
      var q = (a && a.allWindows) ? {} : { currentWindow: true };
      var tabs = await chrome.tabs.query(q);
      return tabs.map(function (t) {
        return { id: t.id, title: t.title || "", url: t.url || "", active: !!t.active, windowId: t.windowId };
      });
    },
  },
  {
    name: "tabs.open",
    desc: "新建标签页打开指定地址",
    params: { url: "string,必填", active: "boolean,可选,默认 true" },
    run: async function (a) {
      if (!a || !a.url) throw new Error("缺少 url");
      var tab = await chrome.tabs.create({ url: String(a.url), active: a.active !== false });
      return { id: tab.id, url: tab.url || String(a.url) };
    },
  },
  {
    name: "tabs.close",
    desc: "关闭指定标签页",
    params: { tabId: "number,必填(可用 tabs.list 获取)", skipConfirm: "boolean,可选" },
    run: async function (a) {
      if (!a || typeof a.tabId !== "number") throw new Error("缺少 tabId");
      await chrome.tabs.remove(a.tabId);
      return { closed: a.tabId };
    },
  },
  {
    name: "tabs.activate",
    desc: "切换到指定标签页",
    params: { tabId: "number,必填" },
    run: async function (a) {
      if (!a || typeof a.tabId !== "number") throw new Error("缺少 tabId");
      var tab = await chrome.tabs.update(a.tabId, { active: true });
      try { if (tab && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) { /* 忽略 */ }
      return { active: a.tabId, url: (tab && tab.url) || "" };
    },
  },
  {
    name: "tabs.navigate",
    desc: "让某个标签页跳转到新地址(不填 tabId 则用当前活动标签页)",
    params: { url: "string,必填", tabId: "number,可选" },
    run: async function (a) {
      if (!a || !a.url) throw new Error("缺少 url");
      var id = (typeof a.tabId === "number") ? a.tabId : await activeTabId();
      if (id === null) throw new Error("找不到活动标签页");
      await chrome.tabs.update(id, { url: String(a.url) });
      return { tabId: id, url: String(a.url) };
    },
  },
  {
    name: "tabs.reload",
    desc: "刷新标签页",
    params: { tabId: "number,可选,默认当前活动标签页", bypassCache: "boolean,可选" },
    run: async function (a) {
      var id = (a && typeof a.tabId === "number") ? a.tabId : await activeTabId();
      if (id === null) throw new Error("找不到活动标签页");
      await chrome.tabs.reload(id, { bypassCache: !!(a && a.bypassCache) });
      return { reloaded: id };
    },
  },

  /* ---------------- 历史 ---------------- */
  {
    name: "history.search",
    desc: "搜索浏览器历史记录",
    params: { text: "string,必填", maxResults: "number,可选,默认 20" },
    run: async function (a) {
      if (!a || !a.text) throw new Error("缺少 text");
      var max = parseInt(a.maxResults, 10);
      if (!isFinite(max) || max <= 0) max = 20;
      if (max > 100) max = 100;

      var items = await chrome.history.search({ text: String(a.text), maxResults: max, startTime: 0 });
      return items.map(function (h) {
        return { title: h.title || "", url: h.url || "", lastVisitTime: h.lastVisitTime || 0, visitCount: h.visitCount || 0 };
      });
    },
  },

  /* ---------------- Cookie ---------------- */
  {
    name: "cookies.get",
    desc: "读取某个地址下的 cookie(不填 name 则返回该地址全部 cookie)",
    params: { url: "string,必填", name: "string,可选" },
    run: async function (a) {
      if (!a || !a.url) throw new Error("缺少 url");
      var detail = { url: String(a.url) };
      if (a.name) detail.name = String(a.name);

      if (a.name) {
        var one = await chrome.cookies.get(detail);
        return one ? [cookiesToPlain(one)] : [];
      }
      var all = await chrome.cookies.getAll({ url: String(a.url) });
      return (all || []).map(cookiesToPlain);
    },
  },
  {
    name: "cookies.set",
    desc: "写入 / 修改一个 cookie",
    params: { url: "string,必填", name: "string,必填", value: "string,必填", domain: "string,可选", path: "string,可选", secure: "boolean,可选", httpOnly: "boolean,可选" },
    run: async function (a) {
      if (!a || !a.url || !a.name) throw new Error("缺少 url 或 name");

      var detail = { url: String(a.url), name: String(a.name), value: String(a.value === undefined ? "" : a.value) };
      if (a.domain) detail.domain = String(a.domain);
      if (a.path)   detail.path = String(a.path);
      if (a.secure) detail.secure = true;
      if (a.httpOnly) detail.httpOnly = true;

      var saved = await chrome.cookies.set(detail);
      return saved ? cookiesToPlain(saved) : { saved: false };
    },
  },

  /* ---------------- 下载 ---------------- */
  {
    name: "downloads.start",
    desc: "开始一个下载(不可撤销)",
    params: { url: "string,必填", filename: "string,可选", saveAs: "boolean,可选" },
    run: async function (a) {
      if (!a || !a.url) throw new Error("缺少 url");
      var opts = { url: String(a.url) };
      if (a.filename) opts.filename = String(a.filename);
      if (a.saveAs) opts.saveAs = true;

      var id = await chrome.downloads.download(opts);
      return { downloadId: id, url: String(a.url) };
    },
  },

  /* ---------------- 扩展存储 ---------------- */
  {
    name: "storage.get",
    desc: "读取扩展自身的本地存储(扩展私有数据)",
    params: { keys: "string[] 或 string,可选,不填则返回全部" },
    run: async function (a) {
      var keys = a && a.keys ? a.keys : null;
      return await chrome.storage.local.get(keys);
    },
  },
  {
    name: "storage.set",
    desc: "写入扩展自身的本地存储",
    params: { items: "object,必填" },
    run: async function (a) {
      if (!a || !a.items || typeof a.items !== "object") throw new Error("缺少 items");
      await chrome.storage.local.set(a.items);
      return { saved: Object.keys(a.items) };
    },
  },
];

/* ==================================================================
   执行
   ================================================================== */

/** token → 可读对象 */
function cookiesToPlain(c) {
  return {
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    secure: !!c.secure, httpOnly: !!c.httpOnly, session: !!c.session,
    expirationDate: c.expirationDate || null,
  };
}

async function activeTabId() {
  var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return (tabs && tabs.length && typeof tabs[0].id === "number") ? tabs[0].id : null;
}

function findBrowserTool(name) {
  for (var i = 0; i < BROWSER_TOOLS.length; i++) {
    if (BROWSER_TOOLS[i].name === name) return BROWSER_TOOLS[i];
  }
  return null;
}

/**
 * 执行一个浏览器工具
 * @returns {{ok:boolean, tool:string, result:*, error:string}}
 */
async function runBrowserTool(name, args) {
  var tool = findBrowserTool(name);
  if (!tool) {
    return { ok: false, tool: String(name || ""), result: null, error: "未开放的工具:" + name };
  }

  try {
    var result = await tool.run(args || {});
    return { ok: true, tool: tool.name, result: result, error: "" };
  } catch (e) {
    return { ok: false, tool: tool.name, result: null, error: String((e && e.message) || e) };
  }
}

/** 给模型看的工具清单文本 */
function describeBrowserTools() {
  var lines = [];
  for (var i = 0; i < BROWSER_TOOLS.length; i++) {
    var t = BROWSER_TOOLS[i];
    lines.push("- " + t.name + " — " + t.desc + " 参数:" + JSON.stringify(t.params));
  }
  return lines.join("\n");
}

/** 工具名清单(用于校验) */
function browserToolNames() {
  return BROWSER_TOOLS.map(function (t) { return t.name; });
}

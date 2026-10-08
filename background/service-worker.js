// ============================================================
// AI Sidebar · 后台 Service Worker (Manifest V3 / 经典脚本)
//
// 职责:
//   1. 扩展安装 / 更新时执行初始设置
//   2. 点击扩展图标时打开或关闭侧边栏
//   3. 中转侧边栏 ↔ 内容脚本的消息(网页内容查询)
//
// 本文件不包含任何 AI 调用、网页修改或翻译逻辑。
// ============================================================

"use strict";

/* 权限等级 / 审计日志 / Browser Agent Tool 层(第十轮)
   ⚠️ importScripts 的路径以 worker 自身为基准解析(即 /background/),
   必须用「以 / 开头的扩展根路径」,否则会 404 并导致整个 SW 启动失败。
   同时整段包裹 try/catch:权限模块加载失败只降级权限能力,
   绝不能拖死消息中转等既有功能。 */
try {
  importScripts("/utils/permissions.js", "/utils/browser-tools.js", "/utils/targets.js");
} catch (e) {
  console.error("[AI Sidebar] 权限模块加载失败,权限相关功能已降级:", e);
}

/* ------------------------------------------------------------------
   消息类型常量 —— 与 sidebar/sidebar.js 及 content/content.js 保持一致
   ------------------------------------------------------------------ */
const MSG = {
  CLOSE_SIDEBAR:   "ai-sidebar:close",
  GET_ACTIVE_TAB:  "ai-sidebar:get-active-tab",
  GET_PAGE_INFO:   "ai-sidebar:get-page-info",
  GET_PAGE_TEXT:   "ai-sidebar:get-page-text",
  GET_SELECTED_TEXT:  "ai-sidebar:get-selected-text",
  SELECTION_CHANGED: "ai-sidebar:selection-changed",
  /* 网页资源(第八轮)*/
  GET_PAGE_RESOURCES:  "ai-sidebar:get-page-resources",
  /* AI 权限等级(第十轮):由后台自己处理,不转发给内容脚本 */
  PAGE_RUN_JS:   "ai-sidebar:page-run-js",
  BROWSER_TOOL:  "ai-sidebar:browser-tool",
  /* AI 网页修改(第九轮)*/
  PATCH_ANALYZE:  "ai-sidebar:patch-analyze",
  PATCH_APPLY:    "ai-sidebar:patch-apply",
  PATCH_UNDO:     "ai-sidebar:patch-undo",
  PATCH_RESTORE:  "ai-sidebar:patch-restore",
  PATCH_STATE:    "ai-sidebar:patch-state",
  /* 网页深度分析(第十一轮)+ 跨 frame 媒体执行(第十二轮)*/
  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",
  MEDIA_APPLY:    "ai-sidebar:media-apply",
  /* 锁定目标 / Tab(第四阶段)*/
  TARGET_LIST:       "ai-sidebar:target-list",
  TARGET_LOCK:       "ai-sidebar:target-lock",
  TARGET_UNLOCK:     "ai-sidebar:target-unlock",
  TARGET_SET_ACTIVE: "ai-sidebar:target-set-active",
  TARGET_CONFIRM:    "ai-sidebar:target-confirm",
  TARGET_REFRESH:    "ai-sidebar:target-refresh",
  TARGETS_CHANGED:   "ai-sidebar:targets-changed",
  /* 网页修改恢复(第四阶段)*/
  CAPTURE_SCREENSHOT: "ai-sidebar:capture-screenshot",
  PATCH_RECOVER:     "ai-sidebar:patch-recover",
  PATCH_RECOVERED:   "ai-sidebar:patch-recovered",
  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",
  PATCH_PLAN_STATE:  "ai-sidebar:patch-plan-state",
  PATCH_PLAN_CLEAR:  "ai-sidebar:patch-plan-clear",
  /* 网页翻译(第七轮)*/
  COLLECT_TEXTS:       "ai-sidebar:collect-texts",
  GET_TEXT_BATCH:      "ai-sidebar:get-text-batch",
  APPLY_TRANSLATIONS:  "ai-sidebar:apply-translations",
  RESTORE_TEXTS:       "ai-sidebar:restore-texts",
  TRANSLATION_STATE:   "ai-sidebar:translation-state",
};

/* 侧边栏页面路径(相对扩展根目录) */
const SIDE_PANEL_PATH = "sidebar/sidebar.html";

/* 让「点击图标打开侧边栏」成为浏览器原生行为。
   安装/更新时设置一次;SW 每次启动再设一次,避免设置丢失。 */
async function enableNativePanelOpen() {
  try {
    if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === "function") {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (e) {
    console.error("[AI Sidebar] 设置点击图标打开侧边栏失败:", e);
  }
}

enableNativePanelOpen();

/* ==================================================================
   1. 安装 / 更新时初始化
   ================================================================== */
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    "ai-sidebar:default-model": "placeholder",
  });

  // 开启「点击图标自动打开侧边栏」——这是浏览器原生行为,最可靠,
  // 不依赖手势时序(上面的 onClicked 只是兜底)
  await enableNativePanelOpen();

  console.log("[AI Sidebar] 扩展初始化完成");
});

/* ==================================================================
   2. 点击扩展图标 —— 打开 / 关闭侧边栏
   ================================================================== */
/* 点击扩展图标 → 打开侧边栏
   ⚠️ 关键:sidePanel.open() 必须在**用户手势所在的那次任务**里调用。
   原来的写法先 await getState() 再 open(),await 之后手势已失效,open() 不会生效。
   所以这里:不 await 任何东西、直接调用 open();
   也不做「再点一次关闭」的模拟 —— 浏览器没有官方关闭 API,
   强行模拟会因手势失效而失败(浏览器限制,不是代码问题)。 */
chrome.action.onClicked.addListener(function (tab) {
  try {
    var opts = null;
    if (tab && typeof tab.windowId === "number")   opts = { windowId: tab.windowId };
    else if (tab && typeof tab.id === "number")    opts = { tabId: tab.id };
    if (!opts) return;

    var opening = chrome.sidePanel.open(opts);
    if (opening && opening.catch) {
      opening.catch(function (e) { console.error("[AI Sidebar] 打开侧边栏失败:", e); });
    }
  } catch (e) {
    console.error("[AI Sidebar] 打开侧边栏异常:", e);
  }
});

/* ==================================================================
   3. 消息通信 —— 中转侧边栏发出的请求
   ================================================================== */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  switch (message.type) {

    // ---- 轻量查询:直接由后台返回 tab 信息(无需内容脚本) ----
    case MSG.GET_ACTIVE_TAB:
      getActiveTabInfo()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 锁定目标(第四阶段):全部由后台处理 ----
    case MSG.TARGET_LIST:
      targetListView()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.TARGET_LOCK:
      lockTargetTab()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.TARGET_UNLOCK:
      unlockTargetTab(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.TARGET_SET_ACTIVE:
      selectTargetTab(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.TARGET_CONFIRM:
      confirmTargetTab(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.TARGET_REFRESH:
      refreshTargets()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 网页修改恢复(第四阶段) ----
    case MSG.CAPTURE_SCREENSHOT:
      captureTargetScreenshot(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.PATCH_RECOVER:
      handlePatchRecover(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.PATCH_PLAN_SAVE:
      handlePatchPlanSave(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.PATCH_PLAN_STATE:
      handlePatchPlanState(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.PATCH_PLAN_CLEAR:
      handlePatchPlanClear(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 跨 frame 媒体执行与深度分析(第十二轮):后台注入所有 frame 并汇总 ----
    case MSG.MEDIA_APPLY:
      mediaApplyAcrossFrames(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.DEEP_ANALYZE:
      deepAnalyzeAcrossFrames(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 撤销 / 恢复:顶层走内容脚本,其它 frame 只回滚各自的媒体记录 ----
    case MSG.PATCH_UNDO:
    case MSG.PATCH_RESTORE:
      patchUndoRestore(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 权限等级 1:网页代码执行(后台注入页面主世界,内容脚本不参与) ----
    case MSG.PAGE_RUN_JS:
      runPageCode(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 权限等级 2:Browser Agent Tool ----
    case MSG.BROWSER_TOOL:
      runBrowserToolChecked(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 需要内容脚本的请求:转发到当前页面 ----
    case MSG.GET_PAGE_INFO:
    case MSG.GET_PAGE_TEXT:
    case MSG.GET_SELECTED_TEXT:
    // ---- 网页资源(第八轮)同样转发到当前页面 ----
    case MSG.GET_PAGE_RESOURCES:
    // ---- AI 网页修改(第九轮)同样转发到当前页面 ----
    case MSG.PATCH_ANALYZE:
    case MSG.PATCH_APPLY:
    case MSG.PATCH_STATE:
    // ---- 网页翻译(第七轮)同样转发到当前页面 ----
    case MSG.COLLECT_TEXTS:
    case MSG.GET_TEXT_BATCH:
    case MSG.APPLY_TRANSLATIONS:
    case MSG.RESTORE_TEXTS:
    case MSG.TRANSLATION_STATE:
      relayToContentScript(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 内容脚本主动上报:转发到侧边栏(不等待结果) ----
    case MSG.SELECTION_CHANGED:
      chrome.runtime.sendMessage(message).catch(function () {});
      sendResponse({ ok: true });
      return false;

    case MSG.PATCH_RECOVERED:
      sendResponse(handlePatchRecovered(message));
      return false;

    default:
      return false;
  }
});

/* ------------------------------------------------------------------
   读取当前活动标签页的标题与 URL(不经过内容脚本)
   ------------------------------------------------------------------ */
async function getActiveTabInfo() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) return { ok: false, error: "no-active-tab" };

  const tab = tabs[0];
  return {
    ok: true,
    tab: { id: tab.id, title: tab.title || "", url: tab.url || "" },
  };
}

/* ==================================================================
   3b. 锁定目标:解析「AI 当前要操作哪个网页」(第四阶段)
   ----------------------------------------------------------------
   在此之前所有网页能力都隐含「当前活动 Tab」,用户锁定网页 A 后切到 B
   就会操作错页面。现在统一走这里:
     · 消息带 targetTabId → 用那个 Tab(锁定目标)
     · 不带 → 退化成原来的行为(当前活动 Tab)
   另外把「已关闭 / 已导航」的目标挡在执行之前。
   ================================================================== */

async function activeTabId() {
  const tab = await activeTabRaw();
  return tab ? tab.id : null;
}

/**
 * 解析本次请求的目标 Tab,并做权限 / 状态检查
 * @returns {{ok:true, tab:object, explicit:boolean} | {ok:false, error:string, code:string}}
 */
async function guardTarget(msg) {
  const wanted = (msg && typeof msg.targetTabId === "number") ? msg.targetTabId : null;

  if (wanted === null) {
    const tab = await activeTabRaw();
    if (!tab) {
      return { ok: false, code: "no-active-tab", error: "没有找到可操作的网页(可能没有活动标签页)。" };
    }
    return { ok: true, tab: tab, explicit: false };
  }

  let tab = null;
  try { tab = await chrome.tabs.get(wanted); } catch (e) { tab = null; }
  if (!tab) {
    return { ok: false, code: "target-closed", error: "目标网页已关闭,请重新锁定一个网页后再操作。" };
  }

  // 锁定目标的真实状态(由 Tab 生命周期监听维护)
  if (typeof getTargetsData === "function") {
    let data = null;
    try { data = await getTargetsData(); } catch (e) { data = null; }

    if (data) {
      const t = findTarget(data, tab.id);
      if (t && t.state === "closed") {
        return { ok: false, code: "target-closed", error: "目标网页已关闭,请重新锁定一个网页后再操作。" };
      }
      if (t && t.state === "navigated" && !(msg && msg.allowNavigated === true)) {
        return {
          ok: false,
          code: "target-navigated",
          error: "目标网页已导航到新地址(当前:" + (tab.url || "") + "),需要重新确认后再操作,避免误改另一个网页。",
        };
      }
    }
  }

  // 跨 Tab 操作:目标不是当前正在看的那个网页 → 需要权限等级 1
  const activeId = await activeTabId();
  if (activeId !== null && activeId !== tab.id) {
    if (typeof hasPageLevel !== "function" || !(await hasPageLevel())) {
      return {
        ok: false,
        code: "permission-denied",
        error: "当前权限不足,请在设置中开启「权限等级 1:网页完全权限」后再对非当前显示的锁定网页执行操作。",
      };
    }
  }

  return { ok: true, tab: tab, explicit: true };
}

/* ------------------------------------------------------------------
   将消息转发到目标标签页的内容脚本,并返回其结果
   如果页面是浏览器内部页面(无法注入内容脚本),返回友好错误
   ------------------------------------------------------------------ */
async function relayToContentScript(message) {
  const guard = await guardTarget(message);
  if (!guard.ok) return guard;

  const tab = guard.tab;

  // 检查浏览器内部页面 —— 内容脚本无法在这些页面上运行
  if (isRestrictedPageUrl(tab.url)) {
    return {
      ok: false,
      error: "浏览器内部页面无法读取内容(不支持注入内容脚本)。请在普通网页上使用此功能。",
    };
  }

  try {
    // ⚠️ 内容脚本现在注入所有 frame(all_frames),不带 frameId 的话
    // 会由任意一个 iframe 抢先响应,导致「当前网页 / 翻译 / 修改」作用到 iframe 的小文档。
    // 这些「以当前页面为主体」的消息必须钉死在顶层 frame(0)。
    return await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch (err) {
    return {
      ok: false,
      code: "no-content-script",
      error: "无法连接目标网页。请确认页面已加载完毕,或刷新后重试。浏览器内部页面不支持此功能。",
    };
  }
}

/* ==================================================================
   3c. 锁定目标:Tab 生命周期(第四阶段)
   ----------------------------------------------------------------
   浏览器里的 Tab 会关闭、会刷新、会跳转。锁定的目标必须跟着变,
   否则就会出现「AI 以为在操作网页 A,其实那个 Tab 早就没了 / 变成 B 了」。
   ================================================================== */

function targetsModuleReady() {
  return (typeof getTargetsData === "function" &&
          typeof saveTargetsData === "function" &&
          typeof findTarget === "function" &&
          typeof applyTargetPatch === "function");
}

/** 把最新的目标列表推给侧边栏(侧边栏自己也会查,这里只是即时通知) */
async function notifyTargetsChanged(reason) {
  try {
    await chrome.runtime.sendMessage({
      type: MSG.TARGETS_CHANGED,
      reason: String(reason || ""),
      data: await getTargetsData(),
    });
  } catch (e) {
    // 侧边栏没开着:忽略
  }
}

/** Tab 被关闭 → 标记目标已关闭(保留在列表里,让用户看到真实情况) */
try {
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!targetsModuleReady()) return;
  try {
    const data = await getTargetsData();
    if (!findTarget(data, tabId)) return;
    await saveTargetsData(applyTargetPatch(data, tabId, { state: "closed" }));
    await notifyTargetsChanged("closed");
  } catch (e) {
    console.error("[AI Sidebar] 标记目标关闭失败:", e);
  }
});
} catch (e) {
  console.error("[AI Sidebar] 无法注册 Tab 关闭监听,目标状态跟踪已降级:", e);
}

/** URL / 标题变化 → 回写;地址变了就标记「已导航,需要重新确认」 */
try {
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!targetsModuleReady()) return;
  if (!changeInfo || (!changeInfo.url && !changeInfo.title && !changeInfo.favIconUrl)) return;

  try {
    const data = await getTargetsData();
    if (!findTarget(data, tabId)) return;

    const patch = {};
    if (changeInfo.url) patch.url = changeInfo.url;
    if (tab && tab.title) patch.title = tab.title;
    else if (changeInfo.title) patch.title = changeInfo.title;
    if (tab && tab.favIconUrl) patch.favicon = tab.favIconUrl;

    await saveTargetsData(applyTargetPatch(data, tabId, patch));
    await notifyTargetsChanged(changeInfo.url ? "navigated" : "updated");
  } catch (e) {
    console.error("[AI Sidebar] 更新目标失败:", e);
  }
});
} catch (e) {
  console.error("[AI Sidebar] 无法注册 Tab 更新监听,目标状态跟踪已降级:", e);
}

/** 锁定一个网页 */
async function lockTargetTab() {
  if (!targetsModuleReady()) {
    return { ok: false, error: "目标模块未加载,无法锁定网页(其它功能不受影响)" };
  }

  const tab = await activeTabRaw();
  if (!tab || typeof tab.id !== "number") return { ok: false, error: "没有找到可锁定的网页。" };
  if (isRestrictedPageUrl(tab.url)) return { ok: false, error: "浏览器内部页面无法锁定(内容脚本无法运行)。" };

  const data = await getTargetsData();
  const before = data.list.length;
  if (before >= TARGETS_MAX && !findTarget(data, tab.id)) {
    return { ok: false, error: "最多同时锁定 " + TARGETS_MAX + " 个网页,请先解除一个。" };
  }

  const next = await saveTargetsData(upsertTarget(data, tab, Date.now()));
  await appendAuditLog("base", "锁定目标", "Tab " + tab.id + " " + (tab.title || tab.url || ""));
  await notifyTargetsChanged("locked");
  return { ok: true, data: next, target: findTarget(next, tab.id) };
}

async function unlockTargetTab(msg) {
  if (!targetsModuleReady()) return { ok: false, error: "目标模块未加载" };
  const tabId = (msg && typeof msg.tabId === "number") ? msg.tabId : null;
  if (tabId === null) return { ok: false, error: "缺少要解除的 Tab" };

  const data = await getTargetsData();
  const t = findTarget(data, tabId);
  const next = await saveTargetsData(removeTarget(data, tabId));

  // 解除锁定时,顺带清掉这个目标的恢复计划,避免下次打开又被自动改
  try {
    const plans = await getPatchPlans();
    await savePatchPlans(dropPatchPlan(plans, tabId));
  } catch (e) { /* 忽略 */ }

  if (t) await appendAuditLog("base", "解除锁定", "Tab " + tabId + " " + (t.title || t.url || ""));
  await notifyTargetsChanged("unlocked");
  return { ok: true, data: next };
}

async function selectTargetTab(msg) {
  if (!targetsModuleReady()) return { ok: false, error: "目标模块未加载" };
  const data = await getTargetsData();
  const next = await saveTargetsData(setActiveTarget(data, msg && msg.tabId));
  await notifyTargetsChanged("active");
  return { ok: true, data: next };
}

/** 用户确认「这个目标跳到新地址了,我认」→ 回到正常锁定状态 */
async function confirmTargetTab(msg) {
  if (!targetsModuleReady()) return { ok: false, error: "目标模块未加载" };
  const tabId = (msg && typeof msg.tabId === "number") ? msg.tabId : null;
  if (tabId === null) return { ok: false, error: "缺少要确认的 Tab" };

  const data = await getTargetsData();
  const t = findTarget(data, tabId);
  if (!t) return { ok: false, error: "这个目标已经不在锁定列表里了" };

  let url = t.url;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) url = tab.url;
  } catch (e) { /* 用旧的 */ }

  const next = await saveTargetsData(applyTargetPatch(data, tabId, { url: url, lastSeenUrl: url, state: "locked" }));
  await notifyTargetsChanged("confirmed");
  return { ok: true, data: next };
}

/** 主动刷新目标信息(标题 / favicon / 状态) */
async function refreshTargets() {
  if (!targetsModuleReady()) return { ok: false, error: "目标模块未加载" };

  let data = await getTargetsData();
  for (let i = 0; i < data.list.length; i++) {
    const t = data.list[i];
    let tab = null;
    try { tab = await chrome.tabs.get(t.tabId); } catch (e) { tab = null; }

    if (!tab) {
      data = applyTargetPatch(data, t.tabId, { state: "closed" });
      continue;
    }
    data = applyTargetPatch(data, t.tabId, {
      title:   tab.title || t.title,
      favicon: tab.favIconUrl || t.favicon,
      url:     tab.url || t.url,
    });
  }

  const next = await saveTargetsData(data);
  return { ok: true, data: next };
}

/** 返回给侧边栏的完整目标视图(含活动 Tab,便于区分「浏览器在看哪个」) */
async function targetListView() {
  const data = targetsModuleReady() ? await getTargetsData() : { list: [], activeId: null };
  const active = await activeTabRaw();

  const list = [];
  for (let i = 0; i < data.list.length; i++) {
    const t = data.list[i];
    let live = false;
    try { live = !!(await chrome.tabs.get(t.tabId)); } catch (e) { live = false; }

    list.push({
      tabId:    t.tabId,
      windowId: t.windowId,
      title:    t.title,
      url:      t.url,
      favicon:  t.favicon,
      state:    live ? t.state : "closed",
      lockedAt: t.lockedAt,
      active:   t.tabId === data.activeId,
    });
  }

  return {
    ok: true,
    list: list,
    activeId: data.activeId,
    browserActiveTabId: active ? active.id : null,
    browserActiveTitle: active ? (active.title || "") : "",
    browserActiveUrl:   active ? (active.url || "") : "",
    max: TARGETS_MAX,
  };
}

/* ==================================================================
   3d. 网页修改的刷新恢复计划(第四阶段)
   ----------------------------------------------------------------
   只存「AI 的结构化修改动作」,不存 DOM / HTML。
   页面重新加载后由内容脚本主动来问,再重放并回报真实结果。
   ================================================================== */

function recoveryReady() {
  return (typeof getPatchPlans === "function" && typeof findPatchPlan === "function");
}

/** 内容脚本加载完成后来问:这个地址有没有需要恢复的修改 */
async function handlePatchRecover(msg) {
  if (!recoveryReady()) return { ok: false, error: "恢复模块未加载" };

  const url = String((msg && msg.url) || "");
  if (!url) return { ok: false, error: "缺少页面地址" };

  const plans = await getPatchPlans();
  const plan = findPatchPlan(plans, url);

  if (!plan || !plan.actions || !plan.actions.length) {
    return { ok: true, hasPlan: false };
  }

  return {
    ok:        true,
    hasPlan:   true,
    actions:   plan.actions,
    summary:   plan.summary || "",
    createdAt: plan.createdAt || 0,
    planTabId: plan.tabId,
  };
}

/** 记录 / 覆盖恢复计划(修改成功后由侧边栏调用) */
async function handlePatchPlanSave(msg) {
  if (!recoveryReady()) return { ok: false, error: "恢复模块未加载" };

  const plans = await getPatchPlans();
  const next  = await savePatchPlans(upsertPatchPlan(plans, {
    tabId:     (msg && typeof msg.tabId === "number") ? msg.tabId : null,
    url:       (msg && msg.url) || "",
    actions:   (msg && msg.actions) || [],
    summary:   (msg && msg.summary) || "",
    createdAt: Date.now(),
    applied:   (msg && msg.applied) || 0,
  }));

  return { ok: true, count: next.length };
}

async function handlePatchPlanClear(msg) {
  if (!recoveryReady()) return { ok: false, error: "恢复模块未加载" };

  const tabId = (msg && typeof msg.tabId === "number") ? msg.tabId : null;
  const plans = await getPatchPlans();
  const url   = (msg && msg.url) || "";

  let next;
  if (tabId === null) {
    next = url ? dropPatchPlan(plans, undefined, url) : [];
  } else {
    next = dropPatchPlan(plans, tabId, url || undefined);
  }

  await savePatchPlans(next);
  await appendAuditLog("base", "清除修改状态", "Tab " + tabId + " " + url);
  return { ok: true, count: next.length };
}

/** 查询某个目标当前的恢复计划(界面显示用) */
async function handlePatchPlanState(msg) {
  if (!recoveryReady()) return { ok: false, error: "恢复模块未加载" };

  const plans = await getPatchPlans();
  const tabId = (msg && typeof msg.tabId === "number") ? msg.tabId : null;

  const mine = plans.filter(function (pl) {
    return pl && (tabId === null || pl.tabId === tabId);
  });

  const totalActions = mine.reduce(function (sum, pl) {
    return sum + ((pl.actions && pl.actions.length) || 0);
  }, 0);

  return { ok: true, plans: mine, totalActions: totalActions };
}

/** 页面恢复完成后,内容脚本回报结果 → 转给侧边栏显示 */
function handlePatchRecovered(msg) {
  chrome.runtime.sendMessage({
    type:      MSG.PATCH_RECOVERED,
    url:       (msg && msg.url) || "",
    applied:   (msg && msg.applied) || 0,
    failed:    (msg && msg.failed) || 0,
    failures:  (msg && msg.failures) || [],
    recoverable: (msg && msg.recoverable) || 0,
  }).catch(function () {});
  return { ok: true };
}

/* ==================================================================
   3e. 网页截图(完整版)
   ----------------------------------------------------------------
   用 chrome.tabs.captureVisibleTab 抓「用户此刻看到的画面」。
   ⚠️ 浏览器限制(改代码解决不了):
      · 只能抓**当前窗口正在显示**的那个标签页 —— 后台标签抓不到
      · 页面被切走 / 窗口最小化时抓不到
      · 浏览器内部页面永远抓不到
   抓不到就如实说明,绝不返回一张假图。
   ================================================================== */

async function captureTargetScreenshot(msg) {
  const guard = await guardTarget(msg);
  if (!guard.ok) return guard;

  const tab = guard.tab;
  if (isRestrictedPageUrl(tab.url)) {
    return { ok: false, code: "restricted", error: "浏览器内部页面无法截图。" };
  }

  // 只能抓当前窗口正在显示的那个标签页
  const active = await activeTabRaw();
  if (!active || active.id !== tab.id) {
    return {
      ok: false,
      code: "not-visible",
      error: "只能截图浏览器当前正在显示的那个网页(切走或最小化时截不到)。请把目标网页切到前台再试。",
    };
  }

  let dataUrl = "";
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  } catch (e) {
    return {
      ok: false,
      code: "capture-failed",
      error: "截图失败:" + ((e && e.message) || e) + "(常见原因:窗口最小化、页面被切走、或浏览器限制)",
    };
  }

  if (!dataUrl || dataUrl.indexOf("data:image") !== 0) {
    return { ok: false, code: "capture-empty", error: "截图没有拿到画面内容。" };
  }

  // 过大的图会浪费大量 token,做个上限保护(约 3MB base64)
  if (dataUrl.length > 3 * 1024 * 1024) {
    return { ok: false, code: "too-large", error: "截图过大,已放弃本次视觉上下文(不影响文字上下文)。" };
  }

  await appendAuditLog("base", "网页截图", "Tab " + tab.id + " " + (tab.title || ""));

  return {
    ok:      true,
    dataUrl: dataUrl,
    tabId:   tab.id,
    title:   tab.title || "",
    url:     tab.url || "",
    bytes:   dataUrl.length,
  };
}

/* ==================================================================
   4. AI 权限:等级 1 网页代码执行 + 等级 2 浏览器工具(第十轮)
   ----------------------------------------------------------------
   权限由**后台独立校验**,不信任侧边栏传来的任何标志。
   等级 1 的代码注入到页面 MAIN world,因此能真正访问页面对象;
   但注入世界里没有 chrome.* / 扩展 API,能力天然止步于当前网页。
   ================================================================== */

const PAGE_RESULT_MAX = 8000;   // 回传给模型的结果最大长度

/**
 * 这个函数会被 chrome.scripting.executeScript 注入到页面 MAIN world 执行。
 * 必须**自包含**:不能引用 service worker 里的任何变量或函数。
 */
function aiPageRunCode(code, maxLen) {
  function serialize(value) {
    try {
      if (value === undefined) return "undefined";
      if (value === null) return "null";

      var t = typeof value;
      if (t === "string")  return value.length > maxLen ? value.slice(0, maxLen) + "…(已截断)" : value;
      if (t === "number" || t === "boolean") return String(value);
      if (t === "function") return "[function " + (value.name || "anonymous") + "]";
      if (t === "symbol" || t === "bigint") return String(value);

      if (value === window) return "[window]";
      if (value.nodeType === 9) return "[document]";
      if (value.nodeType === 1) {
        var tag = value.tagName ? value.tagName.toLowerCase() : "node";
        return "<" + tag + (value.id ? "#" + value.id : "") + ">";
      }

      var seen = [];
      var json = JSON.stringify(value, function (k, v) {
        if (typeof v === "function") return "[function]";
        if (v && v.nodeType === 1) {
          return "<" + (v.tagName ? v.tagName.toLowerCase() : "node") + (v.id ? "#" + v.id : "") + ">";
        }
        if (typeof v === "object" && v !== null) {
          if (seen.indexOf(v) !== -1) return "[循环引用]";
          seen.push(v);
        }
        return v;
      });

      if (json === undefined) return String(value);
      return json.length > maxLen ? json.slice(0, maxLen) + "…(已截断)" : json;
    } catch (e) {
      return "[无法序列化:" + (e && e.message ? e.message : e) + "]";
    }
  }

  var logs = [];
  var origLog = console.log;
  var origErr = console.error;

  return (async function () {
    try {
      console.log = function () {
        try {
          var parts = Array.prototype.map.call(arguments, function (a) {
            return typeof a === "string" ? a : serialize(a);
          });
          if (logs.length < 50) logs.push(parts.join(" "));
        } catch (e) { /* 忽略 */ }
      };
      console.error = console.log;

      // 用 fromCharCode 拼换行:避免代码文本里出现转义序列
      var nl = String.fromCharCode(10);
      var factory = new Function("return (async () => {" + nl + code + nl + "})();");
      var value = await factory();

      return { ok: true, value: serialize(value), logs: logs };
    } catch (e) {
      var msg = String((e && e.message) || e);
      if (msg.indexOf("Content Security Policy") !== -1 || msg.indexOf("unsafe-eval") !== -1) {
        msg += "(该网页的 CSP 禁止动态执行代码,可改用结构化动作完成)";
      }
      return { ok: false, error: msg, logs: logs };
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  })();
}

/** 浏览器内部页面无法注入 */
function isRestrictedPageUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}

async function activeTabRaw() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return (tabs && tabs.length) ? tabs[0] : null;
}

/**
 * 等级 1:在页面主世界执行网页代码
 * @param {{code:string, summary?:string}} msg
 */
async function runPageCode(msg) {
  if (typeof hasPageLevel !== "function") {
    return { ok: false, error: "权限模块未加载,网页代码执行不可用(其它功能不受影响)" };
  }

  if (!(await hasPageLevel())) {
    return { ok: false, error: "未开启「权限等级 1:网页完全权限」,已拒绝执行网页代码" };
  }

  const code = (msg && msg.code) || "";
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, error: "代码为空" };
  }

  const guard = await guardTarget(msg);
  if (!guard.ok) return guard;
  const tab = guard.tab;
  if (isRestrictedPageUrl(tab.url)) {
    return { ok: false, error: "浏览器内部页面无法执行网页代码,请在普通网页上使用" };
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: aiPageRunCode,
      args: [code, PAGE_RESULT_MAX],
    });
  } catch (e) {
    return { ok: false, error: "无法在页面主世界执行代码:" + ((e && e.message) || e) };
  }

  const first = results && results[0];
  const out   = first ? first.result : null;

  if (!out || typeof out !== "object") {
    return { ok: false, error: "页面未返回执行结果" };
  }

  if (!out.ok) {
    await appendAuditLog("page", "run_js", "失败:" + out.error + " | 代码:" + code.slice(0, 120));
    return { ok: false, error: out.error, logs: out.logs || [] };
  }

  // 真实返回值:undefined 也要明确写出来,不能只用"执行成功"糊过去
  var returned = (out.value === undefined) ? "undefined" : String(out.value);

  await appendAuditLog("page", "run_js",
    "代码:" + code.slice(0, 120) + " → 成功;返回值:" + returned.slice(0, 200));

  return {
    ok:          true,
    value:       returned,     // 对象 / 数组已在页面侧 JSON 序列化
    returnValue: returned,
    logs:        out.logs || [],
    code:        code.slice(0, 200),
  };
}

/**
 * 等级 2:调用 Browser Agent Tool(只开放 BROWSER_TOOLS 里列出的能力)
 * @param {{tool:string, args?:object}} msg
 */
async function runBrowserToolChecked(msg) {
  if (typeof hasBrowserLevel !== "function" || typeof runBrowserTool !== "function") {
    return { ok: false, error: "权限模块未加载,浏览器能力不可用(其它功能不受影响)" };
  }

  if (!(await hasBrowserLevel())) {
    return {
      ok: false,
      code: "permission-denied",
      error: "当前权限不足,请在设置中开启「权限等级 2:浏览器完全权限」后再使用浏览器能力(下载 / 标签页 / 历史 / Cookie 等)。",
    };
  }

  const name = (msg && msg.tool) || "";
  const args = (msg && msg.args) || {};
  const res  = await runBrowserTool(name, args);

  let detail;
  if (res.ok) {
    let summarized = "";
    try {
      summarized = JSON.stringify(res.result);
    } catch (e) {
      summarized = String(res.result);
    }
    if (summarized && summarized.length > 300) summarized = summarized.slice(0, 300) + "…";
    detail = "参数 " + JSON.stringify(args).slice(0, 160) + " → " + summarized;
  } else {
    detail = "失败:" + res.error;
  }

  await appendAuditLog("browser", res.tool || name, detail);

  return res;
}

/* ==================================================================
   5. 跨 frame 媒体执行 / 深度分析(第十二轮)
   ----------------------------------------------------------------
   为什么需要:很多站点真正的播放器在 iframe 里(如 B 站),
   只改顶层文档会命中占位元素,看起来"成功"但实际没生效。

   做法:chrome.scripting.executeScript({ allFrames: true }) 会在每个 frame 的
   **同一个孤立世界**里运行注入函数,因此可以直接按名字调用内容脚本的全局函数
   (wpFrameRunMedia / wpFrameDeepAnalyze / wpFrameUndoLast)。
   结果按 frame 汇总后返回给侧边栏。
   ================================================================== */

/* ---- 注入到每个 frame 的函数(必须自包含,只能引用目标世界的全局) ---- */

async function aiFrameRunMedia(job) {
  if (typeof wpFrameRunMedia !== "function") {
    return { ok: false, error: "内容脚本未就绪,请刷新页面后重试", frame: String(location.href) };
  }
  return await wpFrameRunMedia(job);
}

function aiFrameDeepAnalyze() {
  if (typeof wpFrameDeepAnalyze !== "function") {
    return { ok: false, error: "内容脚本未就绪", frame: String(location.href) };
  }
  return wpFrameDeepAnalyze();
}

function aiFrameUndoRestore(restoreAll) {
  if (window.top === window) return { ok: true, skipped: true };   // 顶层已由内容脚本处理
  if (typeof wpFrameUndoLast !== "function") return { ok: true, skipped: true };
  return restoreAll ? wpFrameRestoreAll() : wpFrameUndoLast();
}

/* ---- 目标解析:f3_media_1 → 只对该 frame 执行 ---- */

function parseFrameScopedTarget(target) {
  var t = String(target || "").trim();
  if (t.charAt(0) !== "f") return { frameId: null, local: t };

  var sep = t.indexOf("_media_");
  if (sep < 2) return { frameId: null, local: t };

  var idStr = t.slice(1, sep);
  var num = parseInt(idStr, 10);
  if (!isFinite(num) || String(num) !== idStr) return { frameId: null, local: t };

  return { frameId: num, local: "media_" + t.slice(sep + 7) };
}

/* ---- 汇总 ---- */

function buildMediaMessage(applied, failed, reasons, actuals) {
  if (!applied && !failed) {
    return "没有找到可操作的媒体元素(页面可能尚未开始播放,或需要刷新页面)";
  }

  var msg = "已操作 " + applied + " 个媒体元素";
  if (failed) msg += "," + failed + " 个未成功";

  if (actuals && actuals.length) {
    var uniq = [];
    actuals.forEach(function (v) { if (uniq.indexOf(v) === -1) uniq.push(v); });
    msg += ";实际生效值:" + uniq.join(" / ");
  }
  if (reasons && reasons.length) msg += "(" + reasons[0] + ")";

  return msg;
}

function aggregateMediaFrames(frames, job) {
  var applied = 0, failed = 0, skippedFrames = 0;
  var details = [], reasons = [], actuals = [], perFrame = [];
  var locks = [], lockConflicts = 0, lockReverts = [], lockGaveUp = [];

  (frames || []).forEach(function (f) {
    var r = f && f.result;

    if (!r || !r.ok) {
      if (r && r.skipped) { skippedFrames++; return; }
      if (r && r.error) reasons.push("frame" + f.frameId + ": " + r.error);
      return;
    }

    applied += r.applied || 0;
    failed  += r.failed || 0;

    (r.results || []).forEach(function (x) {
      if (x.ok) {
        if (x.detail) details.push("frame" + f.frameId + " " + x.detail);
        if (x.actualValue !== null && x.actualValue !== undefined) actuals.push(x.actualValue);
      } else if (x.reason) {
        reasons.push("frame" + f.frameId + " " + x.reason);
      }
    });

    // 倍速锁定状态(第十四轮):来自内容脚本的真实回执
    (r.locks || []).forEach(function (lk) {
      locks.push(lk);
      if (lk.gaveUp) lockGaveUp.push(lk);
      if (lk.conflicts > 0) {
        lockConflicts += lk.conflicts;
        lockReverts.push("frame" + f.frameId + " " + lk.id + " 目标 " + lk.target +
          " 倍,被改回去 " + lk.conflicts + " 次");
      }
    });

    perFrame.push({ frameId: f.frameId, url: r.frame, applied: r.applied || 0, failed: r.failed || 0 });
  });

  var conflictNote = "";
  if (lockGaveUp.length) {
    conflictNote = "检测到其他脚本 / 播放器正在持续修改倍速,已停止自动重设以免互相覆盖;当前实际倍速 " +
      lockGaveUp[0].actual + " 倍(目标 " + lockGaveUp[0].target + " 倍)。";
  } else if (lockConflicts > 0) {
    conflictNote = "检测到其他脚本 / 播放器修改过倍速(" + lockReverts.slice(0, 2).join(";") +
      "),已自动恢复到目标倍速。";
  }

  return {
    ok:            true,
    applied:       applied,
    failed:        failed,
    frames:        perFrame,
    frameCount:    (frames || []).length,
    skippedFrames: skippedFrames,
    details:       details.slice(0, 10),
    reasons:       reasons.slice(0, 6),
    actualValues:  actuals,
    locks:         locks,
    conflictNote:  conflictNote,
    message:       buildMediaMessage(applied, failed, reasons, actuals),
  };
}

/* ---- 媒体:在所有 frame 执行 ---- */

async function mediaApplyAcrossFrames(msg) {
  const guard = await guardTarget(msg);
  if (!guard.ok) return guard;
  const tab = guard.tab;
  if (isRestrictedPageUrl(tab.url)) return { ok: false, error: "浏览器内部页面无法操作媒体" };

  const op = String((msg && msg.op) || "");
  if (!op) return { ok: false, error: "缺少媒体操作" };

  const scoped = parseFrameScopedTarget(msg && msg.target);

  const job = {
    op:         op,
    value:      msg && msg.value,
    target:     scoped.local,
    keep:       !(msg && msg.keep === false),
    delayCheck: !(msg && msg.delayCheck === false),
    lock:       !!(msg && msg.lock === true),   // 第十四轮:持续锁定倍速(只锁主目标)
  };

  // 指定了 frame 就只打那个 frame,否则所有 frame
  const target = (scoped.frameId === null)
    ? { tabId: tab.id, allFrames: true }
    : { tabId: tab.id, frameIds: [scoped.frameId] };

  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: target, func: aiFrameRunMedia, args: [job] });
  } catch (e) {
    return { ok: false, error: "无法在页面中执行媒体操作:" + ((e && e.message) || e) };
  }

  const out = aggregateMediaFrames(frames, job);

  if (out.applied || out.failed) {
    await appendAuditLog("page", "media_" + op,
      "target=" + (scoped.local || "全部") + " value=" + job.value + " → " + out.message);
  }

  return out;
}

/* ---- 深度分析:汇总所有 frame ---- */

function buildCrossFrameReport(counts, media, iframes, shadows, frameCount, elapsed) {
  var lines = [];

  lines.push("【深度分析】" + (media.length ? "含 iframe 的完整扫描" : "扫描完成"));
  lines.push("【规模】扫描 " + frameCount + " 个 frame · DOM " + counts.dom + " 个元素 · video " +
    counts.video + " · audio " + counts.audio + " · iframe " + counts.iframe +
    " · Shadow DOM " + counts.shadow + " · 媒体合计 " + counts.media);

  if (media.length) {
    lines.push("");
    lines.push("【媒体元素】编号形如 f<frame>_media_N,可直接作为 media_* 动作的 target");
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      var kind = m.kind || {};
      lines.push("- " + m.id + (m.stableId ? "(" + m.stableId + ")" : "") + " (" + m.type + ") frame" + m.frameId + " · " +
        (m.visible ? "可见" : "不可见") + " · " + (m.paused ? "已暂停" : "播放中") +
        " · 倍速 " + m.playbackRate + " · 音量 " + m.volume + (m.muted ? "(静音)" : "") +
        " · 进度 " + m.currentTime + (m.duration === null ? "/未知" : "/" + m.duration) + " 秒" +
        " · 源 " + m.srcType);
      lines.push("  形态:" + (kind.label || "未知") +
        " · 可控制:" + (kind.controllable === false ? "否" : "是") +
        " · 可下载:" + (kind.downloadable ? "是" : "否") + (kind.note ? " · " + kind.note : ""));
      lines.push("  frame 地址: " + m.frameUrl);
    }
    lines.push("");
    lines.push("重要:源为 blob / hls 只表示地址不能直接下载,**不影响**播放、暂停、倍速、跳转、音量、静音、controls。");
    lines.push("若不指定 target,媒体动作会作用于**所有 frame 的所有媒体**。");
  } else {
    lines.push("");
    lines.push("【媒体元素】所有 frame 都未发现 video / audio。");
  }

  if (counts.button || counts.input || counts.link || counts.form || counts.image) {
    lines.push("");
    lines.push("【页面要素】button " + counts.button + " · input " + counts.input +
      " · textarea " + counts.textarea + " · select " + counts.select +
      " · link " + counts.link + " · image " + counts.image + " · form " + counts.form);
    lines.push("交互元素有稳定的内部 ID(button_1 / input_1 / link_1 …),修改网页时可直接引用,不必猜 CSS 选择器。");
  }

  if (iframes.length) {
    lines.push("");
    lines.push("【iframe】" + iframes.length + " 个");
    for (var f = 0; f < iframes.length && f < 12; f++) {
      lines.push("- frame" + iframes[f].frameId + " " + iframes[f].src + " · " +
        (iframes[f].visible ? "可见" : "不可见") + " · " + iframes[f].note);
    }
  }

  if (shadows.length) {
    lines.push("");
    lines.push("【Shadow DOM】" + counts.shadow + " 个 open shadow root");
    for (var s = 0; s < shadows.length && s < 8; s++) {
      lines.push("- frame" + shadows[s].frameId + " " + shadows[s].host + " · 内含媒体 " + shadows[s].mediaCount);
    }
  }

  lines.push("");
  lines.push("(分析用时 " + elapsed + "ms)");

  return lines.join("\n");
}

async function deepAnalyzeAcrossFrames(msg) {
  const guard = await guardTarget(msg);
  if (!guard.ok) return guard;
  const tab = guard.tab;
  if (isRestrictedPageUrl(tab.url)) {
    return { ok: false, error: "浏览器内部页面无法深度分析,请在普通网页上使用" };
  }

  var t0 = Date.now();
  let frames;
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: aiFrameDeepAnalyze,
    });
  } catch (e) {
    return { ok: false, error: "无法在页面中执行深度分析:" + ((e && e.message) || e) };
  }

  var counts = {
    dom: 0, visible: 0, video: 0, audio: 0, iframe: 0, shadow: 0, media: 0, playing: 0,
    button: 0, input: 0, textarea: 0, select: 0, link: 0, image: 0, form: 0,
    mse: 0, drm: 0,
  };
  var media = [], iframes = [], shadows = [];
  var interactive = { buttons: [], inputs: [], textareas: [], selects: [], links: [], images: [] };
  var forms = [];
  var page = null;
  var scanned = 0;

  (frames || []).forEach(function (f) {
    var r = f && f.result;
    if (!r || !r.ok) return;
    scanned++;

    Object.keys(counts).forEach(function (key) {
      counts[key] += (r.counts && r.counts[key]) || 0;
    });

    // 只有顶层 frame 的页面信息才代表「这个网页」
    if (!page && r.page && f.frameId === 0) page = r.page;

    // 交互元素:各 frame 分别编号后汇总(f<frame>_button_1 这种形式)
    if (r.interactive) {
      Object.keys(interactive).forEach(function (key) {
        var arr = r.interactive[key] || [];
        for (var ii = 0; ii < arr.length && interactive[key].length < 40; ii++) {
          var it = arr[ii];
          it.frameId = f.frameId;
          it.stableId = (f.frameId === 0 ? "" : "f" + f.frameId + "_") + it.id;
          interactive[key].push(it);
        }
      });
    }
    (r.forms || []).forEach(function (fm) {
      if (forms.length >= 20) return;
      fm.frameId = f.frameId;
      fm.stableId = (f.frameId === 0 ? "" : "f" + f.frameId + "_") + fm.id;
      forms.push(fm);
    });

    (r.media || []).forEach(function (m) {
      m.frameId   = f.frameId;
      m.frameUrl  = r.url || "";
      m.id        = "f" + f.frameId + "_" + m.id;   // 加 frame 前缀,避免各 frame 编号冲突
      media.push(m);
    });
    (r.iframes || []).forEach(function (x) { x.frameId = f.frameId; iframes.push(x); });
    (r.shadows || []).forEach(function (x) { x.frameId = f.frameId; shadows.push(x); });
  });

  var report = buildCrossFrameReport(counts, media, iframes, shadows, scanned, Date.now() - t0);

  return {
    ok:      true,
    title:   tab.title || "",
    url:     tab.url || "",
    frameCount: scanned,
    counts:  counts,
    page:    page,
    media:   media,
    iframes: iframes,
    shadows: shadows,
    interactive: interactive,
    forms:   forms,
    report:  report,
    length:  report.length,
  };
}

/* ---- 撤销 / 恢复:顶层 + 其它 frame 的媒体记录 ---- */

async function patchUndoRestore(message) {
  const restore = message.type === MSG.PATCH_RESTORE;

  var top = null;
  try { top = await relayToContentScript(message); } catch (e) { top = null; }

  var otherFramesUndone = 0;
  const guard = await guardTarget(message);
  const tab = guard.ok ? guard.tab : null;

  if (tab && typeof tab.id === "number" && !isRestrictedPageUrl(tab.url)) {
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: aiFrameUndoRestore,
        args: [!!restore],
      });

      (frames || []).forEach(function (f) {
        var r = f && f.result;
        if (r && r.ok && !r.skipped) otherFramesUndone += r.undone || 0;
      });
    } catch (e) { /* 其它 frame 回滚失败不影响主流程 */ }
  }

  const base = (top && top.ok) ? top : { ok: true, steps: 0, undone: 0, canUndo: false, message: "" };

  var msg = base.message || (restore ? "已恢复网页" : "已撤销最近一次修改");
  if (otherFramesUndone) msg += ";(iframe 内另回滚 " + otherFramesUndone + " 步媒体修改)";

  return {
    ok:           true,
    undone:       base.undone || 0,
    steps:        base.steps || 0,
    canUndo:      base.canUndo === true,
    irreversible: base.irreversible || 0,
    otherFrames:  otherFramesUndone,
    message:      msg,
  };
}

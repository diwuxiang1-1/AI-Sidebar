# -*- coding: utf-8 -*-
"""第四阶段 · 1:后台目标解析 + Tab 生命周期 + 目标/恢复消息"""

import io

p = "background/service-worker.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# ---- 1. 加载 targets.js ----
rep("import",
    'try {\n  importScripts("/utils/permissions.js", "/utils/browser-tools.js");\n} catch (e) {\n'
    '  console.error("[AI Sidebar] 权限模块加载失败,权限相关功能已降级:", e);\n}',
    'try {\n  importScripts("/utils/permissions.js", "/utils/browser-tools.js", "/utils/targets.js");\n} catch (e) {\n'
    '  console.error("[AI Sidebar] 权限模块加载失败,权限相关功能已降级:", e);\n}')

# ---- 2. 新增消息类型 ----
rep("msg",
    '  /* 网页翻译(第七轮)*/\n  COLLECT_TEXTS:       "ai-sidebar:collect-texts",',
    '  /* 锁定目标 / Tab(第四阶段)*/\n'
    '  TARGET_LIST:       "ai-sidebar:target-list",\n'
    '  TARGET_LOCK:       "ai-sidebar:target-lock",\n'
    '  TARGET_UNLOCK:     "ai-sidebar:target-unlock",\n'
    '  TARGET_SET_ACTIVE: "ai-sidebar:target-set-active",\n'
    '  TARGET_CONFIRM:    "ai-sidebar:target-confirm",\n'
    '  TARGET_REFRESH:    "ai-sidebar:target-refresh",\n'
    '  TARGETS_CHANGED:   "ai-sidebar:targets-changed",\n'
    '  /* 网页修改恢复(第四阶段)*/\n'
    '  PATCH_RECOVER:     "ai-sidebar:patch-recover",\n'
    '  PATCH_RECOVERED:   "ai-sidebar:patch-recovered",\n'
    '  PATCH_PLAN_STATE:  "ai-sidebar:patch-plan-state",\n'
    '  PATCH_PLAN_CLEAR:  "ai-sidebar:patch-plan-clear",\n'
    '  /* 网页翻译(第七轮)*/\n  COLLECT_TEXTS:       "ai-sidebar:collect-texts",')

# ---- 3. 目标解析层 ----
rep("resolve",
    '/* ------------------------------------------------------------------\n'
    '   将消息转发到当前活动标签页的内容脚本,并返回其结果\n'
    '   如果页面是浏览器内部页面(无法注入内容脚本),返回友好错误\n'
    '   ------------------------------------------------------------------ */\n'
    'async function relayToContentScript(message) {\n'
    '  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });\n'
    '  if (!tabs || tabs.length === 0) return { ok: false, error: "no-active-tab" };\n'
    '\n'
    '  const tab = tabs[0];\n'
    '\n'
    '  // 检查浏览器内部页面 —— 内容脚本无法在这些页面上运行\n'
    '  if (tab.url) {\n'
    '    const u = tab.url;\n'
    '    if (\n'
    '      u.startsWith("chrome://")   ||\n'
    '      u.startsWith("edge://")     ||\n'
    '      u.startsWith("chrome-extension://") ||\n'
    '      u.startsWith("about:")      ||\n'
    '      u.startsWith("moz-extension://")\n'
    '    ) {\n'
    '      return {\n'
    '        ok: false,\n'
    '        error: "浏览器内部页面无法读取内容(不支持注入内容脚本)。请在普通网页上使用此功能。",\n'
    '      };\n'
    '    }\n'
    '  }\n'
    '\n'
    '  try {\n',
    '/* ==================================================================\n'
    '   3b. 锁定目标:解析「AI 当前要操作哪个网页」(第四阶段)\n'
    '   ----------------------------------------------------------------\n'
    '   在此之前所有网页能力都隐含「当前活动 Tab」,用户锁定网页 A 后切到 B\n'
    '   就会操作错页面。现在统一走这里:\n'
    '     · 消息带 targetTabId → 用那个 Tab(锁定目标)\n'
    '     · 不带 → 退化成原来的行为(当前活动 Tab)\n'
    '   另外把「已关闭 / 已导航」的目标挡在执行之前。\n'
    '   ================================================================== */\n'
    '\n'
    'async function activeTabId() {\n'
    '  const tab = await activeTabRaw();\n'
    '  return tab ? tab.id : null;\n'
    '}\n'
    '\n'
    '/**\n'
    ' * 解析本次请求的目标 Tab,并做权限 / 状态检查\n'
    ' * @returns {{ok:true, tab:object, explicit:boolean} | {ok:false, error:string, code:string}}\n'
    ' */\n'
    'async function guardTarget(msg) {\n'
    '  const wanted = (msg && typeof msg.targetTabId === "number") ? msg.targetTabId : null;\n'
    '\n'
    '  if (wanted === null) {\n'
    '    const tab = await activeTabRaw();\n'
    '    if (!tab) {\n'
    '      return { ok: false, code: "no-active-tab", error: "没有找到可操作的网页(可能没有活动标签页)。" };\n'
    '    }\n'
    '    return { ok: true, tab: tab, explicit: false };\n'
    '  }\n'
    '\n'
    '  let tab = null;\n'
    '  try { tab = await chrome.tabs.get(wanted); } catch (e) { tab = null; }\n'
    '  if (!tab) {\n'
    '    return { ok: false, code: "target-closed", error: "目标网页已关闭,请重新锁定一个网页后再操作。" };\n'
    '  }\n'
    '\n'
    '  // 锁定目标的真实状态(由 Tab 生命周期监听维护)\n'
    '  if (typeof getTargetsData === "function") {\n'
    '    let data = null;\n'
    '    try { data = await getTargetsData(); } catch (e) { data = null; }\n'
    '\n'
    '    if (data) {\n'
    '      const t = findTarget(data, tab.id);\n'
    '      if (t && t.state === "closed") {\n'
    '        return { ok: false, code: "target-closed", error: "目标网页已关闭,请重新锁定一个网页后再操作。" };\n'
    '      }\n'
    '      if (t && t.state === "navigated" && !(msg && msg.allowNavigated === true)) {\n'
    '        return {\n'
    '          ok: false,\n'
    '          code: "target-navigated",\n'
    '          error: "目标网页已导航到新地址(当前:" + (tab.url || "") + "),需要重新确认后再操作,避免误改另一个网页。",\n'
    '        };\n'
    '      }\n'
    '    }\n'
    '  }\n'
    '\n'
    '  // 跨 Tab 操作:目标不是当前正在看的那个网页 → 需要权限等级 1\n'
    '  const activeId = await activeTabId();\n'
    '  if (activeId !== null && activeId !== tab.id) {\n'
    '    if (typeof hasPageLevel !== "function" || !(await hasPageLevel())) {\n'
    '      return {\n'
    '        ok: false,\n'
    '        code: "permission-denied",\n'
    '        error: "当前权限不足,请在设置中开启「权限等级 1:网页完全权限」后再对非当前显示的锁定网页执行操作。",\n'
    '      };\n'
    '    }\n'
    '  }\n'
    '\n'
    '  return { ok: true, tab: tab, explicit: true };\n'
    '}\n'
    '\n'
    '/* ------------------------------------------------------------------\n'
    '   将消息转发到目标标签页的内容脚本,并返回其结果\n'
    '   如果页面是浏览器内部页面(无法注入内容脚本),返回友好错误\n'
    '   ------------------------------------------------------------------ */\n'
    'async function relayToContentScript(message) {\n'
    '  const guard = await guardTarget(message);\n'
    '  if (!guard.ok) return guard;\n'
    '\n'
    '  const tab = guard.tab;\n'
    '\n'
    '  // 检查浏览器内部页面 —— 内容脚本无法在这些页面上运行\n'
    '  if (isRestrictedPageUrl(tab.url)) {\n'
    '    return {\n'
    '      ok: false,\n'
    '      error: "浏览器内部页面无法读取内容(不支持注入内容脚本)。请在普通网页上使用此功能。",\n'
    '    };\n'
    '  }\n'
    '\n'
    '  try {\n')

rep("relay-tail",
    '    return await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });\n'
    '  } catch (err) {\n'
    '    return {\n'
    '      ok: false,\n'
    '      error: "无法连接当前网页。请确认页面已加载完毕,或刷新后重试。浏览器内部页面不支持此功能。",\n'
    '    };\n'
    '  }\n'
    '}',
    '    return await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });\n'
    '  } catch (err) {\n'
    '    return {\n'
    '      ok: false,\n'
    '      code: "no-content-script",\n'
    '      error: "无法连接目标网页。请确认页面已加载完毕,或刷新后重试。浏览器内部页面不支持此功能。",\n'
    '    };\n'
    '  }\n'
    '}')

# ---- 4. 各执行入口改用目标解析 ----
rep("media",
    'async function mediaApplyAcrossFrames(msg) {\n'
    '  const tab = await activeTabRaw();\n'
    '  if (!tab || typeof tab.id !== "number") return { ok: false, error: "找不到可操作的活动标签页" };\n'
    '  if (isRestrictedPageUrl(tab.url)) return { ok: false, error: "浏览器内部页面无法操作媒体" };',
    'async function mediaApplyAcrossFrames(msg) {\n'
    '  const guard = await guardTarget(msg);\n'
    '  if (!guard.ok) return guard;\n'
    '  const tab = guard.tab;\n'
    '  if (isRestrictedPageUrl(tab.url)) return { ok: false, error: "浏览器内部页面无法操作媒体" };')

# ---- 5. 目标生命周期 + 目标消息 ----
TARGET_BLOCK = r'''
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

/** URL / 标题变化 → 回写;地址变了就标记「已导航,需要重新确认」 */
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

'''

rep("targetblock",
    '/* ==================================================================\n'
    '   4. AI 权限:等级 1 网页代码执行 + 等级 2 浏览器工具(第十轮)',
    TARGET_BLOCK.lstrip("\n") + '/* ==================================================================\n'
    '   4. AI 权限:等级 1 网页代码执行 + 等级 2 浏览器工具(第十轮)')

# ---- 6. 消息路由 ----
rep("route",
    '    // ---- 轻量查询:直接由后台返回 tab 信息(无需内容脚本) ----\n'
    '    case MSG.GET_ACTIVE_TAB:\n'
    '      getActiveTabInfo()\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;',
    '    // ---- 轻量查询:直接由后台返回 tab 信息(无需内容脚本) ----\n'
    '    case MSG.GET_ACTIVE_TAB:\n'
    '      getActiveTabInfo()\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    // ---- 锁定目标(第四阶段):全部由后台处理 ----\n'
    '    case MSG.TARGET_LIST:\n'
    '      targetListView()\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.TARGET_LOCK:\n'
    '      lockTargetTab()\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.TARGET_UNLOCK:\n'
    '      unlockTargetTab(message)\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.TARGET_SET_ACTIVE:\n'
    '      selectTargetTab(message)\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.TARGET_CONFIRM:\n'
    '      confirmTargetTab(message)\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.TARGET_REFRESH:\n'
    '      refreshTargets()\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    // ---- 网页修改恢复(第四阶段) ----\n'
    '    case MSG.PATCH_RECOVER:\n'
    '      handlePatchRecover(message)\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.PATCH_PLAN_STATE:\n'
    '      handlePatchPlanState(message)\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;\n'
    '\n'
    '    case MSG.PATCH_PLAN_CLEAR:\n'
    '      handlePatchPlanClear(message)\n'
    '        .then(sendResponse)\n'
    '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
    '      return true;')

# ---- 7. 内容脚本上报恢复结果 ----
rep("recovered-route",
    '    // ---- 内容脚本主动上报:转发到侧边栏(不等待结果) ----\n'
    '    case MSG.SELECTION_CHANGED:\n'
    '      chrome.runtime.sendMessage(message).catch(function () {});\n'
    '      sendResponse({ ok: true });\n'
    '      return false;',
    '    // ---- 内容脚本主动上报:转发到侧边栏(不等待结果) ----\n'
    '    case MSG.SELECTION_CHANGED:\n'
    '      chrome.runtime.sendMessage(message).catch(function () {});\n'
    '      sendResponse({ ok: true });\n'
    '      return false;\n'
    '\n'
    '    case MSG.PATCH_RECOVERED:\n'
    '      sendResponse(handlePatchRecovered(message));\n'
    '      return false;')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sw", k, "=", v)

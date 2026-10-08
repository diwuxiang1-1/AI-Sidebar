# -*- coding: utf-8 -*-
"""第四阶段 · 5:侧边栏 JS —— 目标面板渲染 / 切换 / 状态隔离 / 刷新恢复 / 歧义询问"""

import io

p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new, count=1):
    global s
    c = s.count(old)
    n[tag] = c
    if c != count:
        raise SystemExit("!! %s 匹配 %d 次(期望 %d)" % (tag, c, count))
    s = s.replace(old, new)

# ============================================================
# A. 目标面板渲染 + 切换 + 状态隔离 + 恢复(插在 doSend 之前)
# ============================================================
BLOCK = r'''
/* ==================================================================
   0b. 目标面板:显示 / 锁定 / 切换 / 解除 / 确认(第四阶段)
   ================================================================== */

/** 顶部「AI 当前操作目标」栏 */
function renderTargetBar() {
  if (!targetCurrentEl) return;

  var t = currentTarget();
  var name = currentTargetName();
  var cls = "target-name";

  if (t) {
    if (t.state === TARGET_STATE.CLOSED)         cls += " is-closed";
    else if (t.state === TARGET_STATE.NAVIGATED) cls += " is-warn";
    else                                         cls += " is-locked";
  }

  targetCurrentEl.className   = cls;
  targetCurrentEl.textContent = name;
  targetCurrentEl.title       = t ? (t.url || "") : "未锁定:操作当前活动网页";

  if (targetCountEl) targetCountEl.textContent = String((targetsData.list || []).length);

  // 没锁定任何网页时,主按钮是「锁定此网页」;锁定后变成「已锁定 N」
  if (btnTargetLock) {
    var none = !t;
    btnTargetLock.style.display = none ? "" : "none";
  }

  renderTargetPanel();
}

function targetStateBadge(t) {
  if (!t) return { text: "未知", cls: "" };
  if (t.state === TARGET_STATE.CLOSED)    return { text: "目标网页已关闭", cls: "closed" };
  if (t.state === TARGET_STATE.NAVIGATED) return { text: "已导航到新地址", cls: "warn" };
  return { text: "已锁定", cls: "" };
}

/** 锁定目标面板(卡片列表) */
function renderTargetPanel() {
  if (!targetListEl) return;

  var list = targetsData.list || [];
  targetListEl.innerHTML = "";

  if (!list.length) {
    var empty = document.createElement("div");
    empty.className = "target-card-meta";
    empty.textContent = "还没有锁定任何网页。点「锁定此网页」把当前页面固定为操作目标。";
    targetListEl.appendChild(empty);
  }

  for (var i = 0; i < list.length; i++) {
    targetListEl.appendChild(makeTargetCard(list[i]));
  }

  if (targetStatusEl) {
    var n = liveTargets().length;
    var isActive = (browserActiveTabId !== null && currentTargetTabId() === browserActiveTabId);
    targetStatusEl.textContent =
      "共 " + list.length + " 个目标(可用 " + n + " 个)" +
      (list.length && !isActive ? " · AI 操作的不是浏览器当前显示的网页" : "");
  }
}

function makeTargetCard(t) {
  var card = document.createElement("div");
  card.className = "target-card state-" + (t.state || "locked") +
    (t.tabId === targetsData.activeId ? " active" : "");

  var head = document.createElement("div");
  head.className = "target-card-head";

  var title = document.createElement("span");
  title.className = "target-card-title";
  title.textContent = targetLabel(t);
  title.title = t.title || t.url || "";
  head.appendChild(title);

  if (t.tabId === targetsData.activeId) {
    var mine = document.createElement("span");
    mine.className = "target-badge mine";
    mine.textContent = "AI 正在操作";
    head.appendChild(mine);
  }
  if (browserActiveTabId !== null && t.tabId === browserActiveTabId) {
    var see = document.createElement("span");
    see.className = "target-badge";
    see.textContent = "浏览器正在显示";
    head.appendChild(see);
  }

  var badge = targetStateBadge(t);
  var st = document.createElement("span");
  st.className = "target-badge " + badge.cls;
  st.textContent = badge.text;
  head.appendChild(st);

  card.appendChild(head);

  var meta = document.createElement("div");
  meta.className = "target-card-meta";
  meta.textContent = "Tab " + t.tabId + (targetHost(t) ? " · " + targetHost(t) : "");
  card.appendChild(meta);

  var actions = document.createElement("div");
  actions.className = "target-card-actions";

  if (t.state === TARGET_STATE.CLOSED) {
    // 已关闭的目标:只能解除,不能操作
    actions.appendChild(makeCardBtn("解除", function () { unlockTarget(t.tabId); }, false));
  } else if (t.state === TARGET_STATE.NAVIGATED) {
    actions.appendChild(makeCardBtn("重新确认此目标", function () { confirmTarget(t.tabId); }, true));
    actions.appendChild(makeCardBtn("解除", function () { unlockTarget(t.tabId); }, false));
  } else {
    if (t.tabId !== targetsData.activeId) {
      actions.appendChild(makeCardBtn("设为操作目标", function () { switchTarget(t.tabId); }, true));
    }
    actions.appendChild(makeCardBtn("操作", function () { onOperateTarget(t.tabId); }, false));
    actions.appendChild(makeCardBtn("解除", function () { unlockTarget(t.tabId); }, false));
  }

  card.appendChild(actions);
  return card;
}

function makeCardBtn(text, handler, primary) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "btn" + (primary ? " btn-primary" : "");
  b.textContent = text;
  b.addEventListener("click", handler);
  return b;
}

/* ---------------- 目标状态隔离 ---------------- */

/** 当前目标的本地状态键(没锁定目标时用 __active__) */
function targetStateKey() {
  var tid = currentTargetTabId();
  return (tid === null) ? "__active__" : String(tid);
}

/** 切走之前,把当前目标的状态存档 */
function snapshotTargetState() {
  targetStates[targetStateKey()] = {
    patchSteps: patchSteps,
    deepReport: deepReport,
    deepHTML:   patchDeepEl ? patchDeepEl.innerHTML : "",
  };
}

/** 切过来之后,恢复这个目标自己的状态 */
function restoreTargetState() {
  var st = targetStates[targetStateKey()] || null;
  patchSteps = st ? (st.patchSteps || 0) : 0;
  deepReport = st ? (st.deepReport || "") : "";
  if (patchDeepEl) patchDeepEl.innerHTML = st ? (st.deepHTML || "") : "";
  updatePatchButtons();
}

/** 切换/锁定/解除之后统一走这里 */
async function afterTargetChanged() {
  restoreTargetState();
  renderTargetBar();
  await refreshPatchState();     // 向目标网页的真实撤销栈对账,不用本地缓存骗人
  await refreshRecoveryState();
}

/* ---------------- 操作 ---------------- */

async function lockCurrentPage() {
  var res = null;
  try { res = await sendMsg({ type: MSG.TARGET_LOCK }); } catch (e) { res = null; }

  if (!res || !res.ok) {
    setTargetStatus((res && res.error) || "锁定失败", "error");
    return false;
  }

  applyTargetsData(res.data);
  await afterTargetChanged();
  setTargetStatus("已锁定:" + currentTargetName(), "ok");
  return true;
}

async function unlockTarget(tabId) {
  var res = null;
  try { res = await sendMsg({ type: MSG.TARGET_UNLOCK, tabId: tabId }); } catch (e) { res = null; }

  if (!res || !res.ok) { setTargetStatus((res && res.error) || "解除失败", "error"); return; }

  delete targetStates[String(tabId)];
  applyTargetsData(res.data);
  await afterTargetChanged();
  setTargetStatus("已解除锁定", "ok");
}

async function switchTarget(tabId, opts) {
  if (tabId === targetsData.activeId) return;

  snapshotTargetState();

  var res = null;
  try { res = await sendMsg({ type: MSG.TARGET_SET_ACTIVE, tabId: tabId }); } catch (e) { res = null; }
  if (!res || !res.ok) { setTargetStatus((res && res.error) || "切换失败", "error"); return; }

  applyTargetsData(res.data);
  await afterTargetChanged();

  if (!(opts && opts.silent)) {
    appendMessage("system", "AI 当前操作目标已切换为:" + currentTargetName());
  }
}

/** 卡片上的「操作」:设为当前目标并打开修改面板 */
async function onOperateTarget(tabId) {
  await switchTarget(tabId, { silent: true });
  appendMessage("system", "AI 当前操作目标:" + currentTargetName());
  if (patchPanel && patchPanel.style.display === "none") onTogglePatchPanel();
  await refreshPatchState();
}

async function confirmTarget(tabId) {
  var res = null;
  try { res = await sendMsg({ type: MSG.TARGET_CONFIRM, tabId: tabId }); } catch (e) { res = null; }
  if (!res || !res.ok) { setTargetStatus((res && res.error) || "确认失败", "error"); return; }

  applyTargetsData(res.data);
  await afterTargetChanged();
  setTargetStatus("已确认新地址,现在可以继续操作这个网页了", "ok");
}

function setTargetStatus(text, type) {
  if (!targetStatusEl) return;
  targetStatusEl.textContent = text || "";
  targetStatusEl.className = "target-status" + (type ? " " + type : "");
}

/* ---------------- 刷新后的修改恢复 ---------------- */

/** 查询当前目标的「网页修改状态」 */
async function refreshRecoveryState() {
  if (!targetRecoverEl) return;

  var res = null;
  try { res = await sendMsg({ type: MSG.PATCH_PLAN_STATE, tabId: currentTargetTabId() }); } catch (e) { res = null; }

  if (!res || !res.ok || !res.plans || !res.plans.length) {
    targetRecoverEl.style.display = "none";
    return;
  }

  var plans = res.plans;
  var total = res.totalActions || 0;
  var when  = plans[0].createdAt ? new Date(plans[0].createdAt).toLocaleString() : "";

  targetRecoverTxt.textContent =
    "网页修改状态:已记录 " + total + " 项修改" + (when ? "(" + when + ")" : "") +
    "。刷新后会自动重新应用。";
  targetRecoverEl.style.display = "";
}

/** 修改成功后把「修改要求」存下来(只存动作,不存 DOM) */
async function saveRecoveryPlan(actions, summary, applied) {
  if (!actions || !actions.length) return;

  var tid = currentTargetTabId();
  var url = "";
  var t = currentTarget();
  if (t) url = t.lastSeenUrl || t.url || "";
  if (!url) return;

  try {
    await sendMsg({
      type:    MSG.PATCH_PLAN_SAVE || "ai-sidebar:patch-plan-save",
      tabId:   tid,
      url:     url,
      actions: actions,
      summary: summary || "",
      applied: applied || 0,
    });
  } catch (e) { /* 记录失败不影响修改本身 */ }

  refreshRecoveryState();
}

async function clearRecoveryPlan() {
  var t = currentTarget();
  var res = null;
  try {
    res = await sendMsg({
      type:  MSG.PATCH_PLAN_CLEAR,
      tabId: currentTargetTabId(),
      url:   t ? (t.lastSeenUrl || t.url || "") : "",
    });
  } catch (e) { res = null; }

  if (!res || !res.ok) { setTargetStatus((res && res.error) || "清除失败", "error"); return; }

  appendMessage("system", "已清除该网页的修改状态:刷新后不会再自动应用这些修改。");
  await refreshRecoveryState();
}

/* ---------------- 多目标歧义:不猜,先问 ---------------- */

/** 用户这句话里有没有点名某个锁定目标(标题 / 域名片段) */
function matchTargetsByText(text) {
  var raw = String(text || "").toLowerCase();
  if (!raw) return [];

  var out = [];
  var list = liveTargets();
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var title = String(t.title || "").toLowerCase();
    var host  = targetHost(t).toLowerCase();

    if (host && raw.indexOf(host) !== -1) { out.push(t); continue; }
    if (title && title.length >= 2 && raw.indexOf(title) !== -1) { out.push(t); continue; }
    // 标题太长时,取前 6 个字做弱匹配
    if (title.length > 6 && raw.indexOf(title.slice(0, 6)) !== -1) { out.push(t); continue; }
  }
  return out;
}

/**
 * 有多个锁定目标时,判断要不要先问用户
 * @returns {boolean} true = 需要先问(调用方应停止后续执行)
 */
function chooseTargetIfAmbiguous(text) {
  var list = liveTargets();
  if (list.length < 2) return false;

  var named = matchTargetsByText(text);
  if (named.length === 1) {
    if (named[0].tabId !== targetsData.activeId) switchTarget(named[0].tabId, { silent: true });
    return false;
  }

  return true;   // 没说清楚是哪个 → 问
}

/** 在聊天流里给出目标选择按钮 */
function renderTargetChooser(text) {
  var list = liveTargets();

  appendMessage("system", "当前有 " + list.length + " 个锁定网页,请选择这次要操作的目标:");

  var row = document.createElement("div");
  row.className = "target-choose-row";

  for (var i = 0; i < list.length; i++) {
    (function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = "Tab " + t.tabId + " · " + targetLabel(t);
      b.addEventListener("click", async function () {
        row.parentNode && row.parentNode.removeChild(row);
        await switchTarget(t.tabId, { silent: true });
        appendMessage("system", "已选择:" + currentTargetName());
        await runChatModify(text, { verb: "" });
      });
      row.appendChild(b);
    })(list[i]);
  }

  chatList.appendChild(row);
  chatList.scrollTop = chatList.scrollHeight;
}

async function refreshTargetsFromBrowser() {
  var res = null;
  try { res = await sendMsg({ type: MSG.TARGET_REFRESH }); } catch (e) { res = null; }
  if (!res || !res.ok) { setTargetStatus((res && res.error) || "刷新失败", "error"); return; }

  applyTargetsData(res.data);
  await loadTargets();
  setTargetStatus("已刷新目标状态", "ok");
}

'''
rep("block", "async function doSend(text) {", BLOCK.lstrip("\n") + "async function doSend(text) {")

# ============================================================
# B. doSend:多目标歧义先问
# ============================================================
rep("dosend",
    '''  if (intentInfo.intent === "modify" && chatMode === "page" && !isPatching) {
    await runChatModify(text, intentInfo);
    return;
  }''',
    '''  if (intentInfo.intent === "modify" && chatMode === "page" && !isPatching) {
    // 第四阶段:锁定了多个网页又没说清是哪个 → 先问,不猜
    if (chooseTargetIfAmbiguous(text)) {
      messages.push({ role: "user", content: text });
      appendMessage("user", text);
      messageInput.value = "";
      renderTargetChooser(text);
      return;
    }
    await runChatModify(text, intentInfo);
    return;
  }''')

# ============================================================
# C. runChatModify:成功后记录恢复计划
# ============================================================
rep("plan",
    '''  // 真的改动了才给撤销入口
  if (patchSteps > 0 && (patchSteps !== before || before === 0)) addChatUndoRow();
  await saveActiveSession(messages, sessionName);''',
    '''  // 真的改动了才给撤销入口
  if (patchSteps > 0 && (patchSteps !== before || before === 0)) {
    addChatUndoRow();
    // 第四阶段:记下「修改要求」,刷新后能自动重新应用(不保存 DOM)
    await saveRecoveryPlan(lastAppliedActions, text, patchSteps);
  }
  await saveActiveSession(messages, sessionName);''')

# ============================================================
# D. onPatchApply:记下本次真正应用的动作
# ============================================================
rep("capture",
    '    var report = lines.join("\\n");\n    setPatchStatus(report, modified > 0 ? (failedCount ? "info" : "ok") : "error");',
    '    var report = lines.join("\\n");\n'
    '    // 第四阶段:记下这次真正应用的动作,供「刷新后恢复」重放\n'
    '    lastAppliedActions = (plan.actions || []).slice(0, 100);\n'
    '    setPatchStatus(report, modified > 0 ? (failedCount ? "info" : "ok") : "error");')

# ============================================================
# E. 消息监听:目标变化 / 恢复完成
# ============================================================
rep("listen",
    'chrome.runtime.onMessage.addListener(function (message) {\n'
    '  if (message && message.type === MSG.CLOSE_SIDEBAR) { window.close(); return false; }\n'
    '  if (message && message.type === MSG.SELECTION_CHANGED) { showSelection(message); return false; }\n'
    '  return false;\n'
    '});',
    'chrome.runtime.onMessage.addListener(function (message) {\n'
    '  if (message && message.type === MSG.CLOSE_SIDEBAR) { window.close(); return false; }\n'
    '  if (message && message.type === MSG.SELECTION_CHANGED) { showSelection(message); return false; }\n'
    '\n'
    '  // 第四阶段:目标被关闭 / 跳转 / 切换,后台会主动通知\n'
    '  if (message && message.type === MSG.TARGETS_CHANGED) {\n'
    '    applyTargetsData(message.data);\n'
    '    (async function () {\n'
    '      await loadTargets();\n'
    '      if (message.reason === "closed") appendMessage("system", "目标网页已关闭,请重新锁定一个网页。");\n'
    '      if (message.reason === "navigated") appendMessage("system", "目标网页已导航到新地址,需要重新确认后才能继续操作。");\n'
    '    })();\n'
    '    return false;\n'
    '  }\n'
    '\n'
    '  // 第四阶段:页面刷新后自动重放修改,内容脚本回报真实结果\n'
    '  if (message && message.type === MSG.PATCH_RECOVERED) {\n'
    '    (async function () {\n'
    '      var applied = message.applied || 0;\n'
    '      var failed  = message.failed || 0;\n'
    '      var lines = ["网页已刷新,自动恢复修改:" + applied + " 项成功" + (failed ? "," + failed + " 项未能恢复" : "")];\n'
    '      var fs = message.failures || [];\n'
    '      for (var i = 0; i < fs.length && i < 3; i++) lines.push("· 未能恢复:" + (fs[i].action || "") + " — " + (fs[i].reason || ""));\n'
    '      appendMessage("system", lines.join("\\n"));\n'
    '      await loadTargets();\n'
    '      await refreshPatchState();\n'
    '    })();\n'
    '    return false;\n'
    '  }\n'
    '\n'
    '  return false;\n'
    '});')

# ============================================================
# F. init:事件绑定 + 初次加载
# ============================================================
rep("init",
    '  btnChipClear.addEventListener("click", function () { hideSelection(); });\n',
    '  btnChipClear.addEventListener("click", function () { hideSelection(); });\n'
    '\n'
    '  // 第四阶段:锁定目标\n'
    '  btnTargetLock.addEventListener("click", function () { lockCurrentPage(); });\n'
    '  btnTargetLock2.addEventListener("click", function () { lockCurrentPage(); });\n'
    '  btnTargetRefresh.addEventListener("click", function () { refreshTargetsFromBrowser(); });\n'
    '  btnTargetReanalyze.addEventListener("click", function () { onPatchDeepAnalyze(); });\n'
    '  btnTargetClearPlan.addEventListener("click", function () { clearRecoveryPlan(); });\n'
    '  btnTargetPanel.addEventListener("click", function () {\n'
    '    var open = targetPanel.style.display === "none";\n'
    '    targetPanel.style.display = open ? "" : "none";\n'
    '    if (open) refreshTargetsFromBrowser();\n'
    '  });\n'
    '  btnCloseTarget.addEventListener("click", function () { targetPanel.style.display = "none"; });\n'
    '  await loadTargets();\n'
    '  renderTargetBar();\n')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("js2", k, "=", v)

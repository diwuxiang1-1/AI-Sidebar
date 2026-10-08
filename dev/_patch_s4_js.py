# -*- coding: utf-8 -*-
"""第四阶段 · 4:侧边栏 JS —— 目标状态 / 面板 / 切换 / 状态隔离 / 刷新恢复接线"""

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
# 0. 先补一小段 HTML(目标面板里的「恢复状态」区块)
# ============================================================
h = io.open("sidebar/sidebar.html", encoding="utf-8").read()
old_h = '    <div class="target-panel-foot">'
new_h = ('    <!-- 刷新后的修改恢复状态(第四阶段) -->\n'
         '    <div id="target-recover" class="target-recover" style="display:none;">\n'
         '      <div id="target-recover-text" class="target-card-meta"></div>\n'
         '      <div class="target-card-actions">\n'
         '        <button id="btn-target-reanalyze" class="btn btn-small" type="button">重新分析网页</button>\n'
         '        <button id="btn-target-clear-plan" class="btn btn-small" type="button">清除该网页修改</button>\n'
         '      </div>\n'
         '    </div>\n'
         '    <div class="target-panel-foot">')
assert h.count(old_h) == 1
io.open("sidebar/sidebar.html", "w", encoding="utf-8", newline="").write(h.replace(old_h, new_h, 1))
print("sidebar.html recover 区块 = 1")

# ============================================================
# 1. 消息常量
# ============================================================
rep("msg",
    '  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",\n  MEDIA_APPLY:    "ai-sidebar:media-apply",\n};',
    '  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",\n'
    '  MEDIA_APPLY:    "ai-sidebar:media-apply",\n'
    '  /* 锁定目标 / Tab(第四阶段) */\n'
    '  TARGET_LIST:       "ai-sidebar:target-list",\n'
    '  TARGET_LOCK:       "ai-sidebar:target-lock",\n'
    '  TARGET_UNLOCK:     "ai-sidebar:target-unlock",\n'
    '  TARGET_SET_ACTIVE: "ai-sidebar:target-set-active",\n'
    '  TARGET_CONFIRM:    "ai-sidebar:target-confirm",\n'
    '  TARGET_REFRESH:    "ai-sidebar:target-refresh",\n'
    '  TARGETS_CHANGED:   "ai-sidebar:targets-changed",\n'
    '  /* 网页修改恢复(第四阶段) */\n'
    '  PATCH_PLAN_STATE:  "ai-sidebar:patch-plan-state",\n'
    '  PATCH_PLAN_CLEAR:  "ai-sidebar:patch-plan-clear",\n'
    '  PATCH_RECOVERED:   "ai-sidebar:patch-recovered",\n'
    '};')

# ============================================================
# 2. DOM 引用
# ============================================================
rep("refs",
    'const patchDeepEl     = document.getElementById("patch-deep");',
    'const patchDeepEl     = document.getElementById("patch-deep");\n'
    '\n'
    '/* ---- 第四阶段:AI 操作目标 ---- */\n'
    'const targetBar        = document.getElementById("target-bar");\n'
    'const targetCurrentEl  = document.getElementById("target-current-name");\n'
    'const targetCountEl    = document.getElementById("target-count");\n'
    'const btnTargetLock    = document.getElementById("btn-target-lock");\n'
    'const btnTargetPanel   = document.getElementById("btn-target-panel");\n'
    'const targetPanel      = document.getElementById("target-panel");\n'
    'const targetListEl     = document.getElementById("target-list");\n'
    'const targetStatusEl   = document.getElementById("target-status");\n'
    'const btnCloseTarget   = document.getElementById("btn-close-target");\n'
    'const btnTargetRefresh = document.getElementById("btn-target-refresh");\n'
    'const btnTargetLock2   = document.getElementById("btn-target-lock-panel");\n'
    'const targetRecoverEl  = document.getElementById("target-recover");\n'
    'const targetRecoverTxt = document.getElementById("target-recover-text");\n'
    'const btnTargetReanalyze = document.getElementById("btn-target-reanalyze");\n'
    'const btnTargetClearPlan = document.getElementById("btn-target-clear-plan");')

# ============================================================
# 3. 目标状态 + sendMsg 包装(定义放在使用之前)
# ============================================================
TARGET_CORE = r'''
/* ==================================================================
   0. 锁定目标 / AI 当前操作目标(第四阶段)
   ----------------------------------------------------------------
   「浏览器现在显示哪个网页」与「AI 操作哪个网页」是两件事。
   锁定了目标之后,所有网页操作都带上 targetTabId,
   后台按这个 id 解析目标,不再看当前活动 Tab。
   ================================================================== */

var targetsData        = { list: [], activeId: null };   // 本地缓存
var browserActiveTabId = null;                           // 浏览器当前活动 Tab(仅用于显示)
var targetStates       = {};                             // tabId → 该网页自己的状态(互不污染)
var lastAppliedActions = [];                             // 最近一次成功应用的修改动作(用于刷新恢复)
var pendingTargetText  = "";                             // 多目标歧义时,等待用户选目标的那句话

/** 当前 AI 操作目标的 Tab ID;null = 没有锁定,就操作当前活动网页 */
function currentTargetTabId() {
  return (typeof targetsData.activeId === "number") ? targetsData.activeId : null;
}

function findLocalTarget(tabId) {
  var list = targetsData.list || [];
  for (var i = 0; i < list.length; i++) if (list[i].tabId === tabId) return list[i];
  return null;
}

function currentTarget() {
  return findLocalTarget(currentTargetTabId());
}

/** 界面上「AI 当前操作目标」那一行 */
function currentTargetName() {
  var t = currentTarget();
  if (!t) return "当前活动网页";
  return "Tab " + t.tabId + " · " + targetLabel(t);
}

/** 锁定的目标里,还活着的那些 */
function liveTargets() {
  var out = [];
  var list = targetsData.list || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].state !== TARGET_STATE.CLOSED) out.push(list[i]);
  }
  return out;
}

/**
 * 所有发往后台的消息统一在这里出口
 * 网页操作类消息自动带上「AI 当前操作目标」,目标管理类消息不带
 */
var TARGET_MGMT_MSGS = {};
[
  MSG.TARGET_LIST, MSG.TARGET_LOCK, MSG.TARGET_UNLOCK, MSG.TARGET_SET_ACTIVE,
  MSG.TARGET_CONFIRM, MSG.TARGET_REFRESH, MSG.GET_ACTIVE_TAB,
].forEach(function (t) { TARGET_MGMT_MSGS[t] = 1; });

function sendMsg(message) {
  if (message && typeof message === "object" && !TARGET_MGMT_MSGS[message.type]) {
    var tid = currentTargetTabId();
    if (tid !== null) message.targetTabId = tid;
  }
  return chrome.runtime.sendMessage(message);
}

/** 用后台返回的最新数据刷新本地缓存 */
function applyTargetsData(data) {
  if (!data) return;
  targetsData = {
    list:     Array.isArray(data.list) ? data.list : [],
    activeId: (typeof data.activeId === "number") ? data.activeId : null,
  };
}

/** 向后台拉取目标列表(含浏览器当前活动 Tab,便于界面区分) */
async function loadTargets() {
  var res = null;
  try { res = await sendMsg({ type: MSG.TARGET_LIST }); } catch (e) { res = null; }
  if (!res || !res.ok) { renderTargetBar(); return; }

  applyTargetsData(res);
  browserActiveTabId = (typeof res.browserActiveTabId === "number") ? res.browserActiveTabId : null;
  renderTargetBar();
  renderTargetPanel();
  await refreshRecoveryState();
}

'''
rep("core", "async function doSend(text) {", TARGET_CORE.lstrip("\n") + "async function doSend(text) {")

# ============================================================
# 4. 全部出站消息改走 sendMsg
# ============================================================
cnt = s.count("chrome.runtime.sendMessage(")
print("出站调用点 =", cnt)
# sendMsg 定义内部那一处要保留原样,先替换其余
s = s.replace("return chrome.runtime.sendMessage(message);", "@@KEEP@@")
cnt2 = s.count("chrome.runtime.sendMessage(")
s = s.replace("chrome.runtime.sendMessage(", "sendMsg(")
s = s.replace("@@KEEP@@", "return chrome.runtime.sendMessage(message);")
print("已改写调用点 =", cnt2)

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("js", k, "=", v)

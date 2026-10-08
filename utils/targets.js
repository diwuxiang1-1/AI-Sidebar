// ============================================================
// AI Sidebar · 锁定目标(Tab)数据层(第四阶段)
// ------------------------------------------------------------
// 背景:
//   在此之前,所有网页能力都隐含「当前活动 Tab」。用户锁定网页 A 后
//   切到网页 B,AI 就会操作错页面。
//
// 本模块只负责「锁定目标」这份数据的读写与状态流转:
//   · 一个目标 = 一个 Tab
//   · 可以同时锁定多个目标
//   · 「浏览器活动 Tab」与「AI 当前操作目标」是两件不同的事
//
// ⚠️ 本文件不调用 chrome.tabs —— Tab 的真实状态由后台监听并回写,
//    侧边栏只读这份数据。这样侧边栏与后台可以共用同一份逻辑。
// 经典脚本,挂在全局作用域:侧边栏用 <script>,后台用 importScripts。
// ============================================================

"use strict";

var TARGETS_KEY      = "ai-sidebar:targets";
var PATCH_PLANS_KEY  = "ai-sidebar:patch-plans";
var TARGETS_MAX      = 8;      // 最多同时锁定几个目标(避免界面失控)

/** 目标状态 */
var TARGET_STATE = {
  LOCKED:    "locked",     // 正常锁定
  CLOSED:    "closed",     // 目标网页已关闭
  NAVIGATED: "navigated",  // 目标网页跳到了别的地址,需要重新确认
};

/* ==================================================================
   1. 目标对象
   ================================================================== */

/**
 * 把任意来源的数据整理成一个目标对象
 * 只保留明确的字段,不存页面内容、不存 DOM
 */
function normalizeTarget(raw) {
  var t = raw || {};
  var tabId = (typeof t.tabId === "number") ? t.tabId : null;
  if (tabId === null) return null;

  var state = t.state;
  if (state !== TARGET_STATE.CLOSED && state !== TARGET_STATE.NAVIGATED) {
    state = TARGET_STATE.LOCKED;
  }

  return {
    tabId:     tabId,
    windowId:  (typeof t.windowId === "number") ? t.windowId : null,
    url:       String(t.url || ""),
    title:     String(t.title || ""),
    favicon:   String(t.favicon || ""),
    lockedAt:  (typeof t.lockedAt === "number") ? t.lockedAt : 0,
    lastSeenUrl: String(t.lastSeenUrl || t.url || ""),
    state:     state,
  };
}

/** 界面显示用的名字:标题优先,退化到 URL 的域名,再退化到 Tab ID */
function targetLabel(target) {
  if (!target) return "(未选择)";
  var title = String(target.title || "").trim();
  if (title) return title;

  var url = String(target.url || "");
  var m = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  if (m) return m[1];

  return "Tab " + target.tabId;
}

/** 域名(用于界面副标题) */
function targetHost(target) {
  var url = String((target && target.url) || "");
  var m = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  return m ? m[1] : "";
}

/* ==================================================================
   2. 读写
   ================================================================== */

function emptyTargetsData() {
  return { list: [], activeId: null };
}

function normalizeTargetsData(raw) {
  var data = raw && typeof raw === "object" ? raw : {};
  var list = [];

  if (Array.isArray(data.list)) {
    for (var i = 0; i < data.list.length; i++) {
      var t = normalizeTarget(data.list[i]);
      if (t) list.push(t);
    }
  }

  var activeId = (typeof data.activeId === "number") ? data.activeId : null;
  var has = false;
  for (var j = 0; j < list.length; j++) if (list[j].tabId === activeId) has = true;

  // activeId 必须指向一个真实存在的目标,否则回落到第一个可用目标
  if (!has) {
    activeId = null;
    for (var k = 0; k < list.length; k++) {
      if (list[k].state === TARGET_STATE.LOCKED) { activeId = list[k].tabId; break; }
    }
    if (activeId === null && list.length) activeId = list[0].tabId;
  }

  return { list: list, activeId: activeId };
}

async function getTargetsData() {
  try {
    var data = await chrome.storage.local.get(TARGETS_KEY);
    return normalizeTargetsData(data[TARGETS_KEY]);
  } catch (e) {
    return emptyTargetsData();
  }
}

async function saveTargetsData(data) {
  var clean = normalizeTargetsData(data);
  var obj = {};
  obj[TARGETS_KEY] = clean;
  await chrome.storage.local.set(obj);
  return clean;
}

function findTarget(data, tabId) {
  var list = (data && data.list) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].tabId === tabId) return list[i];
  }
  return null;
}

/** 当前 AI 操作目标(没有锁定任何网页时返回 null) */
function getActiveTarget(data) {
  return findTarget(data, data && data.activeId);
}

/* ==================================================================
   3. 变更操作(纯数据,调用方负责保存)
   ================================================================== */

/** 锁定 / 更新一个目标;已存在则更新标题与地址 */
function upsertTarget(data, tab, now) {
  var d = normalizeTargetsData(data);
  var fresh = normalizeTarget({
    tabId:    tab && tab.id,
    windowId: tab && tab.windowId,
    url:      tab && tab.url,
    title:    tab && tab.title,
    favicon:  tab && tab.favIconUrl,
    lockedAt: now,
    state:    TARGET_STATE.LOCKED,
  });
  if (!fresh) return d;

  var exist = findTarget(d, fresh.tabId);
  if (exist) {
    exist.url      = fresh.url || exist.url;
    exist.title    = fresh.title || exist.title;
    exist.favicon  = fresh.favicon || exist.favicon;
    exist.windowId = fresh.windowId;
    exist.state    = TARGET_STATE.LOCKED;
    exist.lastSeenUrl = fresh.url || exist.lastSeenUrl;
  } else {
    if (d.list.length >= TARGETS_MAX) return d;   // 上限:不静默丢弃,由调用方提示
    d.list.push(fresh);
  }

  d.activeId = fresh.tabId;   // 刚锁定的成为当前目标
  return d;
}

function removeTarget(data, tabId) {
  var d = normalizeTargetsData(data);
  var out = [];
  for (var i = 0; i < d.list.length; i++) {
    if (d.list[i].tabId !== tabId) out.push(d.list[i]);
  }
  d.list = out;
  if (d.activeId === tabId) d.activeId = null;
  return normalizeTargetsData(d);
}

function setActiveTarget(data, tabId) {
  var d = normalizeTargetsData(data);
  if (findTarget(d, tabId)) d.activeId = tabId;
  return d;
}

/**
 * 回写目标的真实状态(后台监听 Tab 变化后调用)
 * @param {number} tabId
 * @param {{state?:string, url?:string, title?:string, favicon?:string}} patch
 */
function applyTargetPatch(data, tabId, patch) {
  var d = normalizeTargetsData(data);
  var t = findTarget(d, tabId);
  if (!t) return d;

  var p = patch || {};
  if (p.title !== undefined)   t.title   = String(p.title || "");
  if (p.favicon !== undefined) t.favicon = String(p.favicon || "");

  if (p.url !== undefined) {
    var next = String(p.url || "");
    // 地址变了就不再假装它还是原来那个网页
    if (next && t.lastSeenUrl && next !== t.lastSeenUrl) {
      t.state = TARGET_STATE.NAVIGATED;
    }
    if (next) t.url = next;
  }

  if (p.state) t.state = p.state;

  return d;
}

/* ==================================================================
   4. 网页修改恢复计划(只存「修改要求」,不存 DOM / HTML)
   ----------------------------------------------------------------
   每条计划:
     { tabId, url, urlPattern, actions:[...], createdAt, applied }
   actions 就是 WebPatch 的结构化动作数组(可重放)。
   ================================================================== */

/** URL 匹配:忽略 hash,允许同源同路径的查询串差异 */
function urlPatternOf(url) {
  var s = String(url || "");
  var hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(0, hash);
  return s;
}

function planMatchesUrl(plan, url) {
  if (!plan) return false;
  return urlPatternOf(plan.url) === urlPatternOf(url);
}

async function getPatchPlans() {
  try {
    var data = await chrome.storage.local.get(PATCH_PLANS_KEY);
    var raw = data[PATCH_PLANS_KEY];
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

async function savePatchPlans(list) {
  var arr = Array.isArray(list) ? list.slice(0, 30) : [];   // 上限,避免无限增长
  var obj = {};
  obj[PATCH_PLANS_KEY] = arr;
  await chrome.storage.local.set(obj);
  return arr;
}

/**
 * 记录 / 覆盖某个目标的修改计划
 * 同一个 tab + 同一个 URL 只保留一条(同一次会话的连续修改会合并进同一条)
 */
function upsertPatchPlan(list, entry) {
  var arr = Array.isArray(list) ? list.slice() : [];
  var clean = {
    tabId:      entry.tabId,
    url:        urlPatternOf(entry.url),
    actions:    Array.isArray(entry.actions) ? entry.actions : [],
    summary:    String(entry.summary || ""),
    createdAt:  entry.createdAt || 0,
    applied:    entry.applied || 0,
  };

  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].tabId === clean.tabId && urlPatternOf(arr[i].url) === clean.url) {
      // 合并动作:同一目标的后续修改叠加在原计划上,刷新后才能整体恢复
      var merged = Array.isArray(arr[i].actions) ? arr[i].actions.slice() : [];
      for (var k = 0; k < clean.actions.length; k++) merged.push(clean.actions[k]);
      arr[i].actions   = merged.slice(0, 200);
      arr[i].summary   = clean.summary || arr[i].summary;
      arr[i].applied   = clean.applied;
      arr[i].createdAt = clean.createdAt || arr[i].createdAt;
      return arr;
    }
  }

  arr.push(clean);
  return arr;
}

function dropPatchPlan(list, tabId, url) {
  var arr = Array.isArray(list) ? list : [];
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    if (!arr[i]) continue;
    if (arr[i].tabId === tabId && (!url || urlPatternOf(arr[i].url) === urlPatternOf(url))) continue;
    out.push(arr[i]);
  }
  return out;
}

/** 找出适用于这个地址的恢复计划(用于页面刷新后自动重放) */
function findPatchPlan(list, url) {
  var arr = Array.isArray(list) ? list : [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && planMatchesUrl(arr[i], url)) return arr[i];
  }
  return null;
}

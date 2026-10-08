// ============================================================
// AI Sidebar · AI 权限等级 + 操作审计(第十轮 · 新增)
// ------------------------------------------------------------
// 纯存储逻辑:只碰 chrome.storage,不发请求、不碰 DOM。
// 经典脚本(非 ES module),后台通过 importScripts 加载,页面通过 <script> 加载。
//
// 三个层级(默认只有基础层):
//   基础        —— 普通聊天 / 翻译 / 网页资源 / 结构化网页修改
//   page        —— 权限等级 1:网页完全权限(可在当前网页主世界执行网页代码)
//   browser     —— 权限等级 2:浏览器完全权限(可使用 Browser Agent Tool)
// ============================================================

"use strict";

var PERM_KEY = "ai-sidebar:permissions";
var AUDIT_KEY = "ai-sidebar:audit-log";
var AUDIT_MAX = 100;

/** 默认:两个高级权限都关闭 */
var DEFAULT_PERMISSIONS = { page: false, browser: false };

/* ==================================================================
   1. 权限读写
   ================================================================== */

async function getPermissions() {
  var data = await chrome.storage.local.get(PERM_KEY);
  var stored = data[PERM_KEY];
  if (!stored || typeof stored !== "object") stored = {};

  return {
    page:    stored.page === true,
    browser: stored.browser === true,
  };
}

async function savePermissions(perms) {
  var obj = {};
  obj[PERM_KEY] = {
    page:    !!(perms && perms.page),
    browser: !!(perms && perms.browser),
  };
  await chrome.storage.local.set(obj);
}

/** 单独开关某一级(level: "page" | "browser") */
async function setPermissionLevel(level, on) {
  var perms = await getPermissions();
  if (level === "page")    perms.page    = !!on;
  if (level === "browser") perms.browser = !!on;
  await savePermissions(perms);
  return perms;
}

async function hasPageLevel() {
  try { return (await getPermissions()).page === true; } catch (e) { return false; }
}

async function hasBrowserLevel() {
  try { return (await getPermissions()).browser === true; } catch (e) { return false; }
}

/** 给界面用的一句话描述 */
function describePermissionLevel(perms) {
  if (perms && perms.browser) return "浏览器 Agent(等级 2)";
  if (perms && perms.page)    return "网页 Agent(等级 1)";
  return "普通 AI(基础权限)";
}

/* ==================================================================
   2. 操作审计(简单记录,不追求完整审计系统)
   ================================================================== */

/**
 * 追加一条操作记录
 * @param {string} level "page" | "browser" | "base"
 * @param {string} action 动作名(如 run_js / tabs.open)
 * @param {string} detail 说明(如 "video.playbackRate = 16")
 */
async function appendAuditLog(level, action, detail) {
  try {
    var data = await chrome.storage.local.get(AUDIT_KEY);
    var list = Array.isArray(data[AUDIT_KEY]) ? data[AUDIT_KEY] : [];

    list.push({
      t:      Date.now(),
      level:  String(level || "base"),
      action: String(action || ""),
      detail: String(detail || "").slice(0, 300),
    });

    if (list.length > AUDIT_MAX) list = list.slice(list.length - AUDIT_MAX);

    var obj = {};
    obj[AUDIT_KEY] = list;
    await chrome.storage.local.set(obj);
  } catch (e) {
    // 记录失败不影响主流程
  }
}

async function getAuditLog() {
  try {
    var data = await chrome.storage.local.get(AUDIT_KEY);
    return Array.isArray(data[AUDIT_KEY]) ? data[AUDIT_KEY] : [];
  } catch (e) {
    return [];
  }
}

async function clearAuditLog() {
  var obj = {};
  obj[AUDIT_KEY] = [];
  await chrome.storage.local.set(obj);
}

/** 时间戳 → HH:MM:SS */
function formatAuditTime(ts) {
  try {
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  } catch (e) {
    return "";
  }
}

/** 权限等级 → 中文标签 */
function auditLevelLabel(level) {
  if (level === "browser") return "浏览器权限";
  if (level === "page")    return "网页权限";
  return "基础权限";
}

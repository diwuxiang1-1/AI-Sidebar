// ============================================================
// AI Sidebar · Storage 工具(第六阶段)
// ------------------------------------------------------------
// - API 配置读写(keys 数组、configName、provider preset)
// - 多会话管理(创建/切换/删除/持久化)
// - 旧版单会话自动迁移
// ============================================================

"use strict";

/* ==================================================================
   Provider 预设 —— 服务商选好后自动填 Base URL
   ================================================================== */
var PROVIDER_PRESETS = {
  deepseek:    { name: "DeepSeek",    baseUrl: "https://api.deepseek.com/v1" },
  openai:      { name: "OpenAI",      baseUrl: "https://api.openai.com/v1" },
  siliconflow: { name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1" },
  claude:      { name: "Claude",      baseUrl: "https://api.anthropic.com/v1" },
  google:      { name: "Google",      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  custom:      { name: "自定义",      baseUrl: "" },
};

/* ==================================================================
   Storage keys
   ================================================================== */
var API_CONFIG_KEY         = "ai-sidebar:api-config";
var SESSIONS_KEY           = "ai-sidebar:sessions";
var ACTIVE_SESSION_KEY     = "ai-sidebar:active-session-id";
var OLD_CHAT_HISTORY_KEY   = "ai-sidebar:chat-history"; // 第五阶段旧格式

/* ==================================================================
   API 配置默认值
   ================================================================== */
var DEFAULT_API_CONFIG = {
  configName: "",
  provider:   "custom",
  baseUrl:    "",
  keys:       [{ value: "", enabled: true }],   // 当前 Provider 的 Key 池(旧字符串数组会自动规范化)
  keyPools:   {},                                // provider → Key 池,不同服务商严格分开
  model:      "",
  modelName:  "",
};

/* ==================================================================
   API 配置读写(保持不变)
   ================================================================== */
async function getApiConfig() {
  var data   = await chrome.storage.local.get(API_CONFIG_KEY);
  var stored = data[API_CONFIG_KEY];
  if (!stored || typeof stored !== "object") stored = {};

  if (typeof stored.apiKey === "string" && stored.apiKey && !Array.isArray(stored.keys)) {
    stored.keys = [stored.apiKey];
  }

  var merged = Object.assign({}, DEFAULT_API_CONFIG, stored);
  // 规范化:字符串数组(旧格式)→ { value, enabled }
  merged.keys = normalizeKeyList(merged.keys);
  if (!merged.keys.length) merged.keys = [{ value: "", enabled: true }];

  if (!merged.keyPools || typeof merged.keyPools !== "object") merged.keyPools = {};

  return merged;
}

/**
 * 把历史形态的 Key 列表规范化成 [{ value, enabled }]
 * 兼容:["sk-a","sk-b"] / [""] / [{value,enabled}]
 */
function normalizeKeyList(list) {
  var out = [];
  if (!Array.isArray(list)) return out;

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (typeof item === "string") {
      out.push({ value: item, enabled: true });
    } else if (item && typeof item === "object" && typeof item.value === "string") {
      out.push({ value: item.value, enabled: item.enabled !== false });
    }
  }
  return out;
}

/**
 * 当前配置里「启用的」Key,按填写顺序返回(轮询就按这个顺序)
 * 只包含非空且 enabled 的 Key;不涉及任何其它 Provider 的池
 */
function getEnabledApiKeys(config) {
  var list = normalizeKeyList(config && config.keys);
  var out = [];

  for (var i = 0; i < list.length; i++) {
    if (list[i].enabled && list[i].value) out.push(list[i].value);
  }
  return out;
}

/** 首个可用 Key(单 Key 场景 / 界面展示用) */
function getPrimaryApiKey(config) {
  var list = getEnabledApiKeys(config);
  if (list.length) return list[0];

  var all = normalizeKeyList(config && config.keys);
  for (var i = 0; i < all.length; i++) {
    if (all[i].value) return all[i].value;
  }
  return "";
}

/** Key 掩码:UI / 日志 / 错误信息一律用它,不出现完整 Key */
function maskApiKey(key) {
  var v = String(key || "");
  if (!v) return "";
  if (v.length <= 8) return "****";
  return v.slice(0, 4) + "****" + v.slice(-4);
}

async function saveApiConfig(config) {
  var obj = {};
  obj[API_CONFIG_KEY] = config;
  await chrome.storage.local.set(obj);
}

/* ==================================================================
   活动会话 ID 读写
   ================================================================== */
async function getActiveSessionId() {
  var data = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
  return data[ACTIVE_SESSION_KEY] || null;
}

async function setActiveSessionId(id) {
  var obj = {};
  obj[ACTIVE_SESSION_KEY] = id;
  await chrome.storage.local.set(obj);
}

/* ==================================================================
   会话 CRUD
   ================================================================== */

/** 加载全部会话(含旧格式自动迁移) */
async function loadSessions() {
  var data     = await chrome.storage.local.get(SESSIONS_KEY);
  var sessions = data[SESSIONS_KEY];
  if (!Array.isArray(sessions)) sessions = [];

  // 向后兼容:迁移第五阶段旧单会话 → 多会话
  if (sessions.length === 0) {
    var old = await _loadOldChatHistory();
    if (old && old.length > 0) {
      var session = _createSessionObject();
      session.messages = old;
      session.name = old[0] ? old[0].content.slice(0, 30) : "旧会话";
      sessions.push(session);
      await saveSessions(sessions);
      await setActiveSessionId(session.id);
      await chrome.storage.local.remove(OLD_CHAT_HISTORY_KEY);
    }
  }

  return sessions;
}

/** 保存全部会话 */
async function saveSessions(sessions) {
  // 每个会话最多保留 200 条消息
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].messages.length > 200) {
      sessions[i].messages = sessions[i].messages.slice(sessions[i].messages.length - 200);
    }
  }
  // 最多保留 20 个会话
  if (sessions.length > 20) {
    sessions = sessions.sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 20);
  }

  var obj = {};
  obj[SESSIONS_KEY] = sessions;
  await chrome.storage.local.set(obj);
}

/** 创建新会话对象(不保存) */
function createSession() {
  return _createSessionObject();
}

/** 保存/更新活动会话 */
async function saveActiveSession(messages, name) {
  var sessions = await loadSessions();
  var sid      = await getActiveSessionId();
  if (!sid) {
    sid = _generateId();
    await setActiveSessionId(sid);
  }

  var found = false;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].id === sid) {
      sessions[i].messages  = messages;
      sessions[i].updatedAt = Date.now();
      if (name !== undefined) sessions[i].name = name;
      found = true;
      break;
    }
  }

  if (!found) {
    var session = _createSessionObject();
    session.id       = sid;
    session.name     = name || "";
    session.messages = messages;
    sessions.push(session);
  }

  await saveSessions(sessions);
}

/** 删除指定会话 */
async function deleteSession(id) {
  var sessions = await loadSessions();
  var filtered = [];
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].id !== id) filtered.push(sessions[i]);
  }
  await saveSessions(filtered);
}

/* ==================================================================
   内部工具
   ================================================================== */

function _generateId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function _createSessionObject() {
  return {
    id:        _generateId(),
    name:      "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages:  [],
  };
}

async function _loadOldChatHistory() {
  var data = await chrome.storage.local.get(OLD_CHAT_HISTORY_KEY);
  var arr  = data[OLD_CHAT_HISTORY_KEY];
  return Array.isArray(arr) ? arr : null;
}
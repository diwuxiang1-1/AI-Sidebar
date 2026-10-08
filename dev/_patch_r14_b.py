# -*- coding: utf-8 -*-
# 一次性补丁(第十四轮 · B):settings.js 多 Key UI + webpatch 意图识别 + content 倍速锁定 + 聊天 UI

import io

# ================= settings.js =================
p = "settings/settings.js"
s = io.open(p, encoding="utf-8").read()
n = {}

old = u'''var apiKeyInput     = document.getElementById("api-key");'''
new = u'''var keyListEl       = document.getElementById("key-list");
var btnAddKey       = document.getElementById("btn-add-key");
var keyPools        = {};        // provider → [{value, enabled}],不同服务商严格分开
var currentProvider = "custom";'''
n["refs"] = s.count(old); s = s.replace(old, new, 1)

old = u'''    // API Key:取 keys[0]
    apiKeyInput.value = (config.keys && config.keys.length > 0) ? config.keys[0] : "";'''
new = u'''    // 多 Key:当前 Provider 的池
    keyPools = (config.keyPools && typeof config.keyPools === "object") ? config.keyPools : {};
    currentProvider = config.provider || "custom";

    var pool = keyPools[currentProvider];
    renderKeyRows(normalizeKeyList(pool && pool.length ? pool : config.keys));'''
n["load"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  providerSelect.addEventListener("change", function () {
    var id   = providerSelect.value;
    var info = PROVIDER_PRESETS[id];
    if (info) baseUrlInput.value = info.baseUrl;'''
new = u'''  providerSelect.addEventListener("change", function () {
    var id   = providerSelect.value;
    var info = PROVIDER_PRESETS[id];
    if (info) baseUrlInput.value = info.baseUrl;

    // 严格分池:先把当前编辑内容存回原 Provider,再切到新 Provider 的池
    keyPools[currentProvider] = collectKeyRows();
    currentProvider = id;
    renderKeyRows(normalizeKeyList(keyPools[id] && keyPools[id].length ? keyPools[id] : [{ value: "", enabled: true }]));'''
n["switch"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  var config = {
    configName: configNameInput.value.trim(),
    provider:   provider,
    baseUrl:    baseUrl,
    keys:       [apiKey],
    model:      modelId,
    modelName:  resolveModelName(modelId),
  };'''
new = u'''  keyPools[provider] = collectKeyRows();

  var config = {
    configName: configNameInput.value.trim(),
    provider:   provider,
    baseUrl:    baseUrl,
    keys:       keyPools[provider],       // 当前 Provider 的池
    keyPools:   keyPools,                 // 每个 Provider 各自的池
    model:      modelId,
    modelName:  resolveModelName(modelId),
  };'''
n["save"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  var apiKey     = apiKeyInput.value.trim();
  var modelId    = resolveModelId();

  if (!apiKey)  { showStatus("请填写 API Key", "error"); return; }
  if (!baseUrl) { showStatus("请填写 API Base URL(或选择服务商后自动填写)", "error"); return; }
  if (!modelId) { showStatus("请选择或手动输入模型", "error"); return; }

  keyPools[provider] = collectKeyRows();'''
new = u'''  var modelId    = resolveModelId();
  var enabled    = keyPools[provider].filter(function (k) { return k.enabled && k.value; });

  if (!enabled.length) { showStatus("请至少填写一个启用的 API Key", "error"); return; }
  if (!baseUrl) { showStatus("请填写 API Base URL(或选择服务商后自动填写)", "error"); return; }
  if (!modelId) { showStatus("请选择或手动输入模型", "error"); return; }
'''
n["validate"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  var baseUrl = baseUrlInput.value.trim();
  var apiKey  = apiKeyInput.value.trim();
  var modelId = resolveModelId();

  if (!baseUrl) { showStatus("请先选择服务商或填写 Base URL", "error"); return; }
  if (!apiKey)  { showStatus("请先填写 API Key", "error"); return; }
  if (!modelId) { showStatus("请先选择或输入模型", "error"); return; }

  showStatus("正在测试连接…", "info");'''
new = u'''  var baseUrl = baseUrlInput.value.trim();
  var modelId = resolveModelId();
  var pool    = keyPools[currentProvider] || [];
  var first   = "";
  for (var ki = 0; ki < pool.length; ki++) {
    if (pool[ki].enabled && pool[ki].value) { first = pool[ki].value; break; }
  }
  var apiKey  = first;

  if (!baseUrl) { showStatus("请先选择服务商或填写 Base URL", "error"); return; }
  if (!apiKey)  { showStatus("请先填写至少一个启用的 API Key", "error"); return; }
  if (!modelId) { showStatus("请先选择或输入模型", "error"); return; }

  showStatus("正在测试连接…(使用 " + maskApiKey(apiKey) + ")", "info");'''
n["test"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  var baseUrl = baseUrlInput.value.trim();
  var apiKey  = apiKeyInput.value.trim();

  if (!baseUrl) { showStatus("请先选择服务商或填写 Base URL", "error"); return; }
  if (!apiKey)  { showStatus("请先填写 API Key", "error"); return; }

  showStatus("正在获取模型列表…", "info");'''
new = u'''  var baseUrl = baseUrlInput.value.trim();
  var pool    = keyPools[currentProvider] || [];
  var apiKey  = "";
  for (var kj = 0; kj < pool.length; kj++) {
    if (pool[kj].enabled && pool[kj].value) { apiKey = pool[kj].value; break; }
  }

  if (!baseUrl) { showStatus("请先选择服务商或填写 Base URL", "error"); return; }
  if (!apiKey)  { showStatus("请先填写至少一个启用的 API Key", "error"); return; }

  showStatus("正在获取模型列表…", "info");'''
n["fetch"] = s.count(old); s = s.replace(old, new, 1)

APPEND = u'''

/* ==================================================================
   7. 多 API Key 列表(第十四轮)
   ================================================================== */

/** 渲染 Key 行:密码框 + 启用开关 + 删除 */
function renderKeyRows(list) {
  var rows = normalizeKeyList(list);
  if (!rows.length) rows = [{ value: "", enabled: true }];

  keyListEl.innerHTML = "";

  for (var i = 0; i < rows.length; i++) {
    keyListEl.appendChild(makeKeyRow(rows[i]));
  }
}

function makeKeyRow(item) {
  var row = document.createElement("div");
  row.className = "key-row" + (item.enabled ? "" : " disabled");

  var input = document.createElement("input");
  input.type = "password";
  input.placeholder = "sk-...(第 " + (keyListEl.children.length + 1) + " 个 Key)";
  input.value = item.value || "";
  input.setAttribute("data-role", "key-value");

  var label = document.createElement("label");
  label.className = "key-toggle";

  var toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = item.enabled !== false;
  toggle.setAttribute("data-role", "key-enabled");
  toggle.addEventListener("change", function () {
    if (toggle.checked) row.classList.remove("disabled");
    else row.classList.add("disabled");
  });

  var toggleText = document.createElement("span");
  toggleText.textContent = "启用";
  label.appendChild(toggle);
  label.appendChild(toggleText);

  var del = document.createElement("button");
  del.className = "btn key-del";
  del.type = "button";
  del.textContent = "删除";
  del.addEventListener("click", function () {
    if (keyListEl.children.length <= 1) {
      // 至少留一行,清空即可
      input.value = "";
      return;
    }
    keyListEl.removeChild(row);
  });

  row.appendChild(input);
  row.appendChild(label);
  row.appendChild(del);
  return row;
}

/** 从界面读回 Key 列表 */
function collectKeyRows() {
  var out = [];
  for (var i = 0; i < keyListEl.children.length; i++) {
    var row = keyListEl.children[i];
    var value = row.querySelector('[data-role="key-value"]');
    var on    = row.querySelector('[data-role="key-enabled"]');
    out.push({ value: value ? value.value.trim() : "", enabled: !on || on.checked });
  }
  return out;
}

btnAddKey.addEventListener("click", function () {
  keyPools[currentProvider] = collectKeyRows();
  keyListEl.appendChild(makeKeyRow({ value: "", enabled: true }));
});
'''

s = s + APPEND
io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("settings.js", k, "=", v)

# ================= webpatch.js:意图识别 =================
p = "utils/webpatch.js"
s = io.open(p, encoding="utf-8").read()
n = {}

old = u'''/* ==================================================================
   4. 安全校验(供 content.js 执行器调用)
   ================================================================== */'''
new = u'''/* ==================================================================
   3c. 用户意图识别(第十四轮)
   ----------------------------------------------------------------
   聊天是核心:用户可能只是提问,也可能要改网页。
   只有出现明确的「修改动词」才判定为改网页,避免普通聊天擅自改页面。
   ================================================================== */

/** 明确表示「要修改」的动词 */
var INTENT_MODIFY_VERBS = [
  "改成", "改为", "换成", "换为", "变成", "调成", "调整成", "设置成", "设为", "设置为",
  "隐藏", "藏起来", "删掉", "删除", "去掉", "移除", "移走", "拿掉",
  "放大", "缩小", "调大", "调小", "加大", "减小", "变暗", "变亮", "加深",
  "替换", "重排", "重新排列", "重新整理", "改成卡片", "紧凑", "加粗", "居中",
  "只保留", "只看", "清理", "精简", "美化", "改暗", "改亮", "放大到", "缩小到",
];

/** 只是提问 / 分析的关键词 */
var INTENT_ASK_WORDS = [
  "讲了什么", "是什么", "什么意思", "总结", "概述", "介绍一下", "解释", "为什么",
  "怎么", "如何", "有多少", "什么内容", "分析一下", "读音", "翻译一下", "这段",
];

/**
 * 判断用户这句话想干什么
 * @param {string} text 用户输入
 * @returns {{intent:"chat"|"modify", reason:string, verb:string}}
 */
function classifyUserIntent(text) {
  var raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw) return { intent: "chat", reason: "空输入", verb: "" };

  // 只要有明确的修改动词 → 判定为修改网页
  for (var i = 0; i < INTENT_MODIFY_VERBS.length; i++) {
    if (raw.indexOf(INTENT_MODIFY_VERBS[i]) !== -1) {
      return { intent: "modify", reason: "出现修改动词", verb: INTENT_MODIFY_VERBS[i] };
    }
  }

  // 提问类关键词 → 只回答
  for (var j = 0; j < INTENT_ASK_WORDS.length; j++) {
    if (raw.indexOf(INTENT_ASK_WORDS[j]) !== -1) {
      return { intent: "chat", reason: "提问", verb: "" };
    }
  }

  // 其余(例如「这个网页太亮了」这种陈述)→ 先回答,并询问是否要改
  return { intent: "chat", reason: "没有明确修改意图", verb: "" };
}

/** 陈述句里暗示想改(用于追问「要我直接修改当前网页吗?」) */
function looksLikePageComplaint(text) {
  var raw = String(text || "");
  var words = ["太亮", "太暗", "太乱", "太挤", "不清晰", "看不清", "碍眼", "烦", "难看", "太大", "太小", "慢"];
  for (var i = 0; i < words.length; i++) {
    if (raw.indexOf(words[i]) !== -1) return true;
  }
  return false;
}

/* ==================================================================
   4. 安全校验(供 content.js 执行器调用)
   ================================================================== */'''
n["intent"] = s.count(old); s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("webpatch.js", k, "=", v)

# ================= content.js:倍速锁定 =================
p = "content/content.js"
s = io.open(p, encoding="utf-8").read()
n = {}

old = u'''const WP_RATE_KEEP_TRIES = 5;
const WP_RATE_RECHECK_MS = 500;'''
new = u'''const WP_RATE_KEEP_TRIES = 5;      // 普通「保持倍速」的重试上限
const WP_RATE_RECHECK_MS = 500;     // 设置后延迟复核
const WP_RATE_LOCK_INTERVAL = 1000; // 锁定模式的定时校验周期(低频,不用死循环)
const WP_RATE_LOCK_MIN_GAP = 250;   // 两次重设之间的最小间隔,避免和别人互相抢写'''
n["consts"] = s.count(old); s = s.replace(old, new, 1)

old = u'''function wpStopAllKeepRate() {'''
new = u'''/**
 * 锁定倍速:事件 + 低频定时校验(不是高频死循环)
 * 与「保持倍速」的区别:锁定会一直维持,直到撤销/恢复或用户重新设置倍速。
 */
function wpLockRate(el, rate) {
  wpUnlockRate(el);

  var state = {
    rate:      rate,
    locked:   true,
    reapply:  0,          // 重设次数(用于与其他脚本抢写时如实告知)
    last:     0,
    conflicts: 0,
    timer:    null,
    handler:  null,
  };

  state.handler = function () {
    if (!state.locked) return;
    if (Math.abs(el.playbackRate - state.rate) < 0.001) return;

    var now = Date.now();
    if (now - state.last < WP_RATE_LOCK_MIN_GAP) return;   // 间隔保护:不与人抢写
    state.last = now;
    state.reapply++;
    state.conflicts++;
    try { el.playbackRate = state.rate; } catch (e) { /* 忽略 */ }
  };

  try { el.addEventListener("ratechange", state.handler, true); } catch (e) { /* 忽略 */ }

  state.timer = setInterval(function () {
    if (!state.locked) return;
    if (Math.abs(el.playbackRate - state.rate) < 0.001) return;
    state.handler();
  }, WP_RATE_LOCK_INTERVAL);

  wpRateLocks.set(el, state);
  return state;
}

function wpUnlockRate(el) {
  var st = wpRateLocks.get(el);
  if (!st) return;
  st.locked = false;
  if (st.timer) { try { clearInterval(st.timer); } catch (e) {} }
  try { el.removeEventListener("ratechange", st.handler, true); } catch (e) {}
  wpRateLocks.delete(el);
}

function wpUnlockAllRates() {
  var els = [];
  wpRateLocks.forEach(function (v, k) { els.push(k); });
  for (var i = 0; i < els.length; i++) wpUnlockRate(els[i]);
}

/** 当前锁定状态(给 UI 显示) */
function wpRateLockReport() {
  var out = [];
  wpRateLocks.forEach(function (st, el) {
    out.push({
      id:        wpEnsureMediaRef(el),
      target:    st.rate,
      actual:    el.playbackRate,
      locked:    st.locked && Math.abs(el.playbackRate - st.rate) < 0.001,
      conflicts: st.conflicts,
    });
  });
  return out;
}

function wpStopAllKeepRate() {'''
n["lock"] = s.count(old); s = s.replace(old, new, 1)

old = u'''var wpRateKeepers = new Map();   // element -> { rate, tries, handler }'''
new = u'''var wpRateKeepers = new Map();   // element -> { rate, tries, handler }(保持倍速,有限次)
var wpRateLocks   = new Map();   // element -> 锁定状态(持续维持)'''
n["map"] = s.count(old); s = s.replace(old, new, 1)

# 锁定/保持清理:撤销与恢复时一并移除
old = u'''  wpStopAllKeepRate();      // 撤销时移除「保持倍速」监听'''
new = u'''  wpStopAllKeepRate();      // 撤销时移除「保持倍速」监听
  wpUnlockAllRates();       // 并解除倍速锁定'''
n["undo"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  wpStopAllKeepRate();      // 恢复网页时移除「保持倍速」监听'''
new = u'''  wpStopAllKeepRate();      // 恢复网页时移除「保持倍速」监听
  wpUnlockAllRates();       // 并解除倍速锁定'''
n["restore"] = s.count(old); s = s.replace(old, new, 1)

# wpFrameRunMedia:rate 时改为「只锁定主目标,其余只设一次」
old = u'''    // 倍速成功后挂上「保持倍速」
    if (r && r.ok && job.op === "rate" && job.keep !== false) {
      wpKeepRate(el, Number(job.value), WP_RATE_KEEP_TRIES);
    }'''
new = u'''    // 倍速:只对「主目标」(正在播放 / 可见 / 最大,排在第一个)锁定,
    // 其余媒体只设一次 —— 避免把页面上所有 video 都强制成同一个倍速
    if (r && r.ok && job.op === "rate" && job.keep !== false) {
      var isPrimary = (i === 0);

      if (job.lock === true && isPrimary) {
        wpLockRate(el, Number(job.value));
        r.detail = (r.detail || "") + "(已锁定)";
      } else if (isPrimary) {
        wpKeepRate(el, Number(job.value), WP_RATE_KEEP_TRIES);
      }
    }'''
n["lockinrun"] = s.count(old); s = s.replace(old, new, 1)

# 返回里带上锁定状态
old = u'''  return { ok: true, frame: location.href, results: results, applied: applied, failed: failed };'''
new = u'''  return {
    ok:      true,
    frame:   location.href,
    results: results,
    applied: applied,
    failed:  failed,
    locks:   wpRateLockReport(),
  };'''
n["return"] = s.count(old); s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("content.js", k, "=", v)

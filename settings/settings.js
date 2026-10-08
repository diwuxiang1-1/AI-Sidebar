// ============================================================
// AI Sidebar · 设置页面逻辑(第五阶段维护)
// ------------------------------------------------------------
// 服务商预设 → 自动 Base URL → 获取模型 → 下拉框选择
// ============================================================

"use strict";

/* ---- DOM ---- */
var configNameInput = document.getElementById("config-name");
var providerSelect  = document.getElementById("provider");
var keyListEl       = document.getElementById("key-list");
var btnAddKey       = document.getElementById("btn-add-key");
var keyPools        = {};        // provider → [{value, enabled}],不同服务商严格分开
var currentProvider = "custom";
var btnTest         = document.getElementById("btn-test");
var btnFetchModels  = document.getElementById("btn-fetch-models");
var modelSelect     = document.getElementById("model-select");
var modelTextGroup  = document.getElementById("model-text-group");
var modelTextInput  = document.getElementById("model-text");
var baseUrlInput    = document.getElementById("base-url");
var btnSave         = document.getElementById("btn-save");
var statusMsg       = document.getElementById("status-msg");

/* ---- DOM:上下文管理(第七阶段) ---- */
var pageMaxTokensSelect    = document.getElementById("page-max-tokens");
var customTokensGroup      = document.getElementById("custom-tokens-group");
var customTokensInput      = document.getElementById("custom-tokens");
var contextStatus          = document.getElementById("context-status");
var visionModeSelect       = document.getElementById("vision-mode");

/* ---- DOM:使用者语言(完整版) ---- */
var uiLangSelect           = document.getElementById("ui-lang");

/* ---- DOM:AI 权限(第十轮) ---- */
var permPageInput    = document.getElementById("perm-page");
var permBrowserInput = document.getElementById("perm-browser");
var permPageState    = document.getElementById("perm-page-state");
var permBrowserState = document.getElementById("perm-browser-state");
var permStatus       = document.getElementById("perm-status");

/* ---- 模型缓存 ---- */
var fetchedModels   = [];   // [{id, name}, ...] 从 API 获取的列表

/* ==================================================================
   1. 初始化:填充服务商下拉框 + 加载已有配置
   ================================================================== */
(function init() {
  // 填充服务商下拉框
  var ids = Object.keys(PROVIDER_PRESETS);
  for (var i = 0; i < ids.length; i++) {
    var id   = ids[i];
    var info = PROVIDER_PRESETS[id];
    var opt  = document.createElement("option");
    opt.value = id;
    opt.textContent = info.name;
    providerSelect.appendChild(opt);
  }

  // 服务商切换 → 自动填 Base URL + 清空模型列表
  providerSelect.addEventListener("change", function () {
    var id   = providerSelect.value;
    var info = PROVIDER_PRESETS[id];
    if (info) baseUrlInput.value = info.baseUrl;

    // 严格分池:先把当前编辑内容存回原 Provider,再切到新 Provider 的池
    keyPools[currentProvider] = collectKeyRows();
    currentProvider = id;
    renderKeyRows(normalizeKeyList(keyPools[id] && keyPools[id].length ? keyPools[id] : [{ value: "", enabled: true }]));

    // 切换服务商后清空模型缓存
    fetchedModels = [];
    modelSelect.innerHTML = '<option value="">选择模型或手动输入…</option>';
    modelTextGroup.style.display = "none";
    modelTextInput.value = "";
  });

  // 模型下拉框选择变化
  modelSelect.addEventListener("change", function () {
    if (modelSelect.value === "__manual__") {
      modelTextGroup.style.display = "";
      modelTextInput.focus();
    } else {
      modelTextGroup.style.display = "none";
    }
  });

  // 加载已保存配置
  initUiLanguage();
  loadSettings();
  loadContextSettings();
  loadPermissionSettings();
})();

async function loadSettings() {
  try {
    var config = await getApiConfig();

    configNameInput.value = config.configName || "";
    providerSelect.value  = config.provider  || "custom";

    // 显示已保存的 Base URL,切换服务商后触发 change 覆盖
    if (config.baseUrl) baseUrlInput.value = config.baseUrl;
    else {
      var info = PROVIDER_PRESETS[config.provider];
      if (info) baseUrlInput.value = info.baseUrl;
    }

    // 多 Key:当前 Provider 的池
    keyPools = (config.keyPools && typeof config.keyPools === "object") ? config.keyPools : {};
    currentProvider = config.provider || "custom";

    var pool = keyPools[currentProvider];
    renderKeyRows(normalizeKeyList(pool && pool.length ? pool : config.keys));

    // 如果有已保存的模型,加入下拉框
    if (config.model) {
      fetchedModels = [{ id: config.model, name: config.modelName || config.model }];
      populateModelDropdown(config.model);
    }
  } catch (e) {
    showStatus("无法读取本地配置: " + String(e), "error");
  }
}

/* ==================================================================
   2. 保存
   ================================================================== */
btnSave.addEventListener("click", async function () {
  // 以「界面当前正在编辑的 Provider」为准:下拉框的值理论上与它一致,
  // 但配置里的 provider 可能在下拉框里没有对应项(取值为空),那时以 currentProvider 兜底
  var provider   = currentProvider || providerSelect.value || "custom";
  var baseUrl    = baseUrlInput.value.trim();
  var modelId    = resolveModelId();

  keyPools[provider] = collectKeyRows();     // 先把界面上的内容收进池
  var pool       = keyPools[provider] || [];
  var enabled    = pool.filter(function (k) { return k.enabled && k.value; });

  if (!enabled.length) { showStatus("请至少填写一个启用的 API Key", "error"); return; }
  if (!baseUrl) { showStatus("请填写 API Base URL(或选择服务商后自动填写)", "error"); return; }
  if (!modelId) { showStatus("请选择或手动输入模型", "error"); return; }

  var config = {
    configName: configNameInput.value.trim(),
    provider:   provider,
    baseUrl:    baseUrl,
    keys:       pool,                     // 当前 Provider 的池
    keyPools:   keyPools,                 // 每个 Provider 各自的池
    model:      modelId,
    modelName:  resolveModelName(modelId),
  };

  try {
    await saveApiConfig(config);
    showStatus("配置已保存", "ok");
  } catch (e) {
    showStatus("保存失败: " + String(e), "error");
  }
});

/* ==================================================================
   3. 测试连接 —— 使用当前页面上的 Base URL / Key / Model
   ================================================================== */
btnTest.addEventListener("click", async function () {
  var baseUrl = baseUrlInput.value.trim();
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

  showStatus("正在测试连接…(使用 " + maskApiKey(apiKey) + ")", "info");

  try {
    await testConnection({ baseUrl: baseUrl, apiKey: apiKey, model: modelId });
    showStatus("连接成功 —— API 可正常访问", "ok");
  } catch (e) {
    var msg = e.isApiError ? e.message : "无法连接: " + (e.message || String(e));
    showStatus(msg, "error");
  }
});

/* ==================================================================
   4. 获取模型列表 —— GET {baseUrl}/models
   ================================================================== */
btnFetchModels.addEventListener("click", async function () {
  var baseUrl = baseUrlInput.value.trim();
  var pool    = keyPools[currentProvider] || [];
  var apiKey  = "";
  for (var kj = 0; kj < pool.length; kj++) {
    if (pool[kj].enabled && pool[kj].value) { apiKey = pool[kj].value; break; }
  }

  if (!baseUrl) { showStatus("请先选择服务商或填写 Base URL", "error"); return; }
  if (!apiKey)  { showStatus("请先填写至少一个启用的 API Key", "error"); return; }

  showStatus("正在获取模型列表…", "info");
  btnFetchModels.disabled = true;

  try {
    var models = await fetchModels({ baseUrl: baseUrl, apiKey: apiKey });
    fetchedModels = models;
    populateModelDropdown();

    showStatus("已获取 " + models.length + " 个模型,请从下拉框选择", "ok");
  } catch (e) {
    var msg = e.isApiError ? e.message : "获取失败: " + (e.message || String(e));
    showStatus(msg, "error");
  } finally {
    btnFetchModels.disabled = false;
  }
});

/* ==================================================================
   辅助
   ================================================================== */

/** 填充模型下拉框 */
function populateModelDropdown(preSelectedId) {
  modelSelect.innerHTML = "";

  if (fetchedModels.length === 0) {
    var emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "选择模型或手动输入…";
    modelSelect.appendChild(emptyOpt);
  }

  for (var i = 0; i < fetchedModels.length; i++) {
    var m = fetchedModels[i];
    var opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name || m.id;
    if (preSelectedId && m.id === preSelectedId) opt.selected = true;
    modelSelect.appendChild(opt);
  }

  var manualOpt = document.createElement("option");
  manualOpt.value = "__manual__";
  manualOpt.textContent = "▸ 手动输入…";
  modelSelect.appendChild(manualOpt);

  // 恢复手动输入
  if (preSelectedId && !fetchedModels.some(function (m) { return m.id === preSelectedId; })) {
    modelTextGroup.style.display = "";
    modelTextInput.value = preSelectedId;
    modelSelect.value = "__manual__";
  }
}

/** 确定当前模型 ID:优先下拉框,如果选"手动输入"则取文本框 */
function resolveModelId() {
  if (modelSelect.value === "__manual__") {
    return modelTextInput.value.trim();
  }
  return modelSelect.value;
}

/** 确定模型显示名 */
function resolveModelName(modelId) {
  for (var i = 0; i < fetchedModels.length; i++) {
    if (fetchedModels[i].id === modelId) return fetchedModels[i].name;
  }
  return modelId; // fallback:用 ID 作为显示名
}

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className   = "status-msg " + (type === "ok" ? "ok" : type === "error" ? "error" : "info");
}

/* ==================================================================
   5. 上下文管理(第七阶段)—— 修改后自动保存,与 API 配置相互独立
   ================================================================== */

/** 读取已保存的上下文配置并填充界面 */
/** 使用者语言:填充下拉框 + 读取当前值 + 绑定保存 */
function initUiLanguage() {
  if (!uiLangSelect || typeof I18N_LANGS === "undefined") return;

  for (var i = 0; i < I18N_LANGS.length; i++) {
    var opt = document.createElement("option");
    opt.value = I18N_LANGS[i].id;
    opt.textContent = I18N_LANGS[i].name;
    uiLangSelect.appendChild(opt);
  }

  getUiLang().then(function (lang) {
    uiLangSelect.value = lang;
    applyI18n(document, lang);
  });

  uiLangSelect.addEventListener("change", function () {
    var lang = uiLangSelect.value;
    saveUiLang(lang).then(function () {
      applyI18n(document, lang);
      showStatus("界面语言已切换。侧边栏需要重新打开才会全部生效。", "ok");
    });
  });
}

async function loadContextSettings() {
  try {
    var cfg = await getContextConfig();
    var v   = cfg.pageMaxTokens;

    if (CONTEXT_PRESETS.indexOf(v) !== -1) {
      pageMaxTokensSelect.value = String(v);
      customTokensGroup.style.display = "none";
    } else {
      pageMaxTokensSelect.value = "custom";
      customTokensGroup.style.display = "";
      customTokensInput.value = String(v);
    }

    if (visionModeSelect) visionModeSelect.value = cfg.visionMode || "auto";
  } catch (e) {
    showContextStatus("无法读取上下文设置: " + String(e), "error");
  }
}

/**
 * 保存上下文配置
 * @param {boolean} silent 为 true 时成功不提示(用于输入过程中的自动保存)
 */
async function saveContextSettings(silent) {
  var tokens;

  if (pageMaxTokensSelect.value === "custom") {
    tokens = parseInt(customTokensInput.value, 10);
    if (!isFinite(tokens) || tokens < CONTEXT_MIN_TOKENS) {
      showContextStatus("自定义上限至少 " + CONTEXT_MIN_TOKENS + " tokens", "error");
      return;
    }
    if (tokens > CONTEXT_MAX_TOKENS) tokens = CONTEXT_MAX_TOKENS;
  } else {
    tokens = parseInt(pageMaxTokensSelect.value, 10);
  }

  try {
    await saveContextConfig({
      pageMaxTokens:     tokens,
      visionMode:        visionModeSelect ? visionModeSelect.value : "auto",
    });
    if (!silent) showContextStatus("上下文设置已保存", "ok");
  } catch (e) {
    showContextStatus("保存失败: " + String(e), "error");
  }
}

function showContextStatus(text, type) {
  contextStatus.textContent = text;
  contextStatus.className   = "context-status " + (type === "error" ? "error" : "ok");
}

/* ---- 变更即保存 ---- */
pageMaxTokensSelect.addEventListener("change", function () {
  var isCustom = pageMaxTokensSelect.value === "custom";
  customTokensGroup.style.display = isCustom ? "" : "none";

  if (isCustom) {
    if (!customTokensInput.value) {
      customTokensInput.value = String(DEFAULT_CONTEXT_CONFIG.pageMaxTokens);
    }
    customTokensInput.focus();
  }
  saveContextSettings();
});

if (visionModeSelect) visionModeSelect.addEventListener("change", function () { saveContextSettings(); });

var customTokensTimer = null;
customTokensInput.addEventListener("input", function () {
  if (customTokensTimer) clearTimeout(customTokensTimer);
  customTokensTimer = setTimeout(function () { saveContextSettings(true); }, 500);
});

/* ==================================================================
   6. AI 权限(第十轮)—— 两个等级相互独立,改动即时保存
   ================================================================== */

async function loadPermissionSettings() {
  try {
    var perms = await getPermissions();
    permPageInput.checked    = perms.page === true;
    permBrowserInput.checked = perms.browser === true;
    updatePermissionLabels(perms);
  } catch (e) {
    permStatus.textContent = "无法读取权限设置: " + String(e);
    permStatus.className   = "context-status error";
  }
}

function updatePermissionLabels(perms) {
  permPageState.textContent    = perms.page ? "开启" : "关闭";
  permBrowserState.textContent = perms.browser ? "开启" : "关闭";
}

async function onPermissionChange() {
  var perms = { page: permPageInput.checked, browser: permBrowserInput.checked };

  try {
    await savePermissions(perms);
    updatePermissionLabels(perms);
    permStatus.textContent = "已保存。当前 AI 权限:" + describePermissionLevel(perms) +
      (perms.browser ? " —— 请确认你信任当前使用的模型与服务。" : "");
    permStatus.className = "context-status ok";
  } catch (e) {
    permStatus.textContent = "保存失败: " + String(e);
    permStatus.className   = "context-status error";
  }
}

permPageInput.addEventListener("change", onPermissionChange);
permBrowserInput.addEventListener("change", onPermissionChange);

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

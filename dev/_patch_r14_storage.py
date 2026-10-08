# -*- coding: utf-8 -*-
# 一次性补丁(第十四轮 · A):storage.js 多 Key 结构 + 设置页多 Key UI

import io

# ---------------- storage.js ----------------
p = "utils/storage.js"
s = io.open(p, encoding="utf-8").read()
n = {}

old = u'''  keys:       [""],'''
new = u'''  keys:       [{ value: "", enabled: true }],   // 当前 Provider 的 Key 池(旧字符串数组会自动规范化)
  keyPools:   {},                                // provider → Key 池,不同服务商严格分开'''
n["default"] = s.count(old); s = s.replace(old, new, 1)

old = u'''  if (!Array.isArray(merged.keys)) merged.keys = [""];
  return merged;
}'''
new = u'''  // 规范化:字符串数组(旧格式)→ { value, enabled }
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
}'''
n["normalize"] = s.count(old); s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("storage", k, "=", v)

# ---------------- settings.html ----------------
p = "settings/settings.html"
s = io.open(p, encoding="utf-8").read()
n = {}

old = u'''  <!-- API Key -->
  <div class="form-group">
    <label for="api-key">API Key</label>
    <input id="api-key" type="password" placeholder="sk-..." />
  </div>'''
new = u'''  <!-- API Key(支持同一服务商多个 Key) -->
  <div class="form-group">
    <label>API Key</label>
    <div id="key-list" class="key-list"></div>
    <button id="btn-add-key" class="btn" type="button" style="width:100%;margin-top:6px;">+ 添加 API Key</button>
  </div>'''
n["keyui"] = s.count(old); s = s.replace(old, new, 1)

old = u'''    <ul class="info-note-list">
      <li>API Key 对应上方选择的<strong>服务商 / Base URL / 模型</strong>,换服务商时请一并更换 Key。</li>
      <li>本版本<strong>只使用一个 Key</strong>:保存时会写入配置里的第一个位置。</li>
      <li>配置结构里已<strong>预留多 Key 数组</strong>,但界面上还没有「添加多个 Key」「启用 / 停用某个 Key」以及自动轮询、自动切换、并发请求等功能;填多个也不会生效。</li>
      <li>请<strong>不要混用不同服务商的 Key</strong>(例如把 DeepSeek 的 Key 和 OpenAI 的 Key 当同一个用),它们对应的地址与模型不同。</li>
      <li>后续版本才会实现多 Key 轮询;届时以「设置 → AI 权限 / API 配置」中的实际说明为准。</li>
    </ul>'''
new = u'''    <ul class="info-note-list">
      <li>可添加多个<strong>同一服务商</strong>的 API Key。</li>
      <li>启用多个 Key 后,请求会<strong>按填写顺序轮询</strong>(每个启用的 Key 依次尝试)。</li>
      <li>当前 Key 请求失败时,会<strong>尝试下一个已启用 Key</strong>;单次请求每个 Key 最多尝试一次,不会无限重试。</li>
      <li>全部 Key 都失败时,返回<strong>最后一个真实错误</strong>。</li>
      <li>被<strong>停用</strong>的 Key 不参与轮询。</li>
      <li>不同服务商的 Key <strong>不会混用</strong>:每个服务商有各自的 Key 池,换服务商会切换到对应的池。</li>
      <li>轮询位置不写入配置 —— 每次都从第一个启用的 Key 开始。</li>
    </ul>'''
n["note"] = s.count(old); s = s.replace(old, new, 1)

old = u'''    /* 说明信息块(第十三轮) */'''
new = u'''    /* 多 Key 列表(第十四轮) */
    .key-list { display: flex; flex-direction: column; gap: 6px; }
    .key-row { display: flex; align-items: center; gap: 6px; }
    .key-row input[type="password"] { flex: 1; min-width: 0; }
    .key-row .key-toggle { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #6e7681; white-space: nowrap; }
    .key-row input[type="checkbox"] { width: auto; margin: 0; }
    .key-row .key-del { padding: 4px 8px; font-size: 12px; }
    .key-row.disabled input[type="password"] { opacity: 0.5; }

    /* 说明信息块(第十三轮) */'''
n["css"] = s.count(old); s = s.replace(old, new, 1)

old = u'''      .info-note { border-color: rgba(87,134,246,0.35); background: #20253b; color: #e8eaed; }'''
new = u'''      .info-note { border-color: rgba(87,134,246,0.35); background: #20253b; color: #e8eaed; }
      .key-row .key-toggle { color: #9aa0a6; }'''
n["cssdark"] = s.count(old); s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("settings.html", k, "=", v)

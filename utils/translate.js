// ============================================================
// AI Sidebar · 网页翻译逻辑模块(第七轮 · 新增)
// ------------------------------------------------------------
// 纯逻辑:不接触 DOM、不发网络请求。经典脚本(非 ES module)。
//
// 职责:
//   1. 翻译配置读写(目标语言 / 翻译方式,独立 storage key)
//   2. 翻译提示词构造(意思翻译 / 专业术语两种方式)
//   3. 批量翻译结果解析([TEXT_001] 编号 → 文本)
//   4. 单批 token / 字符预算(复用上下文长度配置作为上限)
//
// 分工:
//   - DOM 收集与替换 → content/content.js
//   - 请求与流程编排 → sidebar/sidebar.js
//
// 加载顺序:utils/storage.js → providers → utils/context.js → 本文件 → sidebar.js
// ============================================================

"use strict";

/* ==================================================================
   1. 翻译配置(独立 storage key)
   ================================================================== */

var TRANSLATE_CONFIG_KEY = "ai-sidebar:translate-config";

/** 目标语言(第一版提供常见语言,默认中文) */
var TRANSLATE_LANGS = [
  { id: "zh", name: "中文" },
  { id: "en", name: "英文" },
  { id: "ja", name: "日文" },
  { id: "ko", name: "韩文" },
  { id: "fr", name: "法文" },
  { id: "de", name: "德文" },
  { id: "es", name: "西班牙文" },
  { id: "ru", name: "俄文" },
];

/** 翻译方式(只保留两种容易理解的) */
var TRANSLATE_MODES = [
  { id: "natural",   name: "意思翻译" },
  { id: "technical", name: "专业术语" },
];

var DEFAULT_TRANSLATE_CONFIG = {
  lang: "zh",
  mode: "natural",
};

/**
 * 单批源文本 token 上限
 * 翻译的输出长度≈输入长度,批次过大容易超出模型单次输出上限,
 * 因此这里比上下文长度配置更保守,再由用户的上下文配置兜底压低。
 */
var TRANSLATE_BATCH_TOKENS     = 1200;
var TRANSLATE_BATCH_MIN_TOKENS = 800;
var TRANSLATE_BATCH_MAX_CHARS  = 6000;

async function getTranslateConfig() {
  var data   = await chrome.storage.local.get(TRANSLATE_CONFIG_KEY);
  var stored = data[TRANSLATE_CONFIG_KEY];
  if (!stored || typeof stored !== "object") stored = {};

  var merged = {};
  for (var k in DEFAULT_TRANSLATE_CONFIG) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_TRANSLATE_CONFIG, k)) {
      merged[k] = (stored[k] === undefined) ? DEFAULT_TRANSLATE_CONFIG[k] : stored[k];
    }
  }

  // 非法值回落到默认,避免旧数据/脏数据导致界面空白
  if (!findById(TRANSLATE_LANGS, merged.lang)) merged.lang = DEFAULT_TRANSLATE_CONFIG.lang;
  if (!findById(TRANSLATE_MODES, merged.mode)) merged.mode = DEFAULT_TRANSLATE_CONFIG.mode;

  return merged;
}

async function saveTranslateConfig(config) {
  var obj = {};
  obj[TRANSLATE_CONFIG_KEY] = config;
  await chrome.storage.local.set(obj);
}

function findById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/** 语言显示名(找不到时回退原值) */
function translateLangName(id) {
  var item = findById(TRANSLATE_LANGS, id);
  return item ? item.name : (id || "");
}

/** 翻译方式显示名 */
function translateModeName(id) {
  var item = findById(TRANSLATE_MODES, id);
  return item ? item.name : (id || "");
}

/* ==================================================================
   2. 单批预算
   ----------------------------------------------------------------
   复用「上下文管理」里的网页上下文长度作为上限参考:
   用户把上下文调小,翻译批次也相应变小,避免出现异常大的单次请求。
   ================================================================== */

function resolveBatchBudget(pageMaxTokens) {
  var ceiling = parseInt(pageMaxTokens, 10);
  if (!isFinite(ceiling) || ceiling <= 0) ceiling = TRANSLATE_BATCH_TOKENS;

  var tokens = Math.min(TRANSLATE_BATCH_TOKENS, Math.max(TRANSLATE_BATCH_MIN_TOKENS, ceiling));
  return { tokens: tokens, chars: TRANSLATE_BATCH_MAX_CHARS };
}

/* ==================================================================
   3. 提示词
   ================================================================== */

/**
 * 翻译系统提示词
 * @param {string} langId 目标语言 id
 * @param {string} modeId 翻译方式 id
 */
function buildTranslateSystemPrompt(langId, modeId) {
  var lang = translateLangName(langId);

  var lines = [];
  lines.push("你是网页翻译引擎。把用户提供的、带 [TEXT_001] 这类编号的网页文字翻译成" + lang + "。");
  lines.push("");
  lines.push("翻译要求:");
  lines.push("1. 准确传达原意,不遗漏信息,不擅自添加信息");
  lines.push("2. 用自然流畅的" + lang + "表达,不要逐字机械替换");
  lines.push("3. 结合网页语境判断词义(同一句可能是标题、按钮、菜单或正文)");
  lines.push("4. 专业术语使用业界通行译法,整页保持一致");
  lines.push("5. 不翻译代码:变量名、函数名、类名、命令行、文件路径、配置项保持原样");
  lines.push("6. 不改动 URL、邮箱地址");
  lines.push("7. 不改动数字、日期、时间、单位、金额等事实信息");
  lines.push("8. 品牌名、产品名、专有名词可保留原文");
  lines.push("9. 已经是" + lang + "的内容原样返回,不要改写");
  lines.push("10. 只输出翻译结果:不要解释、不要加注、不要重复原文、不要输出思考过程");

  if (modeId === "technical") {
    lines.push("");
    lines.push("本页属于技术 / 软件 / 专业内容:术语必须准确,同一术语在整页保持完全一致的译法;");
    lines.push("业界通用缩写(如 API、HTTP、JSON、SDK)可保留英文原文。");
  } else {
    lines.push("");
    lines.push("本页按「意思翻译」处理:先理解整句含义,再用最自然的目标语言表达,允许调整语序和句式,");
    lines.push("但不得改变原意、不得增删信息。");
  }

  lines.push("");
  lines.push("输出格式:每条一行,严格保留原编号与顺序,不要输出多余空行:");
  lines.push("[TEXT_001] 翻译结果");
  lines.push("[TEXT_002] 翻译结果");

  return lines.join("\n");
}

/**
 * 翻译用户消息 —— 把一批文本按编号拼成待翻译内容
 * @param {Array<{id:number, text:string}>} items
 */
function buildTranslateUserPrompt(items) {
  var lines = [];
  for (var i = 0; i < items.length; i++) {
    lines.push("[TEXT_" + padNumber(items[i].id, 3) + "] " + collapseWhitespace(items[i].text));
  }
  return lines.join("\n");
}

function padNumber(n, width) {
  var s = String(n);
  while (s.length < width) s = "0" + s;
  return s;
}

/** 折叠空白:HTML 渲染本身会折叠空白,这样可避免译文按行解析时错位 */
function collapseWhitespace(text) {
  return String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim();
}

/* ==================================================================
   4. 结果解析
   ----------------------------------------------------------------
   只认编号,不做「第几行」这类脆弱匹配:
   模型多输出、少输出、顺序打乱都能正确对应;编号缺失则判定本批失败。
   ================================================================== */

/**
 * @param {string} raw 模型返回的原始文本
 * @param {number} expectedCount 本批期望的条目数
 * @returns {{ok:boolean, map:Object, found:number, missing:number[], reason:string}}
 */
function parseTranslateResponse(raw, expectedCount) {
  var result = { ok: false, map: {}, found: 0, missing: [], reason: "" };

  if (typeof raw !== "string" || !raw.trim()) {
    result.reason = "模型返回为空";
    return result;
  }

  var text = raw.replace(/\r\n?/g, "\n");
  // 去掉可能包裹的 markdown 代码块
  text = text.replace(/^\s*```[a-zA-Z0-9_-]*[ \t]*\n?/, "").replace(/\n?[ \t]*```\s*$/, "");

  var lines   = text.split("\n");
  var entries = [];
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var marker = matchTextMarker(line);

    if (marker) {
      current = { id: marker.id, parts: [marker.rest] };
      entries.push(current);
    } else if (current && line.trim() !== "") {
      // 译文内部换行:续接到上一条
      current.parts.push(line);
    }
    // 编号出现前的内容一律忽略(通常是模型的开场白)
  }

  var map   = {};
  var order = [];
  for (var j = 0; j < entries.length; j++) {
    var entry = entries[j];
    if (Object.prototype.hasOwnProperty.call(map, entry.id)) continue;  // 重复编号只取第一条
    map[entry.id] = entry.parts.join("\n").trim();
    order.push(entry.id);
  }

  // 容错:本批只有一条、模型直接返回译文而没写编号
  if (order.length === 0 && expectedCount === 1) {
    var plain = text.trim();
    if (plain) {
      map   = { 1: plain };
      order = [1];
    }
  }

  if (order.length === 0) {
    result.reason = "返回格式无法识别(没有找到 [TEXT_xxx] 编号)";
    return result;
  }

  for (var k = 1; k <= expectedCount; k++) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) result.missing.push(k);
  }

  result.map   = map;
  result.found = order.length;
  result.ok    = true;
  return result;
}

/**
 * 匹配一行开头的编号:[TEXT_001] / 【TEXT_001】 / TEXT_001: / TEXT-001
 */
function matchTextMarker(line) {
  if (!line) return null;

  var m = /^[ \t]*[[【][ \t]*TEXT[ _-]?(\d{1,4})[ \t]*[\]】][ \t]*(.*)$/i.exec(line);
  if (m) return { id: parseInt(m[1], 10), rest: m[2] };

  m = /^[ \t]*TEXT[ _-]?(\d{1,4})[ \t]*[:：][ \t]*(.*)$/i.exec(line);
  if (m) return { id: parseInt(m[1], 10), rest: m[2] };

  return null;
}

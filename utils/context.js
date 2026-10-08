// ============================================================
// AI Sidebar · 上下文控制与 Token 截断(第七阶段 · 新增模块)
// ------------------------------------------------------------
// 本文件是纯新增模块,不修改 storage.js / provider / content / background
// 的任何既有约定。经典脚本(非 ES module),通过全局函数通信。
//
// 职责:
//   1. 上下文配置读写 —— 独立 storage key,不混入 API 配置与会话数据结构
//   2. Token 近似估算 —— 仅用于「超长截断」这一个目的,不向用户显示任何估算数字
//   3. 按 token 上限截断文本 —— 二分查找,保证结果不超过上限
//
// 加载顺序:utils/storage.js → providers/openai-compatible.js → 本文件 → sidebar.js
//
// ⚠️ 本文件**不产出任何给用户看的用量/费用数字**。
//    回复下方的用量一律来自 API 返回的 usage(见 sidebar.js 的 renderUsageBar),
//    本地估算只用来决定「正文截到多长」,猜出来的数字不展示。
// ============================================================

"use strict";

/* ==================================================================
   1. 上下文配置(独立存储 key,不与其他数据结构混用)
   ================================================================== */

var CONTEXT_CONFIG_KEY = "ai-sidebar:context-config";

/** 设置页下拉框预设值(与 settings.html 的 option value 一致) */
var CONTEXT_PRESETS = [2000, 4000, 8000, 16000];

/** 默认配置:网页正文最多按 4000 tokens 注入,截图按需 */
var DEFAULT_CONTEXT_CONFIG = {
  pageMaxTokens:     4000,
  /* 视觉上下文模式:
       auto —— 只有问题明显需要「看」页面时才附截图(默认)
       on   —— 开着「当前网页」时总是附截图
       off  —— 从不附截图                                            */
  visionMode:        "auto",
};

/** 自定义上限的合法范围 */
var CONTEXT_MIN_TOKENS = 500;
var CONTEXT_MAX_TOKENS = 200000;

/**
 * 读取上下文配置 —— 缺失字段用默认值补齐,旧数据自动兼容
 */
async function getContextConfig() {
  var data   = await chrome.storage.local.get(CONTEXT_CONFIG_KEY);
  var stored = data[CONTEXT_CONFIG_KEY];
  if (!stored || typeof stored !== "object") stored = {};

  var merged = {};
  for (var k in DEFAULT_CONTEXT_CONFIG) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_CONTEXT_CONFIG, k)) {
      merged[k] = (stored[k] === undefined) ? DEFAULT_CONTEXT_CONFIG[k] : stored[k];
    }
  }

  // 数值兜底:非法值回落到默认,并夹到合法区间
  var n = parseInt(merged.pageMaxTokens, 10);
  if (!isFinite(n) || n < CONTEXT_MIN_TOKENS) n = DEFAULT_CONTEXT_CONFIG.pageMaxTokens;
  if (n > CONTEXT_MAX_TOKENS) n = CONTEXT_MAX_TOKENS;
  merged.pageMaxTokens = n;

  if (["auto", "on", "off"].indexOf(merged.visionMode) === -1) {
    merged.visionMode = DEFAULT_CONTEXT_CONFIG.visionMode;
  }

  return merged;
}

/**
 * 保存上下文配置
 */
async function saveContextConfig(config) {
  var obj = {};
  obj[CONTEXT_CONFIG_KEY] = config;
  await chrome.storage.local.set(obj);
}

/* ==================================================================
   2. Token 近似估算(仅供截断使用)
   ----------------------------------------------------------------
   不追求精确(不同模型分词器差异很大),目标是「偏保守、不超限」:
   中日韩字符按 1 字 ≈ 1 token 计,其余字符按 4 字符 ≈ 1 token 计。
   结果只用于 truncateTextToTokens 决定截断位置,**不作为用量展示给用户**。
   ================================================================== */

/** 判断是否宽字符(中日韩文字、全角标点等,通常 1 字符 ≈ 1 token) */
function isWideChar(code) {
  return (
    (code >= 0x3000 && code <= 0x303f) ||  // CJK 标点
    (code >= 0x3040 && code <= 0x30ff) ||  // 日文假名
    (code >= 0x3400 && code <= 0x4dbf) ||  // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) ||  // CJK 基本区
    (code >= 0xac00 && code <= 0xd7af) ||  // 韩文音节
    (code >= 0xf900 && code <= 0xfaff) ||  // CJK 兼容表意
    (code >= 0xff00 && code <= 0xffef)     // 全角字符
  );
}

/**
 * 估算一段文本的 token 数
 */
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text !== "string") text = String(text);

  var wide   = 0;
  var narrow = 0;
  for (var i = 0; i < text.length; i++) {
    if (isWideChar(text.charCodeAt(i))) wide++;
    else narrow++;
  }
  return Math.ceil(wide + narrow / 4);
}

/* ==================================================================
   视觉上下文(完整版)
   ----------------------------------------------------------------
   为什么需要:
     用户眼睛能看到的东西,DOM 文本不一定拿得到 —— 图片里的字、红色报错、
     按钮位置、排版错乱、图表。这些只能靠截图看。
   原则:
     · **按需**截图,不是每次都发(省 token、省时间)
     · 不回退成「假成功」:模型不支持视觉就明确说,并退回文本上下文
     · 截图只存在于本次请求里,**不写进会话历史**
   ================================================================== */

/** 名字里带这些片段的模型,认为支持图片输入 */
var VISION_MODEL_HINTS = [
  "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision", "gpt-5", "o1", "o3", "o4",
  "claude-3", "claude-4", "claude-sonnet", "claude-opus", "claude-haiku",
  "gemini", "gemma-3",
  "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl", "qvq",
  "glm-4v", "glm-4.5v", "cogvlm",
  "internvl", "llava", "minicpm-v", "pixtral", "molmo", "idefics",
  "step-1v", "yi-vision", "deepseek-vl", "doubao-vision", "vision",
];

/**
 * 这个模型是否（很可能）支持图片输入
 * 说明:这是**基于模型名的启发式判断**,不是权威能力表。
 *       判错时的兜底见 sidebar 的「图片被拒绝就退回纯文本重试」。
 */
function modelSupportsVision(modelId) {
  var id = String(modelId || "").toLowerCase();
  if (!id) return false;
  for (var i = 0; i < VISION_MODEL_HINTS.length; i++) {
    if (id.indexOf(VISION_MODEL_HINTS[i]) !== -1) return true;
  }
  return false;
}

/**
 * 用户这句话是不是「需要看页面才能答」的
 * 只有命中才自动附截图 —— 纯文字问题不该浪费一次截图和一堆 token。
 */
var VISUAL_HINT_WORDS = [
  // 明确要求看
  "截图", "截个图", "看一下", "看看", "帮我看看", "看一眼", "看图",
  // 视觉指代
  "这个页面", "这个网页", "当前页面", "页面上", "屏幕上", "界面", "页面布局", "排版",
  "长什么样", "什么样", "什么样子", "显示成", "显示为", "显示的是",
  // 视觉特征
  "红色", "红字", "绿色", "黄色", "蓝色", "颜色", "高亮", "标红",
  "图标", "按钮在哪", "在哪里", "位置", "挡住了", "遮住", "重叠", "错位", "乱码",
  "图片里", "图里", "图中", "图表", "表格里", "海报", "照片",
  // 状态类
  "什么情况", "怎么回事", "为什么显示", "为什么这样", "为什么变成这样", "出了什么问题",
  "报错了吗", "提示什么", "弹窗",
];

function needsVisualContext(text) {
  var raw = String(text || "").trim();
  if (!raw || raw.length > 200) return false;

  for (var i = 0; i < VISUAL_HINT_WORDS.length; i++) {
    if (raw.indexOf(VISUAL_HINT_WORDS[i]) !== -1) return true;
  }
  return false;
}

/**
 * 把 base64 图片数据包成 OpenAI 兼容的 multimodal 消息片段
 * @param {string} dataUrl 形如 data:image/jpeg;base64,xxxx
 */
function buildImagePart(dataUrl, detail) {
  return {
    type: "image_url",
    image_url: { url: String(dataUrl || ""), detail: detail || "auto" },
  };
}

/** 截图说明(放进请求里,让模型知道这张图是什么、什么时候拍的) */
function buildScreenshotNote(pageInfo) {
  var info = pageInfo || {};
  return "【当前网页截图】以下图片是用户此刻在浏览器里看到的画面" +
    (info.title ? "(网页标题:" + info.title + ")" : "") +
    (info.url ? "(地址:" + info.url + ")" : "") +
    "。请把它当作「用户眼睛看到的内容」来理解;如果问题涉及视觉信息(颜色、位置、图片里的文字、排版、弹窗),以截图为准," +
    "截图与文字内容不一致时,说明页面可能有动态内容或渲染差异。";
}

/* ==================================================================
   3. 按 token 上限截断
   ================================================================== */

/**
 * 将文本截断到不超过 maxTokens
 * 用二分查找定位最大可保留长度,避免逐字符累积带来的误差。
 *
 * @returns {{text:string, truncated:boolean, originalTokens:number, keptTokens:number}}
 */
function truncateTextToTokens(text, maxTokens) {
  text = text || "";
  var limit = parseInt(maxTokens, 10);
  if (!isFinite(limit) || limit <= 0) limit = DEFAULT_CONTEXT_CONFIG.pageMaxTokens;

  var originalTokens = estimateTokens(text);
  if (originalTokens <= limit) {
    return {
      text:           text,
      truncated:      false,
      originalTokens: originalTokens,
      keptTokens:     originalTokens,
    };
  }

  var lo = 0;
  var hi = text.length;
  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }

  var kept = text.slice(0, lo);
  return {
    text:           kept,
    truncated:      true,
    originalTokens: originalTokens,
    keptTokens:     estimateTokens(kept),
  };
}

/**
 * 截断提示 —— 让模型知道内容被限制过
 */
function buildPageTruncationNote(originalTokens, limitTokens) {
  return "\n\n[网页内容已截断]\n原始长度:" + formatNumber(originalTokens) + " tokens\n" +
    "当前限制:" + formatNumber(limitTokens) + " tokens";
}

/* ==================================================================
   数字格式化
   ----------------------------------------------------------------
   只服务于「截断提示」里的长度数字(千分位)。
   ================================================================== */

/** 千分位 */
function formatNumber(n) {
  var v = Number(n);
  if (!isFinite(v)) return "0";
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* ==================================================================
   用量与费用(收尾轮 + 支持项目轮)
   ----------------------------------------------------------------
   本地价格表、费用推算、**以及给用户看的 Token 估算栏**全部移除。原因:
     · 各家价格随时变,写死在扩展里的表一定会过时;
     · 用估算 token 推算出来的金额看着像真的,实际是错的 —— 比不显示更糟。
   现在只显示服务商在 usage 里**直接返回**的用量与费用
   (见 providers/openai-compatible.js 与 sidebar.js 的 renderUsageBar)。
   本文件里的 estimateTokens 只用于截断定位,不产生任何用户可见数字。
   ================================================================== */

// ============================================================
// AI Sidebar · 内容脚本(第三阶段)
// ------------------------------------------------------------
// 在主页面上下文中运行。
// 负责提取当前网页的结构化信息:
//   - 标题、URL
//   - 可见文本(innerText)
//   - 选中的文字
//   - 链接数量
//   - 图片、视频、音频数量
//
// 通过 chrome.runtime.onMessage 接收后台的查询请求,
// 提取数据后同步返回结果。
// ============================================================

"use strict";

/* ------------------------------------------------------------------
   消息类型 —— 与 background/service-worker.js 及 sidebar/sidebar.js 一致
   ------------------------------------------------------------------ */
const MSG = {
  GET_PAGE_INFO:    "ai-sidebar:get-page-info",
  GET_PAGE_TEXT:    "ai-sidebar:get-page-text",
  GET_SELECTED_TEXT:  "ai-sidebar:get-selected-text",
  SELECTION_CHANGED: "ai-sidebar:selection-changed",
  /* 网页资源(第八轮) */
  GET_PAGE_RESOURCES: "ai-sidebar:get-page-resources",
  /* AI 网页修改(第九轮) */
  PATCH_ANALYZE:  "ai-sidebar:patch-analyze",
  PATCH_APPLY:    "ai-sidebar:patch-apply",
  PATCH_UNDO:     "ai-sidebar:patch-undo",
  PATCH_RESTORE:  "ai-sidebar:patch-restore",
  PATCH_STATE:    "ai-sidebar:patch-state",
  /* 网页深度分析(第十一轮) */
  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",
  /* 网页修改恢复(第四阶段) */
  PATCH_RECOVER:   "ai-sidebar:patch-recover",
  PATCH_RECOVERED: "ai-sidebar:patch-recovered",
  /* 网页翻译(第七轮) */
  COLLECT_TEXTS:       "ai-sidebar:collect-texts",
  GET_TEXT_BATCH:      "ai-sidebar:get-text-batch",
  APPLY_TRANSLATIONS:  "ai-sidebar:apply-translations",
  RESTORE_TEXTS:       "ai-sidebar:restore-texts",
  TRANSLATION_STATE:   "ai-sidebar:translation-state",
};

/* ------------------------------------------------------------------
   消息监听
   ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  // 只处理本扩展发送的消息
  if (!message || typeof message !== "object") return false;

  try {
    switch (message.type) {

      case MSG.GET_PAGE_INFO:
        sendResponse(extractPageInfo());
        break;

      case MSG.GET_PAGE_TEXT:
        sendResponse(extractPageText());
        break;

      case MSG.GET_SELECTED_TEXT:
        sendResponse(extractSelectedText());
        break;

      /* ---- 网页资源(第八轮) ---- */
      case MSG.GET_PAGE_RESOURCES:
        sendResponse(extractPageResources());
        break;

      /* ---- AI 网页修改(第九轮) ---- */
      case MSG.PATCH_ANALYZE:
        sendResponse(wpAnalyzePage());
        break;

      case MSG.PATCH_APPLY:
        sendResponse(wpApplyPlan(message));
        break;

      case MSG.PATCH_UNDO:
        sendResponse(wpUndoLast());
        break;

      case MSG.PATCH_RESTORE:
        sendResponse(wpRestoreAll());
        break;

      case MSG.PATCH_STATE:
        sendResponse(wpStateReport());
        break;

      case MSG.DEEP_ANALYZE:
        sendResponse(wpDeepAnalyze());
        break;

      /* ---- 网页翻译(第七轮) ---- */
      case MSG.COLLECT_TEXTS:
        sendResponse(txCollect(message));
        break;

      case MSG.GET_TEXT_BATCH:
        sendResponse(txGetBatch(message));
        break;

      case MSG.APPLY_TRANSLATIONS:
        sendResponse(txApplyTranslations(message));
        break;

      case MSG.RESTORE_TEXTS:
        sendResponse(txRestoreTexts());
        break;

      case MSG.TRANSLATION_STATE:
        sendResponse(txStateReport(true));
        break;

      default:
        // 不是本扩展的消息,不处理
        return false;
    }
  } catch (error) {
    sendResponse({ ok: false, error: String(error) });
  }

  // sendResponse 已同步调用,不需要保持通道
  return false;
});

/* ==================================================================
   数据提取函数
   ================================================================== */

/**
 * 提取页面摘要信息:
 * 标题、URL、可见文本预览、多媒体/链接数量、当前选中文字。
 */
function extractPageInfo() {
  if (!document.body) {
    return { ok: false, error: "页面无 body 元素" };
  }

  const rawText = document.body.innerText || "";
  const text    = rawText.replace(/\s+/g, " ").trim();
  const selection = window.getSelection().toString().trim();

  return {
    ok:           true,
    title:        document.title || "",
    url:          location.href,
    textLength:   text.length,
    textPreview:  text.slice(0, 500),
    linkCount:    document.querySelectorAll("a[href]").length,
    imageCount:   document.querySelectorAll("img").length,
    videoCount:   document.querySelectorAll("video").length,
    audioCount:   document.querySelectorAll("audio").length,
    selectedText: selection || null,
  };
}

/* ==================================================================
   网页资源清单(第八轮)
   ----------------------------------------------------------------
   只在页面 DOM 上读取「直接可见」的资源,不解析网络请求、不抓后台接口。
   返回结构保持最小:{ type, name, url },不回传 DOM / HTML / 页面源码。
   复用 extractPageInfo 已有的 img / a[href] / video / audio 口径,
   只是从「计数」扩展为「列表」。
   ================================================================== */

/* 每类最多回传条数:避免超大页面把消息撑爆(超出部分在界面标注) */
const RES_MAX_PER_TYPE = 500;

/* 资源名称 / 文本的长度上限 */
const RES_MAX_NAME_LEN = 120;

/**
 * 提取当前页面的图片 / 链接 / 视频 / 音频资源
 */
function extractPageResources() {
  if (!document.body) {
    return { ok: false, error: "页面无 body 元素" };
  }

  var images = collectResources(document.querySelectorAll("img"), "image", imageResourceInfo);
  var links  = collectResources(document.querySelectorAll("a[href]"), "link", linkResourceInfo);
  var videos = collectResources(document.querySelectorAll("video[src], video source[src]"), "video", mediaResourceInfo);
  var audios = collectResources(document.querySelectorAll("audio[src], audio source[src]"), "audio", mediaResourceInfo);

  return {
    ok:    true,
    token: TX_PAGE_TOKEN,          // 页面标识:切换网页后 token 变化,侧边栏据此丢弃旧数据
    title: document.title || "",
    url:   location.href,
    counts: {
      image: images.items.length,
      link:  links.items.length,
      video: videos.items.length,
      audio: audios.items.length,
    },
    truncated: {
      image: images.truncated,
      link:  links.truncated,
      video: videos.truncated,
      audio: audios.truncated,
    },
    resources: {
      image: images.items,
      link:  links.items,
      video: videos.items,
      audio: audios.items,
    },
  };
}

/** 遍历一类元素,逐个转成 { type, name, url },跳过无地址/无意义地址 */
function collectResources(nodeList, type, mapper) {
  var items     = [];
  var truncated = false;

  for (var i = 0; i < nodeList.length; i++) {
    if (items.length >= RES_MAX_PER_TYPE) { truncated = true; break; }

    var info = mapper(nodeList[i], type);
    if (!info || !info.url) continue;
    items.push(info);
  }

  return { items: items, truncated: truncated };
}

/** 图片:{ type, name, url },名称优先用 alt,退化到文件名 */
function imageResourceInfo(el, type) {
  var url = pickImageUrl(el);
  if (!url) return null;

  var name = cleanResourceText(el.getAttribute("alt")) || fileNameFromUrl(url) || "图片";
  return { type: type, name: name, url: url };
}

/** 链接:名称优先用链接文字,退化到 title,再退化到文件名/域名 */
function linkResourceInfo(el, type) {
  var raw = el.getAttribute("href");
  if (!raw) return null;

  var trimmed = String(raw).trim();
  // 纯锚点与 javascript: 不是可打开的资源
  if (!trimmed || trimmed.charAt(0) === "#" || /^javascript:/i.test(trimmed)) return null;

  var url = resolveResourceUrl(trimmed);
  if (!url) return null;

  var name = cleanResourceText(el.textContent) ||
             cleanResourceText(el.getAttribute("title")) ||
             fileNameFromUrl(url) || "链接";

  return { type: type, name: name, url: url };
}

/** 视频 / 音频源:{ type, name, url } */
function mediaResourceInfo(el, type) {
  // 第四阶段:媒体可能没有 src 属性(靠 <source> 或 MSE 喂流),这里都算上
  var raw = el.getAttribute("src") || "";
  if (!raw) {
    var sEl = el.querySelector && el.querySelector("source[src]");
    if (sEl) raw = sEl.getAttribute("src") || "";
  }
  // blob: 也要能识别出来 —— 它不是「没有资源」,只是不能当普通文件下载
  if (!raw) raw = el.currentSrc || "";

  if (!raw && !(el.tagName || "").match(/^(VIDEO|AUDIO)$/i)) return null;

  var url = raw ? resolveResourceUrl(raw) : (el.currentSrc || "");

  var fallback = type === "video" ? "视频" : "音频";
  var name = cleanResourceText(el.getAttribute("title")) ||
             cleanResourceText(el.getAttribute("aria-label")) ||
             fileNameFromUrl(url) || fallback;

  // 媒体真实形态:直链 / blob+MSE / HLS / DRM / 无源
  var kind = null;
  try { kind = wpMediaKind(el); } catch (e) { kind = null; }
  if (!kind) {
    var isBlob = String(url || "").indexOf("blob:") === 0;
    kind = isBlob
      ? { kind: "mse", label: "MSE 流媒体(blob)", controllable: true, downloadable: false,
          note: "这是页面 Blob 媒体资源,不能直接作为普通 HTTP 文件下载。" }
      : { kind: "direct", label: "直接媒体地址", controllable: true, downloadable: true, note: "" };
  }

  return {
    type:         type,
    name:         name,
    url:          url,
    mediaKind:    kind.kind,
    statusLabel:  kind.label,
    controllable: kind.controllable !== false,
    downloadable: kind.downloadable === true && String(url || "").indexOf("blob:") !== 0,
    note:         kind.note || "",
  };
}

/**
 * 图片地址:优先浏览器实际采用的地址,其次常见懒加载属性,
 * 最后取 srcset 里的第一个候选。很多站点的 src 只是占位图。
 */
function pickImageUrl(el) {
  var candidates = [
    el.currentSrc,
    el.getAttribute("src"),
    el.getAttribute("data-src"),
    el.getAttribute("data-original"),
    el.getAttribute("data-lazy-src"),
    el.getAttribute("data-actualsrc"),
  ];

  for (var i = 0; i < candidates.length; i++) {
    var v = candidates[i];
    if (v && String(v).trim()) return resolveResourceUrl(String(v).trim());
  }

  var srcset = el.getAttribute("srcset") || el.getAttribute("data-srcset");
  if (srcset) {
    var first = String(srcset).split(",")[0].trim().split(/\s+/)[0];
    if (first) return resolveResourceUrl(first);
  }

  return "";
}

/** 相对地址转绝对地址(data: / blob: 等保持原样) */
function resolveResourceUrl(raw) {
  if (!raw) return "";
  raw = String(raw).trim();
  if (!raw) return "";
  // 内联 base64 资源既超长又没有复制/打开价值,直接丢弃
  if (/^data:/i.test(raw)) return "";

  if (/^(https?:|blob:|file:|chrome-extension:|edge-extension:)/i.test(raw)) return raw;

  try {
    return new URL(raw, location.href).href;
  } catch (e) {
    return raw;
  }
}

/** 清理用于显示的名称:折叠空白 + 限长 */
function cleanResourceText(text) {
  if (!text) return "";
  var s = String(text).replace(/\s+/g, " ").trim();
  if (s.length > RES_MAX_NAME_LEN) s = s.slice(0, RES_MAX_NAME_LEN) + "…";
  return s;
}

/** 从 URL 末段猜一个可读名称(用于没有 alt / 链接文字的资源) */
function fileNameFromUrl(url) {
  try {
    var path = String(url).split("?")[0].split("#")[0];
    var last = path.substring(path.lastIndexOf("/") + 1);
    if (!last) return "";
    try { last = decodeURIComponent(last); } catch (e) { /* 保持原样 */ }
    return last.length > 0 && last.length <= 80 ? last : "";
  } catch (e) {
    return "";
  }
}

/**
 * 提取当前页面全部可见文本。
 * 使用 document.body.innerText,自动跳过 <script>/<style>/隐藏元素。
 * 上限 50000 字符,超出部分截断并在返回值中标明。
 */
function extractPageText() {
  if (!document.body) {
    return { ok: false, error: "页面无 body 元素" };
  }

  const MAX_CHARS = 50000;
  const rawText   = document.body.innerText || "";
  const cleaned   = rawText.replace(/\s+/g, " ").trim();
  const totalLen  = cleaned.length;
  const truncated = totalLen > MAX_CHARS;

  return {
    ok:        true,
    title:     document.title || "",
    url:       location.href,
    length:    totalLen,
    text:      truncated ? cleaned.slice(0, MAX_CHARS) : cleaned,
    truncated: truncated,
  };
}

/**
 * 提取当前用户选中的文字。
 */
function extractSelectedText() {
  const selection = window.getSelection().toString().trim();
  return {
    ok:   true,
    text: selection || null,
  };
}

/* ==================================================================
   选中文字主动上报(第四阶段)
   用户用鼠标选择文字 → 防抖 500ms → 通知后台 → 转发到侧边栏
   ================================================================== */
(function () {
  var timer       = null;
  var lastSent    = "";

  document.addEventListener("selectionchange", function () {
    // 跳过空选择
    var sel = window.getSelection().toString().trim();
    if (!sel) return;

    // 与上次发送相同则跳过
    if (sel === lastSent) return;

    // 防抖 500ms —— 避免拖选过程中高频发送
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      lastSent = sel;
      chrome.runtime.sendMessage({
        type:         MSG.SELECTION_CHANGED,
        selectedText: sel,
        pageTitle:    document.title || "",
        pageUrl:      location.href,
      }).catch(function () {
        // 后台 Service Worker 可能未就绪,静默忽略
      });
    }, 500);
  });
})();

/* ==================================================================
   网页翻译引擎(第七轮)
   ----------------------------------------------------------------
   设计原则(按优先级):
     1. 不破坏网页 —— 只写文本节点的 nodeValue,不重建 DOM、不碰元素属性、
        不改 innerHTML,因此 CSS / 图片 / 链接 / 事件监听 / 页面脚本都不受影响
     2. 原文可可靠恢复 —— 翻译前按节点保存原始 nodeValue,恢复时直接写回,
        过程不依赖 API、不需要重新翻译
     3. 分批翻译 —— 长节点先按句子/空格边界拆分,再按 token 预算分批
   翻译状态保存在本内容脚本内,页面刷新/跳转会随脚本一起重建,
   因此不会把 A 网页的节点映射用到 B 网页上。
   ================================================================== */

/* 整棵子树跳过、不进入的标签 */
const TX_SKIP_TAGS = {
  SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1,
  HEAD: 1, TITLE: 1, META: 1, LINK: 1, BASE: 1,
  CODE: 1, PRE: 1, KBD: 1, SAMP: 1, VAR: 1, TT: 1,
  TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, DATALIST: 1,
  SVG: 1, CANVAS: 1, IFRAME: 1, FRAME: 1, MATH: 1,
  OBJECT: 1, EMBED: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, TRACK: 1,
  MAP: 1, AREA: 1,
};

/* 页面标识:内容脚本每次注入(页面加载/跳转)都会重新生成 */
const TX_PAGE_TOKEN = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* 当前页面的翻译会话(同一时刻只保留一个) */
var txSession = null;

/* ------------------------------------------------------------------
   1. 收集待翻译文本
   ------------------------------------------------------------------ */

/**
 * 遍历 DOM 收集可翻译文本节点,并按预算切分成批次
 * @param {{lang?:string, budgetTokens?:number, budgetChars?:number}} msg
 */
function txCollect(msg) {
  // 已有会话 → 直接返回当前进度,支持「继续翻译」而不重复发送已翻译内容
  if (txSession) return txStateReport(true);

  var body = document.body;
  if (!body) return { ok: false, error: "页面无 body 元素" };

  var lang = (msg && msg.lang) || "";
  var budget = {
    tokens: (msg && msg.budgetTokens) || 1200,
    chars:  (msg && msg.budgetChars)  || 6000,
  };

  var stats  = { textNodes: 0, skipped: 0, filtered: 0, split: 0 };
  var groups = [];
  txWalk(body, groups, stats, lang);

  // 把每个文本节点展开成 1..n 个待翻译条目
  var entries = [];
  for (var g = 0; g < groups.length; g++) {
    var group  = groups[g];
    var pieces = txSplitText(group.text, budget);
    if (pieces.length > 1) stats.split++;

    for (var p = 0; p < pieces.length; p++) {
      entries.push({
        node:        group.node,
        group:       g,
        seg:         p,
        text:        pieces[p].text,
        sepAfter:    pieces[p].sepAfter,
        lead:        p === 0 ? group.lead : "",
        trail:       p === pieces.length - 1 ? group.trail : "",
        originalRaw: p === 0 ? group.originalRaw : "",
        translated:  false,
        translation: "",
      });
    }
  }

  if (entries.length === 0) {
    // 没有任何需要翻译的文字 → 不建立会话,便于用户换语言后重新收集
    return {
      ok: true, token: TX_PAGE_TOKEN, active: false, done: false,
      totalEntries: 0, totalNodes: 0, totalChars: 0, totalTokens: 0,
      batchCount: 0, nextBatchIndex: 0, applied: 0, stats: stats,
    };
  }

  // 按节点分组缓存,回写时整组拼接
  var groupMap = {};
  for (var i = 0; i < entries.length; i++) {
    var it = entries[i];
    if (!groupMap[it.group]) groupMap[it.group] = [];
    groupMap[it.group].push(it);
  }

  txSession = {
    token:   TX_PAGE_TOKEN,
    lang:    lang,
    entries: entries,
    groups:  groupMap,
    plan:    txBuildBatchPlan(entries, budget),
    pointer: 0,
    applied: 0,
    stats:   stats,
  };

  return txStateReport(true);
}

/** 递归遍历(元素节点先判断是否跳过,跳过则不再下探) */
function txWalk(node, groups, stats, lang) {
  var children = node.childNodes;
  if (!children) return;

  for (var i = 0; i < children.length; i++) {
    var child = children[i];

    if (child.nodeType === 3) {                    // 文本节点
      stats.textNodes++;
      txHandleTextNode(child, groups, stats, lang);
      continue;
    }
    if (child.nodeType !== 1) continue;            // 注释等一律跳过
    if (txShouldSkipElement(child)) { stats.skipped++; continue; }

    txWalk(child, groups, stats, lang);
  }
}

function txHandleTextNode(node, groups, stats, lang) {
  var raw = node.nodeValue;
  if (!raw || !/\S/.test(raw)) return;

  var collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return;

  if (!TX_LETTER_RE.test(collapsed))            { stats.skipped++;  return; }  // 纯数字/符号
  if (txLooksLikeCodeOrUrl(collapsed))          { stats.skipped++;  return; }  // URL / 邮箱 / 路径
  if (txAlreadyTargetLanguage(collapsed, lang)) { stats.filtered++; return; }  // 已是目标语言

  groups.push({
    node:        node,
    text:        collapsed,
    lead:        (raw.match(/^\s+/) || [""])[0],   // 行内元素间的空格必须保留
    trail:       (raw.match(/\s+$/) || [""])[0],
    originalRaw: raw,                               // 恢复原文用,逐字保存
  });
}

/** 是否含有可翻译的字母(排除纯数字、纯符号) */
const TX_LETTER_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-׿؀-ۿ぀-ヿ一-鿿가-힯]/;

/** URL / 邮箱 / 文件路径不进翻译 */
function txLooksLikeCodeOrUrl(text) {
  if (/^(https?:\/\/|ftp:\/\/|www\.)\S+$/i.test(text)) return true;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(text))         return true;
  if (/^\/[\w\-./%?=&]*$/.test(text))                  return true;
  if (/^[A-Za-z]:\\\S*$/.test(text))                   return true;
  return false;
}

/** 各书写系统字符统计(需与 TX_LETTER_RE 覆盖的脚本保持一致) */
function txScriptStats(text) {
  var s = { latin: 0, cjk: 0, kana: 0, hangul: 0, cyrillic: 0, other: 0 };
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c >= 0x3040 && c <= 0x30ff)      s.kana++;
    else if (c >= 0xac00 && c <= 0xd7af) s.hangul++;
    else if (c >= 0x4e00 && c <= 0x9fff) s.cjk++;
    else if (c >= 0x3400 && c <= 0x4dbf) s.cjk++;
    else if (c >= 0x0400 && c <= 0x04ff) s.cyrillic++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0x00c0 && c <= 0x024f)) s.latin++;
    else if ((c >= 0x0590 && c <= 0x05ff) || (c >= 0x0600 && c <= 0x06ff)) s.other++;  // 希伯来文 / 阿拉伯文
  }
  return s;
}

/**
 * 判断这段文字是否已经是目标语言
 * 只做「书写系统」层面的廉价判断:
 *   - 中日韩俄可以可靠区分,直接跳过不发送,避免中文网页反复翻译
 *   - 英法德西同属拉丁字母,无法廉价区分,交给模型按提示词处理
 * 日文含汉字,因此必须同时满足「无假名」才认定为中文。
 */
function txAlreadyTargetLanguage(text, lang) {
  var s = txScriptStats(text);
  var letters = s.latin + s.cjk + s.kana + s.hangul + s.cyrillic + s.other;

  // 认不出书写系统时不擅自跳过,交给模型按提示词处理
  if (letters === 0) return false;

  if (lang === "zh") return s.cjk / letters > 0.6 && s.kana === 0 && s.hangul === 0;
  if (lang === "ja") return s.kana / letters > 0.2;
  if (lang === "ko") return s.hangul / letters > 0.3;
  if (lang === "ru") return s.cyrillic / letters > 0.6;
  return false;
}

/** 元素是否整棵子树跳过 */
function txShouldSkipElement(el) {
  var tag = el.tagName ? String(el.tagName).toUpperCase() : "";
  if (TX_SKIP_TAGS[tag]) return true;

  if (el.isContentEditable) return true;

  if (typeof el.getAttribute === "function") {
    var tr = el.getAttribute("translate");
    if (tr && tr.toLowerCase() === "no") return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
  }

  return txIsHidden(el);
}

/** 不可见元素不翻译(隐藏内容翻译了也看不见,而且可能破坏折叠逻辑) */
function txIsHidden(el) {
  var style = null;
  try { style = window.getComputedStyle(el); } catch (e) { style = null; }

  if (style) {
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") return true;
    if (style.opacity === "0") return true;
    if (style.display === "contents") return false;   // 自身无盒子但子节点照常渲染
  }

  try {
    if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return true;
  } catch (e) { /* 忽略 */ }

  return false;
}

/* ------------------------------------------------------------------
   2. 长文本拆分与分批
   ------------------------------------------------------------------ */

/**
 * 把过长的文本按「句末标点 / 空格」边界拆成若干段
 * 保证: pieces[0].text + sep0 + pieces[1].text + sep1 + ... === 原文
 * 这样回写时可以完整还原分隔,不会把内容粘在一起
 */
function txSplitText(text, budget) {
  if (estimateTokens(text) <= budget.tokens && text.length <= budget.chars) {
    return [{ text: text, sepAfter: "" }];
  }

  var pieces    = [];
  var remaining = text;
  var guard     = 0;

  while (remaining && guard++ < 500) {
    var canTake = txMaxPrefixLength(remaining, budget);
    if (canTake >= remaining.length) {
      pieces.push({ text: remaining, sepAfter: "" });
      break;
    }

    var cut  = txFindCutPoint(remaining, canTake);
    var rest = remaining.slice(cut);
    var sep  = (rest.match(/^\s+/) || [""])[0];

    pieces.push({ text: remaining.slice(0, cut), sepAfter: sep });
    remaining = rest.slice(sep.length);
  }

  if (pieces.length === 0) pieces.push({ text: text, sepAfter: "" });
  return pieces;
}

/** 二分求满足 token / 字符预算的最大前缀长度 */
function txMaxPrefixLength(text, budget) {
  var lo = 1;
  var hi = text.length;

  while (lo < hi) {
    var mid = Math.ceil((lo + hi) / 2);
    var prefix = text.slice(0, mid);
    if (estimateTokens(prefix) <= budget.tokens && prefix.length <= budget.chars) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 从 maxLen 往回找最近的边界,避免把词/句子切断 */
function txFindCutPoint(text, maxLen) {
  var floor = Math.max(1, Math.floor(maxLen * 0.6));

  for (var i = maxLen; i > floor; i--) {
    var ch = text.charAt(i - 1);
    if (ch === " " || ch === "\n" || ch === "\t") return i - 1;   // 空白归入分隔符
    if (".!?;。！?;；,，、:：".indexOf(ch) !== -1) return i;      // 标点留在前一段
  }
  return maxLen;                                                  // 找不到边界则硬切
}

/** 按预算把条目切成批次(每个批次不超过预算;单个超长条目自成一批) */
function txBuildBatchPlan(entries, budget) {
  var plan  = [];
  var from  = 0;
  var tokens = 0;
  var chars  = 0;

  for (var i = 0; i < entries.length; i++) {
    var t = estimateTokens(entries[i].text);
    var c = entries[i].text.length;

    if (i > from && (tokens + t > budget.tokens || chars + c > budget.chars)) {
      plan.push({ from: from, to: i });
      from = i; tokens = 0; chars = 0;
    }
    tokens += t;
    chars  += c;
  }

  if (from < entries.length) plan.push({ from: from, to: entries.length });
  return plan;
}

/* ------------------------------------------------------------------
   3. 取批次 / 回写 / 恢复
   ------------------------------------------------------------------ */

function txGetBatch(msg) {
  if (!txSession) return { ok: false, error: "尚未收集网页文字" };
  if (msg && msg.token && msg.token !== txSession.token) {
    return { ok: false, stale: true, error: "页面已变化,请重新开始翻译" };
  }

  var bi = parseInt(msg && msg.batchIndex, 10);
  if (!isFinite(bi) || bi < 0 || bi >= txSession.plan.length) {
    return { ok: false, error: "批次超出范围" };
  }

  var seg   = txSession.plan[bi];
  var items = [];
  for (var i = seg.from; i < seg.to; i++) {
    items.push({ ref: i, text: txSession.entries[i].text });
  }

  return {
    ok: true,
    token: txSession.token,
    batchIndex: bi,
    batchCount: txSession.plan.length,
    items: items,
    nextPointer: seg.to,
    last: bi === txSession.plan.length - 1,
  };
}

/**
 * 回写译文
 * @param {{token:string, items:Array<{ref:number,text:string}>, nextPointer:number}} msg
 */
function txApplyTranslations(msg) {
  if (!txSession) return { ok: false, error: "尚未收集网页文字" };
  if (msg.token !== txSession.token) {
    return { ok: false, stale: true, error: "页面已变化,已忽略本次翻译结果" };
  }

  var items   = (msg && msg.items) || [];
  var applied = 0;
  var failed  = 0;
  var touched = {};

  for (var i = 0; i < items.length; i++) {
    var it    = items[i];
    var entry = txSession.entries[it.ref];

    if (!entry || typeof it.text !== "string" || it.text === "") { failed++; continue; }

    entry.translation = it.text;
    entry.translated  = true;
    applied++;
    touched[entry.group] = true;
  }

  var nodesWritten = 0;
  for (var g in touched) {
    if (!Object.prototype.hasOwnProperty.call(touched, g)) continue;
    if (txWriteGroup(txSession.groups[g])) nodesWritten++;
  }

  if (msg && isFinite(msg.nextPointer)) txSession.pointer = msg.nextPointer;
  txSession.applied += applied;

  return { ok: true, token: txSession.token, applied: applied, failed: failed, nodesWritten: nodesWritten };
}

/**
 * 写回一个文本节点(可能由多个分段组成)
 * 未翻译的分段保留原文,保证任何时刻页面文字都是完整的、不会丢失内容
 */
function txWriteGroup(entries) {
  if (!entries || entries.length === 0) return false;

  var node = entries[0].node;
  if (!node || !node.isConnected) return false;

  var out = "";
  var anyTranslated = false;

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.translated && e.translation) {
      out += e.translation.replace(/\s+/g, " ").trim();
      anyTranslated = true;
    } else {
      out += e.text;
    }
    if (i < entries.length - 1) out += e.sepAfter || "";
  }

  if (!anyTranslated) return false;   // 整组都没翻译成功 → 不动 DOM

  node.nodeValue = (entries[0].lead || "") + out + (entries[0].trail || "");
  return true;
}

/** 恢复原文:直接写回翻译前保存的 nodeValue,完全不需要 API */
function txRestoreTexts() {
  if (!txSession) {
    return { ok: true, token: TX_PAGE_TOKEN, restored: 0, skipped: 0, empty: true };
  }

  var restored = 0;
  var skipped  = 0;
  var seen     = {};

  for (var i = 0; i < txSession.entries.length; i++) {
    var e = txSession.entries[i];
    if (seen[e.group]) continue;
    seen[e.group] = true;

    if (!e.node || !e.node.isConnected) { skipped++; continue; }
    e.node.nodeValue = e.originalRaw;
    restored++;
  }

  txSession = null;   // 会话结束,下次翻译重新收集
  return { ok: true, token: TX_PAGE_TOKEN, restored: restored, skipped: skipped };
}

/** 翻译状态报告(侧边栏据此显示「继续翻译 / 已翻译」) */
function txStateReport(withStats) {
  if (!txSession) {
    return {
      ok: true, token: TX_PAGE_TOKEN, active: false, done: false,
      totalEntries: 0, totalNodes: 0, totalChars: 0, totalTokens: 0,
      batchCount: 0, nextBatchIndex: 0, applied: 0,
    };
  }

  var s = txSession;
  var totalChars  = 0;
  var totalTokens = 0;
  for (var i = 0; i < s.entries.length; i++) {
    totalChars  += s.entries[i].text.length;
    totalTokens += estimateTokens(s.entries[i].text);
  }

  return {
    ok: true,
    token: s.token,
    active: true,
    done: s.applied >= s.entries.length,
    totalEntries: s.entries.length,
    totalNodes: s.stats.textNodes,
    totalChars: totalChars,
    totalTokens: totalTokens,
    batchCount: s.plan.length,
    nextBatchIndex: txBatchIndexOfPointer(s),
    applied: s.applied,
    stats: withStats ? s.stats : undefined,
  };
}

/** 当前指针落在第几个批次(用于「继续翻译」) */
function txBatchIndexOfPointer(s) {
  for (var i = 0; i < s.plan.length; i++) {
    if (s.plan[i].to > s.pointer) return i;
  }
  return s.plan.length;
}

/* ==================================================================
   AI 网页修改引擎(第九轮)
   ----------------------------------------------------------------
   设计要点:
     1. 只做「局部修改」:不替换 body / html,不执行任何 AI 返回的脚本
     2. 元素定位以内部编号 ref(el_N) 为主,配合 selector / text 兜底;
        编号只存在内存注册表里,不往页面写任何属性,不污染原网页
     3. 每个动作执行前都记录原始状态,支持逐步撤销与整体恢复
     4. 批量样式写进专用 <style id="ai-webpage-style">,便于统一撤销
     5. 局部 HTML 重构走消毒流程(template 惰性解析 + 去脚本/去 on* 属性)
   ================================================================== */

/* ---- 分析规模上限:控制发给模型的上下文大小 ---- */
const WP_MAX_DEPTH        = 4;      // 结构树最大深度
const WP_MAX_CHILDREN     = 8;      // 每个节点最多列出的子元素
const WP_MAX_REFS         = 160;    // 最多分配多少个 el_N 编号
const WP_MAX_ANALYSIS     = 24000;  // 结构摘要最大字符数
const WP_MAX_INTERACTIVE  = 50;     // 可交互元素最多列出多少
const WP_MAX_MEDIA        = 30;     // 图片 / 媒体最多列出多少
const WP_MAX_TEXT         = 120;    // 单个元素文字预览长度

/* 结构树里直接跳过的标签 */
const WP_SKIP_TAGS = {
  SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1, BASE: 1,
  SVG: 1, MATH: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, SOURCE: 1, TRACK: 1, PARAM: 1,
  BR: 1, HR: 1, WBR: 1, COL: 1, COLGROUP: 1,
};

/* 局部 HTML 重构时整块删除的标签 */
const WP_HTML_DENY_TAGS = {
  SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1, APPLET: 1,
  LINK: 1, META: 1, BASE: 1, FORM: 1, SVG: 1, MATH: 1, TEMPLATE: 1, NOSCRIPT: 1,
};

/* ---------------- 状态 ---------------- */

var wpSeq      = 0;        // el_N 计数
var wpRefOf    = new Map(); // element → ref
var wpByRef    = {};       // ref → { el }
var wpSteps    = [];       // 已应用步骤栈(用于撤销 / 恢复)
var wpCssRules = [];       // 专用样式表里的规则(每条一小段 CSS)
var wpStyleEl  = null;     // <style id="ai-webpage-style">
var wpPageToken = "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ==================================================================
   1. 网页结构摘要
   ================================================================== */

/**
 * 生成发给 AI 的网页结构摘要(压缩 + 截断,不输出完整 HTML)
 */
function wpAnalyzePage() {
  if (!document.body) return { ok: false, error: "页面无 body 元素" };

  var ctx = {
    lines: [], chars: 0, refs: 0, truncated: false,
  };

  wpWalkTree(document.body, 0, ctx);

  var interactive = wpCollectInteractive();
  var media       = wpCollectMedia();

  var parts = [];
  parts.push("【页面】" + (document.title || "(无标题)"));
  parts.push("【地址】" + location.href);
  if (wpSteps.length > 0) {
    parts.push("【AI 修改状态】已应用 " + wpSteps.length + " 次修改,可撤销 " + wpSteps.length + " 步" +
      (wpCssRules.length ? ",专用样式表含 " + wpCssRules.length + " 条规则" : ""));
  }
  parts.push("");
  parts.push("【结构】(缩进表示层级,[el_N] 是可直接引用的元素编号)");
  parts.push(ctx.lines.join("\n"));

  if (interactive.lines.length) {
    parts.push("");
    parts.push("【可交互元素】" + interactive.note);
    parts.push(interactive.lines.join("\n"));
  }
  if (media.lines.length) {
    parts.push("");
    parts.push("【图片 / 媒体】" + media.note);
    parts.push(media.lines.join("\n"));
  }
  if (ctx.truncated) {
    parts.push("");
    parts.push("(页面较大,以上结构已被截断;未列出的区域可用 CSS 选择器定位)");
  }

  var text = parts.join("\n");
  if (text.length > WP_MAX_ANALYSIS) {
    text = text.slice(0, WP_MAX_ANALYSIS) + "\n(结构摘要过长已截断)";
  }

  return {
    ok: true,
    token: wpPageToken,
    title: document.title || "",
    url: location.href,
    analysis: text,
    length: text.length,
    refs: ctx.refs,
    truncated: ctx.truncated,
    steps: wpSteps.length,
    canUndo: wpSteps.length > 0,
  };
}

/** 递归输出结构树 */
function wpWalkTree(el, depth, ctx) {
  if (ctx.chars >= WP_MAX_ANALYSIS) { ctx.truncated = true; return; }

  var tag = el.tagName ? el.tagName.toUpperCase() : "";
  if (WP_SKIP_TAGS[tag]) return;
  if (wpHiddenBySite(el)) return;                       // 站点自己隐藏的区域不分析
  if (depth > WP_MAX_DEPTH) { ctx.truncated = true; return; }

  var ref = null;
  if (ctx.refs < WP_MAX_REFS) {
    ref = wpEnsureRef(el);
    ctx.refs++;
  }

  var line = wpIndent(depth) + wpDescribeElement(el, ref);
  ctx.lines.push(line);
  ctx.chars += line.length + 1;

  var children = el.children || [];
  var listed   = 0;

  for (var i = 0; i < children.length; i++) {
    if (listed >= WP_MAX_CHILDREN) {
      ctx.lines.push(wpIndent(depth + 1) + "… 还有 " + (children.length - listed) + " 个同级元素未列出");
      ctx.truncated = true;
      break;
    }
    var before = ctx.lines.length;
    wpWalkTree(children[i], depth + 1, ctx);
    if (ctx.lines.length > before) listed++;
  }
}

function wpIndent(depth) { return "  ".repeat(depth); }

/** 元素 → 一行描述 */
function wpDescribeElement(el, ref) {
  var parts = [];
  var tag   = el.tagName.toLowerCase();
  var head  = tag;

  if (el.id) head += "#" + wpShort(el.id, 40);
  var cls = wpClassPreview(el);
  if (cls) head += "." + cls;
  parts.push(head);

  if (ref) parts.push("[" + ref + "]");

  var size = wpSizeHint(el);
  if (size) parts.push(size);

  if (el.style && el.style.display === "none") parts.push("[AI已隐藏]");

  var attrs = wpAttrPreview(el);
  if (attrs) parts.push(attrs);

  var text = wpTextPreview(el);
  if (text) parts.push('"' + text + '"');

  return parts.join(" ");
}

function wpClassPreview(el) {
  var list = el.classList ? Array.prototype.slice.call(el.classList) : [];
  if (!list.length) return "";
  var picked = list.slice(0, 3).map(function (c) { return wpShort(c, 24); });
  return picked.join(".") + (list.length > 3 ? ".…" : "");
}

function wpSizeHint(el) {
  var w = el.offsetWidth || 0;
  var h = el.offsetHeight || 0;
  if (!w || !h) return "";
  return "(" + w + "x" + h + ")";
}

function wpAttrPreview(el) {
  var out = [];
  var checks = [
    ["href", 90], ["src", 90], ["alt", 40], ["title", 40],
    ["placeholder", 40], ["type", 20], ["name", 30], ["role", 20],
    ["aria-label", 40], ["value", 40],
  ];
  for (var i = 0; i < checks.length; i++) {
    var v = el.getAttribute && el.getAttribute(checks[i][0]);
    if (v === null || v === undefined || v === "") continue;
    if (checks[i][0] === "value" && el.tagName !== "INPUT") continue;
    out.push(checks[i][0] + "=" + wpShort(String(v), checks[i][1]));
  }
  if (el.disabled) out.push("disabled");
  if (el.hidden)   out.push("hidden");
  return out.join(" ");
}

function wpTextPreview(el) {
  var t = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= WP_MAX_TEXT) return t;
  if (el.children && el.children.length > 0) return t.slice(0, 60) + "…";
  return t.slice(0, WP_MAX_TEXT) + "…";
}

function wpShort(value, max) {
  var s = String(value === null || value === undefined ? "" : value);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** 站点自己隐藏的元素不进入分析(我们自己隐藏的仍保留,方便 AI 再显示回来) */
function wpHiddenBySite(el) {
  if (el.style && el.style.display === "none") return false;
  var st = null;
  try { st = window.getComputedStyle(el); } catch (e) { return false; }
  if (!st) return false;
  return st.display === "none" || st.visibility === "hidden";
}

/** 分配稳定的内部编号(只存在内存,不写入页面) */
function wpEnsureRef(el) {
  var existing = wpRefOf.get(el);
  if (existing) return existing;

  wpSeq++;
  var ref = "el_" + wpSeq;
  wpRefOf.set(el, ref);
  wpByRef[ref] = { el: el };
  return ref;
}

/** 可交互元素清单 */
function wpCollectInteractive() {
  var nodes = document.querySelectorAll("button, input, textarea, select, a[href], [role=button]");
  var lines = [];
  var total = nodes.length;

  for (var i = 0; i < nodes.length && lines.length < WP_MAX_INTERACTIVE; i++) {
    var el  = nodes[i];
    if (wpHiddenBySite(el)) continue;

    var ref = wpEnsureRef(el);
    var parts = [ref, el.tagName.toLowerCase()];
    var type = el.getAttribute("type");
    if (type) parts[1] += "[" + wpShort(type, 12) + "]";

    var label = el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
                el.getAttribute("title") || (el.textContent || "").replace(/\s+/g, " ").trim();
    if (label) parts.push('"' + wpShort(label, 40) + '"');

    var href = el.getAttribute("href");
    if (href) parts.push("href=" + wpShort(href, 60));

    lines.push(parts.join(" "));
  }

  return { lines: lines, note: total > lines.length ? "(共 " + total + " 个,列出前 " + lines.length + " 个)" : "" };
}

/** 图片与音视频清单 */
function wpCollectMedia() {
  var nodes = document.querySelectorAll("img, video, audio");
  var lines = [];
  var total = nodes.length;

  for (var i = 0; i < nodes.length && lines.length < WP_MAX_MEDIA; i++) {
    var el  = nodes[i];
    if (wpHiddenBySite(el)) continue;

    var mediaTag = wpMediaTag(el);

    if (mediaTag) {
      // 媒体:给出 media_N 编号与关键状态,不必先深度分析也能直接操作
      var st = wpMediaState(el, wpEnsureMediaRef(el));
      var mparts = [st.id, mediaTag];
      var mlabel = el.getAttribute("title") || el.getAttribute("aria-label");
      if (mlabel) mparts.push('"' + wpShort(mlabel, 30) + '"');
      mparts.push(st.visible ? "可见" : "不可见");
      mparts.push(st.paused ? "已暂停" : "播放中");
      mparts.push("rate=" + st.playbackRate);
      mparts.push("volume=" + st.volume + (st.muted ? "(静音)" : ""));
      mparts.push("time=" + st.currentTime + (st.duration === null ? "/?" : "/" + st.duration));
      mparts.push("src=" + st.srcType);
      if (st.controls) mparts.push("controls");
      mparts.push("selector=" + wpShort(st.selector, 40));
      lines.push(mparts.join(" "));
      continue;
    }

    var ref   = wpEnsureRef(el);
    var parts = [ref, el.tagName.toLowerCase()];

    var label = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label");
    if (label) parts.push('"' + wpShort(label, 40) + '"');

    var src = el.getAttribute("src") || el.getAttribute("data-src");
    if (src) parts.push("src=" + wpShort(src, 80));

    var size = wpSizeHint(el);
    if (size) parts.push(size);
    if (el.controls) parts.push("controls");

    lines.push(parts.join(" "));
  }

  return { lines: lines, note: total > lines.length ? "(共 " + total + " 个,列出前 " + lines.length + " 个)" : "" };
}

/* ==================================================================
   2. 元素定位(ref → selector → text)
   ================================================================== */

function wpResolveTarget(act) {
  if (!act) return null;

  if (act.ref) {
    var entry = wpByRef[act.ref];
    if (entry && entry.el && entry.el.isConnected) return entry.el;
  }

  if (act.selector) {
    try {
      var el = document.querySelector(String(act.selector));
      if (el) return el;
    } catch (e) { /* 非法选择器 → 继续尝试其它方式 */ }
  }

  if (act.text) return wpFindByText(act.text, act.tag);

  return null;
}

/**
 * 解析 parent / target 这类字段:既可能是 el_N 编号,也可能是 CSS 选择器
 * (模型经常写成 {"action":"move","target":"#content"},不能只认编号)
 */
function wpResolveRefOrSelector(value) {
  if (!value) return null;

  var s = String(value).trim();
  if (!s) return null;

  var entry = wpByRef[s];
  if (entry && entry.el && entry.el.isConnected) return entry.el;

  try {
    var el = document.querySelector(s);
    if (el) return el;
  } catch (e) { /* 既不是编号也不是合法选择器 */ }

  return null;
}

/** 按可见文字定位:取文字完全匹配的「最深」元素 */
function wpFindByText(text, tag) {
  var wanted = String(text).replace(/\s+/g, " ").trim();
  if (!wanted) return null;

  var candidates;
  try {
    candidates = tag ? document.getElementsByTagName(String(tag)) : document.querySelectorAll("div, span, p, h1, h2, h3, h4, a, button, li, td, th, section, aside, header, footer, nav, label, strong, em");
  } catch (e) {
    return null;
  }

  var best = null;
  var bestLen = Infinity;

  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    if (wpHiddenBySite(el)) continue;
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t !== wanted) continue;
    if (t.length < bestLen) { best = el; bestLen = t.length; }
  }

  return best;
}

/* ==================================================================
   3. 执行修改方案
   ================================================================== */

/**
 * @param {{actions:Array, summary?:string, allowFullPage?:boolean}} msg
 * @returns {{ok:boolean, modified:number, failed:number, failures:Array, steps:number, canUndo:boolean, message:string}}
 */
function wpApplyPlan(msg) {
  var actions = (msg && msg.actions) || [];
  var allowFull = !!(msg && msg.allowFullPage);
  // 由后台执行、无法自动回滚的动作(网页代码执行 / 浏览器工具)
  var irreversible = (msg && msg.irreversible) || [];

  if (!actions.length && !irreversible.length) {
    return { ok: true, modified: 0, failed: 0, failures: [], irreversible: 0, steps: wpSteps.length, canUndo: wpSteps.length > 0, message: "这次没有需要执行的修改" };
  }

  // mergeInto="current":同一次用户请求的后续批次并入同一个步骤,撤销时一起回退
  var merging = !!(msg && msg.mergeInto === "current" && wpSteps.length > 0);
  var step;
  if (merging) {
    step = wpSteps[wpSteps.length - 1];
  } else {
    step = { summary: wpShort((msg && msg.summary) || "", 200), records: [] };
  }
  var modified = 0;
  var failures = [];
  var results  = [];   // 每个动作的真实执行结果(含实际生效值)

  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    var mark = step.records.length;      // 本动作写入前的记录位置,失败时只回滚本动作

    try {
      var res = wpRunAction(act, step, allowFull);

      if (res && res.ok) {
        modified++;
        results.push({
          action:      act && act.action,
          ok:          true,
          detail:      (res && res.detail) || "",
          actualValue: (res && res.actualValue !== undefined) ? res.actualValue : null,
        });
      } else {
        var reason = (res && res.reason) || "执行失败";
        failures.push({ index: i, action: act && act.action, reason: reason });
        results.push({ action: act && act.action, ok: false, detail: "", reason: reason });
      }
    } catch (err) {
      if (step.records.length > mark) wpRollbackRecords(step.records.splice(mark));

      var errMsg = "执行异常:" + (err && err.message ? err.message : String(err));
      failures.push({ index: i, action: act && act.action, reason: errMsg });
      results.push({ action: act && act.action, ok: false, detail: "", reason: errMsg });
    }
  }

  // 无法回滚的动作也记进同一步骤,撤销时如实告知用户
  for (var r = 0; r < irreversible.length; r++) {
    var item = irreversible[r] || {};
    step.records.push({ kind: "irreversible", label: wpShort(item.summary || item.action || "网页代码执行", 120) });
  }

  if (!merging) {
    if (modified > 0 || irreversible.length > 0) {
      wpSteps.push(step);
    } else if (step.records.length) {
      wpRollbackRecords(step.records);     // 全部失败 → 不留痕迹
      step.records = [];
    }
  }

  var message = "已执行 " + modified + " 项修改";
  if (failures.length) message += ",其中 " + failures.length + " 项未能完成";
  if (irreversible.length) message += ";另有 " + irreversible.length + " 项网页代码/浏览器操作已执行(无法自动回滚)";

  return {
    ok: true,
    modified: modified,
    failed: failures.length,
    failures: failures.slice(0, 8),
    results:  results.slice(0, 30),
    irreversible: irreversible.length,
    steps: wpSteps.length,
    canUndo: wpSteps.length > 0,
    message: message,
  };
}

function wpRunAction(act, step, allowFull) {
  switch (act.action) {
    case "add_css":     return wpActAddCss(act, step);
    case "set_style":   return wpActSetStyle(act, step);
    case "hide":        return wpActToggle(act, step, true);
    case "show":        return wpActToggle(act, step, false);
    case "remove":      return wpActRemove(act, step, allowFull);
    case "set_text":    return wpActSetText(act, step);
    case "set_title":   return wpActSetTitle(act, step);
    case "set_attr":    return wpActSetAttr(act, step);
    case "set_html":    return wpActSetHtml(act, step, allowFull);
    case "append_html": return wpActInsertHtml(act, step, "append");
    case "insert_html": return wpActInsertHtml(act, step, act.position || "append");
    case "create":      return wpActCreate(act, step);
    case "move":        return wpActMove(act, step);
    case "set_media":   return wpActMedia(act, step);
    /* 解除复制限制(完整版):结构化 + 可撤销,不执行任何网页代码 */
    case "remove_copy_restrictions": return wpActRemoveCopyRestrictions(act, step);
    /* 媒体专用动作(第十一轮),全部复用同一执行核心 */
    case "media_play":            return wpActMediaOp(act, step, "play");
    case "media_pause":           return wpActMediaOp(act, step, "pause");
    case "media_seek":            return wpActMediaOp(act, step, "seek");
    case "media_set_rate":        return wpActMediaOp(act, step, "rate");
    case "media_set_volume":      return wpActMediaOp(act, step, "volume");
    case "media_mute":            return wpActMediaOp(act, step, "muted", true);
    case "media_unmute":          return wpActMediaOp(act, step, "muted", false);
    case "media_toggle_controls": return wpActMediaOp(act, step, "controls", "toggle");
    default:            return { ok: false, reason: "不支持的动作" };
  }
}

/* ---------------- 各动作实现 ---------------- */

/** 批量 CSS → 专用样式表 */
function wpActAddCss(act, step) {
  var target = wpResolveTarget(act);
  var selector = target ? wpCssPathFor(target) : String(act.selector || "");
  var css = wpBuildCssRule(selector, act.css, act.important !== false);

  if (!css) return { ok: false, reason: "选择器或 CSS 内容不合法" };

  var index = wpCssRules.length;
  wpCssRules.push(css);
  wpRenderStyleTag();
  step.records.push({ kind: "css", index: index });

  return { ok: true };
}

/* ==================================================================
   解除复制 / 选择 / 右键限制(完整版)
   ----------------------------------------------------------------
   ⚠️ 三条红线:
     1. 不执行任何网页代码 —— 不用 eval / new Function / 动态 JS 字符串
     2. 不尝试绕过页面 CSP —— 我们只做 DOM 与事件层面的常规操作
     3. 不删除页面自己的监听器(做不到也不该做),而是用**捕获阶段**抢在它前面

   原理:
     · CSS:用 !important 覆盖 user-select:none 之类的样式(写进专用样式表,可撤销)
     · 属性:摘掉 oncopy / onselectstart / oncontextmenu 这类内联处理器
     · 事件:在 document 上用**捕获阶段**监听,stopImmediatePropagation()
             让页面注册的限制处理器收不到事件;我们自己**不 preventDefault**,
             浏览器的原生选择 / 复制 / 右键菜单照常工作
   ================================================================== */

/** 需要摘掉的内联处理器属性 */
var WP_COPY_INLINE_ATTRS = [
  "oncopy", "oncut", "onpaste", "onbeforecopy", "onbeforecut",
  "onselectstart", "onselect", "ondragstart", "oncontextmenu",
  "onmousedown", "onmouseup", "onkeydown", "onkeypress", "onkeyup",
];

/** DOM0 属性(document / body / window 上直接赋值的那种) */
var WP_COPY_DOM0_PROPS = [
  "oncopy", "oncut", "onselectstart", "ondragstart", "oncontextmenu",
  "onmousedown", "onmouseup", "onkeydown", "onkeypress",
];

/** 需要拦截的事件类型 */
var WP_COPY_GUARD_EVENTS = [
  "selectstart", "copy", "cut", "beforecopy", "dragstart", "contextmenu",
  "mousedown", "mouseup", "keydown", "keypress",
];

/** 复制 / 全选相关的快捷键(只有这些按键才干预,避免影响页面自己的快捷键) */
function wpIsCopyHotkey(event) {
  var k = String(event.key || "");
  var mod = !!(event.ctrlKey || event.metaKey);
  if (!mod) return false;
  return k === "c" || k === "C" || k === "x" || k === "X" || k === "a" || k === "A" ||
         k === "Insert" || k === "insert" || k === "u" || k === "U" ||
         k === "F12" || k === "f12";
}

/** 事件目标是不是「交互控件」—— 是的话不要干预,避免点不动按钮 */
function wpIsInteractiveTarget(el) {
  if (!el || !el.tagName) return false;
  var tag = el.tagName.toUpperCase();
  if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" ||
      tag === "SELECT" || tag === "OPTION" || tag === "LABEL" || tag === "SUMMARY") return true;

  try {
    if (el.isContentEditable) return true;
    if (el.closest) {
      if (el.closest("a, button, input, textarea, select, [role='button'], [contenteditable='true']")) return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}

/**
 * 捕获阶段的拦截器
 * 只做一件事:不让页面注册的限制处理器收到事件。
 * **不调用 preventDefault** —— 浏览器的原生行为必须保留,
 * 否则我们会把「允许复制」变成「连正常操作也没了」。
 */
function wpCopyGuardHandler(event) {
  try {
    var type = event.type;

    // 键盘只在按下复制/全选类组合键时干预
    if (type === "keydown" || type === "keypress") {
      if (!wpIsCopyHotkey(event)) return;
    }

    // 鼠标按下/抬起只在非交互控件上干预(否则按钮点不动)
    if (type === "mousedown" || type === "mouseup") {
      if (wpIsInteractiveTarget(event.target)) return;
    }

    event.stopImmediatePropagation();
  } catch (e) { /* 任何异常都不能影响页面 */ }
}

/** 在指定目标上挂拦截器,并记录以便撤销 */
function wpAttachCopyGuard(target, step) {
  for (var i = 0; i < WP_COPY_GUARD_EVENTS.length; i++) {
    var type = WP_COPY_GUARD_EVENTS[i];
    try {
      target.addEventListener(type, wpCopyGuardHandler, true);   // capture = true
      step.records.push({ kind: "copyGuard", target: target, type: type, handler: wpCopyGuardHandler, capture: true });
    } catch (e) { /* 目标不支持就跳过 */ }
  }
}

/**
 * 摘掉元素上的内联限制属性(可撤销)
 * @returns {number} 处理了几个元素
 */
function wpStripInlineCopyAttrs(root, step) {
  if (!root || !root.querySelectorAll) return 0;

  var count = 0;
  var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));

  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!el || el.nodeType !== 1 || !el.getAttribute) continue;

    var touched = false;
    for (var j = 0; j < WP_COPY_INLINE_ATTRS.length; j++) {
      var name = WP_COPY_INLINE_ATTRS[j];
      var prev = el.getAttribute(name);
      if (prev === null) continue;

      step.records.push({ kind: "attr", el: el, name: name, prev: prev });
      try { el.removeAttribute(name); } catch (e) { /* 忽略 */ }
      touched = true;
    }
    if (touched) count++;
  }

  return count;
}

/** 清掉 document / body / window 上直接用属性赋值的处理器(可撤销) */
function wpStripDom0CopyHandlers(step) {
  var targets = [document, document.body, document.documentElement];
  try { targets.push(window); } catch (e) { /* 忽略 */ }

  var count = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (!t) continue;

    for (var j = 0; j < WP_COPY_DOM0_PROPS.length; j++) {
      var prop = WP_COPY_DOM0_PROPS[j];
      var prev = null;
      try { prev = t[prop]; } catch (e) { continue; }
      if (typeof prev !== "function") continue;

      step.records.push({ kind: "prop", el: t, name: prop, prev: null });
      try { t[prop] = null; } catch (e) { /* 只读属性,忽略 */ }
      count++;
    }
  }
  return count;
}

/**
 * 解除复制 / 选择 / 右键限制
 * @param {{selector?:string, ref?:string}} act 可只处理某个区域;留空 = 整页
 */
function wpActRemoveCopyRestrictions(act, step) {
  var scope = null;
  if (act && (act.selector || act.ref)) {
    scope = wpResolveTarget(act);
    if (!scope) return { ok: false, reason: "找不到要处理的区域(选择器没有匹配到元素)" };
  }

  var root = scope || document;

  /* 1) CSS:覆盖 user-select:none 一类样式(写进专用样式表 → 可撤销) */
  var sel = scope
    ? (wpCssPathFor(scope) + ", " + wpCssPathFor(scope) + " *")
    : "html, body, body *";

  var css = wpBuildCssRule(sel,
    "user-select:text !important;" +
    "-webkit-user-select:text !important;" +
    "-ms-user-select:text !important;" +
    "-webkit-user-drag:auto !important;" +
    "-webkit-touch-callout:default !important",
    true);

  var cssOk = false;
  if (css) {
    step.records.push({ kind: "css", index: wpCssRules.length });
    wpCssRules.push(css);
    wpRenderStyleTag();
    cssOk = true;
  }

  /* 2) 摘掉内联限制属性 */
  var attrCount = wpStripInlineCopyAttrs(root, step);
  if (root !== document) attrCount += wpStripInlineCopyAttrs(document, step);

  /* 3) 清掉 DOM0 处理器 */
  var dom0Count = wpStripDom0CopyHandlers(step);

  /* 4) 捕获阶段拦截:让页面注册的限制处理器收不到事件 */
  wpAttachCopyGuard(document, step);
  if (root !== document) wpAttachCopyGuard(root, step);
  try { wpAttachCopyGuard(window, step); } catch (e) { /* 忽略 */ }

  var detail = "已解除复制/选择限制" +
    "(样式覆盖" + (cssOk ? "已生效" : "未生效") +
    " · 清理内联限制 " + attrCount + " 个元素" +
    (dom0Count ? " · 清理处理器 " + dom0Count + " 个" : "") +
    " · 已挂上捕获阶段拦截)";

  return {
    ok:          true,
    detail:      detail,
    actualValue: attrCount,
  };
}

/** 单元素内联样式 */
function wpActSetStyle(act, step) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };

  var styles = act.styles;
  if (!styles || typeof styles !== "object") return { ok: false, reason: "缺少 styles" };

  var keys = Object.keys(styles);
  if (!keys.length) return { ok: false, reason: "styles 为空" };

  step.records.push({ kind: "style", el: el, prev: el.getAttribute("style") });

  for (var i = 0; i < keys.length; i++) {
    var name = wpCssPropName(keys[i]);
    if (!name || !/^[-a-zA-Z]+$/.test(name)) continue;    // 只接受普通 CSS 属性名
    var value = styles[keys[i]];
    if (value === null || value === undefined) { el.style.removeProperty(name); continue; }
    el.style.setProperty(name, String(value));
  }

  return { ok: true };
}

/** 隐藏 / 显示 */
function wpActToggle(act, step, hide) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };

  step.records.push({ kind: "style", el: el, prev: el.getAttribute("style") });

  if (hide) el.style.setProperty("display", "none", "important");
  else      el.style.removeProperty("display");

  return { ok: true };
}

/** 删除元素(保留节点与位置,可恢复) */
function wpActRemove(act, step, allowFull) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };
  if (!allowFull && isFullPageElement(el)) return { ok: false, reason: "不允许删除 body / html" };
  if (!el.parentNode) return { ok: false, reason: "元素没有父节点" };

  step.records.push({ kind: "remove", el: el, parent: el.parentNode, next: el.nextSibling });
  el.parentNode.removeChild(el);
  return { ok: true };
}

/** 替换元素文字(纯文本,不解析 HTML) */
function wpActSetText(act, step) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };
  if (act.text === null || act.text === undefined) return { ok: false, reason: "缺少 text" };

  wpRecordChildren(step, el);
  el.textContent = String(act.text);
  return { ok: true };
}

/** 修改页面标题 */
function wpActSetTitle(act, step) {
  if (act.text === null || act.text === undefined) return { ok: false, reason: "缺少 text" };
  step.records.push({ kind: "title", prev: document.title });
  document.title = String(act.text);
  return { ok: true };
}

/** 修改属性(白名单) */
function wpActSetAttr(act, step) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };

  var attrs = act.attrs;
  if (!attrs || typeof attrs !== "object") return { ok: false, reason: "缺少 attrs" };

  var applied = 0;
  var keys = Object.keys(attrs);

  for (var i = 0; i < keys.length; i++) {
    var name  = String(keys[i]);
    var value = attrs[keys[i]];

    if (!isSafePatchAttribute(name)) continue;                       // on* 等一律拒绝
    if ((name === "href" || name === "src") && !isSafePatchUrl(value)) continue;

    step.records.push({ kind: "attr", el: el, name: name, prev: el.getAttribute(name) });

    if (value === null || value === undefined || value === false) {
      el.removeAttribute(name);
    } else if (value === true) {
      el.setAttribute(name, "");
    } else {
      el.setAttribute(name, String(value));
    }
    applied++;
  }

  if (!applied) return { ok: false, reason: "没有可安全写入的属性" };
  return { ok: true };
}

/** 替换元素内部 HTML(消毒后) */
function wpActSetHtml(act, step, allowFull) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };
  if (!allowFull && isFullPageElement(el)) {
    return { ok: false, reason: "出于安全考虑,不替换 body / html;请改成对局部区域修改" };
  }

  var frag = wpSanitizeHtml(act.html);
  if (!frag) return { ok: false, reason: "HTML 为空或不合法" };

  wpRecordChildren(step, el);
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(frag);

  step.records.push({ kind: "inserted", nodes: Array.prototype.slice.call(el.childNodes) });
  return { ok: true };
}

/** 追加 / 插入 HTML(消毒后) */
function wpActInsertHtml(act, step, position) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到目标元素" };

  var frag = wpSanitizeHtml(act.html);
  if (!frag) return { ok: false, reason: "HTML 为空或不合法" };

  var nodes = Array.prototype.slice.call(frag.childNodes);

  if (position === "before") {
    if (!el.parentNode) return { ok: false, reason: "元素没有父节点" };
    el.parentNode.insertBefore(frag, el);
  } else if (position === "after") {
    if (!el.parentNode) return { ok: false, reason: "元素没有父节点" };
    el.parentNode.insertBefore(frag, el.nextSibling);
  } else if (position === "prepend") {
    el.insertBefore(frag, el.firstChild);
  } else {
    el.appendChild(frag);
  }

  step.records.push({ kind: "inserted", nodes: nodes });
  return { ok: true };
}

/** 创建新元素并插入 */
function wpActCreate(act, step) {
  var parent = wpResolveRefOrSelector(act.parent) ||
               wpResolveTarget({ selector: act.selector, text: act.text });
  if (!parent) return { ok: false, reason: "找不到父容器" };

  var tag = String(act.tag || "div").toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) return { ok: false, reason: "标签名不合法" };
  if (WP_HTML_DENY_TAGS[tag.toUpperCase()]) return { ok: false, reason: "不允许创建该标签:" + tag };

  var el = document.createElement(tag);

  if (act.attrs && typeof act.attrs === "object") {
    var keys = Object.keys(act.attrs);
    for (var i = 0; i < keys.length; i++) {
      var name = String(keys[i]);
      if (!isSafePatchAttribute(name)) continue;
      var value = act.attrs[keys[i]];
      if ((name === "href" || name === "src") && !isSafePatchUrl(value)) continue;
      if (value === null || value === undefined || value === false) continue;
      el.setAttribute(name, value === true ? "" : String(value));
    }
  }

  if (act.styles && typeof act.styles === "object") {
    var sk = Object.keys(act.styles);
    for (var j = 0; j < sk.length; j++) {
      var sname = wpCssPropName(sk[j]);
      if (!sname || !/^[-a-zA-Z]+$/.test(sname)) continue;
      el.style.setProperty(sname, String(act.styles[sk[j]]));
    }
  }

  if (act.html) {
    var frag = wpSanitizeHtml(act.html);
    if (frag) el.appendChild(frag);
  }

  var position = act.position || "append";
  if (position === "before" || position === "after") {
    if (!parent.parentNode) return { ok: false, reason: "父容器没有父节点" };
    parent.parentNode.insertBefore(el, position === "before" ? parent : parent.nextSibling);
  } else if (position === "prepend") {
    parent.insertBefore(el, parent.firstChild);
  } else {
    parent.appendChild(el);
  }

  step.records.push({ kind: "inserted", nodes: [el] });
  return { ok: true };
}

/** 移动元素 */
function wpActMove(act, step) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到要移动的元素" };

  var target = wpResolveRefOrSelector(act.target) ||
               wpResolveRefOrSelector(act.targetSelector);
  if (!target) return { ok: false, reason: "找不到目标位置" };
  if (target === el || el.contains(target)) return { ok: false, reason: "不能移动到自身或子元素里" };

  step.records.push({ kind: "move", el: el, parent: el.parentNode, next: el.nextSibling });

  var position = act.position || "append";
  if (position === "before" || position === "after") {
    if (!target.parentNode) return { ok: false, reason: "目标位置没有父节点" };
    target.parentNode.insertBefore(el, position === "before" ? target : target.nextSibling);
  } else if (position === "prepend") {
    target.insertBefore(el, target.firstChild);
  } else {
    target.appendChild(el);
  }

  return { ok: true };
}

/** 媒体控制 */
/** set_media:沿用原有入口(兼容旧方案),内部走统一媒体执行核心 */
function wpActMedia(act, step) {
  return wpActMediaOp(act, step, String(act.op || ""), act.value);
}

/**
 * 媒体动作入口(第十一轮):set_media 与 media_* 共用
 * target 支持 media_N / CSS 选择器 / "video" / "audio" / 留空自动挑选
 */
function wpActMediaOp(act, step, op, explicitValue) {
  var rawTarget = (act.target !== undefined && act.target !== null) ? act.target
                : (act.ref || act.selector || "");

  var picked = wpResolveMediaTarget(rawTarget);
  if (!picked.ok) return { ok: false, reason: picked.error };

  var value = (explicitValue !== undefined && explicitValue !== null) ? explicitValue : act.value;
  return wpMediaOperation(picked.el, op, value, step, picked.ref);
}

/**
 * 媒体执行核心 —— 所有媒体动作共用这一份实现,不再写第二套
 * 执行后一律回报真实生效值,失败给出真实原因
 */
function wpMediaOperation(el, op, value, step, ref) {
  var tag = wpMediaTag(el);
  if (!tag) return { ok: false, reason: "目标不是 video / audio" };

  var before = wpMediaState(el, ref);
  var label  = before.id;

  if (op === "play") {
    if (!before.paused) return { ok: true, detail: label + " 已经在播放" };
    try {
      var p = el.play();
      if (p && p.catch) p.catch(function () { /* 自动播放策略可能拦截,后续按真实状态回报 */ });
    } catch (e) {
      return { ok: false, reason: "播放失败:" + ((e && e.message) || e) };
    }
    step.records.push({ kind: "playState", el: el, prev: before.paused });
    return { ok: true, detail: label + " 已开始播放", actualValue: true };
  }

  if (op === "pause") {
    if (before.paused) return { ok: true, detail: label + " 本来就处于暂停" };
    try { el.pause(); } catch (e) { return { ok: false, reason: "暂停失败" }; }
    step.records.push({ kind: "playState", el: el, prev: before.paused });
    return { ok: true, detail: label + " 已暂停", actualValue: false };
  }

  if (op === "muted" || op === "controls" || op === "loop") {
    var next = (value === "toggle") ? !el[op]
             : ((value === undefined || value === null) ? true : !!value);

    step.records.push({ kind: "prop", el: el, name: op, prev: el[op] });
    try { el[op] = next; } catch (e) { return { ok: false, reason: "设置 " + op + " 失败" }; }

    var actualFlag = !!el[op];
    if (actualFlag !== next) return { ok: false, reason: "页面未接受该设置(" + op + " 仍为 " + actualFlag + ")" };
    return { ok: true, detail: label + " " + op + " -> " + actualFlag, actualValue: actualFlag };
  }

  if (op === "volume") {
    var v = Number(value);
    if (!isFinite(v)) return { ok: false, reason: "音量必须是 0~1 的数字" };
    v = Math.max(0, Math.min(1, v));

    step.records.push({ kind: "prop", el: el, name: "volume", prev: el.volume });
    try { el.volume = v; } catch (e) { return { ok: false, reason: "设置音量失败" }; }

    var actualVol = Math.round(el.volume * 100) / 100;
    if (Math.abs(actualVol - v) > 0.001) return { ok: false, reason: "页面把音量限制为 " + actualVol };
    return { ok: true, detail: label + " 音量 " + before.volume + " -> " + actualVol, actualValue: actualVol };
  }

  if (op === "seek") {
    var t = Number(value);
    if (!isFinite(t)) return { ok: false, reason: "跳转位置必须是秒数" };
    if (t < 0) t = 0;

    step.records.push({ kind: "prop", el: el, name: "currentTime", prev: el.currentTime });
    try { el.currentTime = t; } catch (e) { return { ok: false, reason: "跳转失败:" + ((e && e.message) || e) }; }

    var actualTime = Math.round((el.currentTime || 0) * 10) / 10;
    if (Math.abs(actualTime - t) > 1.5) {
      return { ok: false, reason: "跳转未生效(请求 " + t + " 秒,实际 " + actualTime + " 秒;直播或未加载完的媒体可能不支持跳转)" };
    }
    return { ok: true, detail: label + " 跳转到 " + actualTime + " 秒", actualValue: actualTime };
  }

  if (op === "rate") {
    var rate = Number(value);
    if (!isFinite(rate) || rate <= 0) return { ok: false, reason: "倍速必须是大于 0 的数字" };
    if (rate < WP_MEDIA_MIN_RATE) rate = WP_MEDIA_MIN_RATE;
    if (rate > WP_MEDIA_MAX_RATE) rate = WP_MEDIA_MAX_RATE;

    step.records.push({ kind: "prop", el: el, name: "playbackRate", prev: el.playbackRate });
    try { el.playbackRate = rate; } catch (e) { return { ok: false, reason: "设置倍速失败:" + ((e && e.message) || e) }; }

    var actualRate = el.playbackRate;
    if (Math.abs(actualRate - rate) > 0.001) {
      return { ok: false, reason: "页面把倍速限制为 " + actualRate + " 倍(请求 " + rate + ");可能是浏览器上限或网站播放器锁定了倍速" };
    }
    return { ok: true, detail: label + " 倍速 " + before.playbackRate + " -> " + actualRate, actualValue: actualRate };
  }

  return { ok: false, reason: "不支持的媒体操作:" + op };
}


/* ==================================================================
   4. 记录与回滚
   ================================================================== */

/** 记录元素原有的子节点(撤销时原样放回,不重新解析 HTML) */
function wpRecordChildren(step, el) {
  step.records.push({
    kind: "children",
    el: el,
    nodes: Array.prototype.slice.call(el.childNodes),
  });
}

/** 回滚一组记录(逆序) */
function wpRollbackRecords(records) {
  for (var i = records.length - 1; i >= 0; i--) {
    var rec = records[i];
    try {
      wpUndoRecord(rec);
    } catch (e) { /* 单条回滚失败不影响其它 */ }
  }
}

function wpUndoRecord(rec) {
  switch (rec.kind) {
    case "style":
      if (rec.prev === null) rec.el.removeAttribute("style");
      else rec.el.setAttribute("style", rec.prev);
      break;

    case "attr":
      if (rec.prev === null) rec.el.removeAttribute(rec.name);
      else rec.el.setAttribute(rec.name, rec.prev);
      break;

    case "children":
      while (rec.el.firstChild) rec.el.removeChild(rec.el.firstChild);
      for (var i = 0; i < rec.nodes.length; i++) {
        if (!rec.nodes[i].parentNode) rec.el.appendChild(rec.nodes[i]);
      }
      break;

    case "inserted":
      for (var j = 0; j < rec.nodes.length; j++) {
        var node = rec.nodes[j];
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
      break;

    case "remove":
      if (rec.parent && !rec.el.parentNode) {
        var anchor = (rec.next && rec.next.parentNode === rec.parent) ? rec.next : null;
        rec.parent.insertBefore(rec.el, anchor);
      }
      break;

    case "move":
      if (rec.parent && rec.el.parentNode !== rec.parent) {
        var a2 = (rec.next && rec.next.parentNode === rec.parent) ? rec.next : null;
        rec.parent.insertBefore(rec.el, a2);
      }
      break;

    case "title":
      document.title = rec.prev;
      break;

    case "prop":
      try { rec.el[rec.name] = rec.prev; } catch (e) { /* 忽略 */ }
      break;

    case "playState":
      // 播放/暂停:尽力恢复到操作前状态(自动播放策略可能拦截)
      try { if (rec.prev) rec.el.pause(); else rec.el.play(); } catch (e) { /* 尽力而为 */ }
      break;

    case "irreversible":
      // 网页代码 / 浏览器操作无法自动回滚,只计数(见 wpCountIrreversible)
      break;

    case "css":
      if (rec.index >= 0 && rec.index < wpCssRules.length) {
        wpCssRules.splice(rec.index, 1);
        wpRenderStyleTag();
      }
      break;

    case "copyGuard":
      // 移除我们为了解除复制限制而挂上的拦截监听(页面自己的监听我们从不碰)
      try { rec.target.removeEventListener(rec.type, rec.handler, rec.capture); } catch (e) { /* 忽略 */ }
      break;
  }
}

/* ==================================================================
   5. 撤销 / 恢复
   ================================================================== */

/** 统计一个步骤里有多少项无法自动回滚 */
function wpCountIrreversible(step) {
  var n = 0;
  if (!step || !step.records) return 0;
  for (var i = 0; i < step.records.length; i++) {
    if (step.records[i].kind === "irreversible") n++;
  }
  return n;
}

/** 撤销最近一次修改 */
function wpUndoLast() {
  if (!wpSteps.length) {
    return { ok: true, undone: 0, steps: 0, canUndo: false, message: "没有可撤销的修改" };
  }

  wpStopAllKeepRate();      // 撤销时移除「保持倍速」监听
  wpUnlockAllRates();       // 并解除倍速锁定

  var step = wpSteps.pop();
  var irr  = wpCountIrreversible(step);
  wpRollbackRecords(step.records);

  var msg = wpSteps.length ? "已撤销最近一次修改,还可撤销 " + wpSteps.length + " 步" : "已撤销全部修改,网页已回到原始状态";
  if (irr) msg += ";该步骤含 " + irr + " 项网页代码/浏览器操作,这部分无法自动回滚";

  return {
    ok: true,
    undone: 1,
    irreversible: irr,
    summary: step.summary,
    steps: wpSteps.length,
    canUndo: wpSteps.length > 0,
    message: msg,
  };
}

/** 恢复网页:清空所有 AI 修改 */
function wpRestoreAll() {
  wpStopAllKeepRate();      // 恢复网页时移除「保持倍速」监听
  wpUnlockAllRates();       // 并解除倍速锁定

  var undone = 0;
  var irr    = 0;

  while (wpSteps.length) {
    var step = wpSteps.pop();
    irr += wpCountIrreversible(step);
    wpRollbackRecords(step.records);
    undone++;
  }

  // 兜底:样式表与残留节点
  wpCssRules = [];
  wpRenderStyleTag();

  var msg = undone ? "已恢复网页(回退 " + undone + " 次修改)" : "网页已是最初状态,没有需要恢复的 AI 修改";
  if (irr) msg += ";其中 " + irr + " 项网页代码/浏览器操作无法自动回滚,如仍有残留请刷新页面";

  return {
    ok: true,
    undone: undone,
    irreversible: irr,
    steps: 0,
    canUndo: false,
    message: msg,
  };
}

/** 状态报告(界面据此显示撤销 / 恢复按钮) */
function wpStateReport() {
  return {
    ok: true,
    token: wpPageToken,
    steps: wpSteps.length,
    canUndo: wpSteps.length > 0,
    cssRules: wpCssRules.length,
    refs: wpByRef ? Object.keys(wpByRef).length : 0,
    summaries: wpSteps.map(function (s) { return s.summary; }).slice(-5),
  };
}

/* ==================================================================
   6. 专用样式表
   ================================================================== */

function wpEnsureStyleTag() {
  if (wpStyleEl && wpStyleEl.isConnected) return wpStyleEl;

  var existing = document.getElementById("ai-webpage-style");
  if (existing) { wpStyleEl = existing; return wpStyleEl; }

  var st = document.createElement("style");
  st.id = "ai-webpage-style";
  (document.head || document.documentElement).appendChild(st);
  wpStyleEl = st;
  return st;
}

function wpRenderStyleTag() {
  if (!wpCssRules.length) {
    if (wpStyleEl && wpStyleEl.parentNode) wpStyleEl.parentNode.removeChild(wpStyleEl);
    wpStyleEl = null;
    return;
  }
  var st = wpEnsureStyleTag();
  st.textContent = wpCssRules.join("\n");
}

/**
 * CSS 属性名归一化:模型习惯写驼峰(backgroundColor),
 * 而 el.style.setProperty 只认 kebab-case(background-color),
 * 不做这层转换的话样式会被静默丢弃。
 */
function wpCssPropName(name) {
  var s = String(name === null || name === undefined ? "" : name).trim();
  if (!s) return "";
  if (s.indexOf("-") !== -1) return s.toLowerCase();
  return s.replace(/[A-Z]/g, function (ch) { return "-" + ch.toLowerCase(); }).toLowerCase();
}

/** 把「选择器 + 声明」拼成一条安全规则 */
function wpBuildCssRule(selector, css, important) {
  var sel = String(selector || "").trim();
  var body = String(css || "").trim();

  if (!sel || !body) return "";
  if (/[{}@]/.test(sel)) return "";                     // 选择器里不允许出现花括号 / at 规则
  if (body.indexOf("{") !== -1 || body.indexOf("}") !== -1) return "";

  var decls = body.split(";");
  var out = [];

  for (var i = 0; i < decls.length; i++) {
    var d = decls[i].trim();
    if (!d) continue;
    if (important && !/!important/i.test(d)) d += " !important";
    out.push(d);
  }

  if (!out.length) return "";
  return sel + "{" + out.join(";") + "}";
}

/** 为元素生成一个可用的 CSS 选择器(id 优先,否则用结构路径) */
function wpCssPathFor(el) {
  if (!el || el.nodeType !== 1) return "";

  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
    return "#" + el.id;
  }

  var parts = [];
  var node = el;
  var guard = 0;

  while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 6) {
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
      parts.unshift("#" + node.id);
      break;
    }

    var tag = node.tagName.toLowerCase();
    var parent = node.parentNode;
    if (parent) {
      var sameTag = 0;
      var index = 1;
      for (var i = 0; i < parent.children.length; i++) {
        var sib = parent.children[i];
        if (sib.tagName === node.tagName) {
          sameTag++;
          if (sib === node) index = sameTag;
        }
      }
      tag += sameTag > 1 ? ":nth-of-type(" + index + ")" : "";
    }
    parts.unshift(tag);
    node = parent;
  }

  return parts.join(" > ");
}

/* ==================================================================
   7. 局部 HTML 消毒
   ================================================================== */

/**
 * 用 <template> 惰性解析 AI 返回的 HTML(脚本不执行、图片不加载),
 * 再删除危险标签 / on* 属性 / 危险 URL。
 * @returns {DocumentFragment|null}
 */
function wpSanitizeHtml(html) {
  var raw = String(html === null || html === undefined ? "" : html).trim();
  if (!raw) return null;

  var tpl = document.createElement("template");
  tpl.innerHTML = raw;

  wpSanitizeNode(tpl.content);

  if (!tpl.content.childNodes.length) return null;
  return tpl.content;
}

function wpSanitizeNode(root) {
  var stack = [root];

  while (stack.length) {
    var node = stack.pop();
    var children = Array.prototype.slice.call(node.childNodes || []);

    for (var i = 0; i < children.length; i++) {
      var child = children[i];

      if (child.nodeType === 8) {                       // 注释
        child.parentNode.removeChild(child);
        continue;
      }
      if (child.nodeType !== 1) continue;               // 文本节点保留

      var tag = child.tagName ? child.tagName.toUpperCase() : "";
      if (WP_HTML_DENY_TAGS[tag]) {
        child.parentNode.removeChild(child);
        continue;
      }

      var attrs = Array.prototype.slice.call(child.attributes || []);
      for (var j = 0; j < attrs.length; j++) {
        var name = attrs[j].name;
        if (!isSafePatchAttribute(name)) { child.removeAttribute(name); continue; }
        if ((name === "href" || name === "src") && !isSafePatchUrl(attrs[j].value)) {
          child.removeAttribute(name);
        }
      }

      stack.push(child);
    }
  }
}

/* ==================================================================
   网页深度分析 + 媒体控制(第十一轮)
   ----------------------------------------------------------------
   目标:解决「网页其实可以操作,但 AI 不知道可操作对象在哪」的问题。
   要点:
     1. 媒体元素分配内存内编号 media_N(不往网页写任何属性)
     2. 深度分析比普通结构摘要更细:媒体完整状态 / iframe / Shadow DOM
     3. blob / MSE 源不影响 DOM 媒体控制能力 —— 只影响"下载资源"
     4. 倍速不设人为上限(0.05 ~ 100),执行后回报真实生效值
   ================================================================== */

/* 倍速允许范围:给一个宽松的护栏,不做"只能 0.5~4"这类人为限制 */
const WP_MEDIA_MIN_RATE = 0.05;
const WP_MEDIA_MAX_RATE = 100;

/* 深度分析的规模上限 */
const WP_DEEP_MAX_IFRAMES = 20;
const WP_DEEP_MAX_SHADOWS = 20;
const WP_RECOVER_DELAY_MS = 800;    // 刷新后等待页面自身脚本就绪再恢复修改
const WP_DEEP_MAX_FORMS   = 20;      // 深度分析:表单最多列出几个
const WP_DEEP_MAX_INTERACTIVE = 40;  // 深度分析:每类交互元素最多列出几个
const WP_DEEP_MAX_MEDIA   = 30;

/* 媒体注册表:只在内存里,页面刷新即失效 */
var wpMediaSeq   = 0;
var wpMediaRefOf = new Map();   // element → "media_N"
var wpMediaByRef = {};          // "media_N" → { el }

/* ---------------- 媒体识别与状态 ---------------- */

function wpMediaTag(el) {
  var t = (el && el.tagName) ? el.tagName.toUpperCase() : "";
  return (t === "VIDEO" || t === "AUDIO") ? t.toLowerCase() : "";
}

/** 分配稳定的媒体编号 */
function wpEnsureMediaRef(el) {
  var existing = wpMediaRefOf.get(el);
  if (existing && wpMediaByRef[existing] && wpMediaByRef[existing].el === el) return existing;

  wpMediaSeq++;
  var ref = "media_" + wpMediaSeq;
  wpMediaRefOf.set(el, ref);
  wpMediaByRef[ref] = { el: el };
  return ref;
}

/**
 * 媒体源类型
 * 注意:blob / hls 只表示"地址不能直接下载",**不代表不能控制播放**
 */
function wpMediaSrcType(el) {
  var src = el.currentSrc || el.getAttribute("src") || "";
  if (!src && el.querySelector) {
    var s = el.querySelector("source[src]");
    if (s) src = s.getAttribute("src") || "";
  }
  if (!src) return "none";
  if (src.indexOf("blob:") === 0) return "blob";
  if (src.indexOf("data:") === 0) return "data";
  if (src.indexOf(".m3u8") !== -1) return "hls";
  return "url";
}

function wpMediaBox(el) {
  var w = el.offsetWidth || 0;
  var h = el.offsetHeight || 0;
  if (!w || !h) {
    try {
      var r = el.getBoundingClientRect();
      w = Math.round(r.width) || 0;
      h = Math.round(r.height) || 0;
    } catch (e) { /* 忽略 */ }
  }
  return { w: w, h: h, area: Math.max(0, w) * Math.max(0, h) };
}

function wpMediaVisible(el) {
  if (wpHiddenBySite(el)) return false;
  var box = wpMediaBox(el);
  return box.w > 0 && box.h > 0;
}

/** 是否位于主要内容区域 */
function wpMediaInMain(el) {
  var p = el.parentNode;
  var guard = 0;
  while (p && p.nodeType === 1 && guard++ < 30) {
    var tag = p.tagName ? p.tagName.toUpperCase() : "";
    if (tag === "MAIN" || tag === "ARTICLE") return true;
    if (p.getAttribute && p.getAttribute("role") === "main") return true;
    p = p.parentNode;
  }
  return false;
}

/** 单个媒体的完整状态 */
/* ==================================================================
   媒体类型识别(第四阶段)
   ----------------------------------------------------------------
   关键区分:
     「不能下载」≠「不能控制」
   blob: / MSE 的 video 依然可以播放、暂停、倍速、跳转、音量。
   只有 DRM(EME)才是真的受保护;而受保护也不等于我们要去绕过它。
   ================================================================== */

/**
 * 判断一个媒体的资源形态
 * @returns {{kind:string, label:string, controllable:boolean, downloadable:boolean, note:string}}
 */
function wpMediaKind(el) {
  var srcType = wpMediaSrcType(el);
  var media   = el;

  // 1) MSE:页面用 MediaSource 喂数据(主流视频站基本都是这种)
  var isMSE = false;
  try { isMSE = (typeof MediaSource !== "undefined") && (media.srcObject instanceof MediaSource); } catch (e) { isMSE = false; }
  if (!isMSE && srcType === "blob") {
    // blob URL 无法直接判断,但绝大多数 blob 媒体都是 MSE 喂的
    isMSE = true;
  }

  // 2) DRM:EME 加密媒体(受保护内容)
  var isDRM = false;
  try {
    isDRM = !!(media.mediaKeys) || (media.webkitKeys && media.webkitKeys);
  } catch (e) { isDRM = false; }

  if (isDRM) {
    return {
      kind: "drm", label: "受保护媒体(EME)", controllable: true, downloadable: false,
      note: "检测到受保护媒体,当前不提供 DRM 绕过或解密下载。播放 / 控制仍按页面自身能力进行。",
    };
  }

  if (isMSE || srcType === "blob") {
    return {
      kind: "mse", label: "MSE 流媒体(blob)", controllable: true, downloadable: false,
      note: "这是页面 Blob / MSE 媒体资源,不能直接作为普通 HTTP 文件下载。播放、暂停、倍速、跳转、音量等控制不受影响。",
    };
  }

  if (srcType === "hls") {
    return {
      kind: "hls", label: "HLS 分片流", controllable: true, downloadable: false,
      note: "HLS(m3u8)是分片流,需要专门的下载器;本扩展只提供播放控制,不做流媒体下载。",
    };
  }

  if (srcType === "data") {
    return {
      kind: "data", label: "内嵌数据(data:)", controllable: true, downloadable: false,
      note: "媒体内容直接内嵌在页面里(data: URL),没有独立的 HTTP 地址可下载。",
    };
  }

  if (srcType === "url") {
    return {
      kind: "direct", label: "直接媒体地址", controllable: true, downloadable: true,
      note: "普通媒体地址,可以下载。",
    };
  }

  return {
    kind: "none", label: "无媒体源", controllable: false, downloadable: false,
    note: "这个元素当前没有可用的媒体源。",
  };
}

function wpMediaState(el, ref) {
  var type   = wpMediaTag(el);
  var box    = wpMediaBox(el);
  var srcType = wpMediaSrcType(el);

  var duration = null;
  try { duration = isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : null; } catch (e) { duration = null; }

  var currentTime = 0;
  try { currentTime = Math.round((el.currentTime || 0) * 10) / 10; } catch (e) { currentTime = 0; }

  var volume = 1;
  try { volume = Math.round((el.volume === undefined ? 1 : el.volume) * 100) / 100; } catch (e) { volume = 1; }

  var playbackRate = 1;
  try { playbackRate = el.playbackRate || 1; } catch (e) { playbackRate = 1; }

  var readyState = 0;
  try { readyState = el.readyState || 0; } catch (e) { readyState = 0; }

  return {
    type:         type,
    id:           ref || wpEnsureMediaRef(el),
    visible:      !wpHiddenBySite(el) && box.w > 0 && box.h > 0,
    paused:       el.paused !== false,
    muted:        !!el.muted,
    volume:       volume,
    currentTime:  currentTime,
    duration:     duration,
    playbackRate: playbackRate,
    readyState:   readyState,
    controls:     !!el.controls,
    hasSrc:       srcType !== "none",
    srcType:      srcType,
    kind:         wpMediaKind(el),          // 第四阶段:直链 / blob+MSE / DRM
    src:          wpShort(el.getAttribute("src") || "", 200),
    currentSrc:   wpShort(el.currentSrc || "", 200),
    inMain:       wpMediaInMain(el),
    area:         box.area,
    width:        box.w,
    height:       box.h,
    loop:         !!el.loop,
    selector:     wpCssPathFor(el),
  };
}

/* ---------------- 目标解析:media_N / 选择器 / 自动挑选 ---------------- */

/**
 * @param {string} target "media_1" | CSS 选择器 | "video" | "audio" | 空
 * @returns {{ok:boolean, el?:Element, ref?:string, error?:string}}
 */
function wpResolveMediaTarget(target) {
  var t = String(target === undefined || target === null ? "" : target).trim();

  // 1) 媒体编号
  if (t.indexOf("media_") === 0) {
    var num = t.slice(6);
    if (num && String(parseInt(num, 10)) === num) {
      var entry = wpMediaByRef[t];
      if (entry && entry.el && entry.el.isConnected) return { ok: true, el: entry.el, ref: t };
      return { ok: false, error: "找不到 " + t + "(页面可能已刷新,请重新分析网页)" };
    }
  }

  // 2) CSS 选择器
  if (t && t !== "video" && t !== "audio" && t !== "current") {
    var found = null;
    try { found = document.querySelector(t); } catch (e) { found = null; }

    if (!found) return { ok: false, error: "找不到媒体目标:" + t };
    if (wpMediaTag(found)) return { ok: true, el: found, ref: wpEnsureMediaRef(found) };

    var inner = found.querySelector ? found.querySelector("video, audio") : null;
    if (inner) return { ok: true, el: inner, ref: wpEnsureMediaRef(inner) };

    return { ok: false, error: "选择器命中的元素里没有 video / audio" };
  }

  // 3) 自动挑选
  return wpPickMedia((t === "video" || t === "audio") ? t : "");
}

/**
 * 自动挑选最合理的媒体:
 *   正在播放 > 可见 > 位于主要内容区 > 面积大 > 靠前
 * 多个候选得分完全相同且都无有效特征时,如实报告"无法确定"
 */
function wpPickMedia(wanted) {
  var nodes = document.querySelectorAll(wanted ? wanted : "video, audio");
  var candidates = [];

  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!wpMediaTag(el)) continue;
    if (wanted && wpMediaTag(el) !== wanted) continue;
    candidates.push(el);
  }

  if (!candidates.length) {
    return { ok: false, error: wanted ? ("页面里没有 " + wanted + " 元素") : "页面里没有 video / audio 元素" };
  }
  if (candidates.length === 1) {
    return { ok: true, el: candidates[0], ref: wpEnsureMediaRef(candidates[0]) };
  }

  var best = null;
  var bestScore = -1;
  var tiedAtTop = false;

  for (var j = 0; j < candidates.length; j++) {
    var m = candidates[j];
    var playing = (m.paused === false && (m.currentTime || 0) > 0);

    var score = 0;
    if (playing) score += 1000;
    if (wpMediaVisible(m)) score += 100;
    if (wpMediaInMain(m)) score += 10;
    score += Math.min(9, Math.floor(wpMediaBox(m).area / 100000));

    if (score > bestScore) { best = m; bestScore = score; tiedAtTop = false; }
    else if (score === bestScore) { tiedAtTop = true; }
  }

  // 全都没有可区分的特征 → 不猜
  if (bestScore <= 0 && tiedAtTop) {
    return { ok: false, error: "检测到 " + candidates.length + " 个媒体元素,无法确定目标。请指明(例如 media_1 / media_2 或 CSS 选择器)" };
  }

  return { ok: true, el: best, ref: wpEnsureMediaRef(best) };
}

/* ---------------- 深度分析 ---------------- */

/**
 * 深度扫描当前网页:媒体完整状态 / iframe / Shadow DOM / 关键计数
 * 只返回结构化摘要,不回传 HTML。
 */
function wpDeepAnalyze() {
  if (!document.body) return { ok: false, error: "页面无 body 元素" };

  var t0 = Date.now();

  /* 媒体 */
  var mediaEls = document.querySelectorAll("video, audio");
  var media = [];
  for (var i = 0; i < mediaEls.length && media.length < WP_DEEP_MAX_MEDIA; i++) {
    if (!wpMediaTag(mediaEls[i])) continue;
    media.push(wpMediaState(mediaEls[i], wpEnsureMediaRef(mediaEls[i])));
  }

  /* iframe */
  var iframeEls = document.querySelectorAll("iframe");
  var iframes = [];
  for (var f = 0; f < iframeEls.length && f < WP_DEEP_MAX_IFRAMES; f++) {
    var fr = iframeEls[f];
    var sameOrigin = false;
    try { sameOrigin = !!(fr.contentDocument); } catch (e) { sameOrigin = false; }

    iframes.push({
      src:        wpShort(fr.getAttribute("src") || "(无 src)", 120),
      visible:    wpMediaVisible(fr),
      sameOrigin: sameOrigin,
      note:       sameOrigin ? "可访问" : "跨域,内容不可访问",
    });
  }

  /* Shadow DOM(只能看到 open 的) */
  var all = document.querySelectorAll("*");
  var shadowHosts = 0;
  var shadows = [];
  for (var k = 0; k < all.length; k++) {
    var host = all[k];
    if (!host.shadowRoot) continue;
    shadowHosts++;

    if (shadows.length < WP_DEEP_MAX_SHADOWS) {
      var root = host.shadowRoot;
      var rootMedia = 0;
      try { rootMedia = root.querySelectorAll ? root.querySelectorAll("video, audio").length : 0; } catch (e) { rootMedia = 0; }

      shadows.push({
        host:        host.tagName.toLowerCase() + (host.id ? "#" + host.id : ""),
        mode:        "open",
        childCount:  root.childNodes ? root.childNodes.length : 0,
        mediaCount:  rootMedia,
        textPreview: wpShort((root.textContent || "").replace(/\s+/g, " "), 60),
        selector:    wpCssPathFor(host),
      });
    }
  }

  var counts = {
    dom:      all.length,
    video:    document.querySelectorAll("video").length,
    audio:    document.querySelectorAll("audio").length,
    iframe:   iframeEls.length,
    shadow:   shadowHosts,
    media:    media.length,
    button:   document.querySelectorAll("button, [role=button]").length,
    input:    document.querySelectorAll("input").length,
    textarea: document.querySelectorAll("textarea").length,
    select:   document.querySelectorAll("select").length,
    link:     document.querySelectorAll("a[href]").length,
    image:    document.querySelectorAll("img").length,
  };

  var operable = 0;
  for (var m = 0; m < media.length; m++) {
    if (media[m].hasSrc && media[m].readyState > 0) operable++;
  }
  counts.operableMedia = operable;

  var report = wpBuildDeepReport(counts, media, iframes, shadows, Date.now() - t0);

  return {
    ok:      true,
    token:   TX_PAGE_TOKEN,
    title:   document.title || "",
    url:     location.href,
    counts:  counts,
    media:   media,
    iframes: iframes,
    shadows: shadows,
    report:  report,
    length:  report.length,
  };
}

/** 深度分析 → 给模型看的文本摘要 */
function wpBuildDeepReport(counts, media, iframes, shadows, elapsed) {
  var lines = [];

  lines.push("【深度分析】" + (document.title || "(无标题)"));
  lines.push("【地址】" + location.href);
  lines.push("【规模】DOM " + counts.dom + " 个元素 · video " + counts.video + " · audio " + counts.audio +
    " · iframe " + counts.iframe + " · Shadow DOM " + counts.shadow + " · 可操作媒体 " + counts.operableMedia);
  lines.push("【其它】button " + counts.button + " · input " + counts.input + " · textarea " + counts.textarea +
    " · select " + counts.select + " · link " + counts.link + " · image " + counts.image);

  if (media.length) {
    lines.push("");
    lines.push("【媒体元素】可直接用 media_N 作为媒体动作的 target");
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      lines.push("- " + m.id + " (" + m.type + ") " +
        (m.visible ? "可见" : "不可见") + " · " + (m.paused ? "已暂停" : "播放中") +
        " · 倍速 " + m.playbackRate + " · 音量 " + m.volume + (m.muted ? "(静音)" : "") +
        " · 进度 " + m.currentTime + (m.duration === null ? "/未知(直播或未加载)" : "/" + m.duration) + " 秒" +
        " · readyState " + m.readyState + " · controls " + (m.controls ? "有" : "无") +
        " · 源 " + m.srcType + (m.inMain ? " · 位于主内容区" : "") +
        " · 尺寸 " + m.width + "x" + m.height);
      lines.push("  selector: " + m.selector);
    }
    lines.push("");
    lines.push("重要:源为 blob / hls 只表示地址不能直接下载,**不影响**播放、暂停、倍速、跳转、音量、静音、controls 这些 DOM 媒体控制。");
  } else {
    lines.push("");
    lines.push("【媒体元素】未发现 video / audio。");
  }

  if (iframes.length) {
    lines.push("");
    lines.push("【iframe】" + iframes.length + " 个");
    for (var f = 0; f < iframes.length; f++) {
      lines.push("- " + iframes[f].src + " · " + (iframes[f].visible ? "可见" : "不可见") + " · " + iframes[f].note);
    }
  }

  if (shadows.length) {
    lines.push("");
    lines.push("【Shadow DOM】发现 " + counts.shadow + " 个 open shadow root,可访问其内部");
    for (var s = 0; s < shadows.length; s++) {
      lines.push("- " + shadows[s].host + " · 子节点 " + shadows[s].childCount +
        " · 内含媒体 " + shadows[s].mediaCount + " · selector " + shadows[s].selector);
    }
  }

  lines.push("");
  lines.push("(分析用时 " + elapsed + "ms)");

  return lines.join("\n");
}

/* ==================================================================
   跨 frame 媒体执行层(第十二轮)
   ----------------------------------------------------------------
   背景:很多站点(如 B 站)真正的播放器在 iframe 里,顶层只有一个占位元素。
   内容脚本现已注入所有 frame(manifest: all_frames + match_about_blank),
   后台用 chrome.scripting.executeScript({allFrames:true}) 调用下面这些入口,
   在每个 frame 的孤立世界里各自执行,再由后台汇总结果。
   ================================================================== */

/* 保持倍速:页面把倍速改回去时自动重设,最多重试 N 次 */
const WP_RATE_KEEP_TRIES = 5;      // 普通「保持倍速」的重试上限
const WP_RATE_RECHECK_MS = 500;     // 设置后延迟复核
const WP_RATE_LOCK_INTERVAL = 1000; // 锁定模式的定时校验周期(低频,不用死循环)
const WP_RATE_LOCK_WINDOW_MS = 1000; // 互抢统计窗口
const WP_RATE_LOCK_MAX_FIGHTS = 5;   // 一个窗口内最多重设几次,超过即判定为互抢并停手

var wpRateKeepers = new Map();   // element -> { rate, tries, handler }(保持倍速,有限次)
var wpRateLocks   = new Map();   // element -> 锁定状态(持续维持)

/** 给元素加「保持倍速」(capture 阶段监听 ratechange,页面改回就重设) */
function wpKeepRate(el, rate, maxTries) {
  wpStopKeepRate(el);

  var handler = function () {
    var rec = wpRateKeepers.get(el);
    if (!rec) return;
    if (Math.abs(el.playbackRate - rec.rate) < 0.001) return;   // 已是目标值
    if (rec.tries >= maxTries) { wpStopKeepRate(el); return; }  // 重试次数用尽,不再纠缠
    rec.tries++;
    try { el.playbackRate = rec.rate; } catch (e) { /* 忽略 */ }
  };

  wpRateKeepers.set(el, { rate: rate, tries: 0, handler: handler });
  try { el.addEventListener("ratechange", handler, true); } catch (e) { /* 忽略 */ }
}

function wpStopKeepRate(el) {
  var rec = wpRateKeepers.get(el);
  if (!rec) return;
  try { el.removeEventListener("ratechange", rec.handler, true); } catch (e) { /* 忽略 */ }
  wpRateKeepers.delete(el);
}

/**
 * 锁定倍速:事件 + 低频定时校验(不是高频死循环)
 * 与「保持倍速」的区别:锁定会一直维持,直到撤销/恢复或用户重新设置倍速。
 *
 * 与其他倍速脚本 / 播放器互抢时的策略:
 *   正常播放器偶尔改一次 → 立刻恢复(锁定生效)
 *   对方在持续抢写(一个时间窗内超过上限)→ 停手,不再无限互相覆盖,
 *   并把停手原因交给 UI 如实说明
 */
function wpLockRate(el, rate) {
  wpUnlockRate(el);

  var state = {
    rate:        rate,
    locked:      true,
    conflicts:   0,      // 真实恢复次数
    windowStart: 0,      // 互抢统计窗口
    windowCount: 0,
    gaveUp:      false,  // 判定为互抢后停手
    stoppedAt:   null,
    timer:       null,
    handler:     null,
  };

  state.handler = function () {
    if (!state.locked) return;
    if (Math.abs(el.playbackRate - state.rate) < 0.001) return;

    var now = Date.now();
    if (!state.windowStart || now - state.windowStart > WP_RATE_LOCK_WINDOW_MS) {
      state.windowStart = now;
      state.windowCount = 0;
    }
    state.windowCount++;

    if (state.windowCount > WP_RATE_LOCK_MAX_FIGHTS) {
      // 对方在持续抢写:停手,别把时间耗在互相覆盖上
      state.gaveUp    = true;
      state.locked    = false;
      state.stoppedAt = el.playbackRate;
      if (state.timer) { try { clearInterval(state.timer); } catch (e) {} state.timer = null; }
      try { el.removeEventListener("ratechange", state.handler, true); } catch (e) {}
      return;
    }

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
      gaveUp:    !!st.gaveUp,       // 与其他脚本互抢后停手
      stoppedAt: st.stoppedAt,
    });
  });
  return out;
}

function wpStopAllKeepRate() {
  var els = [];
  wpRateKeepers.forEach(function (v, k) { els.push(k); });
  for (var i = 0; i < els.length; i++) wpStopKeepRate(els[i]);
}

/** 把一个步骤记进本 frame 的撤销栈 */
function wpPushStep(step) {
  if (!step || !step.records || !step.records.length) return;
  wpSteps.push(step);
}

/** 本 frame 的全部媒体元素:正在播放 → 可见 → 面积大 排在前面 */
function wpFrameMediaList(wanted) {
  var nodes = document.querySelectorAll(wanted ? wanted : "video, audio");
  var out = [];

  for (var i = 0; i < nodes.length; i++) {
    if (wpMediaTag(nodes[i])) out.push(nodes[i]);
  }

  out.sort(function (a, b) {
    var ap = (a.paused === false && (a.currentTime || 0) > 0) ? 1 : 0;
    var bp = (b.paused === false && (b.currentTime || 0) > 0) ? 1 : 0;
    if (ap !== bp) return bp - ap;

    var av = wpMediaVisible(a) ? 1 : 0;
    var bv = wpMediaVisible(b) ? 1 : 0;
    if (av !== bv) return bv - av;

    return wpMediaBox(b).area - wpMediaBox(a).area;
  });

  return out;
}

/**
 * 本 frame 执行媒体动作(由后台注入调用)
 * @param {{op:string, value:*, target:string, keep?:boolean, delayCheck?:boolean}} job
 */
async function wpFrameRunMedia(job) {
  if (!job || !job.op) return { ok: false, error: "缺少媒体操作", frame: location.href };

  var t = String(job.target === undefined || job.target === null ? "" : job.target).trim();

  /* 目标解析:明确指定 → 只改它;否则 → 本 frame 全部媒体 */
  var targets = [];
  if (t && t !== "video" && t !== "audio") {
    var picked = wpResolveMediaTarget(t);
    if (!picked.ok) return { ok: false, error: picked.error, skipped: true, frame: location.href };
    targets = [picked.el];
  } else {
    targets = wpFrameMediaList(t === "video" || t === "audio" ? t : "");
  }

  if (!targets.length) {
    return { ok: false, error: "本 frame 没有可操作的媒体元素", skipped: true, frame: location.href };
  }

  var results = [];

  for (var i = 0; i < targets.length; i++) {
    var el   = targets[i];
    var step = { summary: "跨 frame 媒体操作", records: [] };
    var ref  = wpEnsureMediaRef(el);
    var r    = wpMediaOperation(el, job.op, job.value, step, ref);

    // 倍速:
    //   · 「保持倍速」(有限次重试)沿用第十二轮行为,作用于本 frame 全部目标
    //   · 「锁定」只作用于主目标(正在播放 / 可见 / 最大,排在第一个),
    //     避免把页面上所有 video 都长期强制成同一个倍速
    if (r && r.ok && job.op === "rate" && job.keep !== false) {
      var isPrimary = (i === 0);

      if (job.lock === true && isPrimary) {
        wpLockRate(el, Number(job.value));
        r.detail = (r.detail || "") + "(已锁定)";
      } else {
        wpKeepRate(el, Number(job.value), WP_RATE_KEEP_TRIES);
      }
    }

    wpPushStep(step);   // 记进本 frame 的撤销栈

    results.push({
      id:          ref,
      ok:          !!(r && r.ok),
      detail:      (r && r.detail) || "",
      reason:      (r && r.reason) || "",
      actualValue: (r && r.actualValue !== undefined) ? r.actualValue : null,
    });
  }

  /* 倍速:延迟再复核一次,以延迟后的真实值为准 */
  if (job.op === "rate" && job.delayCheck !== false) {
    await new Promise(function (resolve) { setTimeout(resolve, WP_RATE_RECHECK_MS); });

    var want = Number(job.value);
    for (var j = 0; j < targets.length; j++) {
      var now = targets[j].playbackRate;
      var lk  = wpRateLocks.get(targets[j]);

      if (Math.abs(now - want) > 0.001) {
        if (lk && lk.locked) {
          // 锁定模式:网页确实改过,但我们已经(或即将)恢复 —— 如实说明,不算失败
          results[j].ok          = true;
          results[j].actualValue = now;
          results[j].detail      = "检测到网页修改倍速:" + now + " 倍,正在恢复到 " + want + " 倍";
          results[j].reason      = results[j].detail;
        } else {
          results[j].ok          = false;
          results[j].detail      = "";
          results[j].actualValue = now;
          results[j].reason = "网页播放器随后修改了倍速,当前实际倍速为 " + now + " 倍(目标 " + want + " 倍)" +
            (job.keep === false ? "" : ";已停止自动重设,避免与其他倍速插件互相覆盖");
        }
      } else if (lk && lk.locked && lk.conflicts > 0) {
        // 值对得上,但期间和别的脚本/播放器抢过 —— 说明一句,不假装风平浪静
        results[j].actualValue = now;
        results[j].detail      = "已锁定 " + want + " 倍(检测到其他脚本/播放器修改过倍速,已恢复 " + lk.conflicts + " 次)";
      } else {
        results[j].actualValue = now;
      }
    }
  }

  var applied = 0, failed = 0;
  for (var k = 0; k < results.length; k++) {
    if (results[k].ok) applied++; else failed++;
  }

  return {
    ok:      true,
    frame:   location.href,
    results: results,
    applied: applied,
    failed:  failed,
    locks:   wpRateLockReport(),
  };
}

/** 本 frame 的深度分析(由后台汇总) */
function wpFrameDeepAnalyze() {
  var mediaEls = document.querySelectorAll("video, audio");
  var media = [];

  for (var i = 0; i < mediaEls.length && media.length < WP_DEEP_MAX_MEDIA; i++) {
    if (!wpMediaTag(mediaEls[i])) continue;
    media.push(wpMediaState(mediaEls[i], wpEnsureMediaRef(mediaEls[i])));
  }

  var iframeEls = document.querySelectorAll("iframe");
  var iframes = [];
  for (var f = 0; f < iframeEls.length && f < WP_DEEP_MAX_IFRAMES; f++) {
    var fr = iframeEls[f];
    var sameOrigin = false;
    try { sameOrigin = !!(fr.contentDocument); } catch (e) { sameOrigin = false; }
    iframes.push({
      src:        wpShort(fr.getAttribute("src") || "(无 src)", 120),
      visible:    wpMediaVisible(fr),
      sameOrigin: sameOrigin,
      note:       sameOrigin ? "可访问" : "跨域,内容不可访问",
    });
  }

  var all = document.querySelectorAll("*");
  var shadowHosts = 0, shadows = [];
  for (var k = 0; k < all.length; k++) {
    var host = all[k];
    if (!host.shadowRoot) continue;
    shadowHosts++;
    if (shadows.length < WP_DEEP_MAX_SHADOWS) {
      var root = host.shadowRoot;
      var rm = 0;
      try { rm = root.querySelectorAll ? root.querySelectorAll("video, audio").length : 0; } catch (e) { rm = 0; }
      shadows.push({
        host:       host.tagName.toLowerCase() + (host.id ? "#" + host.id : ""),
        mode:       "open",
        childCount: root.childNodes ? root.childNodes.length : 0,
        mediaCount: rm,
        selector:   wpCssPathFor(host),
      });
    }
  }

  // ---- 第四阶段:结构化补充(交互元素 + 稳定 ID + 页面基础信息) ----
  var buttons  = wpCollectInteractiveKind("button, [role=\"button\"], input[type=\"button\"], input[type=\"submit\"]", "button", WP_DEEP_MAX_INTERACTIVE);
  var inputs   = wpCollectInteractiveKind("input:not([type=\"button\"]):not([type=\"submit\"])", "input", WP_DEEP_MAX_INTERACTIVE);
  var textareas= wpCollectInteractiveKind("textarea", "textarea", WP_DEEP_MAX_INTERACTIVE);
  var selects  = wpCollectInteractiveKind("select", "select", WP_DEEP_MAX_INTERACTIVE);
  var links    = wpCollectInteractiveKind("a[href]", "link", WP_DEEP_MAX_INTERACTIVE);
  var images   = wpCollectInteractiveKind("img", "image", WP_DEEP_MAX_INTERACTIVE);

  // 给媒体也配上稳定 ID(video_1 / audio_1),与 media_N 并存
  var videoSeen = 0, audioSeen = 0;
  for (var mi = 0; mi < media.length; mi++) {
    if (media[mi].type === "video") media[mi].stableId = wpStableId("video", videoSeen++);
    else                            media[mi].stableId = wpStableId("audio", audioSeen++);
  }

  var visibleCount = 0;
  for (var vi = 0; vi < all.length; vi++) {
    if (!wpHiddenBySite(all[vi])) visibleCount++;
  }

  return {
    ok:      true,
    url:     location.href,
    title:   document.title || "",
    page:    wpPageBasics(),
    media:   media,
    iframes: iframes,
    shadows: shadows,
    interactive: {
      buttons:   buttons,
      inputs:    inputs,
      textareas: textareas,
      selects:   selects,
      links:     links,
      images:    images,
    },
    forms:   wpCollectForms(),
    counts: {
      dom:       all.length,
      visible:   visibleCount,
      body:      document.body ? 1 : 0,
      video:     document.querySelectorAll("video").length,
      audio:     document.querySelectorAll("audio").length,
      iframe:    iframeEls.length,
      shadow:    shadowHosts,
      media:     media.length,
      playing:   wpFrameMediaList().length,
      button:    buttons.length,
      input:     inputs.length,
      textarea:  textareas.length,
      select:    selects.length,
      link:      links.length,
      image:     images.length,
      form:      document.querySelectorAll("form").length,
      mse:       (function () { var n = 0; for (var q = 0; q < media.length; q++) if (media[q].kind && media[q].kind.kind === "mse") n++; return n; })(),
      drm:       (function () { var n = 0; for (var q2 = 0; q2 < media.length; q2++) if (media[q2].kind && media[q2].kind.kind === "drm") n++; return n; })(),
    },
    stableIds: {
      video: videoSeen,
      audio: audioSeen,
    },
  };
}

/* ==================================================================
   深度分析增强(第四阶段)
   ----------------------------------------------------------------
   目标:让 AI 拿到一份**结构化**的页面描述,并且优先用稳定内部 ID
   (video_1 / button_1 / input_1 …)引用元素,而不是每次猜 CSS 选择器。
   这些 ID 只存在于本次分析的返回结果里,不写入页面任何属性。
   ================================================================== */

/** 稳定的语义编号:video_1 / audio_1 / button_1 / input_1 / link_1 / image_1 … */
function wpStableId(kind, index) {
  return String(kind) + "_" + (index + 1);
}

/** 一个元素的「交互描述」 */
function wpDescribeInteractive(el, kind, index) {
  var box = wpMediaBox(el);
  var label = "";

  try {
    label = el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            el.getAttribute("placeholder") ||
            (el.innerText ? el.innerText : el.textContent) || "";
  } catch (e) { label = ""; }

  return {
    id:       wpStableId(kind, index),
    tag:      (el.tagName || "").toLowerCase(),
    kind:     kind,
    text:     wpShort(String(label).replace(/\s+/g, " ").trim(), 80),
    ariaLabel: (function () { try { return wpShort(el.getAttribute("aria-label") || "", 60); } catch (e) { return ""; } })(),
    role:     (function () { try { return el.getAttribute("role") || ""; } catch (e) { return ""; } })(),
    elId:     el.id || "",
    className: wpClassPreview(el),
    name:     (function () { try { return el.getAttribute("name") || ""; } catch (e) { return ""; } })(),
    type:     (function () { try { return el.getAttribute("type") || ""; } catch (e) { return ""; } })(),
    href:     (function () { try { return wpShort(el.getAttribute("href") || "", 120); } catch (e) { return ""; } })(),
    visible:  !wpHiddenBySite(el) && box.w > 0 && box.h > 0,
    disabled: !!el.disabled,
    selector: wpCssPathFor(el),
  };
}

/** 收集一类交互元素 */
function wpCollectInteractiveKind(selector, kind, max) {
  var els = document.querySelectorAll(selector);
  var out = [];

  for (var i = 0; i < els.length && out.length < max; i++) {
    // 嵌套在别的 button 里的不算
    out.push(wpDescribeInteractive(els[i], kind, out.length));
  }
  return out;
}

/** 页面基础信息 */
function wpPageBasics() {
  var readyState = "";
  try { readyState = document.readyState || ""; } catch (e) { readyState = ""; }

  return {
    title:      document.title || "",
    url:        location.href,
    readyState: readyState,
    bodyExists: !!document.body,
    lang:       (function () { try { return document.documentElement.getAttribute("lang") || ""; } catch (e) { return ""; } })(),
    charset:    (function () { try { return document.characterSet || ""; } catch (e) { return ""; } })(),
    scrollY:    Math.round(window.scrollY || 0),
    viewport:   { w: window.innerWidth || 0, h: window.innerHeight || 0 },
  };
}

/** 表单概览 */
function wpCollectForms() {
  var forms = document.querySelectorAll("form");
  var out = [];

  for (var i = 0; i < forms.length && out.length < WP_DEEP_MAX_FORMS; i++) {
    var f = forms[i];
    var fields = 0;
    try { fields = f.querySelectorAll("input, textarea, select").length; } catch (e) { fields = 0; }
    out.push({
      id:       wpStableId("form", out.length),
      action:   wpShort(f.getAttribute("action") || "", 120),
      method:   (f.getAttribute("method") || "get").toLowerCase(),
      fields:   fields,
      selector: wpCssPathFor(f),
    });
  }
  return out;
}

/** 本 frame 撤销最近一步(供后台跨 frame 撤销调用) */
function wpFrameUndoLast() {
  wpStopAllKeepRate();
  var r = wpUndoLast();
  return { ok: true, undone: r.undone || 0, steps: r.steps || 0, message: r.message || "" };
}

/** 本 frame 恢复全部(供后台跨 frame 恢复调用) */
function wpFrameRestoreAll() {
  wpStopAllKeepRate();
  var r = wpRestoreAll();
  return { ok: true, undone: r.undone || 0, message: r.message || "" };
}


/* ==================================================================
   网页修改的刷新恢复(第四阶段)
   ----------------------------------------------------------------
   用户改过网页(背景、标题、隐藏元素…)之后刷新页面,
   这些修改会随 DOM 一起消失。这里在页面加载完成后主动问后台:
   「这个地址有没有需要恢复的修改?」有就重放一次,并**如实回报**结果。

   ⚠️ 只重放「AI 的结构化修改动作」,不保存也不还原整份 DOM / HTML。
   ================================================================== */

/** 只由顶层 frame 发起,避免每个 iframe 都去要一次 */
function wpIsTopFrame() {
  try { return window.top === window; } catch (e) { return false; }
}

/**
 * 向后台要恢复计划并重放
 * @returns {Promise<{applied:number, failed:number, failures:Array, recoverable:number}|null>}
 */
async function wpTryRecoverPatches() {
  var res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: MSG.PATCH_RECOVER, url: location.href });
  } catch (e) {
    return null;   // 后台没起来 / 扩展没装:静默跳过
  }

  if (!res || !res.ok || !res.hasPlan || !res.actions || !res.actions.length) return null;

  var outcome;
  try {
    outcome = wpApplyPlan({
      actions:      res.actions,
      summary:      res.summary || "刷新后恢复网页修改",
      allowFullPage: false,     // 恢复阶段一律走结构化动作,不允许整页替换
    });
  } catch (e) {
    outcome = { ok: false, modified: 0, failed: res.actions.length, failures: [{ action: "恢复", reason: String(e) }] };
  }

  var report = {
    url:         location.href,
    applied:     outcome.modified || 0,
    failed:      outcome.failed || 0,
    failures:    (outcome.failures || []).slice(0, 5),
    recoverable: res.actions.length,
  };

  // 回报给后台 → 侧边栏会在聊天里显示真实结果
  try {
    await chrome.runtime.sendMessage({
      type:      MSG.PATCH_RECOVERED,
      url:       report.url,
      applied:   report.applied,
      failed:    report.failed,
      failures:  report.failures,
      recoverable: report.recoverable,
    });
  } catch (e) { /* 侧边栏没开着也无所谓 */ }

  return report;
}

/* 页面加载完成后尝试恢复;延迟一点,等页面自己的脚本先跑完 */
if (wpIsTopFrame()) {
  var wpRecoverTimer = setTimeout(function () {
    wpTryRecoverPatches().catch(function () { /* 恢复失败不影响页面 */ });
  }, WP_RECOVER_DELAY_MS);

  // 页面在恢复前又被卸载,就不要再动它了
  window.addEventListener("pagehide", function () {
    if (wpRecoverTimer) clearTimeout(wpRecoverTimer);
  });
}

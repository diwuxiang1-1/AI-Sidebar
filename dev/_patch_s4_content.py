# -*- coding: utf-8 -*-
"""第四阶段 · 6:内容脚本 —— 刷新恢复 / 深度分析增强 / 媒体类型识别"""

import io

p = "content/content.js"
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
# 1. 消息常量
# ============================================================
rep("msg",
    '  /* 网页深度分析(第十一轮) */\n  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",',
    '  /* 网页深度分析(第十一轮) */\n'
    '  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",\n'
    '  /* 网页修改恢复(第四阶段) */\n'
    '  PATCH_RECOVER:   "ai-sidebar:patch-recover",\n'
    '  PATCH_RECOVERED: "ai-sidebar:patch-recovered",')

# ============================================================
# 2. 媒体类型识别:直链 / blob / MSE / 可能受保护
# ============================================================
MEDIA_KIND = r'''
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

'''
rep("kind", "function wpMediaState(el, ref) {", MEDIA_KIND.lstrip("\n") + "function wpMediaState(el, ref) {")

# ============================================================
# 3. 深度分析:结构化字段 + 稳定内部 ID
# ============================================================
DEEP_EXTRA = r'''
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

'''
rep("deepextra",
    "/** 本 frame 撤销最近一步(供后台跨 frame 撤销调用) */",
    DEEP_EXTRA.lstrip("\n") + "/** 本 frame 撤销最近一步(供后台跨 frame 撤销调用) */")

# 常量
rep("deepmax",
    "const WP_DEEP_MAX_MEDIA",
    "const WP_DEEP_MAX_FORMS   = 20;      // 深度分析:表单最多列出几个\nconst WP_DEEP_MAX_MEDIA")

# wpFrameDeepAnalyze 返回值扩展
rep("deepreturn",
    '''  return {
    ok:      true,
    url:     location.href,
    title:   document.title || "",
    media:   media,
    iframes: iframes,
    shadows: shadows,
    counts: {
      dom:      all.length,
      video:    document.querySelectorAll("video").length,
      audio:    document.querySelectorAll("audio").length,
      iframe:   iframeEls.length,
      shadow:   shadowHosts,
      media:    media.length,
      playing:  wpFrameMediaList().length,
    },
  };
}''',
    '''  // ---- 第四阶段:结构化补充(交互元素 + 稳定 ID + 页面基础信息) ----
  var buttons  = wpCollectInteractiveKind("button, [role=\\"button\\"], input[type=\\"button\\"], input[type=\\"submit\\"]", "button", WP_DEEP_MAX_INTERACTIVE);
  var inputs   = wpCollectInteractiveKind("input:not([type=\\"button\\"]):not([type=\\"submit\\"])", "input", WP_DEEP_MAX_INTERACTIVE);
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
}''')

# wpMediaState 带上 kind
rep("kindinstate",
    '    controls:     !!el.controls,\n    hasSrc:       srcType !== "none",\n    srcType:      srcType,',
    '    controls:     !!el.controls,\n    hasSrc:       srcType !== "none",\n    srcType:      srcType,\n'
    '    kind:         wpMediaKind(el),          // 第四阶段:直链 / blob+MSE / DRM\n'
    '    src:          wpShort(el.getAttribute("src") || "", 200),\n'
    '    currentSrc:   wpShort(el.currentSrc || "", 200),')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("content", k, "=", v)

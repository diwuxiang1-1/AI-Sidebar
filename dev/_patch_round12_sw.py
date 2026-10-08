# -*- coding: utf-8 -*-
# 一次性补丁(第十二轮):后台跨 frame 媒体执行 / 深度分析 / 撤销恢复。
# 执行完即可删除。

import io

p = "background/service-worker.js"
s = io.open(p, encoding="utf-8").read()
n = {}

# 1) 消息常量
old = u'''  /* 网页深度分析(第十一轮)*/
  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",'''
new = u'''  /* 网页深度分析(第十一轮)+ 跨 frame 媒体执行(第十二轮)*/
  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",
  MEDIA_APPLY:    "ai-sidebar:media-apply",'''
n['msg'] = s.count(old)
s = s.replace(old, new, 1)

# 2) 路由:深度分析改由后台全 frame 汇总;新增媒体扇出;撤销/恢复改为合并处理
old = u'''    // ---- 权限等级 1:网页代码执行(后台注入页面主世界,内容脚本不参与) ----'''
new = u'''    // ---- 跨 frame 媒体执行与深度分析(第十二轮):后台注入所有 frame 并汇总 ----
    case MSG.MEDIA_APPLY:
      mediaApplyAcrossFrames(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case MSG.DEEP_ANALYZE:
      deepAnalyzeAcrossFrames()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 撤销 / 恢复:顶层走内容脚本,其它 frame 只回滚各自的媒体记录 ----
    case MSG.PATCH_UNDO:
    case MSG.PATCH_RESTORE:
      patchUndoRestore(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    // ---- 权限等级 1:网页代码执行(后台注入页面主世界,内容脚本不参与) ----'''
n['route'] = s.count(old)
s = s.replace(old, new, 1)

# 3) 从转发列表里摘掉 PATCH_UNDO / PATCH_RESTORE / DEEP_ANALYZE(已改为后台自处理)
old = u'''    case MSG.PATCH_ANALYZE:
    case MSG.PATCH_APPLY:
    case MSG.PATCH_UNDO:
    case MSG.PATCH_RESTORE:
    case MSG.PATCH_STATE:
    case MSG.DEEP_ANALYZE:'''
new = u'''    case MSG.PATCH_ANALYZE:
    case MSG.PATCH_APPLY:
    case MSG.PATCH_STATE:'''
n['relay'] = s.count(old)
s = s.replace(old, new, 1)

APPEND = u'''

/* ==================================================================
   5. 跨 frame 媒体执行 / 深度分析(第十二轮)
   ----------------------------------------------------------------
   为什么需要:很多站点真正的播放器在 iframe 里(如 B 站),
   只改顶层文档会命中占位元素,看起来"成功"但实际没生效。

   做法:chrome.scripting.executeScript({ allFrames: true }) 会在每个 frame 的
   **同一个孤立世界**里运行注入函数,因此可以直接按名字调用内容脚本的全局函数
   (wpFrameRunMedia / wpFrameDeepAnalyze / wpFrameUndoLast)。
   结果按 frame 汇总后返回给侧边栏。
   ================================================================== */

/* ---- 注入到每个 frame 的函数(必须自包含,只能引用目标世界的全局) ---- */

async function aiFrameRunMedia(job) {
  if (typeof wpFrameRunMedia !== "function") {
    return { ok: false, error: "内容脚本未就绪,请刷新页面后重试", frame: String(location.href) };
  }
  return await wpFrameRunMedia(job);
}

function aiFrameDeepAnalyze() {
  if (typeof wpFrameDeepAnalyze !== "function") {
    return { ok: false, error: "内容脚本未就绪", frame: String(location.href) };
  }
  return wpFrameDeepAnalyze();
}

function aiFrameUndoRestore(restoreAll) {
  if (window.top === window) return { ok: true, skipped: true };   // 顶层已由内容脚本处理
  if (typeof wpFrameUndoLast !== "function") return { ok: true, skipped: true };
  return restoreAll ? wpFrameRestoreAll() : wpFrameUndoLast();
}

/* ---- 目标解析:f3_media_1 → 只对该 frame 执行 ---- */

function parseFrameScopedTarget(target) {
  var t = String(target || "").trim();
  if (t.charAt(0) !== "f") return { frameId: null, local: t };

  var sep = t.indexOf("_media_");
  if (sep < 2) return { frameId: null, local: t };

  var idStr = t.slice(1, sep);
  var num = parseInt(idStr, 10);
  if (!isFinite(num) || String(num) !== idStr) return { frameId: null, local: t };

  return { frameId: num, local: "media_" + t.slice(sep + 7) };
}

/* ---- 汇总 ---- */

function buildMediaMessage(applied, failed, reasons, actuals) {
  if (!applied && !failed) {
    return "没有找到可操作的媒体元素(页面可能尚未开始播放,或需要刷新页面)";
  }

  var msg = "已操作 " + applied + " 个媒体元素";
  if (failed) msg += "," + failed + " 个未成功";

  if (actuals && actuals.length) {
    var uniq = [];
    actuals.forEach(function (v) { if (uniq.indexOf(v) === -1) uniq.push(v); });
    msg += ";实际生效值:" + uniq.join(" / ");
  }
  if (reasons && reasons.length) msg += "(" + reasons[0] + ")";

  return msg;
}

function aggregateMediaFrames(frames, job) {
  var applied = 0, failed = 0, skippedFrames = 0;
  var details = [], reasons = [], actuals = [], perFrame = [];

  (frames || []).forEach(function (f) {
    var r = f && f.result;

    if (!r || !r.ok) {
      if (r && r.skipped) { skippedFrames++; return; }
      if (r && r.error) reasons.push("frame" + f.frameId + ": " + r.error);
      return;
    }

    applied += r.applied || 0;
    failed  += r.failed || 0;

    (r.results || []).forEach(function (x) {
      if (x.ok) {
        if (x.detail) details.push("frame" + f.frameId + " " + x.detail);
        if (x.actualValue !== null && x.actualValue !== undefined) actuals.push(x.actualValue);
      } else if (x.reason) {
        reasons.push("frame" + f.frameId + " " + x.reason);
      }
    });

    perFrame.push({ frameId: f.frameId, url: r.frame, applied: r.applied || 0, failed: r.failed || 0 });
  });

  return {
    ok:            true,
    applied:       applied,
    failed:        failed,
    frames:        perFrame,
    frameCount:    (frames || []).length,
    skippedFrames: skippedFrames,
    details:       details.slice(0, 10),
    reasons:       reasons.slice(0, 6),
    actualValues:  actuals,
    message:       buildMediaMessage(applied, failed, reasons, actuals),
  };
}

/* ---- 媒体:在所有 frame 执行 ---- */

async function mediaApplyAcrossFrames(msg) {
  const tab = await activeTabRaw();
  if (!tab || typeof tab.id !== "number") return { ok: false, error: "找不到可操作的活动标签页" };
  if (isRestrictedPageUrl(tab.url)) return { ok: false, error: "浏览器内部页面无法操作媒体" };

  const op = String((msg && msg.op) || "");
  if (!op) return { ok: false, error: "缺少媒体操作" };

  const scoped = parseFrameScopedTarget(msg && msg.target);

  const job = {
    op:         op,
    value:      msg && msg.value,
    target:     scoped.local,
    keep:       !(msg && msg.keep === false),
    delayCheck: !(msg && msg.delayCheck === false),
  };

  // 指定了 frame 就只打那个 frame,否则所有 frame
  const target = (scoped.frameId === null)
    ? { tabId: tab.id, allFrames: true }
    : { tabId: tab.id, frameIds: [scoped.frameId] };

  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: target, func: aiFrameRunMedia, args: [job] });
  } catch (e) {
    return { ok: false, error: "无法在页面中执行媒体操作:" + ((e && e.message) || e) };
  }

  const out = aggregateMediaFrames(frames, job);

  if (out.applied || out.failed) {
    await appendAuditLog("page", "media_" + op,
      "target=" + (scoped.local || "全部") + " value=" + job.value + " → " + out.message);
  }

  return out;
}

/* ---- 深度分析:汇总所有 frame ---- */

function buildCrossFrameReport(counts, media, iframes, shadows, frameCount, elapsed) {
  var lines = [];

  lines.push("【深度分析】" + (media.length ? "含 iframe 的完整扫描" : "扫描完成"));
  lines.push("【规模】扫描 " + frameCount + " 个 frame · DOM " + counts.dom + " 个元素 · video " +
    counts.video + " · audio " + counts.audio + " · iframe " + counts.iframe +
    " · Shadow DOM " + counts.shadow + " · 媒体合计 " + counts.media);

  if (media.length) {
    lines.push("");
    lines.push("【媒体元素】编号形如 f<frame>_media_N,可直接作为 media_* 动作的 target");
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      lines.push("- " + m.id + " (" + m.type + ") frame" + m.frameId + " · " +
        (m.visible ? "可见" : "不可见") + " · " + (m.paused ? "已暂停" : "播放中") +
        " · 倍速 " + m.playbackRate + " · 音量 " + m.volume + (m.muted ? "(静音)" : "") +
        " · 进度 " + m.currentTime + (m.duration === null ? "/未知" : "/" + m.duration) + " 秒" +
        " · 源 " + m.srcType);
      lines.push("  frame 地址: " + m.frameUrl);
    }
    lines.push("");
    lines.push("重要:源为 blob / hls 只表示地址不能直接下载,**不影响**播放、暂停、倍速、跳转、音量、静音、controls。");
    lines.push("若不指定 target,媒体动作会作用于**所有 frame 的所有媒体**。");
  } else {
    lines.push("");
    lines.push("【媒体元素】所有 frame 都未发现 video / audio。");
  }

  if (iframes.length) {
    lines.push("");
    lines.push("【iframe】" + iframes.length + " 个");
    for (var f = 0; f < iframes.length && f < 12; f++) {
      lines.push("- frame" + iframes[f].frameId + " " + iframes[f].src + " · " +
        (iframes[f].visible ? "可见" : "不可见") + " · " + iframes[f].note);
    }
  }

  if (shadows.length) {
    lines.push("");
    lines.push("【Shadow DOM】" + counts.shadow + " 个 open shadow root");
    for (var s = 0; s < shadows.length && s < 8; s++) {
      lines.push("- frame" + shadows[s].frameId + " " + shadows[s].host + " · 内含媒体 " + shadows[s].mediaCount);
    }
  }

  lines.push("");
  lines.push("(分析用时 " + elapsed + "ms)");

  return lines.join("\\n");
}

async function deepAnalyzeAcrossFrames() {
  const tab = await activeTabRaw();
  if (!tab || typeof tab.id !== "number") return { ok: false, error: "找不到可分析的活动标签页" };
  if (isRestrictedPageUrl(tab.url)) {
    return { ok: false, error: "浏览器内部页面无法深度分析,请在普通网页上使用" };
  }

  var t0 = Date.now();
  let frames;
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: aiFrameDeepAnalyze,
    });
  } catch (e) {
    return { ok: false, error: "无法在页面中执行深度分析:" + ((e && e.message) || e) };
  }

  var counts = { dom: 0, video: 0, audio: 0, iframe: 0, shadow: 0, media: 0, playing: 0 };
  var media = [], iframes = [], shadows = [];
  var scanned = 0;

  (frames || []).forEach(function (f) {
    var r = f && f.result;
    if (!r || !r.ok) return;
    scanned++;

    counts.dom    += r.counts.dom || 0;
    counts.video  += r.counts.video || 0;
    counts.audio  += r.counts.audio || 0;
    counts.iframe += r.counts.iframe || 0;
    counts.shadow += r.counts.shadow || 0;
    counts.media  += r.counts.media || 0;
    counts.playing += r.counts.playing || 0;

    (r.media || []).forEach(function (m) {
      m.frameId   = f.frameId;
      m.frameUrl  = r.url || "";
      m.id        = "f" + f.frameId + "_" + m.id;   // 加 frame 前缀,避免各 frame 编号冲突
      media.push(m);
    });
    (r.iframes || []).forEach(function (x) { x.frameId = f.frameId; iframes.push(x); });
    (r.shadows || []).forEach(function (x) { x.frameId = f.frameId; shadows.push(x); });
  });

  var report = buildCrossFrameReport(counts, media, iframes, shadows, scanned, Date.now() - t0);

  return {
    ok:      true,
    title:   tab.title || "",
    url:     tab.url || "",
    frameCount: scanned,
    counts:  counts,
    media:   media,
    iframes: iframes,
    shadows: shadows,
    report:  report,
    length:  report.length,
  };
}

/* ---- 撤销 / 恢复:顶层 + 其它 frame 的媒体记录 ---- */

async function patchUndoRestore(message) {
  const restore = message.type === MSG.PATCH_RESTORE;

  var top = null;
  try { top = await relayToContentScript(message); } catch (e) { top = null; }

  var otherFramesUndone = 0;
  const tab = await activeTabRaw();

  if (tab && typeof tab.id === "number" && !isRestrictedPageUrl(tab.url)) {
    try {
      const frames = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: aiFrameUndoRestore,
        args: [!!restore],
      });

      (frames || []).forEach(function (f) {
        var r = f && f.result;
        if (r && r.ok && !r.skipped) otherFramesUndone += r.undone || 0;
      });
    } catch (e) { /* 其它 frame 回滚失败不影响主流程 */ }
  }

  const base = (top && top.ok) ? top : { ok: true, steps: 0, undone: 0, canUndo: false, message: "" };

  var msg = base.message || (restore ? "已恢复网页" : "已撤销最近一次修改");
  if (otherFramesUndone) msg += ";(iframe 内另回滚 " + otherFramesUndone + " 步媒体修改)";

  return {
    ok:           true,
    undone:       base.undone || 0,
    steps:        base.steps || 0,
    canUndo:      base.canUndo === true,
    irreversible: base.irreversible || 0,
    otherFrames:  otherFramesUndone,
    message:      msg,
  };
}
'''

s = s + APPEND
io.open(p, "w", encoding="utf-8", newline="").write(s)

for k, v in n.items():
    print(k, "=", v)
print("SW 补丁完成")

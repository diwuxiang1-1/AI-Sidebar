# -*- coding: utf-8 -*-
# 一次性补丁(第十二轮):给 content.js 追加「跨 frame 媒体执行层」并清掉遗留死代码。
# 执行完即可删除。

import io

p = "content/content.js"
s = io.open(p, encoding="utf-8").read()
n = {}

# 1) 删除第九轮遗留的死函数(里面有一份过期的 rate 分支,容易误改)
start = s.find(u"/* 旧版 set_media 的剩余分支(已并入 wpMediaOperation,保留占位以免重复实现) */")
if start != -1:
    end = s.find(u"\n}\n", s.find(u"function wpActMediaLegacy", start))
    if end != -1:
        s = s[:start] + s[end + 3:]
        n["删除死代码"] = 1
    else:
        n["删除死代码"] = 0
else:
    n["删除死代码"] = 0

APPEND = u'''

/* ==================================================================
   跨 frame 媒体执行层(第十二轮)
   ----------------------------------------------------------------
   背景:很多站点(如 B 站)真正的播放器在 iframe 里,顶层只有一个占位元素。
   内容脚本现已注入所有 frame(manifest: all_frames + match_about_blank),
   后台用 chrome.scripting.executeScript({allFrames:true}) 调用下面这些入口,
   在每个 frame 的孤立世界里各自执行,再由后台汇总结果。
   ================================================================== */

/* 保持倍速:页面把倍速改回去时自动重设,最多重试 N 次 */
const WP_RATE_KEEP_TRIES = 5;
const WP_RATE_RECHECK_MS = 500;

var wpRateKeepers = new Map();   // element -> { rate, tries, handler }

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

    // 倍速成功后挂上「保持倍速」
    if (r && r.ok && job.op === "rate" && job.keep !== false) {
      wpKeepRate(el, Number(job.value), WP_RATE_KEEP_TRIES);
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
      if (Math.abs(now - want) > 0.001) {
        results[j].ok          = false;
        results[j].detail      = "";
        results[j].actualValue = now;
        results[j].reason      = "页面把倍速改回了 " + now + " 倍(请求 " + want + " 倍)";
      } else {
        results[j].actualValue = now;
      }
    }
  }

  var applied = 0, failed = 0;
  for (var k = 0; k < results.length; k++) {
    if (results[k].ok) applied++; else failed++;
  }

  return { ok: true, frame: location.href, results: results, applied: applied, failed: failed };
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

  return {
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
'''

s = s + APPEND
io.open(p, "w", encoding="utf-8", newline="").write(s)

for k, v in n.items():
    print(k, "=", v)
print("追加跨 frame 层完成")

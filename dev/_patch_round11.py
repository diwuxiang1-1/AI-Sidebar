# -*- coding: utf-8 -*-
# 一次性补丁脚本(第十一轮):把媒体动作接进 content.js。
# 执行完即可删除。

import io

p = "content/content.js"
s = io.open(p, encoding="utf-8").read()
n = {}

# (a) wpActMedia -> 薄封装 + 统一执行核心
old = u'''function wpActMedia(act, step) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到媒体元素" };

  var tag = el.tagName ? el.tagName.toUpperCase() : "";
  if (tag !== "VIDEO" && tag !== "AUDIO") {
    var inner = el.querySelector && el.querySelector("video, audio");
    if (inner) el = inner;
    else return { ok: false, reason: "目标不是 video / audio" };
  }

  var op = String(act.op || "");'''

new = u'''/** set_media:沿用原有入口(兼容旧方案),内部走统一媒体执行核心 */
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

/* 旧版 set_media 的剩余分支(已并入 wpMediaOperation,保留占位以免重复实现) */
function wpActMediaLegacy(act, step) {
  var el = wpResolveTarget(act);
  if (!el) return { ok: false, reason: "找不到媒体元素" };

  var op = String(act.op || "");'''

n['actMedia'] = s.count(old)
s = s.replace(old, new, 1)

# (b) wpRunAction:8 个媒体动作
old = u'''    case "set_media":   return wpActMedia(act, step);
    default:            return { ok: false, reason: "不支持的动作" };'''
new = u'''    case "set_media":   return wpActMedia(act, step);
    /* 媒体专用动作(第十一轮),全部复用同一执行核心 */
    case "media_play":            return wpActMediaOp(act, step, "play");
    case "media_pause":           return wpActMediaOp(act, step, "pause");
    case "media_seek":            return wpActMediaOp(act, step, "seek");
    case "media_set_rate":        return wpActMediaOp(act, step, "rate");
    case "media_set_volume":      return wpActMediaOp(act, step, "volume");
    case "media_mute":            return wpActMediaOp(act, step, "muted", true);
    case "media_unmute":          return wpActMediaOp(act, step, "muted", false);
    case "media_toggle_controls": return wpActMediaOp(act, step, "controls", "toggle");
    default:            return { ok: false, reason: "不支持的动作" };'''
n['runAction'] = s.count(old)
s = s.replace(old, new, 1)

# (c) wpApplyPlan:收集真实执行结果
old = u'''  var modified = 0;
  var failures = [];

  for (var i = 0; i < actions.length; i++) {
    var act = actions[i];
    var mark = step.records.length;      // 本动作写入前的记录位置,失败时只回滚本动作

    try {
      var res = wpRunAction(act, step, allowFull);
      if (res && res.ok) modified++;
      else failures.push({ index: i, action: act && act.action, reason: (res && res.reason) || "执行失败" });
    } catch (err) {
      if (step.records.length > mark) wpRollbackRecords(step.records.splice(mark));
      failures.push({ index: i, action: act && act.action, reason: "执行异常:" + (err && err.message ? err.message : String(err)) });
    }
  }'''
new = u'''  var modified = 0;
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
  }'''
n['results'] = s.count(old)
s = s.replace(old, new, 1)

old = u'''    failures: failures.slice(0, 8),
    irreversible: irreversible.length,'''
new = u'''    failures: failures.slice(0, 8),
    results:  results.slice(0, 30),
    irreversible: irreversible.length,'''
n['resultsOut'] = s.count(old)
s = s.replace(old, new, 1)

# (d) 深度分析消息
old = u'''  PATCH_STATE:    "ai-sidebar:patch-state",'''
new = u'''  PATCH_STATE:    "ai-sidebar:patch-state",
  /* 网页深度分析(第十一轮) */
  DEEP_ANALYZE:   "ai-sidebar:deep-analyze",'''
n['msg'] = s.count(old)
s = s.replace(old, new, 1)

old = u'''      case MSG.PATCH_STATE:
        sendResponse(wpStateReport());
        break;'''
new = u'''      case MSG.PATCH_STATE:
        sendResponse(wpStateReport());
        break;

      case MSG.DEEP_ANALYZE:
        sendResponse(wpDeepAnalyze());
        break;'''
n['case'] = s.count(old)
s = s.replace(old, new, 1)

# (e) 撤销:播放状态尽力恢复
old = u'''    case "irreversible":'''
new = u'''    case "playState":
      // 播放/暂停:尽力恢复到操作前状态(自动播放策略可能拦截)
      try { if (rec.prev) rec.el.pause(); else rec.el.play(); } catch (e) { /* 尽力而为 */ }
      break;

    case "irreversible":'''
n['undo'] = s.count(old)
s = s.replace(old, new, 1)

# (f) wpCollectMedia:媒体用 media_N + 关键状态
old = u'''    var ref   = wpEnsureRef(el);
    var parts = [ref, el.tagName.toLowerCase()];

    var label = el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("aria-label");
    if (label) parts.push('"' + wpShort(label, 40) + '"');'''
new = u'''    var mediaTag = wpMediaTag(el);

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
    if (label) parts.push('"' + wpShort(label, 40) + '"');'''
n['collectMedia'] = s.count(old)
s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print(k, "=", v)

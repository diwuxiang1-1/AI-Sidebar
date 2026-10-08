# -*- coding: utf-8 -*-
"""第四阶段 · 8:资源页 —— 媒体类型状态 + 只对直链提供下载"""

import io

def rep_file(path, pairs, tag):
    s = io.open(path, encoding="utf-8").read()
    for name, old, new in pairs:
        c = s.count(old)
        print(tag, name, "=", c)
        if c != 1:
            raise SystemExit("!! %s / %s 匹配 %d 次" % (tag, name, c))
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(s)

# ============================================================
# 1. 内容脚本:媒体资源带上真实形态
# ============================================================
rep_file("content/content.js", [
    ("mediaResourceInfo",
     '''function mediaResourceInfo(el, type) {
  var raw = el.getAttribute("src");
  if (!raw) return null;

  var url = resolveResourceUrl(raw);
  if (!url) return null;

  var fallback = type === "video" ? "视频" : "音频";
  var name = cleanResourceText(el.getAttribute("title")) ||
             cleanResourceText(el.getAttribute("aria-label")) ||
             fileNameFromUrl(url) || fallback;

  return { type: type, name: name, url: url };
}''',
     '''function mediaResourceInfo(el, type) {
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
}'''),
], "content.js")

# ============================================================
# 2. 侧边栏:渲染状态 + 下载按钮
# ============================================================
rep_file("sidebar/sidebar.js", [
    ("item",
     '''  var urlEl = document.createElement("div");
  urlEl.className = "res-url";
  urlEl.textContent = shortenResourceUrl(item.url);   // 显示用截断
  urlEl.title = item.url;                             // 悬停可见完整地址

  meta.appendChild(nameEl);
  meta.appendChild(urlEl);''',
     '''  var urlEl = document.createElement("div");
  urlEl.className = "res-url";
  urlEl.textContent = shortenResourceUrl(item.url);   // 显示用截断
  urlEl.title = item.url;                             // 悬停可见完整地址

  meta.appendChild(nameEl);

  // 第四阶段:媒体状态一眼可见 —— 为什么有的能下载、有的不能
  if (item.statusLabel) {
    var stEl = document.createElement("div");
    stEl.className = "res-status-line";
    stEl.textContent =
      "来源:" + resSourceLabel(item.url) +
      " · 状态:" + item.statusLabel +
      " · 控制:" + (item.controllable === false ? "不支持" : "支持") +
      " · 下载:" + (item.downloadable ? "可用" : "暂不支持");
    if (item.note) stEl.title = item.note;
    meta.appendChild(stEl);
  }

  meta.appendChild(urlEl);'''),

    ("buttons",
     '''  var copyBtn = document.createElement("button");
  copyBtn.className = "btn btn-small";
  copyBtn.type = "button";
  copyBtn.textContent = "复制";
  copyBtn.addEventListener("click", function () { copyResourceUrl(item.url, copyBtn); });

  actions.appendChild(openBtn);
  actions.appendChild(copyBtn);''',
     '''  var copyBtn = document.createElement("button");
  copyBtn.className = "btn btn-small";
  copyBtn.type = "button";
  copyBtn.textContent = "复制";
  copyBtn.addEventListener("click", function () { copyResourceUrl(item.url, copyBtn); });

  actions.appendChild(openBtn);
  actions.appendChild(copyBtn);

  // 只有「普通直链」才给下载:blob / MSE / DRM 不假装能下
  if (item.downloadable) {
    var dlBtn = document.createElement("button");
    dlBtn.className = "btn btn-small";
    dlBtn.type = "button";
    dlBtn.textContent = "下载";
    dlBtn.addEventListener("click", function () { downloadResource(item, dlBtn); });
    actions.appendChild(dlBtn);
  }'''),

    ("helpers",
     '''/** 显示用:超长 URL 截断,避免把列表撑坏(复制/打开仍用完整地址) */''',
     '''/** 资源地址形态的简短标签 */
function resSourceLabel(url) {
  var s = String(url || "");
  if (s.indexOf("blob:") === 0) return "blob:";
  if (s.indexOf("data:") === 0) return "data:";
  if (s.indexOf(".m3u8") !== -1) return "HLS(m3u8)";
  if (/^https?:/i.test(s)) return "https";
  return "其他";
}

/**
 * 下载一个「普通直链」资源
 * 走已有的浏览器工具(权限等级 2),不做任何绕过:
 *   · blob / MSE / DRM 一律不给下载按钮
 *   · 不注入网络拦截、不读 Cookie、不解密
 */
async function downloadResource(item, btn) {
  if (!item || !item.url) return;

  if (!item.downloadable) {
    setResStatus("这类资源(blob / MSE / 受保护媒体)不支持直接下载。", "error");
    return;
  }

  btn.disabled = true;
  var old = btn.textContent;
  btn.textContent = "下载中…";

  var res = null;
  try {
    res = await sendMsg({
      type: MSG.BROWSER_TOOL,
      tool: "downloads.start",
      args: { url: item.url, filename: item.name || "" },
    });
  } catch (e) { res = null; }

  btn.disabled = false;

  if (!res || !res.ok) {
    btn.textContent = old;
    // 权限不足时给出明确指引,不抛原始 JS 错误
    setResStatus((res && res.error) || "下载失败", "error");
    return;
  }

  btn.textContent = "已下载";
  setResStatus("已开始下载:" + (item.name || item.url), "ok");
  setTimeout(function () { btn.textContent = old; }, 1500);
}

/** 显示用:超长 URL 截断,避免把列表撑坏(复制/打开仍用完整地址) */'''),
], "sidebar.js")

# ============================================================
# 3. CSS:状态行
# ============================================================
rep_file("sidebar/sidebar.css", [
    ("status",
     '/* AI 操作目标栏(第四阶段) */',
     '/* 资源媒体状态行(第四阶段) */\n'
     '.res-status-line { margin-top: 2px; font-size: 11px; color: #6e7681; }\n\n'
     '/* AI 操作目标栏(第四阶段) */'),
    ("dark",
     '  .target-bar { background: #232528; border-color: rgba(255,255,255,0.12); }',
     '  .res-status-line { color: #9aa0a6; }\n'
     '  .target-bar { background: #232528; border-color: rgba(255,255,255,0.12); }'),
], "sidebar.css")

print("资源页补丁完成")

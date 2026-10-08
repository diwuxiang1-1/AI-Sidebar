# -*- coding: utf-8 -*-
"""第四阶段 · 7:内容脚本 —— 页面重新加载后自动恢复网页修改"""

import io

p = "content/content.js"
s = io.open(p, encoding="utf-8").read()

BOOT = r'''

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
'''

assert s.count("\nfunction wpFrameRestoreAll()") == 1
s = s.rstrip() + "\n" + BOOT

# 常量:恢复延迟
old = "const WP_DEEP_MAX_FORMS   = 20;"
new = "const WP_RECOVER_DELAY_MS = 800;    // 刷新后等待页面自身脚本就绪再恢复修改\nconst WP_DEEP_MAX_FORMS   = 20;"
assert s.count(old) == 1
s = s.replace(old, new, 1)

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("content 恢复块已加入")

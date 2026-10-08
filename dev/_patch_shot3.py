# -*- coding: utf-8 -*-
"""完整版 5c:后台截图 + 侧边栏接线(重做,锚点用单行)"""

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
# 后台
# ============================================================
CAPTURE = r'''/* ==================================================================
   3e. 网页截图(完整版)
   ----------------------------------------------------------------
   用 chrome.tabs.captureVisibleTab 抓「用户此刻看到的画面」。
   ⚠️ 浏览器限制(改代码解决不了):
      · 只能抓**当前窗口正在显示**的那个标签页 —— 后台标签抓不到
      · 页面被切走 / 窗口最小化时抓不到
      · 浏览器内部页面永远抓不到
   抓不到就如实说明,绝不返回一张假图。
   ================================================================== */

async function captureTargetScreenshot(msg) {
  const guard = await guardTarget(msg);
  if (!guard.ok) return guard;

  const tab = guard.tab;
  if (isRestrictedPageUrl(tab.url)) {
    return { ok: false, code: "restricted", error: "浏览器内部页面无法截图。" };
  }

  // 只能抓当前窗口正在显示的那个标签页
  const active = await activeTabRaw();
  if (!active || active.id !== tab.id) {
    return {
      ok: false,
      code: "not-visible",
      error: "只能截图浏览器当前正在显示的那个网页(切走或最小化时截不到)。请把目标网页切到前台再试。",
    };
  }

  let dataUrl = "";
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  } catch (e) {
    return {
      ok: false,
      code: "capture-failed",
      error: "截图失败:" + ((e && e.message) || e) + "(常见原因:窗口最小化、页面被切走、或浏览器限制)",
    };
  }

  if (!dataUrl || dataUrl.indexOf("data:image") !== 0) {
    return { ok: false, code: "capture-empty", error: "截图没有拿到画面内容。" };
  }

  // 过大的图会浪费大量 token,做个上限保护(约 3MB base64)
  if (dataUrl.length > 3 * 1024 * 1024) {
    return { ok: false, code: "too-large", error: "截图过大,已放弃本次视觉上下文(不影响文字上下文)。" };
  }

  await appendAuditLog("base", "网页截图", "Tab " + tab.id + " " + (tab.title || ""));

  return {
    ok:      true,
    dataUrl: dataUrl,
    tabId:   tab.id,
    title:   tab.title || "",
    url:     tab.url || "",
    bytes:   dataUrl.length,
  };
}

'''

rep_file("background/service-worker.js", [
    ("msg",
     '  PATCH_RECOVER:     "ai-sidebar:patch-recover",',
     '  CAPTURE_SCREENSHOT: "ai-sidebar:capture-screenshot",\n'
     '  PATCH_RECOVER:     "ai-sidebar:patch-recover",'),

    ("route",
     '    case MSG.PATCH_RECOVER:',
     '    case MSG.CAPTURE_SCREENSHOT:\n'
     '      captureTargetScreenshot(message)\n'
     '        .then(sendResponse)\n'
     '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
     '      return true;\n'
     '\n'
     '    case MSG.PATCH_RECOVER:'),

    ("impl",
     "/* ==================================================================\n   4. AI 权限:等级 1 网页代码执行",
     CAPTURE + "/* ==================================================================\n   4. AI 权限:等级 1 网页代码执行"),
], "service-worker.js")

# ============================================================
# 侧边栏接线
# ============================================================
rep_file("sidebar/sidebar.js", [
    ("msg",
     '  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",',
     '  CAPTURE_SCREENSHOT: "ai-sidebar:capture-screenshot",\n'
     '  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",'),

    ("dosend",
     '  var contextMessages = await buildChatContext();\n  if (!contextMessages) return;',
     '  var contextMessages = await buildChatContext();\n'
     '  if (!contextMessages) return;\n'
     '\n'
     '  // 完整版:问题需要「看」页面时,按需附上用户此刻看到的画面\n'
     '  lastShot = await prepareVisualContext(text, config);\n'
     '  if (lastShot && lastShot.messages) contextMessages = contextMessages.concat(lastShot.messages);'),

    ("apimsg",
     '  var apiMessages = contextMessages.concat(messages);\n',
     '  var apiMessages = contextMessages.concat(messages);\n'
     '  // 视觉上下文:图片挂到「本次用户消息」上(克隆消息对象,不污染会话历史)\n'
     '  if (lastShot && lastShot.imagePart) apiMessages = attachImageToLastUser(apiMessages, lastShot.imagePart);\n'),
], "sidebar.js")

print("截图接线完成")

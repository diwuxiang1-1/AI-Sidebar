# -*- coding: utf-8 -*-
"""完整版 5:后台截图能力 + 侧边栏按需接入多模态上下文"""

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
# 1. 后台:截图
# ============================================================
rep_file("background/service-worker.js", [
    ("msg",
     '  /* 网页修改恢复(第四阶段) */\n  PATCH_RECOVER:     "ai-sidebar:patch-recover",',
     '  /* 网页截图 / 视觉上下文(完整版) */\n'
     '  CAPTURE_SCREENSHOT: "ai-sidebar:capture-screenshot",\n'
     '  /* 网页修改恢复(第四阶段) */\n  PATCH_RECOVER:     "ai-sidebar:patch-recover",'),

    ("route",
     '    // ---- 网页修改恢复(第四阶段) ----\n    case MSG.PATCH_RECOVER:',
     '    // ---- 网页截图(完整版) ----\n'
     '    case MSG.CAPTURE_SCREENSHOT:\n'
     '      captureTargetScreenshot(message)\n'
     '        .then(sendResponse)\n'
     '        .catch((error) => sendResponse({ ok: false, error: String(error) }));\n'
     '      return true;\n'
     '\n'
     '    // ---- 网页修改恢复(第四阶段) ----\n    case MSG.PATCH_RECOVER:'),

    ("impl",
     "/* ==================================================================\n   4. AI 权限:等级 1 网页代码执行 + 等级 2 浏览器工具(第十轮)",
     r'''/* ==================================================================
   3e. 网页截图(完整版)
   ----------------------------------------------------------------
   用 chrome.tabs.captureVisibleTab 抓「用户此刻看到的画面」。
   ⚠️ 浏览器限制(改代码解决不了):
      · 只能抓**当前窗口正在显示**的那个标签页 —— 后台标签抓不到
      · 页面被切走 / 窗口最小化时抓不到
      · 受浏览器自身权限限制,某些内部页面永远抓不到
   抓不到就如实说明,不返回一张假图。
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

  // 过大的图会浪费大量 token,这里做个上限保护(约 3MB base64)
  if (dataUrl.length > 3 * 1024 * 1024) {
    return { ok: false, code: "too-large", error: "截图过大,已放弃本次视觉上下文(不会影响文字上下文)。" };
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

/* ==================================================================
   4. AI 权限:等级 1 网页代码执行 + 等级 2 浏览器工具(第十轮)'''),
], "service-worker.js")

# ============================================================
# 2. 侧边栏:消息常量 + 按需截图 + 多模态组装
# ============================================================
rep_file("sidebar/sidebar.js", [
    ("msg",
     '  /* 网页修改恢复(第四阶段) */\n  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",',
     '  /* 网页截图 / 视觉上下文(完整版) */\n'
     '  CAPTURE_SCREENSHOT: "ai-sidebar:capture-screenshot",\n'
     '  /* 网页修改恢复(第四阶段) */\n  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",'),

    ("dosend",
     '  var contextMessages = await buildChatContext();\n  if (!contextMessages) return;\n',
     '  var contextMessages = await buildChatContext();\n'
     '  if (!contextMessages) return;\n'
     '\n'
     '  // 完整版:需要视觉理解时,按需附上「用户此刻看到的画面」\n'
     '  lastShot = await prepareVisualContext(text, config);\n'
     '  if (lastShot && lastShot.messages) contextMessages = contextMessages.concat(lastShot.messages);\n'),

    ("apimsg",
     '  activeAiBubble = createStreamingBubble();\n\n  var apiMessages = contextMessages.concat(messages);',
     '  activeAiBubble = createStreamingBubble();\n\n'
     '  var apiMessages = contextMessages.concat(messages);\n'
     '  // 视觉上下文:把图片挂到「本次用户消息」上(克隆一份,不污染会话历史)\n'
     '  if (lastShot && lastShot.imagePart) apiMessages = attachImageToLastUser(apiMessages, lastShot.imagePart);'),
], "sidebar.js")

VISUAL_FN = r'''
/* ==================================================================
   视觉上下文:按需截图(完整版)
   ----------------------------------------------------------------
   规则:
     · 只在开着「当前网页」、且问题**明显需要看**的时候才截图
     · 模型明显不支持视觉 → 直接跳过,不浪费一次截图
     · 截图失败 → 说明原因后**照常继续纯文字对话**,不让整个聊天失败
     · 截图只存在于本次请求,永不写入会话历史
   ================================================================== */

/** 是否应该为这次提问抓一张图 */
function shouldCaptureScreen(text, config) {
  var mode = (contextConfig && contextConfig.visionMode) || "auto";
  if (mode === "off") return false;
  if (chatMode !== "page") return false;              // 没开网页上下文就没必要看页面
  if (!modelSupportsVision(config && config.model)) return false;   // 模型看不见图,抓了也没用
  if (mode === "on") return true;
  return needsVisualContext(text);
}

/**
 * 准备视觉上下文
 * @returns {Promise<null|{messages:Array, imagePart:object|null, note:string}>}
 */
async function prepareVisualContext(text, config) {
  if (!shouldCaptureScreen(text, config)) return null;

  var res = null;
  try { res = await sendMsg({ type: MSG.CAPTURE_SCREENSHOT }); } catch (e) { res = null; }

  if (!res || !res.ok) {
    // 抓不到就说清楚,但**不影响本次对话**
    var why = (res && res.error) || "截图失败";
    appendMessage("system", "【视觉上下文】" + why + " 本次改用文字上下文回答。");
    return null;
  }

  var pageInfo = { title: res.title, url: res.url };
  var imagePart = buildImagePart(res.dataUrl, "auto");

  return {
    messages: [
      { role: "system", content: buildScreenshotNote(pageInfo) },
    ],
    imagePart: imagePart,
    note: "已附上当前网页截图",
  };
}

/**
 * 把图片挂到「最后一条用户消息」上
 * ⚠️ 必须克隆消息对象 —— 否则会把图片写进 messages,污染会话历史
 */
function attachImageToLastUser(apiMessages, imagePart) {
  var out = apiMessages.slice();

  for (var i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user") continue;

    var text = typeof out[i].content === "string" ? out[i].content : "";
    out[i] = {
      role:    "user",
      content: [
        { type: "text", text: text },
        imagePart,
      ],
    };
    break;
  }

  return out;
}

/**
 * 模型不支持图片时的兜底:去掉图片重试一次
 * 只在错误信息明确指向「图片」时才重试,避免把无关错误也重试一遍
 */
function isImageRejectedError(err) {
  var m = String((err && err.message) || err || "").toLowerCase();
  if (!m) return false;
  return (m.indexOf("image") !== -1 || m.indexOf("vision") !== -1 || m.indexOf("multimodal") !== -1 ||
          m.indexOf("图片") !== -1 || m.indexOf("content") !== -1 && m.indexOf("type") !== -1);
}

'''

rep_file("sidebar/sidebar.js", [
    ("lastshot",
     'var pendingTargetText  = "";',
     'var lastShot = null;
var pendingTargetText  = "";'),

    ("visualfn", "/* ==================================================================\n   5b. 聊天上下文组装",
     VISUAL_FN.lstrip("\n") + "/* ==================================================================\n   5b. 聊天上下文组装"),
], "sidebar.js")

print("视觉上下文已接线")

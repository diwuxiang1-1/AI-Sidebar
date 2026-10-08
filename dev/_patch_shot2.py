# -*- coding: utf-8 -*-
"""完整版 5b:lastShot 声明 + 视觉函数接线(单独一个可靠的小补丁)"""

import io

BS = chr(92)
NL = BS + "n"

# ---- 1. 侧边栏:声明 lastShot ----
p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()

old = 'var pendingTargetText  = "";'
new = ('var lastShot           = null;   // 本次请求的截图(只用于当前请求,不写入会话历史)' + chr(10) +
       'var pendingTargetText  = "";')
assert s.count(old) == 1, "lastShot 锚点"
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("sidebar: lastShot 已声明")

# ---- 2. 侧边栏:插入视觉上下文函数 ----
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
  if (chatMode !== "page") return false;                            // 没开网页上下文就没必要看页面
  if (!modelSupportsVision(config && config.model)) return false;   // 模型看不见图,抓了也没用
  if (mode === "on") return true;
  return needsVisualContext(text);
}

/**
 * 准备视觉上下文
 * @returns {Promise<null|{messages:Array, imagePart:object}>}
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

  return {
    messages:  [{ role: "system", content: buildScreenshotNote({ title: res.title, url: res.url }) }],
    imagePart: buildImagePart(res.dataUrl, "auto"),
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
      content: [{ type: "text", text: text }, imagePart],
    };
    break;
  }

  return out;
}

/** 去掉图片重试用的判定:只在错误明确指向「图片 / 多模态」时才认为是模型不支持 */
function isImageRejectedError(err) {
  var m = String((err && err.message) || err || "").toLowerCase();
  if (!m) return false;
  return m.indexOf("image") !== -1 ||
         m.indexOf("vision") !== -1 ||
         m.indexOf("multimodal") !== -1 ||
         m.indexOf("图片") !== -1;
}

'''

anchor = "/* ==================================================================\n   5b. 聊天上下文组装"
s2 = io.open(p, encoding="utf-8").read()
assert s2.count(anchor) == 1, "视觉函数锚点"
io.open(p, "w", encoding="utf-8", newline="").write(s2.replace(anchor, VISUAL_FN.lstrip("\n") + anchor, 1))
print("sidebar: 视觉上下文函数已插入")

# -*- coding: utf-8 -*-
"""完整版 4:多模态网页上下文(按需截图)+ 文件输入支持判定"""

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
# 1. utils/context.js:视觉能力 + 视觉需求判定 + 文件上下文
# ============================================================
rep_file("utils/context.js", [
    ("config",
     "var DEFAULT_CONTEXT_CONFIG = {\n"
     "  pageMaxTokens:     4000,\n"
     "  showTokenEstimate: true,\n"
     "  showCostEstimate:  true,\n"
     "};",
     "var DEFAULT_CONTEXT_CONFIG = {\n"
     "  pageMaxTokens:     4000,\n"
     "  showTokenEstimate: true,\n"
     "  showCostEstimate:  true,\n"
     "  /* 视觉上下文模式:\n"
     "       auto —— 只有问题明显需要「看」页面时才附截图(默认)\n"
     "       on   —— 开着「当前网页」时总是附截图\n"
     "       off  —— 从不附截图                                            */\n"
     "  visionMode:        \"auto\",\n"
     "};"),

    ("normalize",
     "  merged.showTokenEstimate = merged.showTokenEstimate !== false;\n"
     "  merged.showCostEstimate  = merged.showCostEstimate  !== false;\n"
     "\n"
     "  return merged;\n"
     "}",
     "  merged.showTokenEstimate = merged.showTokenEstimate !== false;\n"
     "  merged.showCostEstimate  = merged.showCostEstimate  !== false;\n"
     "\n"
     "  if ([\"auto\", \"on\", \"off\"].indexOf(merged.visionMode) === -1) {\n"
     "    merged.visionMode = DEFAULT_CONTEXT_CONFIG.visionMode;\n"
     "  }\n"
     "\n"
     "  return merged;\n"
     "}"),
], "context.js")

VISION = r'''
/* ==================================================================
   视觉上下文(完整版)
   ----------------------------------------------------------------
   为什么需要:
     用户眼睛能看到的东西,DOM 文本不一定拿得到 —— 图片里的字、红色报错、
     按钮位置、排版错乱、图表。这些只能靠截图看。
   原则:
     · **按需**截图,不是每次都发(省 token、省时间)
     · 不回退成「假成功」:模型不支持视觉就明确说,并退回文本上下文
     · 截图只存在于本次请求里,**不写进会话历史**
   ================================================================== */

/** 名字里带这些片段的模型,认为支持图片输入 */
var VISION_MODEL_HINTS = [
  "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision", "gpt-5", "o1", "o3", "o4",
  "claude-3", "claude-4", "claude-sonnet", "claude-opus", "claude-haiku",
  "gemini", "gemma-3",
  "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl", "qvq",
  "glm-4v", "glm-4.5v", "cogvlm",
  "internvl", "llava", "minicpm-v", "pixtral", "molmo", "idefics",
  "step-1v", "yi-vision", "deepseek-vl", "doubao-vision", "vision",
];

/**
 * 这个模型是否（很可能）支持图片输入
 * 说明:这是**基于模型名的启发式判断**,不是权威能力表。
 *       判错时的兜底见 sidebar 的「图片被拒绝就退回纯文本重试」。
 */
function modelSupportsVision(modelId) {
  var id = String(modelId || "").toLowerCase();
  if (!id) return false;
  for (var i = 0; i < VISION_MODEL_HINTS.length; i++) {
    if (id.indexOf(VISION_MODEL_HINTS[i]) !== -1) return true;
  }
  return false;
}

/**
 * 用户这句话是不是「需要看页面才能答」的
 * 只有命中才自动附截图 —— 纯文字问题不该浪费一次截图和一堆 token。
 */
var VISUAL_HINT_WORDS = [
  // 明确要求看
  "截图", "截个图", "看一下", "看看", "帮我看看", "看一眼", "看图",
  // 视觉指代
  "这个页面", "这个网页", "当前页面", "页面上", "屏幕上", "界面", "页面布局", "排版",
  "长什么样", "什么样", "什么样子", "显示成", "显示为", "显示的是",
  // 视觉特征
  "红色", "红字", "绿色", "黄色", "蓝色", "颜色", "高亮", "标红",
  "图标", "按钮在哪", "在哪里", "位置", "挡住了", "遮住", "重叠", "错位", "乱码",
  "图片里", "图里", "图中", "图表", "表格里", "海报", "照片",
  // 状态类
  "什么情况", "怎么回事", "为什么显示", "为什么这样", "为什么变成这样", "出了什么问题",
  "报错了吗", "提示什么", "弹窗",
];

function needsVisualContext(text) {
  var raw = String(text || "").trim();
  if (!raw || raw.length > 200) return false;

  for (var i = 0; i < VISUAL_HINT_WORDS.length; i++) {
    if (raw.indexOf(VISUAL_HINT_WORDS[i]) !== -1) return true;
  }
  return false;
}

/**
 * 把 base64 图片数据包成 OpenAI 兼容的 multimodal 消息片段
 * @param {string} dataUrl 形如 data:image/jpeg;base64,xxxx
 */
function buildImagePart(dataUrl, detail) {
  return {
    type: "image_url",
    image_url: { url: String(dataUrl || ""), detail: detail || "auto" },
  };
}

/** 截图说明(放进请求里,让模型知道这张图是什么、什么时候拍的) */
function buildScreenshotNote(pageInfo) {
  var info = pageInfo || {};
  return "【当前网页截图】以下图片是用户此刻在浏览器里看到的画面" +
    (info.title ? "(网页标题:" + info.title + ")" : "") +
    (info.url ? "(地址:" + info.url + ")" : "") +
    "。请把它当作「用户眼睛看到的内容」来理解;如果问题涉及视觉信息(颜色、位置、图片里的文字、排版、弹窗),以截图为准," +
    "截图与文字内容不一致时,说明页面可能有动态内容或渲染差异。";
}

'''

rep_file("utils/context.js", [
    ("vision", "/* ==================================================================\n   3.", VISION.lstrip("\n") + "/* ==================================================================\n   3."),
], "context.js")

print("context.js 视觉能力已加入")

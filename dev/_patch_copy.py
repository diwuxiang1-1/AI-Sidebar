# -*- coding: utf-8 -*-
"""完整版 1:新增结构化动作 remove_copy_restrictions(不用 eval、不碰 CSP)"""

import io

p = "utils/webpatch.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# ---- 1. 动作白名单 ----
rep("whitelist",
    '  "move",         // 移动元素\n'
    '  "set_media",    // 媒体控制(play/pause/muted/volume/controls/rate)',
    '  "move",         // 移动元素\n'
    '  /* 解除复制限制(完整版):纯结构化,不执行任何网页代码 */\n'
    '  "remove_copy_restrictions",\n'
    '  "set_media",    // 媒体控制(play/pause/muted/volume/controls/rate)')

# ---- 2. 定位校验:可以不指定目标(对整个页面生效) ----
rep("hastarget",
    '  if (name === "add_css")    return !!(item.selector || item.ref || item.text);',
    '  if (name === "add_css")    return !!(item.selector || item.ref || item.text);\n'
    '  // 复制限制:可以整页处理,也可以只处理某个区域 → 允许不带目标\n'
    '  if (name === "remove_copy_restrictions") return true;')

# ---- 3. 提示词:告诉模型有这个动作,并且禁止用 run_js 去解 ----
rep("prompt-hard",
    '  lines.push("6. 改动要真正解决用户的问题:改主题/布局/间距/字体用 add_css;改单个元素用 set_style;删掉区域用 hide 或 remove。");',
    '  lines.push("6. 改动要真正解决用户的问题:改主题/布局/间距/字体用 add_css;改单个元素用 set_style;删掉区域用 hide 或 remove。");\n'
    '  lines.push("6b. **网页禁止选中 / 禁止复制 / 禁止右键 / 无法 Ctrl+C** 这类要求,一律用 remove_copy_restrictions 动作。"\n'
    '          + "这是内置的结构化动作,不需要任何脚本,也**绝对不要**用 run_js 去写 addEventListener / oncopy 之类的代码 —— 那样会在有 CSP 的站点上直接失败。");')

rep("prompt-list",
    '  lines.push(\'   {"action":"add_css","selector":"CSS选择器","css":"background:#111;color:#eee","important":true}\');',
    '  lines.push(\'   {"action":"add_css","selector":"CSS选择器","css":"background:#111;color:#eee","important":true}\');\n'
    '  lines.push(\'   {"action":"remove_copy_restrictions"}                      ← 解除整页的选中/复制/右键限制\');\n'
    '  lines.push(\'   {"action":"remove_copy_restrictions","selector":".content"}   ← 只解除某个区域\');')

# ---- 4. 本地解析:这类请求不调用模型 ----
LOCAL = r'''
/* ==================================================================
   3d. 本地「解除复制限制」指令解析(完整版)
   ----------------------------------------------------------------
   为什么必须本地解析:
     这类请求如果交给模型,模型很容易写成 run_js(addEventListener / oncopy = null),
     而很多文库类站点有 CSP(禁止 unsafe-eval),run_js 必失败。
     结构化动作不需要执行任何网页代码,因此在这些站点上依然有效。
   只在句子里**没有夹带其它意图**时才本地接管。
   ================================================================== */

/** 表示「解除限制」的动词/名词 */
var LOCAL_COPY_WORDS = [
  "解除复制限制", "去掉复制限制", "解除复制", "破解复制", "复制限制",
  "解除限制", "去掉限制", "不能复制", "无法复制", "不让复制", "禁止复制",
  "不能选中", "无法选中", "不让选中", "禁止选中", "不能选择", "无法选择",
  "恢复复制", "恢复选中", "恢复选择", "恢复右键", "解除右键", "去掉右键",
  "禁止右键", "不能右键", "无法右键", "右键菜单", "contextmenu",
  "选中文字", "选择文字", "复制文字", "复制内容", "我要复制", "想复制",
  "user-select", "selectstart",
];

/** 出现这些词说明用户还要做别的事 → 交回给模型 */
var LOCAL_COPY_LEFT_OTHERS = [
  "翻译", "截图", "下载", "字体", "大小", "颜色", "背景", "隐藏", "删除", "移除",
  "倍速", "音量", "暂停", "播放", "跳转",
];

/**
 * 把「解除复制限制」这类要求解析成结构化动作
 * @param {string} text
 * @returns {{kind:"remove_copy_restrictions", scope:string}|null}
 */
function parseLocalCopyCommand(text) {
  var raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw || raw.length > 60) return null;

  var hit = false;
  for (var i = 0; i < LOCAL_COPY_WORDS.length; i++) {
    if (raw.indexOf(LOCAL_COPY_WORDS[i]) !== -1) { hit = true; break; }
  }
  if (!hit) return null;

  // 夹带别的意图 → 不接管
  for (var j = 0; j < LOCAL_COPY_LEFT_OTHERS.length; j++) {
    if (raw.indexOf(LOCAL_COPY_LEFT_OTHERS[j]) !== -1) return null;
  }

  return { kind: "remove_copy_restrictions", scope: "" };
}
'''

rep("localparse",
    '/* ==================================================================\n'
    '   4. 安全校验(供 content.js 执行器调用)',
    LOCAL.lstrip("\n") + '\n/* ==================================================================\n'
    '   4. 安全校验(供 content.js 执行器调用)')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("webpatch", k, "=", v)

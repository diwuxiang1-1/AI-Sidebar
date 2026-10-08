# -*- coding: utf-8 -*-
"""收尾 7:选中文字 JS(本地渲染 / 复制全文 / 加入输入框)+ 上下文优先级 + 不可信数据边界"""

import io

p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# ---- 1. DOM 引用 ----
rep("refs",
    'const selectionChip     = document.getElementById("selection-chip");\n'
    'const selectionChipText = document.getElementById("selection-chip-text");\n'
    'const btnChipClear      = document.getElementById("selection-chip-clear");',
    '/* ---- 选中文字预览(收尾轮) ---- */\n'
    'const selectionPanel   = document.getElementById("selection-panel");\n'
    'const selectionCount   = document.getElementById("selection-count");\n'
    'const selectionPreview = document.getElementById("selection-preview");\n'
    'const btnSelToggle     = document.getElementById("btn-selection-toggle");\n'
    'const btnSelCopy       = document.getElementById("btn-selection-copy");\n'
    'const btnSelToInput    = document.getElementById("btn-selection-toinput");\n'
    'const btnChipClear     = document.getElementById("selection-chip-clear");')

# ---- 2. showSelection / hideSelection 重写 ----
rep("show",
    '''function showSelection(message) {
  var text = message.selectedText || "";
  if (!text) { hideSelection(); return; }

  currentSelection = text;
  lastContextText = "";   // 选中内容已变化,预估改用最新选中文字

  selectionChipText.textContent = "已选中 " + text.length + " 字";   // 已选中 N 字
  selectionChip.title = text.slice(0, 300);
  selectionChip.style.display = "flex";
  refreshEstimate();
}

function hideSelection() {
  selectionChip.style.display = "none";
  selectionChipText.textContent = "";
  selectionChip.removeAttribute("title");
  currentSelection = "";
  lastContextText = "";
  refreshEstimate();
}''',
    '''/**
 * 页面检测到选中文字 → 显示预览面板
 * ----------------------------------------------------------------
 * ⚠️ 全程本地:
 *     content.js 已经把文字拿来了,这里只做「存 + 显示」。
 *     不调用 AI、不发任何请求、不消耗 Token。
 *     预览被 CSS 限制高度,但 currentSelection 始终是**完整原文**。
 */
function showSelection(message) {
  var text = message.selectedText || "";
  if (!text) { hideSelection(); return; }

  currentSelection = text;     // 完整原文,复制用的一定是它
  lastContextText = "";        // 选中内容已变化,上下文改用最新的

  selectionCount.textContent = "共 " + text.length + " 字";
  selectionPreview.textContent = buildSelectionPreviewText(text);
  selectionPanel.style.display = "flex";
  refreshEstimate();
}

/** 预览文本:超长时只渲染前一段,避免 DOM 里塞进几十万字 */
function buildSelectionPreviewText(text) {
  var t = String(text || "");
  if (t.length <= SELECTION_PREVIEW_CHARS) return t;
  return t.slice(0, SELECTION_PREVIEW_CHARS) +
    "\\n\\n…… (预览只显示前 " + SELECTION_PREVIEW_CHARS + " 字;复制时仍是完整 " + t.length + " 字)";
}

/** 复制:必须是完整原文,不能是预览截断后的内容 */
async function copySelectionFull() {
  if (!currentSelection) return;
  try {
    await navigator.clipboard.writeText(currentSelection);
    btnSelCopy.textContent = "已复制";
    setTimeout(function () { btnSelCopy.textContent = "复制"; }, 1200);
  } catch (e) {
    appendMessage("system", "复制失败:浏览器拒绝了剪贴板访问。可以点「加入输入框」再手动复制。");
  }
}

/** 加入输入框:沿用现有行为(整段放进输入框) */
function putSelectionToInput() {
  if (!currentSelection) return;
  messageInput.value = currentSelection;
  messageInput.focus();
}

function hideSelection() {
  selectionPanel.style.display = "none";
  selectionPanel.classList.remove("expanded");
  selectionCount.textContent = "";
  selectionPreview.textContent = "";
  btnSelToggle.textContent = "展开";
  currentSelection = "";
  lastContextText = "";
  refreshEstimate();
}''')

# ---- 3. 事件绑定 ----
rep("bind",
    '  btnChipClear.addEventListener("click", function () { hideSelection(); });',
    '  btnChipClear.addEventListener("click", function () { hideSelection(); });\n'
    '  btnSelCopy.addEventListener("click", function () { copySelectionFull(); });\n'
    '  btnSelToInput.addEventListener("click", function () { putSelectionToInput(); });\n'
    '  btnSelToggle.addEventListener("click", function () {\n'
    '    var open = selectionPanel.classList.contains("expanded");\n'
    '    if (open) selectionPanel.classList.remove("expanded");\n'
    '    else selectionPanel.classList.add("expanded");\n'
    '    btnSelToggle.textContent = open ? "展开" : "收起";\n'
    '  });')

# ---- 4. 常量 ----
rep("const",
    "var MAX_SELECTION_CONTEXT   = 8000;",
    "var MAX_SELECTION_CONTEXT   = 8000;\n"
    "/* 选中文字预览最多渲染多少字(UI 截断 ≠ 数据截断:currentSelection 始终是完整原文) */\n"
    "var SELECTION_PREVIEW_CHARS = 4000;")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sidebar", k, "=", v)

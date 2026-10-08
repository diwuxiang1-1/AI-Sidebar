# -*- coding: utf-8 -*-
"""完整版 10:侧边栏文件输入逻辑接线"""

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

# 1) DOM 引用
rep("refs",
    'const selectionChip     = document.getElementById("selection-chip");',
    '/* ---- 文件输入(完整版) ---- */\n'
    'const btnAddFile       = document.getElementById("btn-add-file");\n'
    'const fileInputEl      = document.getElementById("file-input");\n'
    'const fileChip         = document.getElementById("file-chip");\n'
    'const fileChipText     = document.getElementById("file-chip-text");\n'
    'const btnFileChipClear = document.getElementById("file-chip-clear");\n'
    'var pickedFiles        = [];    // 本次待发送的文件(发送后清空)\n'
    'var pickedRejected     = [];\n'
    '\n'
    'const selectionChip     = document.getElementById("selection-chip");')

# 2) 事件绑定
rep("bind",
    '  btnChipClear.addEventListener("click", function () { hideSelection(); });',
    '  btnChipClear.addEventListener("click", function () { hideSelection(); });\n'
    '\n'
    '  // 完整版:文件输入(本地读取,不上传)\n'
    '  btnAddFile.addEventListener("click", function () { fileInputEl.click(); });\n'
    '  fileInputEl.addEventListener("change", onFilesPicked);\n'
    '  btnFileChipClear.addEventListener("click", function () { clearPickedFiles(); });')

# 3) 逻辑:插在 showSelection 之前
FILE_FN = r'''
/* ==================================================================
   文件输入(完整版)
   ----------------------------------------------------------------
   · 本地读取,不上传任何第三方
   · 文本类 → 作为文件上下文注入本次请求
   · 图片类 → 作为图片输入(需要模型支持视觉)
   · PDF/Word/Excel 等 → 明确告知当前不支持,不假装能读
   · 只作用于「本次发送」,不进会话历史
   ================================================================== */

async function onFilesPicked() {
  var list = fileInputEl.files;
  if (!list || !list.length) return;

  var res;
  try {
    res = await processPickedFiles(list);
  } catch (e) {
    appendMessage("system", "【文件】读取失败:" + ((e && e.message) || e));
    fileInputEl.value = "";
    return;
  }

  pickedFiles    = pickedFiles.concat(res.files);
  pickedRejected = res.rejected;

  if (pickedFiles.length > FILE_MAX_COUNT) {
    pickedFiles = pickedFiles.slice(0, FILE_MAX_COUNT);
  }

  renderFileChip();
  fileInputEl.value = "";   // 允许再次选择同一个文件

  // 有图片但模型不支持视觉 → 现在就说清楚,别等发送后才失败
  var hasImage = pickedFiles.some(function (f) { return f.kind === "image"; });
  if (hasImage) {
    var cfg = null;
    try { cfg = await getApiConfig(); } catch (e) { cfg = null; }
    if (!modelSupportsVision(cfg && cfg.model)) {
      appendMessage("system", "【文件】当前模型(" + ((cfg && cfg.model) || "未知") + ")看起来不支持图片输入,图片不会被发送。可以在设置里换一个支持视觉的模型。");
    }
  }
}

function renderFileChip() {
  if (!fileChip) return;

  if (!pickedFiles.length && !pickedRejected.length) {
    fileChip.style.display = "none";
    fileChipText.textContent = "";
    return;
  }

  fileChipText.textContent = describePickedFiles(pickedFiles, pickedRejected);
  fileChip.style.display = "flex";
}

function clearPickedFiles() {
  pickedFiles = [];
  pickedRejected = [];
  renderFileChip();
}

/**
 * 把已选文件拼进本次请求
 * @returns {{contextMessages:Array, imageParts:Array}}
 */
function buildFileContext() {
  var out = { contextMessages: [], imageParts: [] };
  if (!pickedFiles.length) return out;

  var textMsg = buildFileContextMessage(pickedFiles);
  if (textMsg) out.contextMessages.push({ role: "system", content: textMsg });

  out.imageParts = buildFileImageParts(pickedFiles);
  return out;
}

'''

rep("fn", "/**\n * 页面检测到选中文字 → 显示轻量 chip,并作为自动上下文",
    FILE_FN.lstrip("\n") + "/**\n * 页面检测到选中文字 → 显示轻量 chip,并作为自动上下文")

# 4) doSend:把文件上下文拼进去 + 发送后清空
rep("dosend",
    '  // 完整版:问题需要「看」页面时,按需附上用户此刻看到的画面',
    '  // 完整版:用户附加的文件(只作用于本次请求)\n'
    '  var fileCtx = buildFileContext();\n'
    '  if (fileCtx.contextMessages.length) contextMessages = contextMessages.concat(fileCtx.contextMessages);\n'
    '\n'
    '  // 完整版:问题需要「看」页面时,按需附上用户此刻看到的画面')

rep("attach",
    '  if (lastShot && lastShot.imagePart) apiMessages = attachImageToLastUser(apiMessages, lastShot.imagePart);',
    '  if (lastShot && lastShot.imagePart) apiMessages = attachImageToLastUser(apiMessages, lastShot.imagePart);\n'
    '  // 文件里的图片同样挂到「本次用户消息」上\n'
    '  if (fileCtx.imageParts.length && modelSupportsVision(config.model)) {\n'
    '    apiMessages = attachPartsToLastUser(apiMessages, fileCtx.imageParts);\n'
    '  }')

rep("clear",
    '  removeRegenerateRow();\n'
    '  activeAiBubble = createStreamingBubble();\n'
    '  var apiMessages = contextMessages.concat(messages);\n',
    '  removeRegenerateRow();\n'
    '  activeAiBubble = createStreamingBubble();\n'
    '  clearPickedFiles();   // 文件只作用于这一次发送\n'
    '  var apiMessages = contextMessages.concat(messages);\n')

# 5) attachPartsToLastUser
rep("parts",
    '/** 去掉图片重试用的判定',
    '/**\n'
    ' * 把若干 multimodal 片段追加到最后一条用户消息上\n'
    ' * 同样是克隆消息对象,不污染会话历史\n'
    ' */\n'
    'function attachPartsToLastUser(apiMessages, parts) {\n'
    '  if (!parts || !parts.length) return apiMessages;\n'
    '\n'
    '  var out = apiMessages.slice();\n'
    '  for (var i = out.length - 1; i >= 0; i--) {\n'
    '    if (out[i].role !== "user") continue;\n'
    '\n'
    '    var text = typeof out[i].content === "string" ? out[i].content : "";\n'
    '    out[i] = {\n'
    '      role:    "user",\n'
    '      content: [{ type: "text", text: text }].concat(parts),\n'
    '    };\n'
    '    break;\n'
    '  }\n'
    '  return out;\n'
    '}\n'
    '\n'
    '/** 去掉图片重试用的判定')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sidebar", k, "=", v)

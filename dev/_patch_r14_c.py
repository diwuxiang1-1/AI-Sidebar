# -*- coding: utf-8 -*-
# 一次性补丁(第十四轮 · C):聊天交互整合 + 意图识别接线 + 多 Key 轮询接线 + 选区 chip

import io, re

def patch(path, pairs, tag):
    s = io.open(path, encoding="utf-8").read()
    for name, old, new in pairs:
        c = s.count(old)
        print(tag, name, "=", c)
        if c != 1:
            raise SystemExit("!! %s / %s 匹配 %d 次,已中止" % (tag, name, c))
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(s)

# ============================================================
# 1. sidebar.html
# ============================================================
patch("sidebar/sidebar.html", [
    ("mode-btn",
     '    <button id="btn-mode-page" class="mode-btn" data-mode="page" type="button">当前网页</button>\n'
     '    <button id="btn-mode-selection" class="mode-btn" data-mode="selection" type="button">选中文字</button>',
     '    <button id="btn-mode-page" class="mode-btn" data-mode="page" type="button">当前网页</button>'),

    ("sel-area",
     '  <!-- ========== 选中文字显示区域(默认隐藏) ========== -->\n'
     '  <div id="selection-area" class="selection-area" style="display:none;">\n'
     '    <div class="selection-header">\n'
     '      <span class="selection-label">当前选中文字</span>\n'
     '      <div class="selection-actions">\n'
     '        <button id="btn-copy-selection" class="btn btn-small" type="button">复制</button>\n'
     '        <button id="btn-clear-selection" class="btn btn-small" type="button">清除</button>\n'
     '        <button id="btn-put-input" class="btn btn-small btn-primary" type="button">放入输入框</button>\n'
     '      </div>\n'
     '    </div>\n'
     '    <div id="selection-text" class="selection-text"></div>\n'
     '    <div id="selection-source" class="selection-source"></div>\n'
     '  </div>\n\n', ''),

    ("chip",
     '  <form id="chat-form" class="chat-form">\n'
     '    <textarea',
     '  <form id="chat-form" class="chat-form">\n'
     '    <!-- 选中文字:自动上下文,不再是独立模式(第十四轮) -->\n'
     '    <div id="selection-chip" class="selection-chip" style="display:none;">\n'
     '      <span id="selection-chip-text" class="selection-chip-text"></span>\n'
     '      <button id="selection-chip-clear" class="chip-close" type="button" title="清除选中文字">×</button>\n'
     '    </div>\n'
     '    <textarea'),

    ("hint",
     '    <div class="patch-hint">在下方输入框写要求,例如「背景改深色,正文放大,隐藏右侧栏」,再点「执行网页修改」。</div>',
     '    <div class="patch-hint">在下方输入框写要求,例如「背景改深色,正文放大,隐藏右侧栏」,再点「执行网页修改」。<br />'
     '开着「当前网页」时,直接在聊天框说「把背景改成深色」也会执行修改,结果和「撤销」按钮都出现在聊天里。</div>'),
], "sidebar.html")

# ============================================================
# 2. sidebar.css —— 选区 chip
# ============================================================
patch("sidebar/sidebar.css", [
    ("css",
     '.selection-area { flex-shrink: 0; padding: 8px 12px; border-bottom: 1px solid rgba(31,35,40,0.1); background: #eef1f7; }',
     '.selection-area { flex-shrink: 0; padding: 8px 12px; border-bottom: 1px solid rgba(31,35,40,0.1); background: #eef1f7; }\n\n'
     '/* 选中文字 chip(第十四轮):轻量提示,不再是独立模式 */\n'
     '.selection-chip {\n'
     '  display: flex; align-items: center; gap: 6px;\n'
     '  margin: 0 0 6px; padding: 3px 8px;\n'
     '  border: 1px solid rgba(47,111,237,0.3); border-radius: 12px;\n'
     '  background: #eef1f7; color: #2f6fed;\n'
     '  font-size: 12px; width: fit-content; max-width: 100%;\n'
     '}\n'
     '.selection-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n'
     '.selection-chip .chip-close {\n'
     '  border: none; background: transparent; color: inherit; cursor: pointer;\n'
     '  font-size: 14px; line-height: 1; padding: 0 2px;\n'
     '}\n'
     '.selection-chip .chip-close:hover { color: #d8353a; }\n\n'
     '/* 聊天里的修改结果操作行(第十四轮) */\n'
     '.chat-undo-row { display: flex; gap: 6px; margin: 4px 0 8px; }\n'
     '.chat-undo-row .btn { padding: 3px 10px; font-size: 12px; }'),

    ("cssdark",
     '  .selection-area { background: #25272b; border-color: rgba(255,255,255,0.12); }',
     '  .selection-area { background: #25272b; border-color: rgba(255,255,255,0.12); }\n'
     '  .selection-chip { background: #20253b; border-color: rgba(87,134,246,0.35); color: #5786f6; }\n'
     '  .selection-chip .chip-close:hover { color: #f06a6a; }'),
], "sidebar.css")

# ============================================================
# 3. sidebar.js —— 多 Key 轮询
# ============================================================
s = io.open("sidebar/sidebar.js", encoding="utf-8").read()

CALLMODEL = r'''
/* ==================================================================
   5a. 多 API Key 轮询(第十四轮)
   ----------------------------------------------------------------
   与设置页「关于 API Key」的说明保持一致:
     · 只使用当前 Provider 里「启用」的 Key,按填写顺序
     · 当前 Key 失败 → 尝试下一个;同一请求里每个 Key 最多试一次
     · 全部失败 → 抛出最后一个真实错误;绝不无限重试
     · 用户主动停止(AbortError)不换 Key
     · 不同 Provider 的 Key 不混用(只读当前配置的 keys)
   ================================================================== */

/** 把文本里出现的完整 Key 换成掩码,避免报错 / 日志泄露 */
function scrubKeys(text, keys) {
  var out = String(text === undefined || text === null ? "" : text);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k && k.length >= 8 && out.indexOf(k) !== -1) out = out.split(k).join(maskApiKey(k));
  }
  return out;
}

/** 当前配置里参与轮询的 Key(按填写顺序) */
async function resolveKeyPool() {
  var config = null;
  try { config = await getApiConfig(); } catch (e) { config = null; }

  var keys = getEnabledApiKeys(config);
  if (!keys.length) {
    var primary = getPrimaryApiKey(config);
    if (primary) keys = [primary];
  }
  return keys;
}

async function callModel(opts) {
  var keys = await resolveKeyPool();
  if (!keys.length) throw new Error("没有可用的 API Key");   // 没有可用的 API Key

  var lastErr = null;

  for (var i = 0; i < keys.length; i++) {
    try {
      return await chatCompletionStream({
        baseUrl:  opts.baseUrl,
        apiKey:   keys[i],
        model:    opts.model,
        messages: opts.messages,
        signal:   opts.signal,
        onToken:  opts.onToken,
      });
    } catch (e) {
      if (e && (e.name === "AbortError" || e.aborted)) throw e;   // 用户停止,不换 Key

      lastErr = e;
      if (e && typeof e.message === "string") e.message = scrubKeys(e.message, keys);

      if (i < keys.length - 1) {
        appendAuditLog("base", "API Key 轮询",   // API Key 轮询
          "第 " + (i + 1) + " 个 Key(" + maskApiKey(keys[i]) + ")请求失败,改用下一个");   // 第 N 个 Key(...)请求失败,改用下一个
        renderAuditLog();
      }
    }
  }

  throw lastErr;
}

'''

anchor = "async function doSend(text) {"
assert s.count(anchor) == 1, "doSend 锚点"
s = s.replace(anchor, CALLMODEL.lstrip("\n") + anchor, 1)

# 4 个调用点改用 callModel
# 注意:callModel 自己内部也要调 chatCompletionStream,所以按「变量名 + 调用」精确替换
c1 = s.count("var fullText = await chatCompletionStream({")
c2 = s.count("var raw = await chatCompletionStream({")
print("callsites fullText/raw =", c1, c2)
assert (c1, c2) == (2, 2), "调用点数量"
s = s.replace("var fullText = await chatCompletionStream({", "var fullText = await callModel({")
s = s.replace("var raw = await chatCompletionStream({", "var raw = await callModel({")

# 去掉不再需要的 apiKey 传参(交给 callModel 决定用哪个 Key)
s, n = re.subn(r"\n[ \t]*apiKey:[ \t]+apiKey,", "", s)
print("drop apiKey arg =", n)
assert n == 4, "apiKey 传参"

# 5 处 Key 读取
old = 'var apiKey = (config.keys && config.keys.length > 0) ? config.keys[0] : "";'
print("key reads =", s.count(old))
assert s.count(old) == 5, "key reads"
s = s.replace(old, 'var apiKey = getPrimaryApiKey(config);   // 第十四轮:多 Key 时取第一个启用的')

# ---------------- 意图识别 + 聊天内的网页修改 ----------------
old_send_ctx = r'''  var contextMessages = [];
  if (chatMode === "page") {
    var pageCtx = await fetchPageContext();
    if (!pageCtx) return;
    contextMessages.push({ role: "system", content: buildPageContextMessage(pageCtx) });
  } else if (chatMode === "selection") {
    if (!currentSelection) {
      appendError("请先在网页中选中文字，再使用此模式");  // 请先在网页中选中文字，再使用此模式
      return;
    }
    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });
  }
'''
new_send_ctx = r'''  // 第十四轮:先判断意图 —— 普通聊天绝不擅自修改网页
  var intentInfo = classifyUserIntent(text);

  if (intentInfo.intent === "modify" && chatMode === "page" && !isPatching) {
    await runChatModify(text, intentInfo);
    return;
  }

  // 含糊的「这网页太亮了」:先按普通聊天回答,并问一句要不要改
  pendingModifyAsk = (chatMode === "page" && intentInfo.intent === "chat" && looksLikePageComplaint(text)) ? text : "";

  var contextMessages = await buildChatContext();
  if (!contextMessages) return;
'''
assert s.count(old_send_ctx) == 1, "doSend 上下文"
s = s.replace(old_send_ctx, new_send_ctx, 1)

old_regen_ctx = r'''  var contextMessages = [];
  if (chatMode === "page") {
    var pageCtx = await fetchPageContext();
    if (!pageCtx) return;
    contextMessages.push({ role: "system", content: buildPageContextMessage(pageCtx) });
  } else if (chatMode === "selection") {
    if (!currentSelection) { appendError("请先在网页中选中文字"); return; }
    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });
  }
'''
new_regen_ctx = r'''  var contextMessages = await buildChatContext();
  if (!contextMessages) return;
'''
assert s.count(old_regen_ctx) == 1, "regenerate 上下文"
s = s.replace(old_regen_ctx, new_regen_ctx, 1)

# 上下文组装 helper + 聊天内修改流程
HELPERS = r'''
/* ==================================================================
   5b. 聊天上下文组装 + 聊天里的网页修改(第十四轮)
   ================================================================== */

/**
 * 本次请求的上下文
 * 「当前网页」「选中文字」都只是上下文来源,共用同一个会话与消息流:
 *   · 开着「当前网页」→ 注入网页正文
 *   · 页面上有选中的文字 → 无论哪种模式都自动注入
 * @returns {Array|null} null 表示网页读取失败,调用方应中止
 */
async function buildChatContext() {
  var contextMessages = [];

  if (chatMode === "page") {
    var pageCtx = await fetchPageContext();
    if (!pageCtx) return null;
    contextMessages.push({ role: "system", content: buildPageContextMessage(pageCtx) });
  }

  if (currentSelection) {
    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });
  }

  return contextMessages;
}

/** 用户对「要我直接修改当前网页吗?」的简短确认 */
function isAffirmative(text) {
  var t = String(text || "").trim();
  if (!t || t.length > 10) return false;
  var words = ["改", "要", "好", "可以", "是的", "帮我改", "直接改", "改吧", "行", "嗯"];   // 改/要/好/可以/是的/帮我改/直接改/改吧/行/嗯
  for (var i = 0; i < words.length; i++) if (t === words[i]) return true;
  return false;
}

/**
 * 在聊天里执行网页修改
 * 复用已有的 onPatchApply 流程(它从输入框读要求),不重写修改引擎
 */
async function runChatModify(text, intentInfo) {
  var verb = (intentInfo && intentInfo.verb) || "";
  var shown = "识别为网页修改请求" + (verb ? "(「" + verb + "」)" : "") + ",正在分析并生成方案…";   // 识别为网页修改请求(「…」),正在分析并生成方案…

  if (verb) appendMessage("system", shown);

  messageInput.value = text;   // onPatchApply 从输入框读取修改要求
  var before = patchSteps;

  await onPatchApply();        // 修改结果由它自己写进聊天流

  messages.push({ role: "user", content: text });
  appendMessage("user", text);
  if (!sessionName) sessionName = text.slice(0, 30);

  // 真的改动了才给撤销入口
  if (patchSteps > 0 && (patchSteps !== before || before === 0)) addChatUndoRow();
  await saveActiveSession(messages, sessionName);
}

/** 聊天流里的「撤销 / 恢复」操作行 */
function addChatUndoRow() {
  var row = document.createElement("div");
  row.className = "chat-undo-row";

  var undo = document.createElement("button");
  undo.className = "btn";
  undo.type = "button";
  undo.textContent = "撤销";   // 撤销
  undo.addEventListener("click", async function () {
    await onPatchUndo();
    row.parentNode && row.parentNode.removeChild(row);
    updatePatchButtons();
  });

  var restore = document.createElement("button");
  restore.className = "btn";
  restore.type = "button";
  restore.textContent = "恢复网页";   // 恢复网页
  restore.addEventListener("click", async function () {
    await onPatchRestore();
    row.parentNode && row.parentNode.removeChild(row);
    updatePatchButtons();
  });

  row.appendChild(undo);
  row.appendChild(restore);
  chatList.appendChild(row);
  chatList.scrollTop = chatList.scrollHeight;
}

'''
anchor2 = "/* ==================================================================\n   6. 停止生成"
assert s.count(anchor2) == 1, "停止生成锚点"
s = s.replace(anchor2, HELPERS.lstrip("\n") + anchor2, 1)

# pendingModifyAsk 变量
old = 'var currentSelection = "";'
new = 'var currentSelection = "";\nvar pendingModifyAsk  = "";   // 第十四轮:含糊请求,等用户确认是否改网页'
assert s.count(old) == 1
s = s.replace(old, new, 1)

# 确认后直接执行修改(在 doSend 的意图判断之前)
old = r'''  // 第十四轮:先判断意图 —— 普通聊天绝不擅自修改网页
  var intentInfo = classifyUserIntent(text);

  if (intentInfo.intent === "modify" && chatMode === "page" && !isPatching) {'''
new = r'''  // 第十四轮:先判断意图 —— 普通聊天绝不擅自修改网页
  var intentInfo = classifyUserIntent(text);

  // 上一轮问过「要我直接修改当前网页吗?」,用户回了「改」→ 现在才真的改
  if (pendingModifyAsk && isAffirmative(text)) {
    var ask = pendingModifyAsk;
    pendingModifyAsk = "";
    await runChatModify(ask, { verb: "" });
    return;
  }
  pendingModifyAsk = "";

  if (intentInfo.intent === "modify" && chatMode === "page" && !isPatching) {'''
assert s.count(old) == 1, "意图判断"
s = s.replace(old, new, 1)

# 含糊请求:回答后补一句询问
old = r'''    messages.push({ role: "assistant", content: fullText });
    addRegenerateRow();
    await saveActiveSession(messages, sessionName);'''
new = r'''    messages.push({ role: "assistant", content: fullText });
    addRegenerateRow();

    // 含糊的网页抱怨:回答完后问一句,不自作主张去改
    if (pendingModifyAsk) {
      appendMessage("system", "需要我直接修改当前网页吗？回「改」就执行，或直接说明要怎么改。");   // 需要我直接修改当前网页吗?回「改」就执行,或直接说明要怎么改。
    }

    await saveActiveSession(messages, sessionName);'''
assert s.count(old) == 1, "追问插入"
s = s.replace(old, new, 1)

# ---------------- 选中文字:改为自动上下文 chip ----------------
old = r'''const btnModeSelection = document.getElementById("btn-mode-selection");
const allModeBtns      = [btnModeNormal, btnModePage, btnModeSelection];'''
new = r'''const allModeBtns      = [btnModeNormal, btnModePage];   // 第十四轮:「选中文字」不再是模式'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

old = r'''const selectionArea     = document.getElementById("selection-area");
const selectionTextEl   = document.getElementById("selection-text");
const selectionSourceEl = document.getElementById("selection-source");
const btnCopySelection  = document.getElementById("btn-copy-selection");
const btnClearSelection = document.getElementById("btn-clear-selection");
const btnPutInput       = document.getElementById("btn-put-input");'''
new = r'''const selectionChip     = document.getElementById("selection-chip");
const selectionChipText = document.getElementById("selection-chip-text");
const btnChipClear      = document.getElementById("selection-chip-clear");'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

old = r'''  btnCopySelection.addEventListener("click", function () {
    if (!currentSelection) return;
    navigator.clipboard.writeText(currentSelection).catch(function () {});
  });
  btnClearSelection.addEventListener("click", function () { hideSelection(); });
  btnPutInput.addEventListener("click", function () {
    if (currentSelection) { messageInput.value = currentSelection; messageInput.focus(); }
  });'''
new = r'''  btnChipClear.addEventListener("click", function () { hideSelection(); });'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

old = r'''function showSelection(message) {
  var text = message.selectedText || "";
  if (!text) return;
  currentSelection = text;
  lastContextText = "";   // 选中内容已变化,预估改用最新选中文字
  selectionTextEl.textContent = text;
  selectionSourceEl.textContent =
    "网页标题: " + (message.pageTitle || "(无)") +  // 网页标题:  (无)
    "  |  " + (message.pageUrl || "");
  selectionArea.style.display = "block";
}

function hideSelection() {
  selectionArea.style.display = "none";
  selectionTextEl.textContent = "";
  selectionSourceEl.textContent = "";
  currentSelection = "";
  lastContextText = "";
  refreshEstimate();
}'''
new = r'''/**
 * 页面检测到选中文字 → 显示轻量 chip,并作为自动上下文
 * (第十四轮:不再是独立模式,发送时与网页一起注入)
 */
function showSelection(message) {
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
}'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

# 预估正文:选中文字现在是自动上下文
old = r'''  if (chatMode === "selection") return lastContextText || currentSelection || "";
  if (chatMode === "page")      return lastContextText || "";'''
new = r'''  if (chatMode === "page")      return lastContextText || "";
  if (currentSelection)         return lastContextText || currentSelection;'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

io.open("sidebar/sidebar.js", "w", encoding="utf-8", newline="").write(s)
print("sidebar.js OK")

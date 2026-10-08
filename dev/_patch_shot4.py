# -*- coding: utf-8 -*-
"""完整版 5d:侧边栏接线(只做 sidebar.js,doSend 用更长的唯一锚点)"""

import io

p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new, expect=1):
    global s
    c = s.count(old)
    n[tag] = c
    if c != expect:
        raise SystemExit("!! %s 匹配 %d 次(期望 %d)" % (tag, c, expect))
    s = s.replace(old, new, 1)

# 1) 消息常量
rep("msg",
    '  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",',
    '  CAPTURE_SCREENSHOT: "ai-sidebar:capture-screenshot",\n'
    '  PATCH_PLAN_SAVE:   "ai-sidebar:patch-plan-save",')

# 2) doSend:按需准备视觉上下文(用「模糊请求」那一行的上下文做唯一锚点)
rep("dosend",
    '  // 含糊的「这网页太亮了」:先按普通聊天回答,并问一句要不要改\n'
    '  pendingModifyAsk = (chatMode === "page" && intentInfo.intent === "chat" && looksLikePageComplaint(text)) ? text : "";\n'
    '\n'
    '  var contextMessages = await buildChatContext();\n'
    '  if (!contextMessages) return;\n',
    '  // 含糊的「这网页太亮了」:先按普通聊天回答,并问一句要不要改\n'
    '  pendingModifyAsk = (chatMode === "page" && intentInfo.intent === "chat" && looksLikePageComplaint(text)) ? text : "";\n'
    '\n'
    '  var contextMessages = await buildChatContext();\n'
    '  if (!contextMessages) return;\n'
    '\n'
    '  // 完整版:问题需要「看」页面时,按需附上用户此刻看到的画面\n'
    '  // (只在这一轮请求里用,不写进会话历史)\n'
    '  lastShot = await prepareVisualContext(text, config);\n'
    '  if (lastShot && lastShot.messages) contextMessages = contextMessages.concat(lastShot.messages);\n')

# 3) apiMessages:挂图片(doSend 里那一处)
rep("apimsg",
    '  removeRegenerateRow();\n'
    '  activeAiBubble = createStreamingBubble();\n'
    '  var apiMessages = contextMessages.concat(messages);\n',
    '  removeRegenerateRow();\n'
    '  activeAiBubble = createStreamingBubble();\n'
    '  var apiMessages = contextMessages.concat(messages);\n'
    '  // 视觉上下文:图片挂到「本次用户消息」上(克隆消息对象,不污染会话历史)\n'
    '  if (lastShot && lastShot.imagePart) apiMessages = attachImageToLastUser(apiMessages, lastShot.imagePart);\n')

# 4) 重新生成:不要复用上一轮的截图
rep("regen",
    '  activeAiBubble = createStreamingBubble();\n'
    '\n'
    '  var apiMessages = contextMessages.concat(messages);\n',
    '  activeAiBubble = createStreamingBubble();\n'
    '\n'
    '  lastShot = null;   // 重新生成不带截图,避免用到上一轮的旧画面\n'
    '  var apiMessages = contextMessages.concat(messages);\n')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sidebar", k, "=", v)

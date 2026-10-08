# -*- coding: utf-8 -*-
"""收尾 10:把三个测试文件对齐到收尾轮的实际改动
   · 费用行已移除 → 断言改为「真实用量」
   · 选中文字 chip → 预览面板
   · 上下文按需发送 → 不再有无条件的「网页 + 选中文字」
   · 新增行为准则 system 消息 → 计数相应调整
"""

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
# 1. test_sidebar_integration.js —— 预估栏结构变了
# ============================================================
rep_file("dev/test_sidebar_integration.js", [
    ("cfg",
     '  ctx.contextConfig = { pageMaxTokens: 4000, showTokenEstimate: true, showCostEstimate: true };\n'
     '  ctx.chatMode = "normal";',
     '  // 收尾轮:两个「估算」开关已从产品里删除,这里也不再需要\n'
     '  ctx.contextConfig = { pageMaxTokens: 4000 };\n'
     '  ctx.chatMode = "normal";'),

    ("rows",
     '  eq("普通模式预估栏可见", bar.style.display, "");\n'
     '  const rows2 = rowTexts();\n'
     '  eq("包含 6 行(标题+3 明细+总计+费用)", rows2.length, 6);\n'
     '  eq("标题", rows2[0], "预计输入");\n'
     '  eq("网页内容 0", rows2[1], "网页内容 | 0 tokens");\n'
     '  eq("历史消息 104", rows2[2], "历史消息 | 104 tokens");\n'
     '  eq("系统提示 0", rows2[3], "系统提示 | 0 tokens");\n'
     '  eq("总计 104", rows2[4], "总计 | 104 tokens");\n'
     '  eq("未知模型费用文案", bar._children[5].textContent, "无法估算费用");',
     '  eq("普通模式预估栏可见", bar.style.display, "");\n'
     '  const rows2 = rowTexts();\n'
     '  // 收尾轮:费用行已移除,并且标题明确写出「本地估算」,不会被误当成真实用量\n'
     '  eq("包含 5 行(标题+3 明细+总计),不再有费用行", rows2.length, 5);\n'
     '  eq("标题明确标注是估算", rows2[0], "预计输入（本地估算）");\n'
     '  eq("网页内容 0", rows2[1], "网页内容 | 0 tokens");\n'
     '  eq("历史消息 104", rows2[2], "历史消息 | 104 tokens");\n'
     '  eq("系统提示 0", rows2[3], "系统提示 | 0 tokens");\n'
     '  eq("总计 104", rows2[4], "总计 | 104 tokens");\n'
     '  ok("不再出现任何本地推算的金额", rows2.join(" ").indexOf("$") === -1);\n'
     '\n'
     '  /* 收尾轮:真实用量来自 API,没有就是「未提供」,绝不编造 */\n'
     '  ctx.lastUsage = null;\n'
     '  ctx.showRealUsage();\n'
     '  ok("没有 usage 时明确写「未提供实际用量」",\n'
     '    bar._children[bar._children.length - 1].textContent.indexOf("未提供实际用量") !== -1);\n'
     '\n'
     '  ctx.lastUsage = { promptTokens: 1234, completionTokens: 567, totalTokens: 1801, cost: null };\n'
     '  ctx.showRealUsage();\n'
     '  const usageText = bar._children[bar._children.length - 1].textContent;\n'
     '  ok("有 usage 时显示真实输入/输出/合计",\n'
     '    usageText.indexOf("1234") !== -1 && usageText.indexOf("567") !== -1 && usageText.indexOf("1801") !== -1);\n'
     '  ok("未返回费用时不显示任何金额", usageText.indexOf("费用") === -1);'),
], "sidebar_integration")

# ============================================================
# 2. test_r14_chat.js —— chip → 预览面板
# ============================================================
rep_file("dev/test_r14_chat.js", [
    ("page+sel",
     '  ctx.chatMode = "page";\n'
     '  msgs = await ctx.buildChatContext();\n'
     '  R.eq("2/3. 网页 + 选中文字一起注入,共用同一条消息流", msgs.length, 2);',
     '  // 收尾轮:上下文改为按需发送 —— 没点名要整页时,不会把网页和选中文字一起塞进去\n'
     '  ctx.chatMode = "page";\n'
     '  const pageOnly = await ctx.buildChatContext("");\n'
     '  R.ok("没开选中内容的话题时只发网页",\n'
     '    pageOnly.some((m) => m.content.indexOf("网页正文") !== -1) &&\n'
     '    !pageOnly.some((m) => m.content.indexOf("被选中的一句话") !== -1));\n'
     '\n'
     '  const selAsked = await ctx.buildChatContext("这段话是什么意思");\n'
     '  R.ok("问选中内容时只发选中文字,不发整页",\n'
     '    selAsked.some((m) => m.content.indexOf("被选中的一句话") !== -1) &&\n'
     '    !selAsked.some((m) => m.content.indexOf("网页正文") !== -1));'),

    ("chip",
     '  ctx.showSelection({ selectedText: "一二三四五", pageTitle: "T", pageUrl: "https://e.com" });\n'
     '  R.eq("5. chip 显示「已选中 N 字」", elements["selection-chip-text"].textContent, "已选中 5 字");\n'
     '  R.eq("5. chip 可见", elements["selection-chip"].style.display, "flex");\n'
     '  R.eq("5. 选中文字已记录为上下文", ctx.currentSelection, "一二三四五");\n'
     '\n'
     '  ctx.hideSelection();\n'
     '  R.eq("6. × 清除后 chip 隐藏", elements["selection-chip"].style.display, "none");',
     '  ctx.showSelection({ selectedText: "一二三四五", pageTitle: "T", pageUrl: "https://e.com" });\n'
     '  R.eq("5. 面板显示总字数", elements["selection-count"].textContent, "共 5 字");\n'
     '  R.eq("5. 面板可见", elements["selection-panel"].style.display, "flex");\n'
     '  R.eq("5. 用户能直接看到选中的实际内容", elements["selection-preview"].textContent, "一二三四五");\n'
     '  R.eq("5. 选中文字已记录为上下文", ctx.currentSelection, "一二三四五");\n'
     '\n'
     '  ctx.hideSelection();\n'
     '  R.eq("6. × 清除后面板隐藏", elements["selection-panel"].style.display, "none");'),

    ("empty",
     '  ctx.showSelection({ selectedText: "" });\n'
     '  R.eq("6. 空选区不显示 chip", elements["selection-chip"].style.display, "none");',
     '  ctx.showSelection({ selectedText: "" });\n'
     '  R.eq("6. 空选区不显示面板", elements["selection-panel"].style.display, "none");'),
], "r14_chat")

# ============================================================
# 3. test_s4_chat.js —— 行为准则 + 按需上下文
# ============================================================
rep_file("dev/test_s4_chat.js", [
    ("normal",
     '  let msgs = await ctx.buildChatContext();\n'
     '  R.eq("36. 普通聊天不注入网页上下文", msgs, []);',
     '  let msgs = await ctx.buildChatContext("");\n'
     '  // 收尾轮:任何时候都会带一条「行为准则」system 消息(很短),但**不含任何网页内容**\n'
     '  R.eq("36. 普通聊天不注入网页上下文",\n'
     '    msgs.filter((m) => m.content.indexOf("网页正文") !== -1 || m.content.indexOf("选中文字") !== -1), []);\n'
     '  R.ok("36. 只带行为准则这类固定规则", msgs.every((m) => m.role === "system"));'),

    ("page",
     '  ctx.chatMode = "page";\n'
     '  msgs = await ctx.buildChatContext();\n'
     '  R.eq("37. 当前网页模式注入网页正文", msgs.length, 1);',
     '  ctx.chatMode = "page";\n'
     '  msgs = await ctx.buildChatContext("这篇文章讲了什么");\n'
     '  R.eq("37. 当前网页模式注入网页正文",\n'
     '    msgs.filter((m) => m.content.indexOf("网页正文") !== -1).length, 1);\n'
     '\n'
     '  // 收尾轮:寒暄不浪费网页 Token\n'
     '  const hello = await ctx.buildChatContext("你好");\n'
     '  R.eq("37. 寒暄不发送整页",\n'
     '    hello.filter((m) => m.content.indexOf("网页正文") !== -1).length, 0);'),
], "s4_chat")

print("三个测试文件已对齐")

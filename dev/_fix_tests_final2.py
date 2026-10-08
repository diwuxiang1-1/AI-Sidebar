# -*- coding: utf-8 -*-
"""收尾 11:test_r14_chat.js 与 test_sidebar_integration.js 余下部分对齐到收尾轮"""

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
# sidebar_integration:费用段与「关闭」段已不存在
# ============================================================
rep_file("dev/test_sidebar_integration.js", [
    ("cost3",
     '  ok("已收录模型显示费用", bar._children[5].textContent.indexOf("预计费用:$") !== -1);\n'
     '  ok("费用行含模型名", bar._children[5].textContent.indexOf("GPT-4o mini") !== -1);',
     '  // 收尾轮:本地费用推算已移除 —— 不再有任何「预计费用」\n'
     '  ok("不再出现本地推算的费用", renderText(bar).indexOf("预计费用") === -1);'),

    ("sec4",
     '  ctx.contextConfig = { pageMaxTokens: 16000, showTokenEstimate: true, showCostEstimate: true };',
     '  ctx.contextConfig = { pageMaxTokens: 16000 };'),

    ("sec5",
     '''  /* ---- 5. 关闭 Token 估算 ---- */
  ctx.contextConfig = { pageMaxTokens: 4000, showTokenEstimate: false, showCostEstimate: true };
  ctx.refreshEstimate();
  eq("关闭后隐藏", bar.style.display, "none");

  /* ---- 6. 关闭费用提示 ---- */
  ctx.contextConfig = { pageMaxTokens: 4000, showTokenEstimate: true, showCostEstimate: false };
  ctx.refreshEstimate({ contextMessages: [{ role: "system", content: pageMsg }], modelId: "gpt-4o-mini" });
  eq("关闭费用后不含费用行", rowTexts().length, 5);
  eq("无费用文案", renderText(bar).indexOf("预计费用") === -1, true);
''',
     '''  /* ---- 5. 收尾轮:两个「估算」开关已删除,上下文规模栏始终可用 ---- */
  ctx.contextConfig = { pageMaxTokens: 4000 };
  ctx.refreshEstimate({ contextMessages: [{ role: "system", content: pageMsg }], modelId: "gpt-4o-mini" });
  eq("没有开关后仍然正常显示", bar.style.display, "");
  eq("仍然不含费用行", rowTexts().length, 5);
  eq("始终不出现费用文案", renderText(bar).indexOf("预计费用") === -1, true);
'''),

], "sidebar_integration")

# 选中文字模式这一段:chatMode 已无 "selection"
s = io.open("dev/test_sidebar_integration.js", encoding="utf-8").read()
old8 = '''  /* ---- 8. 选中文字模式 ---- */
  ctx.chatMode = "selection";'''
if old8 in s:
    new8 = '''  /* ---- 8. 选中文字(收尾轮:不再是独立模式,而是自动上下文) ---- */
  ctx.chatMode = "normal";'''
    s = s.replace(old8, new8, 1)
    io.open("dev/test_sidebar_integration.js", "w", encoding="utf-8", newline="").write(s)
    print("sidebar_integration 选中文字段 = 1")

print("余下测试已对齐")

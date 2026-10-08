# -*- coding: utf-8 -*-
"""收尾 12:用量栏做防御性查询 + 剩下三条断言对齐"""

import io

# ---- 1. 产品代码:querySelector 可能不存在(DOM 桩/老浏览器),不要让显示挂掉 ----
p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()
old = '  var old = estimateBar.querySelectorAll ? estimateBar.querySelector(".estimate-usage") : null;\n  if (old && old.parentNode) old.parentNode.removeChild(old);'
new = ('  // 防御:某些环境/桩里没有 querySelector,不能因此让用量显示失败\n'
       '  var old = null;\n'
       '  try {\n'
       '    if (typeof estimateBar.querySelector === "function") old = estimateBar.querySelector(".estimate-usage");\n'
       '  } catch (e) { old = null; }\n'
       '  if (old && old.parentNode) old.parentNode.removeChild(old);')
assert s.count(old) == 1
io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new))
print("renderUsageBar 已加防御")

# ---- 2. 测试:三条断言对齐收尾轮的实际行为 ----
p2 = "dev/test_sidebar_integration.js"
t = io.open(p2, encoding="utf-8").read()

old2 = '''  /* ---- 9. 估算失败不影响聊天(配置损坏) ---- */
  ctx.contextConfig = null;
  let threw = false;
  try { ctx.refreshEstimate(); } catch (e) { threw = true; }
  eq("配置损坏不抛异常", threw, false);
  eq("配置损坏时隐藏预估栏", bar.style.display, "none");'''
new2 = '''  /* ---- 9. 配置损坏也不影响聊天 ---- */
  // 收尾轮:上下文规模栏不再依赖 contextConfig(两个开关已删除),配置为空也应照常工作
  ctx.contextConfig = null;
  let threw = false;
  try { ctx.refreshEstimate(); } catch (e) { threw = true; }
  eq("配置损坏不抛异常", threw, false);
  eq("配置为空时仍能显示上下文规模", bar.style.display, "");'''
assert t.count(old2) == 1, "配置损坏段"
t = t.replace(old2, new2)

# 用量断言:DOM 桩补上 querySelector
old3 = '    querySelectorAll() { return []; },'
new3 = '    querySelectorAll() { return []; },\n    querySelector() { return null; },'
if t.count(old3) == 1:
    t = t.replace(old3, new3)
    print("DOM 桩已补 querySelector")
else:
    print("DOM 桩 querySelector:", t.count(old3))

io.open(p2, "w", encoding="utf-8", newline="").write(t)
print("测试已对齐")

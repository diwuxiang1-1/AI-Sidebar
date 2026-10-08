# -*- coding: utf-8 -*-
"""收尾 5:test_context.js 里针对「本地费用估算」的旧断言整体移除
   (功能已按收尾要求删除,测试不能留着测不存在的东西)"""

import io

p = "dev/test_context.js"
s = io.open(p, encoding="utf-8").read()
lines = s.split("\n")

# 找到「费用估算」这一段并整段删除
start = None
for i, ln in enumerate(lines):
    if "费用估算" in ln and ln.strip().startswith("/*"):
        start = i
        break
assert start is not None, "找不到费用估算段"

end = start
while end < len(lines) and "费用估算" not in lines[end][:200]:
    end += 1
    if end > start + 30:
        break

# 从注释块开始,删到该段结束(下一个 /* ---- 或空行分隔的功能段)
j = start
depth = 0
while j < len(lines):
    if j > start and lines[j].strip().startswith("/* ----") and depth >= 0:
        break
    j += 1

seg = "\n".join(lines[start:j])
assert "estimateCost" in seg, "这段里没有费用断言,位置可能不对"

removed = j - start
del lines[start:j]

# 在删除处留下一句说明
lines.insert(start, "/* ---- 费用本地估算已按收尾要求移除:不再用估算 Token 推算金额 ---- */")
lines.insert(start + 1, "/*      现在只显示服务商在 usage 里直接返回的真实数据(见 providers/openai-compatible.js) */")
lines.insert(start + 2, "")

s = "\n".join(lines)

# 配置开关的旧断言也要改:这两个开关已从产品里删掉
s = s.replace('  eq("默认显示估算", cfg.showTokenEstimate, true);\n', '')
s = s.replace('  eq("默认显示费用", cfg.showCostEstimate, true);\n', '')
s = s.replace('await ctx.saveContextConfig({ pageMaxTokens: 12000, showTokenEstimate: false, showCostEstimate: true });',
              'await ctx.saveContextConfig({ pageMaxTokens: 12000 });')
s = s.replace('  eq("保存后读回开关", cfg.showTokenEstimate, false);\n', '')
s = s.replace('eq("旧数据缺字段用默认补齐", [cfg.pageMaxTokens, cfg.showTokenEstimate, cfg.showCostEstimate], [8000, true, true]);',
              'eq("旧数据缺字段用默认补齐", cfg.pageMaxTokens, 8000);')

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("删除了 %d 行旧费用断言" % removed)

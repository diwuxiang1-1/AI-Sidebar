# -*- coding: utf-8 -*-
"""收尾 4:context.js 去掉本地价格表与费用推算(改为只认 API 真实数据)"""

import io

p = "utils/context.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# 1) 配置:去掉两个「估算开关」
rep("cfg",
    "var DEFAULT_CONTEXT_CONFIG = {\n"
    "  pageMaxTokens:     4000,\n"
    "  showTokenEstimate: true,\n"
    "  showCostEstimate:  true,\n",
    "var DEFAULT_CONTEXT_CONFIG = {\n"
    "  pageMaxTokens:     4000,\n")

rep("norm",
    "  merged.showTokenEstimate = merged.showTokenEstimate !== false;\n"
    "  merged.showCostEstimate  = merged.showCostEstimate  !== false;\n"
    "\n",
    "")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("context", k, "=", v)

# 2) 删掉价格表与费用函数(整段)
s = io.open(p, encoding="utf-8").read()
i = s.find("var MODEL_PRICES = [")
if i == -1:
    raise SystemExit("找不到 MODEL_PRICES")

# 往前找到这一段的注释开头
seg_start = s.rfind("/* ===", 0, i)
# 往后找到 formatCost 之后的段落结束
j = s.find("function formatCost(n) {")
assert j != -1
k = s.find("\n}\n", j) + 3

removed = s[seg_start:k]
s = s[:seg_start] + "/* ==================================================================\n" \
    "   费用(收尾轮调整)\n" \
    "   ----------------------------------------------------------------\n" \
    "   本地价格表与费用推算**已移除**。原因:\n" \
    "     · 各家价格随时变,写死在扩展里的表一定会过时;\n" \
    "     · 用它算出来的金额看着像真的,实际是错的 —— 比不显示更糟。\n" \
    "   现在只显示服务商在 usage 里**直接返回**的费用(见 providers/openai-compatible.js)。\n" \
    "   ================================================================== */\n" + s[k:]

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("context: 已删除价格表与费用函数(%d 字符)" % len(removed))

# 3) 检查还有没有残留引用
left = []
for name in ["MODEL_PRICES", "estimateCost", "formatCostLine", "showCostEstimate", "showTokenEstimate"]:
    t = io.open(p, encoding="utf-8").read()
    if name in t:
        left.append(name)
print("context 残留引用:", left if left else "无")

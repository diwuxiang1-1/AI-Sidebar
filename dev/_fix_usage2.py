# -*- coding: utf-8 -*-
"""收尾 3:侧边栏 —— 去掉本地费用估算,改为显示 API 真实 usage"""

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

# 1) 配置默认值去掉两个开关
rep("cfg",
    "var contextConfig   = { pageMaxTokens: 4000, showTokenEstimate: true, showCostEstimate: true };",
    "var contextConfig   = { pageMaxTokens: 4000, visionMode: \"auto\" };")

# 2) refreshEstimate:不再有开关,也不再算费用
rep("refresh",
    '''    if (!contextConfig.showTokenEstimate) { estimateBar.style.display = "none"; return; }

''',
    '')

rep("cost",
    '''    var costInfo = contextConfig.showCostEstimate
      ? estimateCost(breakdown.totalTokens, modelId)
      : null;

    renderEstimate(breakdown, costInfo, contextConfig.showCostEstimate);''',
    '''    renderEstimate(breakdown);''')

# 3) renderEstimate:去掉费用行
rep("render",
    '''/** 渲染预估栏 */
function renderEstimate(breakdown, costInfo, showCost) {''',
    '''/**
 * 渲染上下文规模栏
 * ⚠️ 这里显示的是**本地估算**的上下文规模,只用来判断「会不会太长」。
 *    真实用量由 showRealUsage() 显示 API 返回的 usage —— 两者含义不同,不要混。
 */
function renderEstimate(breakdown) {''')

rep("costline",
    '''  if (showCost) {
    var cost = document.createElement("div");
    cost.className   = "estimate-cost";
    cost.textContent = formatCostLine(costInfo);
    estimateBar.appendChild(cost);
  }

''',
    '''  // 费用只在服务商直接返回时显示(见 showRealUsage),这里不再做任何本地价格推算

''')

# 4) 标题文案说清这是估算
rep("title",
    "  title.textContent = report.title;",
    "  title.textContent = report.title + \"（本地估算）\";")

# 5) 真实用量:插在 renderEstimate 之后
USAGE = r'''
/* ==================================================================
   真实用量显示(收尾轮)
   ----------------------------------------------------------------
   原则:
     · 只显示 API 返回的 usage,一个数字都不猜
     · 服务商没返回 → 明确写「未提供实际用量」
     · 费用只在服务商直接给出时才显示;拿不到就一个金额都不写
   ================================================================== */

/** 最近一次请求的真实用量(没有则为 null) */
var lastUsageInfo = null;

function renderUsageBar() {
  if (!estimateBar) return;

  var old = estimateBar.querySelectorAll ? estimateBar.querySelector(".estimate-usage") : null;
  if (old && old.parentNode) old.parentNode.removeChild(old);

  var box = document.createElement("div");
  box.className = "estimate-usage";

  var u = lastUsageInfo;
  if (u && (u.totalTokens !== null || u.promptTokens !== null)) {
    var parts = [];
    if (u.promptTokens !== null)     parts.push("输入 " + u.promptTokens);
    if (u.completionTokens !== null) parts.push("输出 " + u.completionTokens);
    if (u.totalTokens !== null)      parts.push("合计 " + u.totalTokens);
    box.textContent = "实际用量(来自 API):" + parts.join(" · ");

    if (typeof u.cost === "number") {
      box.textContent += " · 费用 " + u.cost;
    }
  } else {
    box.textContent = "实际用量:当前 API 未提供实际用量";
  }

  estimateBar.appendChild(box);
  estimateBar.style.display = "";
}

/** 一次请求结束后刷新用量显示 */
function showRealUsage() {
  try {
    lastUsageInfo = (typeof lastUsage !== "undefined") ? lastUsage : null;
    renderUsageBar();
  } catch (e) { /* 显示失败不影响聊天 */ }
}

'''
rep("usage", "/** 预估栏的一行:左标签 + 右数值 */",
    USAGE.lstrip("\n") + "/** 预估栏的一行:左标签 + 右数值 */")

# 6) 回复结束后刷新真实用量
rep("after",
    '''    messages.push({ role: "assistant", content: fullText });
    addRegenerateRow();

    // 含糊的网页抱怨:回答完后问一句,不自作主张去改''',
    '''    messages.push({ role: "assistant", content: fullText });
    addRegenerateRow();
    showRealUsage();   // 收尾轮:显示这次请求的真实用量

    // 含糊的网页抱怨:回答完后问一句,不自作主张去改''')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sidebar", k, "=", v)

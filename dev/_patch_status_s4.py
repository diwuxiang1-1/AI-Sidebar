# -*- coding: utf-8 -*-
"""把 PROJECT_STATUS.md 更新到第四阶段"""

import io

p = "PROJECT_STATUS.md"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

rep("head",
    "> 最后更新:第十四轮(聊天交互整合 + 网页执行反馈 + API Key 多 Key 轮询)完成时。",
    "> 最后更新:第四阶段(高级网页操作层:锁定目标 / 多 Tab / 刷新恢复)完成时。")

rep("overview",
    "**同一服务商多 API Key 顺序轮询**、以及**两级可选 AI 权限**(网页 Agent / 浏览器 Agent)。",
    "**同一服务商多 API Key 顺序轮询**、**锁定目标(多 Tab 独立操作)**、\n"
    "**刷新后自动恢复网页修改**、以及**两级可选 AI 权限**(网页 Agent / 浏览器 Agent)。")

rep("rows",
    "| 侧边栏骨架 / 双页面切换 | 完成 | 顶部 `[聊天] [网页资源]` |",
    "| 侧边栏骨架 / 双页面切换 | 完成 | 顶部 `[聊天] [网页资源]` |\n"
    "| **锁定目标 / 多 Tab 独立操作**(锁定 · 切换 · 解除 · 关闭检测 · 导航确认) | 完成 | 顶部「AI 当前操作目标」栏 |\n"
    "| **刷新后自动恢复网页修改**(只存修改动作,不存 DOM) | 完成 | 目标面板 →「清除该网页修改」 |\n"
    "| 深度分析结构化输出(交互元素稳定 ID `button_1` / `input_1` …) | 完成 | 「修改网页」→「深度分析网页」 |\n"
    "| 媒体形态识别(直链 / blob+MSE / HLS / 受保护媒体) | 完成 | 「网页资源」页状态行 |\n"
    "| 直链媒体下载(仅普通 HTTP 直链;走等级 2) | 完成 | 「网页资源」→ 下载 |")

rep("partial",
    "| 多 Key 轮询 | 已实现(顺序、每 Key 每请求一次) |",
    "| 刷新后的修改恢复 | 已实现(按 URL 匹配重放结构化动作) | SPA 站内路由变化不会触发恢复(只有整页重新加载才会);媒体倍速锁定不参与恢复(刷新后 video 是新元素,`media_N` 编号失效) |\n"
    "| 多 Key 轮询 | 已实现(顺序、每 Key 每请求一次) |")

rep("rounds",
    "| 第十四轮 | **聊天交互整合**",
    "| 第四阶段 | **高级网页操作层**:\n"
    "`utils/targets.js` 锁定目标数据层(tabId/windowId/url/title/favicon/lockedAt/state)· 后台统一 `guardTarget(msg)` 解析目标 ·\n"
    "Tab 关闭 / 导航生命周期监听 · 侧边栏目标栏 + 锁定面板(多目标卡片 · 操作 / 设置目标 / 解除 / 重新确认)·\n"
    "按 tabId 隔离的网页修改状态 · 刷新后按 URL 重放结构化修改动作并如实回报 ·\n"
    "深度分析补 `page` / `interactive` / `forms` 与稳定 ID · 媒体形态识别(直链 / blob+MSE / HLS / DRM)· 只对直链提供下载 |\n"
    "| 第十四轮 | **聊天交互整合**")

rep("issues",
    "| 17 | **真实浏览器人工验证不完整** |",
    "| 17 | 跨 Tab 操作需要权限等级 1 | 目标是浏览器当前**不显示**的锁定网页时,后台强制校验等级 1;未开启会明确拒绝而不是静默作用到当前页面 |\n"
    "| 18 | Tab 管理 / 浏览器下载需要权限等级 2 | 下载、标签页、历史、Cookie 等一律走等级 2;未开启时返回「当前权限不足」而不是 JS 报错 |\n"
    "| 19 | 锁定目标上限 8 个 | 超过会明确提示,不静默丢弃 |\n"
    "| 20 | 已导航的目标默认拒绝执行 | 目标 Tab 跳到新地址后标记「需要重新确认」,避免把网页 B 当成网页 A;面板上点「重新确认此目标」恢复 |\n"
    "| 21 | 刷新恢复依赖 URL 匹配 | 页面地址变了(或改成了别的页面)就不会恢复;恢复失败的项目会逐条如实报告原因 |\n"
    "| 22 | **真实浏览器人工验证不完整** |")

rep("tests-head",
    "## 7. 测试(21 个套件 / 922 项断言,当前全绿)",
    "## 7. 测试(25 个套件 / 1075 项断言,当前全绿)")

rep("tests-body",
    "```bash\n# 本轮(第十四轮)新增",
    "```bash\n# 本轮(第四阶段)新增\n"
    "node dev/test_s4_targets.js   # 36  锁定目标 / 多目标切换 / Tab 关闭 / 导航确认 / 跨 Tab 权限\n"
    "node dev/test_s4_recover.js   # 22  刷新后恢复:自动重放 / 元素消失如实报失败 / 计划数据结构\n"
    "node dev/test_s4_media.js     # 75  深度分析结构化字段 + 稳定 ID / 视频控制 / 16× 锁定 / blob·MSE·DRM 识别\n"
    "node dev/test_s4_chat.js      # 20  聊天 × 目标网页:自动带 targetTabId / 多目标歧义先问 / 状态隔离 / 结果与失败回聊天\n\n"
    "# 第十四轮新增")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("status", k, "=", v)

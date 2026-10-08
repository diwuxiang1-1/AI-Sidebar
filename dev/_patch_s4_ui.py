# -*- coding: utf-8 -*-
"""第四阶段 · 3:侧边栏目标栏 + 锁定目标面板(HTML / CSS)"""

import io

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
# sidebar.html
# ============================================================
patch("sidebar/sidebar.html", [
    ("target-bar",
     '  <!-- ========== 页面 1:聊天(以下内容原样搬入容器,未改动结构) ========== -->',
     '  <!-- ========== AI 操作目标栏(第四阶段) ==========\n'
     '       始终显示 AI 正在操作哪个网页 ——「浏览器现在看哪个」与「AI 操作哪个」是两件事 -->\n'
     '  <div id="target-bar" class="target-bar">\n'
     '    <div class="target-current">\n'
     '      <span class="target-label">AI 当前操作目标</span>\n'
     '      <span id="target-current-name" class="target-name">当前活动网页</span>\n'
     '    </div>\n'
     '    <div class="target-actions">\n'
     '      <button id="btn-target-lock" class="btn btn-small btn-primary" type="button">锁定此网页</button>\n'
     '      <button id="btn-target-panel" class="btn btn-small" type="button">已锁定 <span id="target-count">0</span></button>\n'
     '    </div>\n'
     '  </div>\n'
     '\n'
     '  <!-- ========== 锁定目标面板(第四阶段,默认隐藏) ========== -->\n'
     '  <div id="target-panel" class="target-panel" style="display:none;">\n'
     '    <div class="target-panel-header">\n'
     '      <span>已锁定的网页</span>\n'
     '      <button id="btn-close-target" class="btn-close-panel" type="button">✕</button>\n'
     '    </div>\n'
     '    <div id="target-status" class="target-status"></div>\n'
     '    <div id="target-list" class="target-list"></div>\n'
     '    <div class="target-panel-foot">\n'
     '      <button id="btn-target-refresh" class="btn btn-small" type="button">刷新状态</button>\n'
     '      <button id="btn-target-lock-panel" class="btn btn-small btn-primary" type="button">锁定当前网页</button>\n'
     '    </div>\n'
     '  </div>\n'
     '\n'
     '  <!-- ========== 页面 1:聊天(以下内容原样搬入容器,未改动结构) ========== -->'),

    ("script",
     '  <script src="../utils/browser-tools.js"></script>\n  <script src="sidebar.js"></script>',
     '  <script src="../utils/browser-tools.js"></script>\n'
     '  <script src="../utils/targets.js"></script>\n'
     '  <script src="sidebar.js"></script>'),
], "sidebar.html")

# ============================================================
# sidebar.css
# ============================================================
patch("sidebar/sidebar.css", [
    ("css",
     '/* 选中文字 chip(第十四轮):轻量提示,不再是独立模式 */',
     '/* AI 操作目标栏(第四阶段) */\n'
     '.target-bar {\n'
     '  flex-shrink: 0; display: flex; align-items: center; gap: 8px;\n'
     '  padding: 6px 12px; border-bottom: 1px solid rgba(31,35,40,0.1);\n'
     '  background: #f6f7f9;\n'
     '}\n'
     '.target-current { flex: 1; min-width: 0; display: flex; flex-direction: column; }\n'
     '.target-label { font-size: 10px; color: #6e7681; }\n'
     '.target-name {\n'
     '  font-size: 12px; font-weight: 600; color: #1f2328;\n'
     '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n'
     '}\n'
     '.target-name.is-locked  { color: #1a7d1a; }\n'
     '.target-name.is-warn    { color: #b8860b; }\n'
     '.target-name.is-closed  { color: #d8353a; }\n'
     '.target-actions { display: flex; gap: 4px; flex-shrink: 0; }\n'
     '\n'
     '.target-panel {\n'
     '  flex-shrink: 0; max-height: 46%; overflow-y: auto;\n'
     '  padding: 8px 12px; border-bottom: 1px solid rgba(31,35,40,0.1);\n'
     '  background: #ffffff;\n'
     '}\n'
     '.target-panel-header {\n'
     '  display: flex; align-items: center; justify-content: space-between;\n'
     '  font-size: 13px; font-weight: 600; margin-bottom: 6px;\n'
     '}\n'
     '.target-status { font-size: 12px; color: #6e7681; margin-bottom: 8px; }\n'
     '.target-list { display: flex; flex-direction: column; gap: 6px; }\n'
     '\n'
     '.target-card {\n'
     '  border: 1px solid rgba(31,35,40,0.12); border-radius: 8px;\n'
     '  padding: 8px 10px; background: #f6f7f9;\n'
     '}\n'
     '.target-card.active { border-color: #2f6fed; background: #eef1f7; }\n'
     '.target-card.state-closed { border-color: #e6b3b3; }\n'
     '.target-card.state-navigated { border-color: #e6d5a8; }\n'
     '.target-card-head { display: flex; align-items: center; gap: 6px; }\n'
     '.target-card-title {\n'
     '  flex: 1; min-width: 0; font-size: 12px; font-weight: 600;\n'
     '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n'
     '}\n'
     '.target-badge {\n'
     '  font-size: 10px; padding: 1px 6px; border-radius: 8px; white-space: nowrap;\n'
     '  background: #e6f7e6; color: #1a7d1a;\n'
     '}\n'
     '.target-badge.warn   { background: #fdf3d8; color: #8a6d1a; }\n'
     '.target-badge.closed { background: #fef0f0; color: #d8353a; }\n'
     '.target-badge.mine   { background: #2f6fed; color: #ffffff; }\n'
     '.target-card-meta { margin-top: 4px; font-size: 11px; color: #6e7681; word-break: break-all; }\n'
     '.target-card-actions { display: flex; gap: 6px; margin-top: 6px; }\n'
     '.target-card-actions .btn { padding: 3px 10px; font-size: 12px; }\n'
     '.target-panel-foot { display: flex; gap: 6px; margin-top: 8px; }\n'
     '\n'
     '/* 聊天里的目标选择行(第四阶段) */\n'
     '.target-choose-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }\n'
     '.target-choose-row .btn { padding: 3px 10px; font-size: 12px; }\n'
     '\n'
     '/* 选中文字 chip(第十四轮):轻量提示,不再是独立模式 */'),

    ("cssdark",
     '  .selection-chip { background: #20253b; border-color: rgba(87,134,246,0.35); color: #5786f6; }',
     '  .selection-chip { background: #20253b; border-color: rgba(87,134,246,0.35); color: #5786f6; }\n'
     '  .target-bar { background: #232528; border-color: rgba(255,255,255,0.12); }\n'
     '  .target-name { color: #e8eaed; }\n'
     '  .target-name.is-locked { color: #6ddb6d; }\n'
     '  .target-name.is-warn   { color: #e0c060; }\n'
     '  .target-name.is-closed { color: #f06a6a; }\n'
     '  .target-panel { background: #1e1f22; border-color: rgba(255,255,255,0.12); }\n'
     '  .target-status { color: #9aa0a6; }\n'
     '  .target-card { background: #232528; border-color: rgba(255,255,255,0.12); }\n'
     '  .target-card.active { background: #20253b; border-color: #5786f6; }\n'
     '  .target-card.state-closed { border-color: #6b3535; }\n'
     '  .target-card.state-navigated { border-color: #6b5f35; }\n'
     '  .target-card-meta { color: #9aa0a6; }\n'
     '  .target-badge { background: #1a3a1a; color: #6ddb6d; }\n'
     '  .target-badge.warn { background: #3a3320; color: #e0c060; }\n'
     '  .target-badge.closed { background: #3a1a1a; color: #f06a6a; }\n'
     '  .target-badge.mine { background: #5786f6; color: #1e1f22; }'),
], "sidebar.css")

print("UI 补丁完成")

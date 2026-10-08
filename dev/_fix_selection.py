# -*- coding: utf-8 -*-
"""收尾 6:选中文字预览面板 + 上下文优先级 + 网页内容按不可信数据处理"""

import io

def patch(path, pairs, tag):
    s = io.open(path, encoding="utf-8").read()
    for name, old, new in pairs:
        c = s.count(old)
        print(tag, name, "=", c)
        if c != 1:
            raise SystemExit("!! %s / %s 匹配 %d 次" % (tag, name, c))
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(s)

# ============================================================
# 1. sidebar.html:chip → 预览面板
# ============================================================
patch("sidebar/sidebar.html", [
    ("panel",
     '    <div id="selection-chip" class="selection-chip" style="display:none;">\n'
     '      <span id="selection-chip-text" class="selection-chip-text"></span>\n'
     '      <button id="selection-chip-clear" class="chip-close" type="button" title="清除选中文字">×</button>\n'
     '    </div>',
     '    <!-- 选中文字(收尾轮):显示实际内容,纯本地渲染,不调用 AI -->\n'
     '    <div id="selection-panel" class="selection-panel" style="display:none;">\n'
     '      <div class="selection-head">\n'
     '        <span class="selection-title">已选中文字</span>\n'
     '        <span id="selection-count" class="selection-count"></span>\n'
     '        <button id="btn-selection-toggle" class="btn btn-small" type="button">展开</button>\n'
     '        <button id="selection-chip-clear" class="chip-close" type="button" title="清除选中文字">×</button>\n'
     '      </div>\n'
     '      <div id="selection-preview" class="selection-preview"></div>\n'
     '      <div class="selection-actions">\n'
     '        <button id="btn-selection-copy" class="btn btn-small" type="button">复制</button>\n'
     '        <button id="btn-selection-toinput" class="btn btn-small btn-primary" type="button">加入输入框</button>\n'
     '      </div>\n'
     '    </div>'),
], "sidebar.html")

# ============================================================
# 2. sidebar.css
# ============================================================
patch("sidebar/sidebar.css", [
    ("css",
     '/* 选中文字 chip(第十四轮):轻量提示,不再是独立模式 */',
     '/* 选中文字预览面板(收尾轮) */\n'
     '.selection-panel {\n'
     '  display: flex; flex-direction: column; gap: 4px;\n'
     '  margin: 0 0 6px; padding: 6px 8px;\n'
     '  border: 1px solid rgba(47,111,237,0.3); border-radius: 6px;\n'
     '  background: #eef1f7;\n'
     '}\n'
     '.selection-head { display: flex; align-items: center; gap: 6px; }\n'
     '.selection-title { font-size: 11px; font-weight: 600; color: #2f6fed; }\n'
     '.selection-count { flex: 1; font-size: 11px; color: #6e7681; }\n'
     '.selection-head .btn { padding: 2px 8px; font-size: 11px; }\n'
     '.selection-preview {\n'
     '  max-height: 84px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;\n'
     '  font-size: 12px; line-height: 1.5; color: #1f2328;\n'
     '  background: #ffffff; border: 1px solid rgba(31,35,40,0.08); border-radius: 4px;\n'
     '  padding: 4px 6px;\n'
     '}\n'
     '.selection-panel.expanded .selection-preview { max-height: 260px; }\n'
     '.selection-actions { display: flex; gap: 6px; }\n'
     '.selection-actions .btn { padding: 2px 10px; font-size: 11px; }\n\n'
     '/* 选中文字 chip(第十四轮):轻量提示,不再是独立模式 */'),

    ("dark",
     '  .selection-chip { background: #20253b; border-color: rgba(87,134,246,0.35); color: #5786f6; }',
     '  .selection-chip { background: #20253b; border-color: rgba(87,134,246,0.35); color: #5786f6; }\n'
     '  .selection-panel { background: #20253b; border-color: rgba(87,134,246,0.35); }\n'
     '  .selection-title { color: #5786f6; }\n'
     '  .selection-count { color: #9aa0a6; }\n'
     '  .selection-preview { background: #1e1f22; border-color: rgba(255,255,255,0.10); color: #e8eaed; }'),
], "sidebar.css")

print("选中文字 UI 完成")

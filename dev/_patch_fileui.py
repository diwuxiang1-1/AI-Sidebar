# -*- coding: utf-8 -*-
"""完整版 9:聊天输入框旁边的「📎 添加文件」"""

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
# sidebar.html:按钮 + 隐藏的 file input + 已选文件条
# ============================================================
patch("sidebar/sidebar.html", [
    ("fileui",
     '    <button id="btn-stop" class="btn btn-stop" type="button" style="display:none;" data-i18n="input.stop">停止</button>',
     '    <!-- 文件输入(完整版):本地读取,不上传 -->\n'
     '    <button id="btn-add-file" class="btn btn-file" type="button" data-i18n-title="input.addFile" title="添加文件">📎</button>\n'
     '    <input id="file-input" class="file-input-hidden" type="file" multiple\n'
     '           accept=".txt,.md,.json,.csv,.log,.xml,.html,.css,.js,.ts,.yaml,.yml,.py,.sql,image/*" />\n'
     '    <button id="btn-stop" class="btn btn-stop" type="button" style="display:none;" data-i18n="input.stop">停止</button>'),

    ("filebar",
     '    <div id="selection-chip" class="selection-chip" style="display:none;">',
     '    <!-- 已添加的文件(完整版) -->\n'
     '    <div id="file-chip" class="file-chip" style="display:none;">\n'
     '      <span id="file-chip-text" class="file-chip-text"></span>\n'
     '      <button id="file-chip-clear" class="chip-close" type="button" title="移除文件">×</button>\n'
     '    </div>\n'
     '    <div id="selection-chip" class="selection-chip" style="display:none;">'),

    ("script",
     '  <script src="../utils/i18n.js"></script>\n  <script src="sidebar.js"></script>',
     '  <script src="../utils/i18n.js"></script>\n'
     '  <script src="../utils/files.js"></script>\n'
     '  <script src="sidebar.js"></script>'),
], "sidebar.html")

# ============================================================
# sidebar.css
# ============================================================
patch("sidebar/sidebar.css", [
    ("css",
     '/* 图片缩略图(第四阶段收尾) */',
     '/* 文件输入(完整版) */\n'
     '.btn-file { padding: 6px 10px; font-size: 15px; line-height: 1; flex-shrink: 0; }\n'
     '.file-input-hidden { display: none; }\n'
     '.file-chip {\n'
     '  display: flex; align-items: center; gap: 6px;\n'
     '  margin: 0 0 6px; padding: 4px 8px;\n'
     '  border: 1px solid rgba(31,35,40,0.15); border-radius: 6px;\n'
     '  background: #f6f7f9; font-size: 12px; color: #1f2328;\n'
     '  max-height: 96px; overflow-y: auto;\n'
     '}\n'
     '.file-chip-text { flex: 1; white-space: pre-wrap; word-break: break-all; }\n'
     '.file-chip .chip-close {\n'
     '  border: none; background: transparent; color: inherit; cursor: pointer;\n'
     '  font-size: 14px; line-height: 1; padding: 0 2px; flex-shrink: 0;\n'
     '}\n'
     '.file-chip .chip-close:hover { color: #d8353a; }\n\n'
     '/* 图片缩略图(第四阶段收尾) */'),

    ("dark",
     '  .res-status-line { color: #9aa0a6; }',
     '  .res-status-line { color: #9aa0a6; }\n'
     '  .file-chip { background: #232528; border-color: rgba(255,255,255,0.12); color: #e8eaed; }'),
], "sidebar.css")

print("文件输入 UI 完成")

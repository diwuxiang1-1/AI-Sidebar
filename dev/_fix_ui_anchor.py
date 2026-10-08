# -*- coding: utf-8 -*-
import io, re

p = "dev/_patch_visionui.py"
s = io.open(p, encoding="utf-8").read()

# 把 uiLang 那一段的锚点改成单行(避开注释里的横线/中文编码问题)
start = s.index('    ("uiLang",')
end = s.index('    ("vision",')
good = ('    ("uiLang",\n'
        "     '  <h2>\\u4e0a\\u4e0b\\u6587\\u7ba1\\u7406</h2>',\n"
        "     '  <!-- \\u4f7f\\u7528\\u8005\\u8bed\\u8a00(\\u5b8c\\u6574\\u7248) -->\\n'\n"
        "     '  <h2>\\u4f7f\\u7528\\u8005\\u8bed\\u8a00</h2>\\n'\n"
        "     '  <div class=\"form-group\">\\n'\n"
        "     '    <label for=\"ui-lang\">\\u754c\\u9762\\u4e0e\\u63d0\\u793a\\u8bed\\u8a00</label>\\n'\n"
        "     '    <select id=\"ui-lang\"></select>\\n'\n"
        "     '  </div>\\n'\n"
        "     '  <div class=\"info-note\">\\n'\n"
        "     '    <div class=\"info-note-title\">\\u5173\\u4e8e\\u4f7f\\u7528\\u8005\\u8bed\\u8a00</div>\\n'\n"
        "     '    <ul class=\"info-note-list\">\\n'\n"
        "     '      <li>\\u8fd9\\u91cc\\u8bbe\\u7f6e\\u7684\\u662f<strong>\\u4f60\\u81ea\\u5df1\\u770b\\u5230\\u7684\\u754c\\u9762\\u8bed\\u8a00</strong>\\u3002</li>\\n'\n"
        "     '      <li>\\u5b83\\u4e0e\\u300c\\u7f51\\u9875\\u7ffb\\u8bd1\\u300d\\u91cc\\u7684<strong>\\u76ee\\u6807\\u8bed\\u8a00\\u662f\\u4e24\\u4ef6\\u72ec\\u7acb\\u7684\\u4e8b</strong>\\uff1a\\u754c\\u9762\\u7528\\u4e2d\\u6587\\u3001\\u7ffb\\u8bd1\\u6210\\u65e5\\u6587\\uff0c\\u5b8c\\u5168\\u53ef\\u4ee5\\u3002</li>\\n'\n"
        "     '      <li>\\u5f00\\u542f\\u300c\\u5f53\\u524d\\u7f51\\u9875\\u300d\\u804a\\u5929\\u65f6\\uff0cAI \\u4e5f\\u4f1a\\u88ab\\u8981\\u6c42\\u7528\\u8fd9\\u4e2a\\u8bed\\u8a00\\u56de\\u590d\\u3002</li>\\n'\n"
        "     '    </ul>\\n'\n"
        "     '  </div>\\n'\n"
        "     '\\n'\n"
        "     '  <h2>\\u4e0a\\u4e0b\\u6587\\u7ba1\\u7406</h2>'),\n"
        "\n")

s = s[:start] + good + s[end:]
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("uiLang 锚点已重写")

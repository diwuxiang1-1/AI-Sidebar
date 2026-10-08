# 一次性补丁脚本:把 sidebar.js 中 buildPageContextMessage 的
# 「固定 4000 字符截断」替换为「可配置 token 上限截断」。
# 该处含字面 \uXXXX 转义序列,用正则匹配可避免手工转义。
# 执行成功后本脚本即可删除。

import io
import re
import sys

PATH = r"E:\AI-Sidebar\sidebar\sidebar.js"

pat = re.compile(
    r'  var text = pageInfo\.text \|\| "";\r?\n'
    r'  var totalLen = text\.length;\r?\n'
    r'  if \(text\.length > MAX_PAGE_CONTEXT_CHARS\) \{\r?\n'
    r'    text = text\.slice\(0, MAX_PAGE_CONTEXT_CHARS\);\r?\n'
    r'  \}\r?\n'
    r'  var truncNote = totalLen > MAX_PAGE_CONTEXT_CHARS\r?\n'
    r'    \? "[^"]*"[^\r\n]*\r?\n'
    r'    : "";\r?\n'
)

new = (
    '  // 第七阶段:按可配置的 token 上限截断(替代原固定 4000 字符上限)\n'
    '  var limit  = contextConfig.pageMaxTokens || 4000;\n'
    '  var result = truncateTextToTokens(pageInfo.text || "", limit);\n'
    '  var text   = result.text;\n'
    '\n'
    '  lastContextText = text;   // 供 Token 预估使用\n'
    '\n'
    '  var truncNote = result.truncated ? buildPageTruncationNote(result.originalTokens, limit) : "";\n'
)

with io.open(PATH, "r", encoding="utf-8", newline="") as f:
    src = f.read()

hits = len(pat.findall(src))
print("matches:", hits)
if hits != 1:
    sys.exit("expected exactly 1 match -- aborting, file untouched")

src = pat.sub(lambda m: new, src, count=1)

with io.open(PATH, "w", encoding="utf-8", newline="") as f:
    f.write(src)

print("patched OK")

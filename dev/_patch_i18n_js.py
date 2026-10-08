# -*- coding: utf-8 -*-
"""完整版 8:侧边栏 init 应用语言 + AI 回复语言 + 文件输入"""

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

# 1) init 里应用界面语言
rep("init",
    '  await loadTargets();\n  renderTargetBar();',
    '  // 完整版:应用使用者语言(没有翻译的文案原样保留,不影响中文界面)\n'
    '  await initUiLanguage();\n'
    '\n'
    '  await loadTargets();\n'
    '  renderTargetBar();')

# 2) AI 回复语言:拼进上下文
rep("langnote",
    '  if (currentSelection) {\n'
    '    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });\n'
    '  }\n'
    '\n'
    '  return contextMessages;\n'
    '}',
    '  if (currentSelection) {\n'
    '    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });\n'
    '  }\n'
    '\n'
    '  return contextMessages;\n'
    '}\n'
    '\n'
    '/**\n'
    ' * 应用使用者语言\n'
    ' * ⚠️ 只改有 data-i18n 标记的元素 —— 没标记的一律保持原样,中文界面不会被破坏\n'
    ' */\n'
    'async function initUiLanguage() {\n'
    '  try {\n'
    '    if (typeof getUiLang !== "function" || typeof applyI18n !== "function") return;\n'
    '    var lang = await getUiLang();\n'
    '    setCurrentLang(lang);\n'
    '    applyI18n(document, lang);\n'
    '    if (typeof setTranslateUiLanguage === "function") setTranslateUiLanguage(lang);\n'
    '  } catch (e) {\n'
    '    // 语言模块异常不影响任何功能,界面保持默认中文\n'
    '  }\n'
    '}')

# 3) 回复语言要求:作为一条 system 上下文注入(不写进历史)
rep("langctx",
    '  if (currentSelection) {\n'
    '    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });\n'
    '  }\n'
    '\n'
    '  return contextMessages;\n'
    '}\n'
    '\n'
    '/**\n'
    ' * 应用使用者语言',
    '  if (currentSelection) {\n'
    '    contextMessages.push({ role: "system", content: buildSelectionContextMessage() });\n'
    '  }\n'
    '\n'
    '  // 完整版:要求 AI 用「使用者语言」回答(与网页翻译目标语言无关)\n'
    '  try {\n'
    '    if (typeof buildLanguageNote === "function") {\n'
    '      contextMessages.push({ role: "system", content: buildLanguageNote() });\n'
    '    }\n'
    '  } catch (e) { /* 语言模块不可用时静默跳过 */ }\n'
    '\n'
    '  return contextMessages;\n'
    '}\n'
    '\n'
    '/**\n'
    ' * 应用使用者语言')

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sidebar", k, "=", v)

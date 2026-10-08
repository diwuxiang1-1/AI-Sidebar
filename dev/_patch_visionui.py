# -*- coding: utf-8 -*-
"""完整版 6:设置页 —— 视觉上下文模式 + 使用者语言(与翻译目标语言独立)"""

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
# settings.html:视觉模式 + 使用者语言
# ============================================================
patch("settings/settings.html", [
    ("uiLang",
     '  <h2>\u4e0a\u4e0b\u6587\u7ba1\u7406</h2>',
     '  <!-- \u4f7f\u7528\u8005\u8bed\u8a00(\u5b8c\u6574\u7248) -->\n'
     '  <h2>\u4f7f\u7528\u8005\u8bed\u8a00</h2>\n'
     '  <div class="form-group">\n'
     '    <label for="ui-lang">\u754c\u9762\u4e0e\u63d0\u793a\u8bed\u8a00</label>\n'
     '    <select id="ui-lang"></select>\n'
     '  </div>\n'
     '  <div class="info-note">\n'
     '    <div class="info-note-title">\u5173\u4e8e\u4f7f\u7528\u8005\u8bed\u8a00</div>\n'
     '    <ul class="info-note-list">\n'
     '      <li>\u8fd9\u91cc\u8bbe\u7f6e\u7684\u662f<strong>\u4f60\u81ea\u5df1\u770b\u5230\u7684\u754c\u9762\u8bed\u8a00</strong>\u3002</li>\n'
     '      <li>\u5b83\u4e0e\u300c\u7f51\u9875\u7ffb\u8bd1\u300d\u91cc\u7684<strong>\u76ee\u6807\u8bed\u8a00\u662f\u4e24\u4ef6\u72ec\u7acb\u7684\u4e8b</strong>\uff1a\u754c\u9762\u7528\u4e2d\u6587\u3001\u7ffb\u8bd1\u6210\u65e5\u6587\uff0c\u5b8c\u5168\u53ef\u4ee5\u3002</li>\n'
     '      <li>\u5f00\u542f\u300c\u5f53\u524d\u7f51\u9875\u300d\u804a\u5929\u65f6\uff0cAI \u4e5f\u4f1a\u88ab\u8981\u6c42\u7528\u8fd9\u4e2a\u8bed\u8a00\u56de\u590d\u3002</li>\n'
     '    </ul>\n'
     '  </div>\n'
     '\n'
     '  <h2>\u4e0a\u4e0b\u6587\u7ba1\u7406</h2>'),

    ("vision",
     '  <div class="form-group">\n'
     '    <label class="checkbox-row" for="show-cost-estimate">\n'
     '      <input id="show-cost-estimate" type="checkbox" />\n'
     '      <span>显示费用提示</span>\n'
     '    </label>\n'
     '  </div>',
     '  <div class="form-group">\n'
     '    <label class="checkbox-row" for="show-cost-estimate">\n'
     '      <input id="show-cost-estimate" type="checkbox" />\n'
     '      <span>显示费用提示</span>\n'
     '    </label>\n'
     '  </div>\n'
     '\n'
     '  <!-- 视觉上下文(完整版) -->\n'
     '  <div class="form-group">\n'
     '    <label for="vision-mode">网页截图(视觉理解)</label>\n'
     '    <select id="vision-mode">\n'
     '      <option value="auto">按需 —— 只有需要看页面时才截图(默认)</option>\n'
     '      <option value="on">总是 —— 开着「当前网页」就附上截图</option>\n'
     '      <option value="off">关闭 —— 从不截图,只用文字</option>\n'
     '    </select>\n'
     '  </div>\n'
     '  <div class="hint">截图只发给<strong>你自己配置的 API</strong>,不经过任何第三方;截图不会写进聊天记录。\n'
     '    只有支持图片输入的模型才会用到它。</div>'),

    ("script",
     '<script src="../utils/permissions.js"></script>',
     '<script src="../utils/permissions.js"></script>' + chr(10) + '<script src="../utils/i18n.js"></script>'),
], "settings.html")

# ============================================================
# settings.js:读写
# ============================================================
patch("settings/settings.js", [
    ("refs",
     'var contextStatus          = document.getElementById("context-status");',
     'var contextStatus          = document.getElementById("context-status");\n'
     'var visionModeSelect       = document.getElementById("vision-mode");\n'
     '\n'
     '/* ---- DOM:使用者语言(完整版) ---- */\n'
     'var uiLangSelect           = document.getElementById("ui-lang");'),

    ("save",
     '    await saveContextConfig({\n'
     '      pageMaxTokens:     tokens,\n'
     '      showTokenEstimate: showTokenEstimateInput.checked,\n'
     '      showCostEstimate:  showCostEstimateInput.checked,\n'
     '    });',
     '    await saveContextConfig({\n'
     '      pageMaxTokens:     tokens,\n'
     '      showTokenEstimate: showTokenEstimateInput.checked,\n'
     '      showCostEstimate:  showCostEstimateInput.checked,\n'
     '      visionMode:        visionModeSelect ? visionModeSelect.value : "auto",\n'
     '    });'),

    ("load",
     'async function loadContextSettings() {',
     '/** 使用者语言:填充下拉框 + 读取当前值 + 绑定保存 */\n'
     'function initUiLanguage() {\n'
     '  if (!uiLangSelect || typeof I18N_LANGS === "undefined") return;\n'
     '\n'
     '  for (var i = 0; i < I18N_LANGS.length; i++) {\n'
     '    var opt = document.createElement("option");\n'
     '    opt.value = I18N_LANGS[i].id;\n'
     '    opt.textContent = I18N_LANGS[i].name;\n'
     '    uiLangSelect.appendChild(opt);\n'
     '  }\n'
     '\n'
     '  getUiLang().then(function (lang) {\n'
     '    uiLangSelect.value = lang;\n'
     '    applyI18n(document, lang);\n'
     '  });\n'
     '\n'
     '  uiLangSelect.addEventListener("change", function () {\n'
     '    var lang = uiLangSelect.value;\n'
     '    saveUiLang(lang).then(function () {\n'
     '      applyI18n(document, lang);\n'
     '      showStatus("界面语言已切换。侧边栏需要重新打开才会全部生效。", "ok");\n'
     '    });\n'
     '  });\n'
     '}\n'
     '\n'
     'async function loadContextSettings() {'),

    ("init",
     '  loadSettings();\n  loadContextSettings();\n  loadPermissionSettings();',
     '  initUiLanguage();\n'
     '  loadSettings();\n'
     '  loadContextSettings();\n'
     '  loadPermissionSettings();'),

    ("applycontext",
     '    showTokenEstimateInput.checked = cfg.showTokenEstimate !== false;',
     '    if (visionModeSelect) visionModeSelect.value = cfg.visionMode || "auto";' + chr(10) +
     '    showTokenEstimateInput.checked = cfg.showTokenEstimate !== false;'),
    ("bind",
     'showCostEstimateInput.addEventListener("change",  function () { saveContextSettings(); });',
     'showCostEstimateInput.addEventListener("change",  function () { saveContextSettings(); });\n'
     'if (visionModeSelect) visionModeSelect.addEventListener("change", function () { saveContextSettings(); });'),
], "settings.js")

print("设置页完成")

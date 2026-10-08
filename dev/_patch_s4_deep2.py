# -*- coding: utf-8 -*-
"""第四阶段 · 9:深度分析聚合 + 报告 + 侧边栏显示"""

import io

def rep_file(path, pairs, tag):
    s = io.open(path, encoding="utf-8").read()
    for name, old, new in pairs:
        c = s.count(old)
        print(tag, name, "=", c)
        if c != 1:
            raise SystemExit("!! %s / %s 匹配 %d 次" % (tag, name, c))
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(s)

# ============================================================
# 1. 后台:聚合新增计数 + 交互元素
# ============================================================
rep_file("background/service-worker.js", [
    ("counts",
     "  var counts = { dom: 0, video: 0, audio: 0, iframe: 0, shadow: 0, media: 0, playing: 0 };\n"
     "  var media = [], iframes = [], shadows = [];\n"
     "  var scanned = 0;",
     "  var counts = {\n"
     "    dom: 0, visible: 0, video: 0, audio: 0, iframe: 0, shadow: 0, media: 0, playing: 0,\n"
     "    button: 0, input: 0, textarea: 0, select: 0, link: 0, image: 0, form: 0,\n"
     "    mse: 0, drm: 0,\n"
     "  };\n"
     "  var media = [], iframes = [], shadows = [];\n"
     "  var interactive = { buttons: [], inputs: [], textareas: [], selects: [], links: [], images: [] };\n"
     "  var forms = [];\n"
     "  var page = null;\n"
     "  var scanned = 0;"),

    ("accum",
     "    counts.dom    += r.counts.dom || 0;\n"
     "    counts.video  += r.counts.video || 0;\n"
     "    counts.audio  += r.counts.audio || 0;\n"
     "    counts.iframe += r.counts.iframe || 0;\n"
     "    counts.shadow += r.counts.shadow || 0;\n"
     "    counts.media  += r.counts.media || 0;\n"
     "    counts.playing += r.counts.playing || 0;\n",
     "    Object.keys(counts).forEach(function (key) {\n"
     "      counts[key] += (r.counts && r.counts[key]) || 0;\n"
     "    });\n"
     "\n"
     "    // 只有顶层 frame 的页面信息才代表「这个网页」\n"
     "    if (!page && r.page && f.frameId === 0) page = r.page;\n"
     "\n"
     "    // 交互元素:各 frame 分别编号后汇总(f<frame>_button_1 这种形式)\n"
     "    if (r.interactive) {\n"
     "      Object.keys(interactive).forEach(function (key) {\n"
     "        var arr = r.interactive[key] || [];\n"
     "        for (var ii = 0; ii < arr.length && interactive[key].length < 40; ii++) {\n"
     "          var it = arr[ii];\n"
     "          it.frameId = f.frameId;\n"
     "          it.stableId = (f.frameId === 0 ? \"\" : \"f\" + f.frameId + \"_\") + it.id;\n"
     "          interactive[key].push(it);\n"
     "        }\n"
     "      });\n"
     "    }\n"
     "    (r.forms || []).forEach(function (fm) {\n"
     "      if (forms.length >= 20) return;\n"
     "      fm.frameId = f.frameId;\n"
     "      fm.stableId = (f.frameId === 0 ? \"\" : \"f\" + f.frameId + \"_\") + fm.id;\n"
     "      forms.push(fm);\n"
     "    });\n"),

    ("return",
     "    counts:  counts,\n"
     "    media:   media,\n"
     "    iframes: iframes,\n"
     "    shadows: shadows,\n"
     "    report:  report,\n"
     "    length:  report.length,\n"
     "  };",
     "    counts:  counts,\n"
     "    page:    page,\n"
     "    media:   media,\n"
     "    iframes: iframes,\n"
     "    shadows: shadows,\n"
     "    interactive: interactive,\n"
     "    forms:   forms,\n"
     "    report:  report,\n"
     "    length:  report.length,\n"
     "  };"),
], "service-worker.js")

# ============================================================
# 2. 后台:报告文本带上媒体形态与稳定 ID
# ============================================================
rep_file("background/service-worker.js", [
    ("report-media",
     "      lines.push(\"- \" + m.id + \" (\" + m.type + \") frame\" + m.frameId + \" · \" +\n"
     "        (m.visible ? \"可见\" : \"不可见\") + \" · \" + (m.paused ? \"已暂停\" : \"播放中\") +\n"
     "        \" · 倍速 \" + m.playbackRate + \" · 音量 \" + m.volume + (m.muted ? \"(静音)\" : \"\") +\n"
     "        \" · 进度 \" + m.currentTime + (m.duration === null ? \"/未知\" : \"/\" + m.duration) + \" 秒\" +\n"
     "        \" · 源 \" + m.srcType);\n"
     "      lines.push(\"  frame 地址: \" + m.frameUrl);",
     "      var kind = m.kind || {};\n"
     "      lines.push(\"- \" + m.id + (m.stableId ? \"(\" + m.stableId + \")\" : \"\") + \" (\" + m.type + \") frame\" + m.frameId + \" · \" +\n"
     "        (m.visible ? \"可见\" : \"不可见\") + \" · \" + (m.paused ? \"已暂停\" : \"播放中\") +\n"
     "        \" · 倍速 \" + m.playbackRate + \" · 音量 \" + m.volume + (m.muted ? \"(静音)\" : \"\") +\n"
     "        \" · 进度 \" + m.currentTime + (m.duration === null ? \"/未知\" : \"/\" + m.duration) + \" 秒\" +\n"
     "        \" · 源 \" + m.srcType);\n"
     "      lines.push(\"  形态:\" + (kind.label || \"未知\") +\n"
     "        \" · 可控制:\" + (kind.controllable === false ? \"否\" : \"是\") +\n"
     "        \" · 可下载:\" + (kind.downloadable ? \"是\" : \"否\") + (kind.note ? \" · \" + kind.note : \"\"));\n"
     "      lines.push(\"  frame 地址: \" + m.frameUrl);"),

    ("report-tail",
     "  if (iframes.length) {",
     "  if (counts.button || counts.input || counts.link || counts.form || counts.image) {\n"
     "    lines.push(\"\");\n"
     "    lines.push(\"【页面要素】button \" + counts.button + \" · input \" + counts.input +\n"
     "      \" · textarea \" + counts.textarea + \" · select \" + counts.select +\n"
     "      \" · link \" + counts.link + \" · image \" + counts.image + \" · form \" + counts.form);\n"
     "    lines.push(\"交互元素有稳定的内部 ID(button_1 / input_1 / link_1 …),修改网页时可直接引用,不必猜 CSS 选择器。\");\n"
     "  }\n"
     "\n"
     "  if (iframes.length) {"),
], "service-worker.js")

# 报告函数需要拿到 counts 的新字段 —— 签名不变(counts 已经是对象)
print("深度分析聚合完成")

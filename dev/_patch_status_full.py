# -*- coding: utf-8 -*-
"""把 PROJECT_STATUS.md 更新到完整版冲刺轮"""

import io

p = "PROJECT_STATUS.md"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次: %s" % (tag, c, old[:40]))
    s = s.replace(old, new, 1)

rep("head",
    "> 最后更新:收尾维护轮(功能开发结束)。",
    "> 最后更新:完整版冲刺轮(解除复制限制 / 使用者语言 / 多模态截图 / 文件输入)。")

rep("rows",
    "| 直链媒体下载按钮 | ✅ | 只有普通 HTTP 直链才有,走权限等级 2 |",
    "| 直链媒体下载按钮 | ✅ | 只有普通 HTTP 直链才有,走权限等级 2 |\n"
    "| **解除复制 / 选择 / 右键限制** | ✅ | 结构化动作 `remove_copy_restrictions`,不用 eval |\n"
    "| **多模态网页上下文**(按需截图) | ✅ | 设置页「网页截图」= 按需 / 总是 / 关闭 |\n"
    "| **使用者语言**(8 种,与翻译目标语言独立) | ✅ | 设置页「使用者语言」 |\n"
    "| **文件输入**(文本本地读取 + 图片走视觉) | ✅ | 输入框旁边 📎 |")

rep("tree",
    "│  ├─ permissions.js              133 行   两级权限读写 + 审计日志",
    "│  ├─ permissions.js              133 行   两级权限读写 + 审计日志\n"
    "│  ├─ i18n.js                     约 250 行 界面语言(8 种,与翻译目标语言独立)\n"
    "│  ├─ files.js                    约 250 行 文件输入:本地读取 / 分类 / 大小限制")

rep("issues",
    "| 26 | **真实浏览器人工验证不完整** |",
    "| 26 | 截图只能抓当前显示的标签页 | `captureVisibleTab` 抓不到后台标签,窗口最小化也抓不到;会如实说明并退回文字上下文 |\n"
    "| 27 | PDF / Word / Excel 暂不解析 | 浏览器原生 API 拿不到这些格式的文本,引入 pdf.js / mammoth / sheetjs 会破坏「零依赖」;当前明确提示不支持并建议另存为 txt / md / csv |\n"
    "| 28 | 视觉模型靠模型名启发式判断 | 名字对不上时先按不支持处理;若实际支持,可把「网页截图」设为「总是」。真的不支持时也会自动去掉图片重试一次 |\n"
    "| 29 | 解除复制限制只管前端限制 | 图片型内容、服务端权限控制、需登录才能看的内容不在范围内 |\n"
    "| 30 | **真实浏览器人工验证不完整** |")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("status", k, "=", v)

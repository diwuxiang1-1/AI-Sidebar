# -*- coding: utf-8 -*-
"""补完 PROJECT_STATUS.md 的测试数字与新增测试行"""

import io

p = "PROJECT_STATUS.md"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new, count=1):
    global s
    c = s.count(old)
    n[tag] = c
    if c != count:
        raise SystemExit("!! %s 匹配 %d 次(期望 %d)" % (tag, c, count))
    s = s.replace(old, new)

rep("c1", "26 个测试文件、**1110 项断言,当前全绿**。详见第 13 章。",
         "28 个测试文件、**1225 项断言,当前全绿**。详见第 13 章。")
rep("c2", "**合计:26 个文件 / 1110 项断言 / 0 失败。**",
         "**合计:28 个文件 / 1225 项断言 / 0 失败。**")
rep("c3", "刷新恢复 —— 全部完成并有测试覆盖(26 个套件 / 1110 项断言 / 0 失败)。",
         "刷新恢复 · 解除复制限制 · 使用者语言 · 视觉上下文 · 文件输入\n"
         "—— 全部完成并有测试覆盖(28 个套件 / 1225 项断言 / 0 失败)。")

# 测试表里补两行(插在 table 的第一行之前,保持表格完整)
rep("t1",
    "| `test_webpatch.js` | 129 | WebPatch 全链路:解析 / 执行 / 撤销 / 恢复 / 安全 / 编排 | 单元 + 集成 |",
    "| `test_webpatch.js` | 129 | WebPatch 全链路:解析 / 执行 / 撤销 / 恢复 / 安全 / 编排 | 单元 + 集成 |\n"
    "| `test_full.js` | 77 | 完整版:文件输入(格式/限制/上下文)+ 8 种语言 + 视觉上下文 | 单元 + 集成 |\n"
    "| `test_copy.js` | 38 | 解除复制限制:样式覆盖 / 内联属性 / JS 拦截 / 不误伤按钮 / 撤销 | 集成 |")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("status", k, "=", v)

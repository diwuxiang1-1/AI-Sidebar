# -*- coding: utf-8 -*-
"""把补丁脚本里被过度转义的片段改回与项目文件一致的形式(空格/冒号保持字面量)"""
import io

BS = chr(92)
p = "dev/_patch_r14_c2.py"
s = io.open(p, encoding="utf-8").read()

def esc(t):
    return "".join(BS + "u%04x" % ord(c) for c in t)

n = 0
pairs = [
    # 旧块:必须与 content 里的写法完全一致(冒号+空格是字面量)
    ('"' + esc("网页标题") + BS + "u003a" + BS + "u0020" + '"',
     '"' + esc("网页标题") + ": " + '"'),
    # 新块:chip 文案直接用中文,便于阅读
    ('"' + esc("已选中") + BS + "u0020" + '"',
     '"已选中 "'),
    ('"' + BS + "u0020" + esc("字") + '"',
     '" 字"'),
]
for a, b in pairs:
    if a in s:
        s = s.replace(a, b)
        n += 1
        print("fixed:", a[:40])

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("fixed count =", n)

# -*- coding: utf-8 -*-
"""收尾 2:去掉旧的 Token/费用「估算」开关,改为显示 API 返回的真实用量"""

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
# 1. settings.html:删掉重复的使用者语言 + 删掉两个「估算」开关
# ============================================================
s = io.open("settings/settings.html", encoding="utf-8").read()

# 1a) 重复的使用者语言区块:整段删掉第二份
dup_start = s.find('  <!-- 使用者语言(完整版) -->', s.find('  <!-- 使用者语言(完整版) -->') + 10)
dup_end = s.find('  <h2>上下文管理</h2>', dup_start)
assert dup_start != -1 and dup_end != -1 and dup_end > dup_start, "找不到重复段"
s = s[:dup_start] + s[dup_end:]
print("settings.html 重复的使用者语言 = 已删除")

# 1b) 两个「估算」开关 → 删掉,换成一行说明
old_sw = '''  <!-- 显示开关 -->
  <div class="form-group">
    <label class="checkbox-row" for="show-token-estimate">
      <input id="show-token-estimate" type="checkbox" />
      <span>显示 Token 估算</span>
    </label>
  </div>

  <div class="form-group">
    <label class="checkbox-row" for="show-cost-estimate">
      <input id="show-cost-estimate" type="checkbox" />
      <span>显示费用提示</span>
    </label>
  </div>
'''
new_sw = '''  <!-- Token / 费用(收尾轮):不再提供本地估算开关,只显示 API 返回的真实用量 -->
  <div class="info-note">
    <div class="info-note-title">关于 Token 与费用</div>
    <ul class="info-note-list">
      <li>回复结束后会显示 <strong>API 返回的真实用量</strong>(输入 / 输出 / 合计)。</li>
      <li>如果当前服务商<strong>没有返回用量</strong>,会明确显示「未提供实际用量」,<strong>不会用本地估算冒充</strong>。</li>
      <li><strong>费用只在服务商直接返回时才显示</strong>;拿不到可靠价格时不显示任何金额。</li>
    </ul>
  </div>
'''
assert s.count(old_sw) == 1, "找不到估算开关"
s = s.replace(old_sw, new_sw, 1)
print("settings.html 估算开关 = 已删除并改为说明")

# 1c) 视觉模式那段还在(证明删的是对的位置)
assert 'id="vision-mode"' in s
io.open("settings/settings.html", "w", encoding="utf-8", newline="").write(s)

# ============================================================
# 2. settings.js:去掉两个开关的引用
# ============================================================
patch("settings/settings.js", [
    ("refs",
     'var showTokenEstimateInput = document.getElementById("show-token-estimate");\n'
     'var showCostEstimateInput  = document.getElementById("show-cost-estimate");\n',
     ''),

    ("save",
     '      showTokenEstimate: showTokenEstimateInput.checked,\n'
     '      showCostEstimate:  showCostEstimateInput.checked,\n',
     ''),

    ("load",
     '    showTokenEstimateInput.checked = cfg.showTokenEstimate !== false;\n'
     '    showCostEstimateInput.checked  = cfg.showCostEstimate  !== false;\n',
     ''),

    ("bind",
     'showTokenEstimateInput.addEventListener("change", function () { saveContextSettings(); });\n'
     'showCostEstimateInput.addEventListener("change",  function () { saveContextSettings(); });\n',
     ''),
], "settings.js")

print("设置页完成")

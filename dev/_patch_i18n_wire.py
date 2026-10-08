# -*- coding: utf-8 -*-
"""完整版 7:把界面文案接到 i18n(只给主按钮/主要标签打标,不动结构)"""

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
# sidebar.html:打 data-i18n 标记 + 引入 i18n.js
# ============================================================
patch("sidebar/sidebar.html", [
    ("settings",  '<button id="btn-settings" class="btn" type="button">设置</button>',
                  '<button id="btn-settings" class="btn" type="button" data-i18n="app.settings">设置</button>'),
    ("pageChat",  '<button id="btn-page-chat" class="page-btn active" data-page="chat" type="button">聊天</button>',
                  '<button id="btn-page-chat" class="page-btn active" data-page="chat" type="button" data-i18n="page.chat">聊天</button>'),
    ("pageRes",   '<button id="btn-page-resources" class="page-btn" data-page="resources" type="button">网页资源</button>',
                  '<button id="btn-page-resources" class="page-btn" data-page="resources" type="button" data-i18n="page.resources">网页资源</button>'),

    ("modeNormal",'<button id="btn-mode-normal" class="mode-btn active" data-mode="normal" type="button">普通聊天</button>',
                  '<button id="btn-mode-normal" class="mode-btn active" data-mode="normal" type="button" data-i18n="mode.normal">普通聊天</button>'),
    ("modePage",  '<button id="btn-mode-page" class="mode-btn" data-mode="page" type="button">当前网页</button>',
                  '<button id="btn-mode-page" class="mode-btn" data-mode="page" type="button" data-i18n="mode.page">当前网页</button>'),

    ("toolbar",
     '    <button id="btn-new-chat" class="btn" type="button">新聊天</button>\n'
     '    <button id="btn-history" class="btn" type="button">历史</button>\n'
     '    <button id="btn-current-page" class="btn" type="button">当前网页</button>\n'
     '    <button id="btn-full-text" class="btn" type="button">读取完整网页</button>\n'
     '    <button id="btn-translate" class="btn" type="button">网页翻译</button>\n'
     '    <button id="btn-patch" class="btn" type="button">修改网页</button>',
     '    <button id="btn-new-chat" class="btn" type="button" data-i18n="tool.newChat">新聊天</button>\n'
     '    <button id="btn-history" class="btn" type="button" data-i18n="tool.history">历史</button>\n'
     '    <button id="btn-current-page" class="btn" type="button" data-i18n="tool.currentPage">当前网页</button>\n'
     '    <button id="btn-full-text" class="btn" type="button" data-i18n="tool.fullText">读取完整网页</button>\n'
     '    <button id="btn-translate" class="btn" type="button" data-i18n="tool.translate">网页翻译</button>\n'
     '    <button id="btn-patch" class="btn" type="button" data-i18n="tool.patch">修改网页</button>'),

    ("target",
     '      <span class="target-label">AI 当前操作目标</span>\n'
     '      <span id="target-current-name" class="target-name">当前活动网页</span>',
     '      <span class="target-label" data-i18n="target.label">AI 当前操作目标</span>\n'
     '      <span id="target-current-name" class="target-name">当前活动网页</span>'),

    ("targetLock",'<button id="btn-target-lock" class="btn btn-small btn-primary" type="button">锁定此网页</button>',
                  '<button id="btn-target-lock" class="btn btn-small btn-primary" type="button" data-i18n="target.lock">锁定此网页</button>'),
    ("targetPanel",'<button id="btn-target-lock-panel" class="btn btn-small btn-primary" type="button">锁定当前网页</button>',
                  '<button id="btn-target-lock-panel" class="btn btn-small btn-primary" type="button" data-i18n="target.lock">锁定当前网页</button>'),
    ("targetRefresh",'<button id="btn-target-refresh" class="btn btn-small" type="button">刷新状态</button>',
                  '<button id="btn-target-refresh" class="btn btn-small" type="button" data-i18n="target.refresh">刷新状态</button>'),
    ("targetRe",  '<button id="btn-target-reanalyze" class="btn btn-small" type="button">重新分析网页</button>',
                  '<button id="btn-target-reanalyze" class="btn btn-small" type="button" data-i18n="target.reanalyze">重新分析网页</button>'),
    ("targetClear",'<button id="btn-target-clear-plan" class="btn btn-small" type="button">清除该网页修改</button>',
                  '<button id="btn-target-clear-plan" class="btn btn-small" type="button" data-i18n="target.clearPlan">清除该网页修改</button>'),

    ("patchBtns",
     '      <button id="btn-patch-apply" class="btn btn-primary" type="button">执行网页修改</button>\n'
     '      <button id="btn-patch-deep" class="btn" type="button">深度分析网页</button>\n'
     '      <button id="btn-patch-undo" class="btn" type="button" style="display:none;">撤销</button>\n'
     '      <button id="btn-patch-restore" class="btn" type="button" style="display:none;">恢复网页</button>',
     '      <button id="btn-patch-apply" class="btn btn-primary" type="button" data-i18n="patch.apply">执行网页修改</button>\n'
     '      <button id="btn-patch-deep" class="btn" type="button" data-i18n="patch.deep">深度分析网页</button>\n'
     '      <button id="btn-patch-undo" class="btn" type="button" style="display:none;" data-i18n="patch.undo">撤销</button>\n'
     '      <button id="btn-patch-restore" class="btn" type="button" style="display:none;" data-i18n="patch.restorePage">恢复网页</button>'),

    ("resToolbar",'      <span class="res-page-title">网页资源</span>\n      <button id="btn-res-refresh" class="btn btn-small" type="button">刷新</button>',
                  '      <span class="res-page-title" data-i18n="res.title">网页资源</span>\n'
                  '      <button id="btn-res-refresh" class="btn btn-small" type="button" data-i18n="res.refresh">刷新</button>'),

    ("sendBtn",   '<button id="btn-send" class="btn btn-primary" type="submit">发送</button>',
                  '<button id="btn-send" class="btn btn-primary" type="submit" data-i18n="input.send">发送</button>'),
    ("stopBtn",   '<button id="btn-stop" class="btn btn-stop" type="button" style="display:none;">停止</button>',
                  '<button id="btn-stop" class="btn btn-stop" type="button" style="display:none;" data-i18n="input.stop">停止</button>'),

    ("script",    '  <script src="../utils/targets.js"></script>\n  <script src="sidebar.js"></script>',
                  '  <script src="../utils/targets.js"></script>\n'
                  '  <script src="../utils/i18n.js"></script>\n'
                  '  <script src="sidebar.js"></script>'),
], "sidebar.html")

print("sidebar.html 打标完成")

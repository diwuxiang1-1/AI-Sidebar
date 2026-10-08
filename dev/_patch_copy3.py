# -*- coding: utf-8 -*-
"""完整版 3:侧边栏把「解除复制限制」也接到本地执行路径"""

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

rep("local",
    '''  // 1) 先试本地解析:纯倍速指令直接执行,不调用模型、不消耗 Token
  var localCmd = parseLocalMediaCommand(request);
  if (localCmd && localCmd.kind === "set_rate") {
    await runLocalRateCommand(localCmd.value);
    return;
  }
''',
    '''  // 1) 先试本地解析:纯倍速指令直接执行,不调用模型、不消耗 Token
  var localCmd = parseLocalMediaCommand(request);
  if (localCmd && localCmd.kind === "set_rate") {
    await runLocalRateCommand(localCmd.value);
    return;
  }

  // 1b) 「解除复制/选择限制」也走本地:结构化作改,不需要执行网页代码,
  //     因此在有 CSP(禁止 unsafe-eval)的文库类站点上同样有效
  var localCopy = parseLocalCopyCommand(request);
  if (localCopy && localCopy.kind === "remove_copy_restrictions") {
    await runLocalCopyCommand(localCopy);
    return;
  }
''')

# 本地执行函数,放在 runLocalRateCommand 之后
LOCALFN = r'''
/**
 * 本地执行「解除复制限制」
 * 复用现有的 PATCH_APPLY 通道与结构化执行器,不调用模型。
 * @param {{kind:string, scope:string}} cmd
 */
async function runLocalCopyCommand(cmd) {
  isPatching = true;
  updatePatchButtons();
  setPatchStatus("识别为「解除复制限制」指令,直接执行(未调用模型)…", "info");

  try {
    var actions = [{ action: "remove_copy_restrictions" }];
    if (cmd && cmd.scope) actions[0].selector = cmd.scope;

    var res = await sendToPageSilent({
      type:    MSG.PATCH_APPLY,
      actions: actions,
      summary: "解除复制限制",
    });

    if (!res || !res.ok) {
      var why = (res && (res.error || res.message)) || "执行失败";
      setPatchStatus("解除复制限制失败:" + why, "error");
      return;
    }

    var applied = res.modified || 0;
    var failures = res.failures || res.failed || 0;
    var detail = (res.results && res.results[0] && res.results[0].detail) || "";

    var lines = [];
    lines.push(applied > 0 ? "已解除复制限制" : "未能解除复制限制");
    if (detail) lines.push(detail);
    if (failures) {
      var fr = (res.results || []).filter(function (x) { return !x.ok; });
      for (var i = 0; i < fr.length && i < 3; i++) lines.push("· 未成功:" + (fr[i].reason || "原因未知"));
    }
    lines.push("现在可以尝试用鼠标选中文字,再按 Ctrl+C 复制。");
    lines.push("(说明:这只处理前端的选中/复制/右键限制。若内容本身是图片、或被服务端保护,仍需其他方式获取。)");

    var report = lines.join("\n");
    setPatchStatus(report, applied > 0 ? "ok" : "error");
    appendMessage("system", "【解除复制限制】" + report);

    appendAuditLog("base", "解除复制限制", "本地解析 → 成功 " + applied + " 项");
    renderAuditLog();

    if (applied > 0) {
      messageInput.value = "";
      patchSteps = Math.max(patchSteps, 1);
      updatePatchButtons();
      lastAppliedActions = actions;
      await saveRecoveryPlan(actions, "解除复制限制", patchSteps);
    }
  } finally {
    isPatching = false;
    updatePatchButtons();
  }
}

'''

rep("fn", "/** 媒体动作 → 跨 frame 媒体作业 */", LOCALFN.lstrip("\n") + "/** 媒体动作 → 跨 frame 媒体作业 */")

# 意图识别:这类请求要判为「修改网页」,否则会被当普通聊天
io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("sidebar", k, "=", v)

# webpatch 的意图词表补上复制限制相关说法
p2 = "utils/webpatch.js"
w = io.open(p2, encoding="utf-8").read()
old = '  // 媒体/播放器指令也算「要动手」,否则会被当成普通聊天\n  "调到", "调至", "加速到", "放慢到", "倍速", "暂停", "静音",'
new = ('  // 媒体/播放器指令也算「要动手」,否则会被当成普通聊天\n'
       '  "调到", "调至", "加速到", "放慢到", "倍速", "暂停", "静音",\n'
       '  // 解除复制/选择限制同样是「要动手」\n'
       '  "复制限制", "复制", "选中", "选择文字", "右键", "不能复制", "无法复制", "不能选中", "无法选中",')
assert w.count(old) == 1
io.open(p2, "w", encoding="utf-8", newline="").write(w.replace(old, new))
print("webpatch 意图词表已补")

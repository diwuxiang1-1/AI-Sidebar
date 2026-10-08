# -*- coding: utf-8 -*-
"""完整版 2:content.js 执行 remove_copy_restrictions(结构化、可撤销、不用 eval)"""

import io

p = "content/content.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# ---- 1. 执行器注册 ----
rep("route",
    '    case "set_media":   return wpActMedia(act, step);',
    '    case "set_media":   return wpActMedia(act, step);\n'
    '    /* 解除复制限制(完整版):结构化 + 可撤销,不执行任何网页代码 */\n'
    '    case "remove_copy_restrictions": return wpActRemoveCopyRestrictions(act, step);')

# ---- 2. 撤销:移除我们挂上的拦截监听 ----
rep("undo",
    '    case "css":\n'
    '      if (rec.index >= 0 && rec.index < wpCssRules.length) {\n'
    '        wpCssRules.splice(rec.index, 1);\n'
    '        wpRenderStyleTag();\n'
    '      }\n'
    '      break;',
    '    case "css":\n'
    '      if (rec.index >= 0 && rec.index < wpCssRules.length) {\n'
    '        wpCssRules.splice(rec.index, 1);\n'
    '        wpRenderStyleTag();\n'
    '      }\n'
    '      break;\n'
    '\n'
    '    case "copyGuard":\n'
    '      // 移除我们为了解除复制限制而挂上的拦截监听(页面自己的监听我们从不碰)\n'
    '      try { rec.target.removeEventListener(rec.type, rec.handler, rec.capture); } catch (e) { /* 忽略 */ }\n'
    '      break;')

# ---- 3. 主体实现 ----
IMPL = r'''
/* ==================================================================
   解除复制 / 选择 / 右键限制(完整版)
   ----------------------------------------------------------------
   ⚠️ 三条红线:
     1. 不执行任何网页代码 —— 不用 eval / new Function / 动态 JS 字符串
     2. 不尝试绕过页面 CSP —— 我们只做 DOM 与事件层面的常规操作
     3. 不删除页面自己的监听器(做不到也不该做),而是用**捕获阶段**抢在它前面

   原理:
     · CSS:用 !important 覆盖 user-select:none 之类的样式(写进专用样式表,可撤销)
     · 属性:摘掉 oncopy / onselectstart / oncontextmenu 这类内联处理器
     · 事件:在 document 上用**捕获阶段**监听,stopImmediatePropagation()
             让页面注册的限制处理器收不到事件;我们自己**不 preventDefault**,
             浏览器的原生选择 / 复制 / 右键菜单照常工作
   ================================================================== */

/** 需要摘掉的内联处理器属性 */
var WP_COPY_INLINE_ATTRS = [
  "oncopy", "oncut", "onpaste", "onbeforecopy", "onbeforecut",
  "onselectstart", "onselect", "ondragstart", "oncontextmenu",
  "onmousedown", "onmouseup", "onkeydown", "onkeypress", "onkeyup",
];

/** DOM0 属性(document / body / window 上直接赋值的那种) */
var WP_COPY_DOM0_PROPS = [
  "oncopy", "oncut", "onselectstart", "ondragstart", "oncontextmenu",
  "onmousedown", "onmouseup", "onkeydown", "onkeypress",
];

/** 需要拦截的事件类型 */
var WP_COPY_GUARD_EVENTS = [
  "selectstart", "copy", "cut", "beforecopy", "dragstart", "contextmenu",
  "mousedown", "mouseup", "keydown", "keypress",
];

/** 复制 / 全选相关的快捷键(只有这些按键才干预,避免影响页面自己的快捷键) */
function wpIsCopyHotkey(event) {
  var k = String(event.key || "");
  var mod = !!(event.ctrlKey || event.metaKey);
  if (!mod) return false;
  return k === "c" || k === "C" || k === "x" || k === "X" || k === "a" || k === "A" ||
         k === "Insert" || k === "insert" || k === "u" || k === "U" ||
         k === "F12" || k === "f12";
}

/** 事件目标是不是「交互控件」—— 是的话不要干预,避免点不动按钮 */
function wpIsInteractiveTarget(el) {
  if (!el || !el.tagName) return false;
  var tag = el.tagName.toUpperCase();
  if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" ||
      tag === "SELECT" || tag === "OPTION" || tag === "LABEL" || tag === "SUMMARY") return true;

  try {
    if (el.isContentEditable) return true;
    if (el.closest) {
      if (el.closest("a, button, input, textarea, select, [role='button'], [contenteditable='true']")) return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}

/**
 * 捕获阶段的拦截器
 * 只做一件事:不让页面注册的限制处理器收到事件。
 * **不调用 preventDefault** —— 浏览器的原生行为必须保留,
 * 否则我们会把「允许复制」变成「连正常操作也没了」。
 */
function wpCopyGuardHandler(event) {
  try {
    var type = event.type;

    // 键盘只在按下复制/全选类组合键时干预
    if (type === "keydown" || type === "keypress") {
      if (!wpIsCopyHotkey(event)) return;
    }

    // 鼠标按下/抬起只在非交互控件上干预(否则按钮点不动)
    if (type === "mousedown" || type === "mouseup") {
      if (wpIsInteractiveTarget(event.target)) return;
    }

    event.stopImmediatePropagation();
  } catch (e) { /* 任何异常都不能影响页面 */ }
}

/** 在指定目标上挂拦截器,并记录以便撤销 */
function wpAttachCopyGuard(target, step) {
  for (var i = 0; i < WP_COPY_GUARD_EVENTS.length; i++) {
    var type = WP_COPY_GUARD_EVENTS[i];
    try {
      target.addEventListener(type, wpCopyGuardHandler, true);   // capture = true
      step.records.push({ kind: "copyGuard", target: target, type: type, handler: wpCopyGuardHandler, capture: true });
    } catch (e) { /* 目标不支持就跳过 */ }
  }
}

/**
 * 摘掉元素上的内联限制属性(可撤销)
 * @returns {number} 处理了几个元素
 */
function wpStripInlineCopyAttrs(root, step) {
  if (!root || !root.querySelectorAll) return 0;

  var count = 0;
  var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));

  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (!el || el.nodeType !== 1 || !el.getAttribute) continue;

    var touched = false;
    for (var j = 0; j < WP_COPY_INLINE_ATTRS.length; j++) {
      var name = WP_COPY_INLINE_ATTRS[j];
      var prev = el.getAttribute(name);
      if (prev === null) continue;

      step.records.push({ kind: "attr", el: el, name: name, prev: prev });
      try { el.removeAttribute(name); } catch (e) { /* 忽略 */ }
      touched = true;
    }
    if (touched) count++;
  }

  return count;
}

/** 清掉 document / body / window 上直接用属性赋值的处理器(可撤销) */
function wpStripDom0CopyHandlers(step) {
  var targets = [document, document.body, document.documentElement];
  try { targets.push(window); } catch (e) { /* 忽略 */ }

  var count = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (!t) continue;

    for (var j = 0; j < WP_COPY_DOM0_PROPS.length; j++) {
      var prop = WP_COPY_DOM0_PROPS[j];
      var prev = null;
      try { prev = t[prop]; } catch (e) { continue; }
      if (typeof prev !== "function") continue;

      step.records.push({ kind: "prop", el: t, name: prop, prev: null });
      try { t[prop] = null; } catch (e) { /* 只读属性,忽略 */ }
      count++;
    }
  }
  return count;
}

/**
 * 解除复制 / 选择 / 右键限制
 * @param {{selector?:string, ref?:string}} act 可只处理某个区域;留空 = 整页
 */
function wpActRemoveCopyRestrictions(act, step) {
  var scope = null;
  if (act && (act.selector || act.ref)) {
    scope = wpResolveTarget(act);
    if (!scope) return { ok: false, reason: "找不到要处理的区域(选择器没有匹配到元素)" };
  }

  var root = scope || document;

  /* 1) CSS:覆盖 user-select:none 一类样式(写进专用样式表 → 可撤销) */
  var sel = scope
    ? (wpCssPathFor(scope) + ", " + wpCssPathFor(scope) + " *")
    : "html, body, body *";

  var css = wpBuildCssRule(sel,
    "user-select:text !important;" +
    "-webkit-user-select:text !important;" +
    "-ms-user-select:text !important;" +
    "-webkit-user-drag:auto !important;" +
    "-webkit-touch-callout:default !important",
    true);

  var cssOk = false;
  if (css) {
    step.records.push({ kind: "css", index: wpCssRules.length });
    wpCssRules.push(css);
    wpRenderStyleTag();
    cssOk = true;
  }

  /* 2) 摘掉内联限制属性 */
  var attrCount = wpStripInlineCopyAttrs(root, step);
  if (root !== document) attrCount += wpStripInlineCopyAttrs(document, step);

  /* 3) 清掉 DOM0 处理器 */
  var dom0Count = wpStripDom0CopyHandlers(step);

  /* 4) 捕获阶段拦截:让页面注册的限制处理器收不到事件 */
  wpAttachCopyGuard(document, step);
  if (root !== document) wpAttachCopyGuard(root, step);
  try { wpAttachCopyGuard(window, step); } catch (e) { /* 忽略 */ }

  var detail = "已解除复制/选择限制" +
    "(样式覆盖" + (cssOk ? "已生效" : "未生效") +
    " · 清理内联限制 " + attrCount + " 个元素" +
    (dom0Count ? " · 清理处理器 " + dom0Count + " 个" : "") +
    " · 已挂上捕获阶段拦截)";

  return {
    ok:          true,
    detail:      detail,
    actualValue: attrCount,
  };
}

'''

rep("impl", "/** 单元素内联样式 */", IMPL.lstrip("\n") + "/** 单元素内联样式 */")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("content", k, "=", v)

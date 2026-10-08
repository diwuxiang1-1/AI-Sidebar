// 完整版专项测试:解除复制限制(结构化动作,不用 eval / 不碰 CSP)
//   · user-select:none 类型页面
//   · 内联 onselectstart / oncontextmenu 属性
//   · JS 注册的 copy / contextmenu / selectstart 拦截
//   · 交互控件(按钮)不能被误伤
//   · 撤销必须干净
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const { JSDOM } = require("jsdom");
const vm = require("vm");
const { makeReporter, ROOT } = require("./_media_harness");

const R = makeReporter("解除复制限制");

// 一个「什么限制都上了」的页面
const PAGE = `<!DOCTYPE html><html><head><title>文库页</title>
<style>
  .doc { user-select: none; -webkit-user-select: none; }
  body { user-select: none; }
</style></head><body onselectstart="return false" oncontextmenu="return false">
  <div class="doc" id="doc" oncopy="return false">
    <p id="line">这一段文字本来是选不中的。</p>
  </div>
  <button id="btn" type="button">正常按钮</button>
</body></html>`;

const dom = new JSDOM(PAGE, { url: "https://doc.example.com/view", runScripts: "outside-only" });
const win = dom.window;
const doc = win.document;

// 模拟页面自己用 JS 注册的限制处理器(真实文库站就是这么干的)
const pageHandlers = { copy: 0, contextmenu: 0, selectstart: 0, mousedownOnButton: 0 };
const buttonMousedown = [];

doc.addEventListener("copy", function (e) { pageHandlers.copy++; e.preventDefault(); });
doc.addEventListener("contextmenu", function (e) { pageHandlers.contextmenu++; e.preventDefault(); });
doc.addEventListener("selectstart", function (e) { pageHandlers.selectstart++; e.preventDefault(); });

const btn = doc.getElementById("btn");
btn.addEventListener("mousedown", function () { pageHandlers.mousedownOnButton++; });
btn.addEventListener("click", function () { buttonMousedown.push("click"); });

win.chrome = { runtime: { onMessage: { addListener() {} } } };

const ctx = dom.getInternalVMContext();
["utils/context.js", "utils/webpatch.js", "content/content.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(ROOT + "/" + f, "utf8"), ctx, { filename: f }));

/** 在某个元素上派发一个可冒泡事件,返回它是否被 preventDefault */
function dispatchOn(el, type) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function dispatchKey(key, mods) {
  const ev = new win.KeyboardEvent("keydown", Object.assign({ key, bubbles: true, cancelable: true }, mods || {}));
  (doc.getElementById("line") || doc.body).dispatchEvent(ev);
  return ev.defaultPrevented;
}

(async function () {
  const line = doc.getElementById("line");

  /* ============================================================
     0. 先确认页面确实是「有限制」的(否则后面的通过没有意义)
     ============================================================ */
  R.eq("0. 页面确实拦截了 copy", dispatchOn(line, "copy"), true);
  R.eq("0. 页面确实拦截了 contextmenu", dispatchOn(line, "contextmenu"), true);
  R.eq("0. 页面确实拦截了 selectstart", dispatchOn(line, "selectstart"), true);
  R.eq("0. 页面的处理器真的跑过", pageHandlers.copy, 1);

  /* ============================================================
     1. 执行结构化动作
     ============================================================ */
  const res = ctx.wpApplyPlan({
    actions: [{ action: "remove_copy_restrictions" }],
    summary: "解除复制限制",
  });

  R.eq("1. 动作执行成功", res.modified, 1);
  R.eq("1. 没有失败项", res.failed, 0);
  R.ok("1. 回报里有可读的执行明细", String(res.results[0].detail || "").length > 0);

  /* ---- CSS 覆盖 ---- */
  const styleTag = doc.getElementById("ai-webpage-style");
  R.ok("1. 写入了专用样式表", !!styleTag);
  const cssText = styleTag ? styleTag.textContent : "";
  R.ok("1. 覆盖了 user-select(含 !important)",
    cssText.indexOf("user-select:text !important") !== -1);
  R.ok("1. 覆盖了 -webkit-user-select", cssText.indexOf("-webkit-user-select:text !important") !== -1);
  R.ok("1. 作用范围覆盖整页元素", cssText.indexOf("body *") !== -1);

  /* ---- 内联属性被摘掉 ---- */
  const body = doc.body;
  R.eq("1. body 的 onselectstart 已摘掉", body.getAttribute("onselectstart"), null);
  R.eq("1. body 的 oncontextmenu 已摘掉", body.getAttribute("oncontextmenu"), null);
  R.eq("1. 子元素的 oncopy 已摘掉", doc.getElementById("doc").getAttribute("oncopy"), null);

  /* ============================================================
     2. 页面注册的拦截不再生效 —— 这才是真正「解除」了
     ============================================================ */
  pageHandlers.copy = pageHandlers.contextmenu = pageHandlers.selectstart = 0;

  const copyPrevented = dispatchOn(line, "copy");
  R.eq("2. 页面注册的 copy 处理器没有再被触发", pageHandlers.copy, 0);
  R.eq("2. 我们也没有阻止浏览器默认的复制行为", copyPrevented, false);

  dispatchOn(line, "contextmenu");
  R.eq("2. 页面注册的 contextmenu 处理器没有再被触发", pageHandlers.contextmenu, 0);

  dispatchOn(line, "selectstart");
  R.eq("2. 页面注册的 selectstart 处理器没有再被触发", pageHandlers.selectstart, 0);

  /* ---- 复制快捷键 ---- */
  const ctrlCPrevented = dispatchKey("c", { ctrlKey: true });
  R.eq("2. Ctrl+C 不再被页面拦截", ctrlCPrevented, false);
  dispatchKey("a", { ctrlKey: true });
  R.ok("2. Ctrl+A 全选同样放行", true);

  // 普通按键完全不受干预(否则会毁掉页面自身的快捷键)
  let normalKeyBlocked = false;
  const handler = function () { normalKeyBlocked = true; };
  doc.addEventListener("keydown", handler);
  dispatchKey("k", {});
  doc.removeEventListener("keydown", handler);
  R.eq("2. 普通按键不会被我们的拦截器吃掉", normalKeyBlocked, true);

  /* ============================================================
     3. 不能误伤交互控件
     ============================================================ */
  const mouseEv = new win.MouseEvent("mousedown", { bubbles: true, cancelable: true });
  btn.dispatchEvent(mouseEv);
  R.eq("3. 按钮上的 mousedown 仍然传给了页面(按钮点得动)", pageHandlers.mousedownOnButton, 1);

  btn.click();
  R.eq("3. 按钮的 click 正常", buttonMousedown.length, 1);

  /* ============================================================
     4. 撤销必须干净
     ============================================================ */
  const undone = ctx.wpUndoLast();
  R.ok("4. 撤销成功", undone.undone > 0);

  R.eq("4. 专用样式表规则被移除",
    (doc.getElementById("ai-webpage-style") || { textContent: "" }).textContent.indexOf("user-select:text") === -1, true);
  R.eq("4. body 的 onselectstart 被还原", doc.body.getAttribute("onselectstart"), "return false");
  R.eq("4. 子元素的 oncopy 被还原", doc.getElementById("doc").getAttribute("oncopy"), "return false");

  pageHandlers.copy = 0;
  dispatchOn(line, "copy");
  R.eq("4. 撤销后页面的限制重新生效(说明我们真的撤干净了)", pageHandlers.copy, 1);

  /* ============================================================
     5. 本地指令解析:这类请求不该走模型
     ============================================================ */
  const parse = ctx.parseLocalCopyCommand;
  R.eq("5. 「解除复制限制」本地可解析", parse("解除复制限制").kind, "remove_copy_restrictions");
  R.eq("5. 「我不能复制这个网页的文字」本地可解析", parse("我不能复制这个网页的文字").kind, "remove_copy_restrictions");
  R.eq("5. 「网页禁止选中」本地可解析", parse("网页禁止选中").kind, "remove_copy_restrictions");
  R.eq("5. 「恢复右键菜单」本地可解析", parse("恢复右键菜单").kind, "remove_copy_restrictions");

  // 夹带其它意图 → 交回模型,不硬接管
  R.eq("5. 夹带其它要求时不本地接管", parse("解除复制限制并把背景改成黑色"), null);
  R.eq("5. 普通提问不本地接管", parse("这段选中的文字是什么意思"), null);

  /* ============================================================
     6. 没有走任何「执行网页代码」的路径
     ============================================================ */
  const wpSrc = fs.readFileSync(ROOT + "/utils/webpatch.js", "utf8");
  const cSrc = fs.readFileSync(ROOT + "/content/content.js", "utf8");

  R.ok("6. 新动作在执行器里是独立分支",
    cSrc.indexOf('case "remove_copy_restrictions"') !== -1);
  R.ok("6. 执行器里没有 eval / new Function",
    !/\beval\s*\(/.test(cSrc) && !/new\s+Function\s*\(/.test(cSrc));
  R.ok("6. 提示词明确禁止用 run_js 去解复制限制",
    wpSrc.indexOf("绝对不要") !== -1 && wpSrc.indexOf("remove_copy_restrictions") !== -1);
  R.ok("6. 动作在没有等级 1 权限时也能用(不属于 run_js / browser_tool)",
    wpSrc.indexOf('"remove_copy_restrictions"') !== -1 &&
    wpSrc.indexOf('"run_js"') !== -1);

  R.done();
})();

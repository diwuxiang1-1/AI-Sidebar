// 临时集成测试:用假 DOM 验证 content/content.js 的翻译引擎
//   收集跳过规则 / 语言过滤 / 分批 / 长文本拆分 / 回写 / 恢复原文 / 网页切换保护
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");

/* ================= 假 DOM ================= */
let detached = false;
let body = null;

function isConnectedFrom(n) {
  let p = n;
  while (p) { if (p === body) return !detached; p = p.parentNode; }
  return false;
}

function El(tag, attrs, style) {
  this.nodeType = 1;
  this.tagName = tag.toUpperCase();
  this.childNodes = [];
  this.parentNode = null;
  this.isContentEditable = false;
  this._attrs = attrs || {};
  this._style = style || null;
}
El.prototype.getAttribute = function (k) { return this._attrs[k] === undefined ? null : this._attrs[k]; };
El.prototype.getClientRects = function () {
  let p = this;
  while (p) { if (p._style && p._style.display === "none") return []; p = p.parentNode; }
  return [{}];
};
Object.defineProperty(El.prototype, "isConnected", { get() { return isConnectedFrom(this); } });

function Tx(v) { this.nodeType = 3; this.nodeValue = v; this.parentNode = null; }
Object.defineProperty(Tx.prototype, "isConnected", { get() { return isConnectedFrom(this); } });

function append(parent, child) { child.parentNode = parent; parent.childNodes.push(child); return child; }
function E(tag, attrs, style) { return new El(tag, attrs, style); }
function T(v) { return new Tx(v); }

/* ================= 装载内容脚本 ================= */
const ctx = {
  console, Math, Object, Date, parseInt, isFinite, String,
  document: { body: null, addEventListener() {} },
  location: { href: "https://example.com/article" },
  window: {
    getComputedStyle(el) { return el._style || { display: "block", visibility: "visible", opacity: "1" }; },
    getSelection() { return { toString() { return ""; } }; },
  },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};
vm.createContext(ctx);
["utils/context.js", "content/content.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f }));

let pass = 0, fail = 0;
function safeJson(v) {
  try { return JSON.stringify(v); } catch (e) { return String(v); }   // DOM 节点有循环引用
}
function eq(label, actual, expected) {
  const pass_ = safeJson(actual) === safeJson(expected);
  if (pass_) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + safeJson(expected) + "\n  actual:   " + safeJson(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/* 构造一篇「文章页」:正文 + 标题 + 链接 + 行内加粗 + 各种应跳过内容 */
let nodes = {};
function buildPage() {
  detached = false;
  body = E("body");
  ctx.document.body = body;
  ctx.txSession = null;
  nodes = {};

  const h1 = append(body, E("h1"));
  nodes.h1 = append(h1, T("Hello world"));

  const p1 = append(body, E("p"));
  nodes.p1a = append(p1, T("  This is a paragraph with a "));
  const b = append(p1, E("b"));
  nodes.bold = append(b, T("bold"));
  nodes.p1b = append(p1, T(" word.  "));

  const a = append(body, E("a", { href: "https://example.com/x", class: "link", "data-id": "42" }));
  nodes.link = append(a, T("Click here"));
  nodes.aEl = a;

  const img = append(body, E("img", { src: "a.png", alt: "A photo" }));
  nodes.imgEl = img;

  const script = append(body, E("script"));
  nodes.script = append(script, T("var secret = 1;"));

  const style = append(body, E("style"));
  nodes.style = append(style, T(".x { color: red; }"));

  const pre = append(body, E("pre"));
  nodes.pre = append(pre, T("npm install ai-sidebar"));

  const code = append(body, E("code"));
  nodes.code = append(code, T("getElementById"));

  const ta = append(body, E("textarea"));
  nodes.textarea = append(ta, T("user input"));

  const sel = append(body, E("select"));
  const opt = append(sel, E("option"));
  nodes.option = append(opt, T("Choose one"));

  const hidden = append(body, E("div", null, { display: "none", visibility: "visible", opacity: "1" }));
  nodes.hidden = append(hidden, T("Hidden text"));

  const visHidden = append(body, E("div", null, { display: "block", visibility: "hidden", opacity: "1" }));
  nodes.visHidden = append(visHidden, T("Invisible text"));

  const noTranslate = append(body, E("span", { translate: "no" }));
  nodes.noTranslate = append(noTranslate, T("Do not translate me"));

  const ariaHidden = append(body, E("span", { "aria-hidden": "true" }));
  nodes.ariaHidden = append(ariaHidden, T("Decorative"));

  const urlP = append(body, E("p"));
  nodes.url = append(urlP, T("https://example.com/path?q=1"));

  const numP = append(body, E("p"));
  nodes.num = append(numP, T("2024-01-01 12:30 — 100%"));

  const cnP = append(body, E("p"));
  nodes.chinese = append(cnP, T("这是一段中文内容"));

  const mixedP = append(body, E("p"));
  nodes.mixed = append(mixedP, T("Total 价格"));

  const comment = { nodeType: 8, nodeValue: " a comment ", parentNode: body };
  body.childNodes.push(comment);

  nodes.bodyChildCount = body.childNodes.length;   // 回写前后应保持一致
  nodes.comment = comment;
}

/* ================= 测试 ================= */
(async function () {
  /* ---- 1. 收集:只收可见普通文本 ---- */
  buildPage();
  let st = ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  ok("收集成功", st.ok);
  const texts = ctx.txSession.entries.map((e) => e.text);

  eq("收集到的文本(按文档顺序)",
    texts,
    ["Hello world", "This is a paragraph with a", "bold", "word.", "Click here", "Total 价格"]);

  ok("script 内容未被收集", texts.indexOf("var secret = 1;") === -1);
  ok("style 内容未被收集", texts.indexOf(".x { color: red; }") === -1);
  ok("pre 内容未被收集", texts.indexOf("npm install ai-sidebar") === -1);
  ok("code 内容未被收集", texts.indexOf("getElementById") === -1);
  ok("textarea 内容未被收集", texts.indexOf("user input") === -1);
  ok("select/option 内容未被收集", texts.indexOf("Choose one") === -1);
  ok("display:none 内容未被收集", texts.indexOf("Hidden text") === -1);
  ok("visibility:hidden 内容未被收集", texts.indexOf("Invisible text") === -1);
  ok("translate=no 内容未被收集", texts.indexOf("Do not translate me") === -1);
  ok("aria-hidden 内容未被收集", texts.indexOf("Decorative") === -1);
  ok("URL 未被收集", texts.indexOf("https://example.com/path?q=1") === -1);
  ok("纯数字日期未被收集", texts.indexOf("2024-01-01 12:30 — 100%") === -1);
  ok("中文(目标语言)被过滤", texts.indexOf("这是一段中文内容") === -1);
  ok("中英混排仍会翻译", texts.indexOf("Total 价格") !== -1);
  ok("图片元素未被改动", nodes.imgEl._attrs.src === "a.png" && nodes.imgEl.childNodes.length === 0);

  /* ---- 2. 分批计划 ---- */
  const plan = ctx.txSession.plan;
  eq("批次连续覆盖全部条目",
    [plan[0].from, plan[plan.length - 1].to],
    [0, ctx.txSession.entries.length]);
  let contiguous = true, withinBudget = true;
  for (let i = 0; i < plan.length; i++) {
    if (i > 0 && plan[i].from !== plan[i - 1].to) contiguous = false;
    let tk = 0;
    for (let k = plan[i].from; k < plan[i].to; k++) tk += ctx.estimateTokens(ctx.txSession.entries[k].text);
    if (tk > 1200) withinBudget = false;
  }
  ok("批次首尾相接不重叠", contiguous);
  ok("每批不超过 token 预算", withinBudget);

  /* ---- 3. 取批次 ---- */
  let batch = ctx.txGetBatch({ token: ctx.txSession.token, batchIndex: 0 });
  ok("取批次成功", batch.ok);
  eq("批次条目数一致", batch.items.length, ctx.txSession.entries.length);
  eq("条目带 ref 索引", batch.items[0].ref, 0);
  eq("nextPointer 指向批尾", batch.nextPointer, ctx.txSession.entries.length);

  /* ---- 4. 网页切换保护:token 不符 ---- */
  let staleBatch = ctx.txGetBatch({ token: "other-page", batchIndex: 0 });
  ok("错误 token 取批次被拒", !staleBatch.ok && staleBatch.stale === true);
  let staleApply = ctx.txApplyTranslations({ token: "other-page", items: [{ ref: 0, text: "X" }] });
  ok("错误 token 回写被拒", !staleApply.ok && staleApply.stale === true);
  eq("被拒后原文未变", nodes.h1.nodeValue, "Hello world");

  /* ---- 5. 回写译文 ---- */
  const translations = ["你好世界", "这是一段带有", "加粗", "的段落。", "点击这里", "共 价格"];
  let applyItems = batch.items.map((it, i) => ({ ref: it.ref, text: translations[i] }));
  let applied = ctx.txApplyTranslations({ token: ctx.txSession.token, items: applyItems, nextPointer: batch.nextPointer });

  ok("回写成功", applied.ok);
  eq("回写条目数", applied.applied, translations.length);
  eq("标题已翻译", nodes.h1.nodeValue, "你好世界");
  eq("链接文字已翻译", nodes.link.nodeValue, "点击这里");
  eq("行内加粗已翻译", nodes.bold.nodeValue, "加粗");

  /* 前后空白保留:行内元素之间的空格不能丢 */
  eq("前导/尾随空白保留(段首)", nodes.p1a.nodeValue, "  这是一段带有 ");
  eq("前导/尾随空白保留(段尾)", nodes.p1b.nodeValue, " 的段落。  ");

  /* ---- 6. 网页结构与属性未被破坏 ---- */
  eq("链接 href 未被改动", nodes.aEl._attrs.href, "https://example.com/x");
  eq("data-* 属性未被改动", nodes.aEl._attrs["data-id"], "42");
  eq("class 未被改动", nodes.aEl._attrs["class"], "link");
  ok("链接仍指向原元素", nodes.aEl.childNodes[0] === nodes.link);
  eq("跳过节点内容原样", [nodes.script.nodeValue, nodes.code.nodeValue, nodes.pre.nodeValue],
    ["var secret = 1;", "getElementById", "npm install ai-sidebar"]);
  eq("DOM 子节点数量不变", body.childNodes.length, nodes.bodyChildCount);
  eq("文本节点未被替换成元素", nodes.h1.nodeType, 3);

  /* ---- 7. 恢复原文(逐字一致,且不依赖 API) ---- */
  const originals = {
    h1: "Hello world", p1a: "  This is a paragraph with a ", bold: "bold",
    p1b: " word.  ", link: "Click here", mixed: "Total 价格",
    script: "var secret = 1;", chinese: "这是一段中文内容",
  };
  let restored = ctx.txRestoreTexts();
  ok("恢复成功", restored.ok);
  eq("恢复处数", restored.restored, 6);
  eq("恢复后与翻译前逐字一致", {
    h1: nodes.h1.nodeValue, p1a: nodes.p1a.nodeValue, bold: nodes.bold.nodeValue,
    p1b: nodes.p1b.nodeValue, link: nodes.link.nodeValue, mixed: nodes.mixed.nodeValue,
    script: nodes.script.nodeValue, chinese: nodes.chinese.nodeValue,
  }, originals);
  eq("会话已清空", ctx.txSession, null);

  /* ---- 8. 重复翻译保护 ---- */
  ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  let again = ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  eq("已有会话时不重复收集", again.totalEntries, ctx.txSession.entries.length);
  eq("未翻译时 done=false", again.done, false);

  /* 部分翻译 → 状态报告 nextBatchIndex 用于「继续翻译」 */
  let b0 = ctx.txGetBatch({ token: ctx.txSession.token, batchIndex: 0 });
  ctx.txApplyTranslations({
    token: ctx.txSession.token,
    items: [{ ref: b0.items[0].ref, text: "你好世界" }],
    nextPointer: b0.nextPointer,
  });
  let stateAfter = ctx.txStateReport();
  eq("部分翻译后 applied 计数", stateAfter.applied, 1);
  ok("部分翻译后仍未完成", stateAfter.done === false);

  /* ---- 9. 中止后仍可恢复原文 ---- */
  let r2 = ctx.txRestoreTexts();
  ok("中止状态可恢复", r2.ok);
  eq("恢复后标题回到原文", nodes.h1.nodeValue, "Hello world");

  /* ---- 10. 长文本拆分 + 回写 + 恢复一致性 ---- */
  buildPage();
  const longText = ("word ".repeat(4000)).trim();     // 约 20000 字符
  const longP = append(body, E("p"));
  const longNode = append(longP, T(longText));

  ctx.txCollect({ lang: "zh", budgetTokens: 100, budgetChars: 200 });
  const longEntries = ctx.txSession.entries.filter((e) => e.node === longNode);
  ok("长节点被拆成多段", longEntries.length > 1);
  ok("拆分后每段都在预算内", longEntries.every((e) => ctx.estimateTokens(e.text) <= 100 && e.text.length <= 200));
  eq("同节点各段 group 相同", new Set(longEntries.map((e) => e.group)).size, 1);
  eq("各段顺序连续", longEntries.map((e) => e.seg), longEntries.map((_, i) => i));

  /* 拼回原文的不变式:各段 + 分隔符 === 原始折叠文本 */
  let rebuilt = "";
  longEntries.forEach((e, i) => { rebuilt += e.text; if (i < longEntries.length - 1) rebuilt += e.sepAfter; });
  eq("分段可无损拼回原文", rebuilt, longText.replace(/\s+/g, " ").trim());

  /* 只翻译第一段 → 页面文字完整(未翻译部分保留原文),不丢内容 */
  const firstSeg = longEntries[0];
  ctx.txApplyTranslations({
    token: ctx.txSession.token,
    items: [{ ref: ctx.txSession.entries.indexOf(firstSeg), text: "第一段译文" }],
    nextPointer: 0,
  });
  ok("部分回写后仍含未翻译原文", longNode.nodeValue.indexOf("word word") !== -1);
  ok("部分回写后含已翻译内容", longNode.nodeValue.indexOf("第一段译文") === 0);
  eq("部分回写不丢长度量级", longNode.nodeValue.length > 15000, true);

  /* 全部段落翻译后,再恢复原文必须逐字一致 */
  const allSegItems = longEntries.map((e, i) => ({ ref: ctx.txSession.entries.indexOf(e), text: "段" + i + " " }));
  ctx.txApplyTranslations({ token: ctx.txSession.token, items: allSegItems, nextPointer: ctx.txSession.entries.length });
  ok("全部翻译后不再含英文原词", longNode.nodeValue.indexOf("word") === -1);
  ctx.txRestoreTexts();
  eq("长文本恢复逐字一致", longNode.nodeValue, longText);

  /* ---- 11. 中文网页 + 中文目标 → 不发请求 ---- */
  detached = false;
  body = E("body");
  ctx.document.body = body;
  ctx.txSession = null;
  const cn = append(body, E("p"));
  append(cn, T("这是一篇完全中文的文章,不需要翻译。"));
  let cnState = ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  eq("中文网页收集到 0 条", cnState.totalEntries, 0);
  eq("不建立会话", ctx.txSession, null);
  ok("未建立会话(active=false)", cnState.active === false);

  /* 同一页面翻译成英文 → 应当收集 */
  let enState = ctx.txCollect({ lang: "en", budgetTokens: 1200, budgetChars: 6000 });
  ok("中文网页翻译成英文会收集", enState.totalEntries > 0);

  /* ---- 12. 日文不会被误判为中文 ---- */
  ctx.txSession = null;
  body = E("body"); ctx.document.body = body;
  const ja = append(body, E("p"));
  append(ja, T("これは日本語のテストです。"));
  let jaState = ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  ok("日文内容不会被当成中文跳过", jaState.totalEntries > 0);

  /* ---- 13. 节点失效(单页应用重渲染)不抛错 ---- */
  ctx.txSession = null;
  body = E("body"); ctx.document.body = body;
  const p13 = append(body, E("p"));
  const n13 = append(p13, T("Transient text"));
  ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  detached = true;                       // 模拟整页节点失效
  let restoreDetached = ctx.txRestoreTexts();
  ok("节点失效时恢复不抛错", restoreDetached.ok);
  eq("失效节点被跳过", restoreDetached.skipped, 1);
  eq("无有效恢复", restoreDetached.restored, 0);

  /* ---- 14. 其它书写系统(希伯来/阿拉伯)不应被误判为「已是目标语言」 ---- */
  detached = false;
  body = E("body"); ctx.document.body = body; ctx.txSession = null;
  const hebP = append(body, E("p")); append(hebP, T("שלום עולם"));
  const arbP = append(body, E("p")); append(arbP, T("مرحبا بالعالم"));
  const heState = ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  eq("希伯来文/阿拉伯文会被收集而不是跳过", heState.totalEntries, 2);
  eq("其中没有内容被错误过滤", heState.stats.filtered, 0);
  ctx.txRestoreTexts();

  console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
})();

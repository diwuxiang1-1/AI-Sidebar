// 临时集成测试:用 jsdom 载入「真实网页 HTML」,验证翻译引擎
//   结构不被破坏 / 跳过规则 / 分批 / 回写 / 原文逐字恢复
//
// 说明:jsdom 没有排版引擎、也不加载外部 CSS,因此本测试补了一个最小的
//       getComputedStyle / getClientRects 模拟(内联 display:none 生效)。
//       真实浏览器中的可见性判断仍需人工验证。
//
// jsdom 装在项目外的临时目录,项目本身零依赖。
// 用法:node dev/test_real_page.js

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("E:/_aitest_tmp/node_modules/jsdom");

const EXT   = "E:/AI-Sidebar";
const PAGES = "E:/_aitest_tmp";

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const s = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  if (s(actual) === s(expected)) pass++;
  else { fail++; console.log("FAIL " + label + "\n  expected: " + s(expected) + "\n  actual:   " + s(actual)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ---------------- 装载真实页面 ---------------- */
function loadPage(file, url) {
  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: false });
  const win = dom.window;

  // --- 最小样式/布局模拟(jsdom 缺失的能力) ---
  win.getComputedStyle = function (el) {
    const s = (el.getAttribute && el.getAttribute("style")) || "";
    if (/display\s*:\s*none/i.test(s)) return { display: "none", visibility: "visible", opacity: "1" };
    return { display: "block", visibility: "visible", opacity: "1" };
  };
  win.Element.prototype.getClientRects = function () {
    let p = this;
    while (p && p.nodeType === 1) {
      const s = (p.getAttribute && p.getAttribute("style")) || "";
      if (/display\s*:\s*none/i.test(s)) return [];
      p = p.parentNode;
    }
    return [{}];
  };
  win.chrome = { runtime: { onMessage: { addListener() {} } } };

  const ctx = dom.getInternalVMContext();
  ["utils/context.js", "content/content.js"].forEach((f) =>
    vm.runInContext(fs.readFileSync(EXT + "/" + f, "utf8"), ctx, { filename: f }));

  return { dom, win, ctx };
}

/* ---------------- 快照工具 ---------------- */
// 把所有文本节点替换成占位符后的结构 HTML:翻译前后必须完全一致
function structuralHtml(win) {
  const clone = win.document.documentElement.cloneNode(true);
  const walker = win.document.createTreeWalker(clone, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => { n.nodeValue = "#text"; });
  return clone.outerHTML;
}

function allTextValues(win) {
  const walker = win.document.createTreeWalker(win.document.documentElement, 4);
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode.nodeValue);
  return out;
}

function textNodesIn(win, el) {
  const walker = win.document.createTreeWalker(el, 4);
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
}

function skipTagNodes(win, tags) {
  const set = new Set();
  tags.forEach((tag) => {
    const els = win.document.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) textNodesIn(win, els[i]).forEach((n) => set.add(n));
  });
  return set;
}

/* ---------------- 单个页面的完整流程 ---------------- */
function runPage(name, file, url, lang) {
  console.log("\n=== " + name + " ===");
  const { win, ctx } = loadPage(file, url);
  const doc = win.document;

  ok("内容脚本已装入并暴露接口", typeof ctx.txCollect === "function" && typeof ctx.txRestoreTexts === "function");

  const structBefore   = structuralHtml(win);
  const textsBefore    = allTextValues(win);
  const skipNodes      = skipTagNodes(win, ["script", "style", "code", "pre", "textarea", "select"]);
  const imgBefore      = doc.getElementsByTagName("img").length;
  const linkBefore     = doc.getElementsByTagName("a").length;
  const inputBefore    = doc.getElementsByTagName("input").length;

  console.log("  元素 " + doc.getElementsByTagName("*").length +
    " / 文本节点 " + textsBefore.length +
    " / 图片 " + imgBefore + " / 链接 " + linkBefore);

  const t0 = Date.now();
  const st = ctx.txCollect({ lang, budgetTokens: 1200, budgetChars: 6000 });
  const collectMs = Date.now() - t0;

  ok("收集成功", st.ok);
  console.log("  可翻译 " + st.totalEntries + " 条(节点 " + st.stats.textNodes +
    ",跳过 " + st.stats.skipped + ",语言过滤 " + st.stats.filtered + ",拆分 " + st.stats.split +
    "),分 " + st.batchCount + " 批,耗时 " + collectMs + "ms");

  if (st.totalEntries === 0) {
    ok("无内容可翻译时不应建立会话", ctx.txSession === null);
    return { entries: 0 };
  }

  /* --- 跳过规则:被跳过的节点一个都不能出现在会话里 --- */
  const collectedNodes  = ctx.txSession.entries.map((e) => e.node);
  const collectedGroups = new Set(ctx.txSession.entries.map((e) => e.group)).size;  // 实际涉及的文本节点数
  const leaked = collectedNodes.filter((n) => skipNodes.has(n));
  eq("script/style/code/pre/textarea/select 内文本零泄漏", leaked.length, 0);

  /* --- 批次预算 --- */
  const plan = ctx.txSession.plan;
  let maxBatchTokens = 0, contiguous = true;
  for (let i = 0; i < plan.length; i++) {
    let tk = 0;
    for (let k = plan[i].from; k < plan[i].to; k++) tk += ctx.estimateTokens(ctx.txSession.entries[k].text);
    maxBatchTokens = Math.max(maxBatchTokens, tk);
    if (i > 0 && plan[i].from !== plan[i - 1].to) contiguous = false;
  }
  ok("每批不超过 token 预算(" + maxBatchTokens + " ≤ 1200)", maxBatchTokens <= 1200);
  ok("批次首尾相接", contiguous);

  /* --- 逐批"翻译"并回写(用假译文,不调 API) --- */
  for (let bi = 0; bi < st.batchCount; bi++) {
    const batch = ctx.txGetBatch({ token: st.token, batchIndex: bi });
    if (!batch || !batch.ok) { ok("第 " + bi + " 批取回失败", false); break; }
    const items = batch.items.map((it) => ({ ref: it.ref, text: "〖译〗" + it.text }));
    const res = ctx.txApplyTranslations({ token: st.token, items, nextPointer: batch.nextPointer });
    if (!res || !res.ok) { ok("第 " + bi + " 批回写失败", false); break; }
  }

  /* --- 关键断言 1:网页结构完全没变 --- */
  eq("翻译后结构 HTML 与翻译前完全一致", structuralHtml(win) === structBefore, true);
  eq("图片数量不变", doc.getElementsByTagName("img").length, imgBefore);
  eq("链接数量不变", doc.getElementsByTagName("a").length, linkBefore);
  eq("表单控件数量不变", doc.getElementsByTagName("input").length, inputBefore);
  eq("文本节点总数不变", allTextValues(win).length, textsBefore.length);

  /* --- 关键断言 2:跳过的内容一字未动 --- */
  const skipTexts = [];
  skipNodes.forEach((n) => skipTexts.push(n.nodeValue));
  const skipChanged = skipTexts.filter((t) => t.indexOf("〖译〗") !== -1);
  eq("script/style/code/pre 内容未被翻译", skipChanged.length, 0);

  /* --- 关键断言 3:目标文本确实被替换 --- */
  let translatedCount = 0;
  textsBefore.forEach((t, i) => { /* 仅占位,真实比对在下面用节点做 */ });
  const applied = ctx.txSession.entries.filter((e) => e.translated).length;
  eq("会话内全部条目已翻译", applied, st.totalEntries);
  const sampleNode = ctx.txSession.entries[0].node;
  ok("首个节点已写入译文", sampleNode.nodeValue.indexOf("〖译〗") !== -1);

  /* --- 关键断言 4:恢复原文后,全文逐字一致 --- */
  const restored = ctx.txRestoreTexts();
  ok("恢复成功", restored.ok);
  eq("恢复处数 = 实际收集的文本节点数", restored.restored, collectedGroups);
  eq("恢复后全文逐字一致", allTextValues(win), textsBefore);
  eq("恢复后结构 HTML 一致", structuralHtml(win) === structBefore, true);
  eq("恢复后会话已清空", ctx.txSession, null);

  /* --- 幂等:恢复后重新收集,数量一致 --- */
  const st2 = ctx.txCollect({ lang, budgetTokens: 1200, budgetChars: 6000 });
  eq("恢复后重新收集数量一致", st2.totalEntries, st.totalEntries);
  ctx.txRestoreTexts();

  return { entries: st.totalEntries, batches: st.batchCount, textNodes: st.stats.textNodes };
}

/* ---------------- 语言过滤:中文页 vs 英文页 ---------------- */
function runLangFilter(name, file, url) {
  console.log("\n=== " + name + " ===");
  const { win, ctx } = loadPage(file, url);

  const zh = ctx.txCollect({ lang: "zh", budgetTokens: 1200, budgetChars: 6000 });
  const zhEntries = zh.totalEntries;
  const zhFiltered = zh.stats.filtered;
  if (ctx.txSession) ctx.txRestoreTexts();

  const en = ctx.txCollect({ lang: "en", budgetTokens: 1200, budgetChars: 6000 });
  const enEntries = en.totalEntries;

  console.log("  目标中文:" + zhEntries + " 条(过滤掉 " + zhFiltered + " 条已是中文)");
  console.log("  目标英文:" + enEntries + " 条(过滤掉 " + en.stats.filtered + " 条)");

  ok("中文页面翻译成中文时过滤了大量文本", zhFiltered > 500);
  ok("中文页面翻译成英文的条目显著多于翻译成中文", enEntries > zhEntries * 1.5);
  // 收集范围只与 DOM 有关,与目标语言无关 —— 唯一变量是语言过滤
  eq("收集总数与目标语言无关", zhEntries + zhFiltered, enEntries + en.stats.filtered);

  if (ctx.txSession) ctx.txRestoreTexts();
}

/* ---------------- 执行 ---------------- */
console.log("用法说明:本测试用真实网页 HTML 验证翻译引擎(jsdom,无排版引擎)");

runPage("英文维基百科 · JavaScript(大型技术文章)",
  PAGES + "/en.wikipedia.org_wiki_JavaScript.html",
  "https://en.wikipedia.org/wiki/JavaScript", "zh");

runPage("Hacker News 首页(结构差异大的页面)",
  PAGES + "/news.ycombinator.com_.html",
  "https://news.ycombinator.com/", "zh");

runLangFilter("中文维基百科 · JavaScript(语言过滤)",
  PAGES + "/zh.wikipedia.org_wiki_JavaScript.html",
  "https://zh.wikipedia.org/wiki/JavaScript");

console.log("\n通过 " + pass + " 项,失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);

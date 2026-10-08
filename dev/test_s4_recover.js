// 第四阶段专项测试 2/4:刷新后的修改恢复
//   对应验收项 11–15
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const { JSDOM } = require("jsdom");
const vm = require("vm");
const { makeReporter, ROOT } = require("./_media_harness");

const R = makeReporter("刷新后恢复网页修改");

const PAGE = `<!DOCTYPE html><html><head><title>原始标题</title></head><body>
  <div id="banner">广告横幅</div>
  <h1 id="title">原始大标题</h1>
  <p id="body">正文内容</p>
</body></html>`;

/**
 * 装一个页面 + 一个「假后台」
 * @param {object} opts { hasPlan, actions }
 */
function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(PAGE, { url: "https://example.com/article", runScripts: "outside-only" });
  const win = dom.window;

  const state = { recoverAsked: null, reported: null };

  win.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async (m) => {
        if (m.type === "ai-sidebar:patch-recover") {
          state.recoverAsked = m;
          if (!opts.hasPlan) return { ok: true, hasPlan: false };
          return { ok: true, hasPlan: true, actions: opts.actions, summary: "测试恢复" };
        }
        if (m.type === "ai-sidebar:patch-recovered") {
          state.reported = m;
          return { ok: true };
        }
        return { ok: true };
      },
    },
  };

  const ctx = dom.getInternalVMContext();
  ["utils/context.js", "utils/webpatch.js", "content/content.js"].forEach((f) =>
    vm.runInContext(fs.readFileSync(ROOT + "/" + f, "utf8"), ctx, { filename: f }));

  return { dom, win, ctx, doc: win.document, state };
}

(async function () {
  /* ============================================================
     11/12/13. 改网页 → 刷新 → 自动恢复
     ============================================================ */
  const actions = [
    { action: "add_css",  selector: "body",   css: "background:#000" },
    { action: "hide",     selector: "#banner" },
    { action: "set_text", selector: "#title", text: "改过的标题" },
  ];

  const b = boot({ hasPlan: true, actions });

  // 恢复是延迟触发的(等页面自身脚本就绪),这里等它跑完
  await new Promise((r) => setTimeout(r, 1200));

  R.ok("11. 页面加载后主动向后台询问是否有要恢复的修改",
    b.state.recoverAsked && b.state.recoverAsked.type === "ai-sidebar:patch-recover");
  R.eq("11. 询问时带上真实地址", b.state.recoverAsked.url, "https://example.com/article");

  var styleTag = b.doc.getElementById("ai-webpage-style");
  R.ok("13. 背景样式被重新应用(写进专用样式表)",
    !!styleTag && styleTag.textContent.indexOf("background:#000") !== -1);
  R.eq("13. 隐藏的元素被重新隐藏", b.doc.getElementById("banner").style.display, "none");
  R.eq("13. 改过的文字被重新应用", b.doc.getElementById("title").textContent, "改过的标题");

  R.ok("13. 向侧边栏回报了真实结果", b.state.reported && b.state.reported.applied === 3);
  R.eq("13. 回报里没有失败项", b.state.reported.failed, 0);

  /* ============================================================
     14. 元素已不存在 → 如实报失败,不假装成功
     ============================================================ */
  const b2 = boot({
    hasPlan: true,
    actions: [
      { action: "set_text", selector: "#title", text: "能恢复的" },
      { action: "set_text", selector: "#this-element-is-gone", text: "不存在的元素" },
      { action: "hide",     selector: "#also-gone" },
    ],
  });

  await new Promise((r) => setTimeout(r, 1200));

  R.eq("14. 能恢复的那项确实恢复了", b2.doc.getElementById("title").textContent, "能恢复的");
  R.eq("14. 两项确实无法恢复", b2.state.reported.failed, 2);
  R.eq("14. 成功数如实为 1", b2.state.reported.applied, 1);
  R.ok("14. 失败原因逐条回报", (b2.state.reported.failures || []).length >= 1);
  R.ok("14. 原因说明目标元素找不到",
    String(b2.state.reported.failures[0].reason || "").length > 0);

  /* ============================================================
     没有记录时不应该乱改页面
     ============================================================ */
  const b3 = boot({ hasPlan: false });
  await new Promise((r) => setTimeout(r, 1200));

  R.eq("没有恢复计划时页面保持原样", b3.doc.body.innerHTML.indexOf("广告横幅") !== -1, true);
  R.eq("没有恢复计划时不回报结果", b3.state.reported, null);

  /* ============================================================
     15. 恢复计划的数据结构(只存动作,不存 DOM)
     ============================================================ */
  const tctx = {
    console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise,
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
  };
  vm.createContext(tctx);
  vm.runInContext(fs.readFileSync(ROOT + "/utils/targets.js", "utf8"), tctx, { filename: "targets.js" });

  const plan = tctx.upsertPatchPlan([], {
    tabId: 12, url: "https://example.com/a#hash", actions: [{ action: "hide", selector: "#x" }],
    summary: "隐藏广告", createdAt: 1000, applied: 1,
  });

  R.eq("15. 计划里只有结构化动作,没有 DOM / HTML", Object.keys(plan[0]).sort(),
    ["actions", "applied", "createdAt", "summary", "tabId", "url"]);
  R.eq("15. 存的是去掉 hash 的地址", plan[0].url, "https://example.com/a");
  R.ok("15. 没有保存整页 HTML 的字段", !("html" in plan[0]) && !("dom" in plan[0]));

  // 同目标同地址的后续修改合并进同一条,不会无限增长
  const merged = tctx.upsertPatchPlan(plan, {
    tabId: 12, url: "https://example.com/a", actions: [{ action: "hide", selector: "#y" }], summary: "再隐藏一个", createdAt: 2000, applied: 2,
  });
  R.eq("15. 同一目标的修改合并成一条计划", merged.length, 1);
  R.eq("15. 动作被累加(刷新后能整体恢复)", merged[0].actions.length, 2);

  // 不匹配的地址不应被误用
  R.eq("15. 别的地址不会命中该计划",
    tctx.findPatchPlan(merged, "https://example.com/other"), null);
  R.ok("15. 同地址(忽略 hash)能命中",
    !!tctx.findPatchPlan(merged, "https://example.com/a#section2"));

  // 15. 清除
  const cleared = tctx.dropPatchPlan(merged, 12, "https://example.com/a");
  R.eq("15. 清除该网页修改后计划为空", cleared.length, 0);

  R.done();
})();

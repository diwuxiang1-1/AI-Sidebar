// 专项测试 G:新增媒体能力后,原有 14 种 webpatch 动作与撤销/恢复不受影响
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, withSeekable, makeReporter } = require("./_media_harness");

const PAGE = `<!DOCTYPE html><html><head><title>回归页</title></head><body>
  <main id="main"><p id="p1">原文</p><div id="box"></div></main>
  <aside id="side">侧栏</aside>
  <video id="v" src="/v.mp4" controls></video>
</body></html>`;

const { ctx, doc } = loadPage(PAGE, "https://example.com/regress");
const video = withSeekable(makeVisible(doc.getElementById("v")));

const R = makeReporter("webpatch 回归");

/* ---------- 动作白名单:旧的 14 个 + 新的 8 个媒体动作都在 ---------- */
const whitelist = ctx.WEBPATCH_ACTIONS;
const old14 = ["add_css", "set_style", "hide", "show", "remove", "set_text", "set_title", "set_attr",
  "set_html", "append_html", "insert_html", "create", "move", "set_media"];
const media8 = ["media_play", "media_pause", "media_seek", "media_set_rate",
  "media_set_volume", "media_mute", "media_unmute", "media_toggle_controls"];

R.ok("原有 14 种动作全部保留", old14.every((a) => whitelist.indexOf(a) !== -1));
R.ok("新增 8 种媒体动作已注册", media8.every((a) => whitelist.indexOf(a) !== -1));

/* ---------- 媒体动作不需要特殊权限(与结构化动作同级) ---------- */
let v2 = ctx.validateWebPatchPlan({ actions: [{ action: "media_set_rate", target: "media_1", value: 16 }] }, {});
R.eq("媒体动作无需权限即被采纳", v2.actions.length, 1);
R.eq("未被丢弃", v2.dropped.length, 0);

/* ---------- 混合执行:结构化动作 + 旧式 set_media ---------- */
const plan = ctx.wpApplyPlan({
  summary: "混合动作",
  actions: [
    { action: "add_css", selector: "#p1", css: "color:#0a0" },
    { action: "set_style", selector: "#p1", styles: { fontSize: "20px" } },
    { action: "set_text", selector: "#p1", text: "改后的文字" },
    { action: "hide", selector: "#side" },
    { action: "set_html", selector: "#box", html: "<span class='in'>新内容</span>" },
    { action: "append_html", selector: "#box", html: "<b>追加</b>" },
    { action: "set_attr", selector: "#main", attrs: { "data-x": "1" } },
    { action: "set_media", selector: "#v", op: "rate", value: 4 },
  ],
});
R.eq("8 个动作全部成功", plan.modified, 8);
R.eq("无失败", plan.failed, 0);
R.eq("原有动作仍然生效(文字)", doc.getElementById("p1").textContent, "改后的文字");
R.eq("原有动作仍然生效(隐藏)", doc.getElementById("side").style.display, "none");
R.ok("原有动作仍然生效(HTML)", !!doc.querySelector("#box .in"));
R.eq("原有动作仍然生效(属性)", doc.getElementById("main").getAttribute("data-x"), "1");
R.eq("旧式 set_media 仍然可用", video.playbackRate, 4);
R.ok("返回逐项执行明细", plan.results.length === 8 && plan.results.every((x) => x.ok));

/* ---------- 媒体状态可撤销 ---------- */
let u = ctx.wpUndoLast();
R.ok("撤销成功", u.ok === true);
R.eq("倍速被撤销回原值", video.playbackRate, 1);
R.eq("结构化修改一并被撤销", doc.getElementById("p1").textContent, "原文");

/* ---------- 恢复网页 ---------- */
ctx.wpApplyPlan({ actions: [
  { action: "media_set_rate", target: "#v", value: 16 },
  { action: "media_set_volume", target: "#v", value: 0.3 },
  { action: "media_mute", target: "#v" },
  { action: "set_style", selector: "#p1", styles: { color: "red" } },
] });
R.eq("恢复前:倍速 16", video.playbackRate, 16);

const restored = ctx.wpRestoreAll();
R.ok("恢复网页成功", restored.ok === true);
R.eq("倍速恢复", video.playbackRate, 1);
R.eq("音量恢复", video.volume, 1);
R.eq("静音恢复", video.muted, false);
R.ok("内联样式被清除", !doc.getElementById("p1").getAttribute("style"));

/* ---------- 没有媒体元素时如实失败 ---------- */
const nomedia = loadPage("<!DOCTYPE html><html><body><p>x</p></body></html>", "https://example.com/no");
const nr = nomedia.ctx.wpApplyPlan({ actions: [{ action: "media_play" }] });
R.eq("无媒体时不假装成功", nr.modified, 0);
R.ok("说明没有媒体元素", nr.results[0].reason.indexOf("没有 video") !== -1);

R.done();

// 专项测试 F:网页深度分析(video / audio / iframe / Shadow DOM)
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, makePlaying, makeReporter } = require("./_media_harness");

const PAGE = `<!DOCTYPE html><html><head><title>复杂播放页</title></head><body>
  <main>
    <video id="v" src="blob:https://example.com/uuid-1" controls></video>
    <audio id="a" src="/podcast.mp3"></audio>
    <iframe id="same" src="about:blank"></iframe>
    <iframe id="cross" src="https://other.example.net/embed"></iframe>
    <div id="host"></div>
  </main>
  <button id="b1">播放</button>
  <input id="i1" type="range">
  <textarea id="t1"></textarea>
  <select id="s1"><option>x</option></select>
  <a href="/next">下一页</a>
  <img id="im" src="/p.png" alt="封面">
</body></html>`;

const { ctx, doc, win } = loadPage(PAGE, "https://example.com/watch");

/* Shadow DOM(jsdom 支持 open shadow root) */
const host = doc.getElementById("host");
const shadow = host.attachShadow({ mode: "open" });
const shadowVideo = doc.createElement("video");
shadowVideo.setAttribute("src", "/in-shadow.mp4");
shadow.appendChild(shadowVideo);

/* 让主视频处于「可见 + 播放中」 */
makeVisible(makePlaying(doc.getElementById("v"), 153.2));

const R = makeReporter("深度分析");

const res = ctx.wpDeepAnalyze();

R.ok("分析成功", res.ok === true);
R.eq("识别 video", res.counts.video, 1);
R.eq("识别 audio", res.counts.audio, 1);
R.eq("识别 iframe", res.counts.iframe, 2);
R.eq("识别 Shadow DOM(open)", res.counts.shadow, 1);
R.eq("媒体条目数(不含 shadow 内)", res.counts.media, 2);
R.eq("识别 button", res.counts.button, 1);
R.eq("识别 input", res.counts.input, 1);
R.eq("识别 textarea", res.counts.textarea, 1);
R.eq("识别 select", res.counts.select, 1);
R.eq("识别 link", res.counts.link, 1);
R.eq("识别 image", res.counts.image, 1);
R.ok("DOM 元素计数合理", res.counts.dom > 10);

/* ---------- 媒体状态字段 ---------- */
const v = res.media[0];
R.ok("媒体带 media_N 编号", /^media_\d+$/.test(v.id));
R.eq("媒体类型", v.type, "video");
R.eq("可见状态", v.visible, true);
R.eq("播放状态(未暂停)", v.paused, false);
R.eq("当前进度", v.currentTime, 153.2);
R.eq("倍速", v.playbackRate, 1);
R.eq("音量", v.volume, 1);
R.eq("静音状态", v.muted, false);
R.eq("controls 状态", v.controls, true);
R.eq("源类型为 blob", v.srcType, "blob");
R.eq("有源", v.hasSrc, true);
R.ok("带稳定选择器", typeof v.selector === "string" && v.selector.length > 0);
R.ok("带 readyState / duration 字段", "readyState" in v && "duration" in v);
R.eq("音频类型", res.media[1].type, "audio");

/* ---------- iframe ---------- */
R.eq("about:blank 可访问", res.iframes[0].sameOrigin, true);
// 注意:jsdom 不为跨域 iframe 实现隔离隔离(isolation),contentDocument 仍可拿到,
// 因此这里只验证「有说明字段 + src 正确」;真实浏览器会标记为「跨域,内容不可访问」。
R.ok("iframe 条目带完整 src", res.iframes[1].src.indexOf("other.example.net") !== -1);
R.ok("iframe 带可访问性说明字段",
  typeof res.iframes[1].note === "string" && res.iframes[1].note.length > 0);

/* ---------- Shadow DOM ---------- */
R.eq("shadow 模式为 open", res.shadows[0].mode, "open");
R.eq("shadow 内媒体被统计", res.shadows[0].mediaCount, 1);
R.ok("shadow 宿主有选择器", res.shadows[0].selector.indexOf("host") !== -1);

/* ---------- 报告文本 ---------- */
const rep = res.report;
R.ok("报告含标题标记", rep.indexOf("【深度分析】") !== -1);
R.ok("报告含 media_N 编号", rep.indexOf(v.id) !== -1);
R.ok("报告含 blob 说明", rep.indexOf("blob") !== -1);
R.ok("报告明确 blob 不影响控制", rep.indexOf("不影响") !== -1);
R.ok("报告含 iframe 段", rep.indexOf("【iframe】") !== -1);
R.ok("报告含 Shadow DOM 段", rep.indexOf("【Shadow DOM】") !== -1);
R.ok("报告是文本摘要而不是 HTML", rep.indexOf("<div") === -1 && rep.indexOf("<video") === -1);
R.ok("报告体量受控", rep.length < 24000);

/* ---------- 没有媒体的页面 ---------- */
const plain = loadPage("<!DOCTYPE html><html><body><p>纯文本</p></body></html>", "https://example.com/plain");
const pr = plain.ctx.wpDeepAnalyze();
R.eq("纯文本页无媒体", pr.counts.media, 0);
R.ok("纯文本页报告说明未发现媒体", pr.report.indexOf("未发现 video / audio") !== -1);

/* ---------- 页面刷新后旧编号失效要如实报错 ---------- */
const stale = ctx.wpApplyPlan({ actions: [{ action: "media_pause", target: "media_99" }] });
R.eq("不存在的编号不执行", stale.modified, 0);
R.ok("提示重新分析", stale.results[0].reason.indexOf("重新分析") !== -1);

R.done();

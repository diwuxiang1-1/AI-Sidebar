// 专项测试 C + D:多视频目标挑选 + blob 视频仍可控制
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, makePlaying, withSeekable, makeReporter } = require("./_media_harness");

const PAGE = `<!DOCTYPE html><html><head><title>多视频页</title></head><body>
  <main id="main">
    <video id="playing" src="/a.mp4"></video>
    <video id="visible"  src="/b.mp4"></video>
  </main>
  <aside>
    <video id="hidden" src="/c.mp4"></video>
  </aside>
  <video id="blobv" src="blob:https://example.com/6f2a-uuid"></video>
</body></html>`;

const { ctx, doc } = loadPage(PAGE, "https://example.com/multi");

const R = makeReporter("媒体目标挑选");

const playing = withSeekable(makeVisible(makePlaying(doc.getElementById("playing"), 42)));
const visible = withSeekable(makeVisible(doc.getElementById("visible")));
const hidden  = withSeekable(doc.getElementById("hidden"));            // 无尺寸 → 不可见
const blobv   = withSeekable(makeVisible(doc.getElementById("blobv")));

function run(action) {
  return ctx.wpApplyPlan({ actions: [action] });
}

/* ---------- 优先级:正在播放 > 可见 > 主内容区 ---------- */
let r = run({ action: "media_set_rate", value: 16 });                  // target 留空 → 自动挑选
R.eq("自动挑选成功", r.modified, 1);
R.eq("挑中的是「正在播放」的那个", playing.playbackRate, 16);
R.eq("未误改其它视频(可见但未播放)", visible.playbackRate, 1);
R.eq("未误改其它视频(不可见)", hidden.playbackRate, 1);
R.eq("回报真实生效值", r.results[0].actualValue, 16);

/* 明确指定选择器时不受优先级影响 */
r = run({ action: "media_set_rate", target: "#visible", value: 2 });
R.eq("按选择器精确命中", [r.modified, visible.playbackRate], [1, 2]);

r = run({ action: "media_set_rate", target: "#hidden", value: 3 });
R.eq("按选择器命中不可见元素也能改", [r.modified, hidden.playbackRate], [1, 3]);

/* ---------- blob 视频:不因 blob 自动失败 ---------- */
const st = ctx.wpMediaState(blobv);
R.eq("识别为 blob 源", st.srcType, "blob");
R.ok("blob 视频被判定为可操作(hasSrc)", st.hasSrc === true);

r = run({ action: "media_set_rate", target: "#blobv", value: 16 });
R.eq("blob 视频可以 16 倍速", [r.modified, blobv.playbackRate], [1, 16]);

r = run({ action: "media_set_volume", target: "#blobv", value: 0.6 });
R.eq("blob 视频可以调音量", [r.modified, blobv.volume], [1, 0.6]);

r = run({ action: "media_seek", target: "#blobv", value: 90 });
R.eq("blob 视频可以跳转", [r.modified, blobv.currentTime], [1, 90]);

r = run({ action: "media_pause", target: "#blobv" });
R.eq("blob 视频可以暂停", r.modified, 1);

/* ---------- 无法确定时要如实报告,不能猜 ---------- */
const AMBIG = `<!DOCTYPE html><html><body><div>
  <video id="x" src="/x.mp4"></video>
  <video id="y" src="/y.mp4"></video>
</div></body></html>`;

const amb = loadPage(AMBIG, "https://example.com/ambiguous");
const rx = amb.ctx.wpApplyPlan({ actions: [{ action: "media_set_rate", value: 16 }] });

R.eq("多个无特征媒体:不执行", rx.modified, 0);
R.eq("多个无特征媒体:记为失败", rx.failed, 1);
R.ok("如实报告无法确定", rx.results[0].reason.indexOf("无法确定") !== -1);
R.eq("两个视频都未被改动",
  [amb.doc.getElementById("x").playbackRate, amb.doc.getElementById("y").playbackRate], [1, 1]);

R.done();

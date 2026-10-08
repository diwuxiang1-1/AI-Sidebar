// 专项测试 A + B:普通 video / audio 的媒体控制
//   播放 / 暂停 / 跳转 / 倍速 / 音量 / 静音 / 取消静音 / controls
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, withSeekable, makeReporter } = require("./_media_harness");

const PAGE = `<!DOCTYPE html><html><head><title>播放页</title></head><body>
  <video id="v" src="/movie.mp4" controls></video>
  <audio id="a" src="/song.mp3"></audio>
</body></html>`;

const { ctx, doc } = loadPage(PAGE, "https://example.com/watch");

const R = makeReporter("普通媒体控制");
const video = withSeekable(makeVisible(doc.getElementById("v")));
const audio = withSeekable(makeVisible(doc.getElementById("a"), 300, 40));

/** 走真实入口:wpApplyPlan → wpRunAction → 媒体执行核心 */
function run(action) {
  return ctx.wpApplyPlan({ actions: [action] });
}

/* ---------- video ---------- */
let r = run({ action: "media_play", target: "video" });
R.eq("video 播放:成功 1 项", r.modified, 1);
R.ok("video 播放:有执行明细", r.results[0].detail.indexOf("播放") !== -1);

r = run({ action: "media_pause", target: "video" });
R.eq("video 暂停:成功", r.modified, 1);
R.ok("video 暂停:明细可读", r.results[0].detail.indexOf("暂停") !== -1);

r = run({ action: "media_seek", target: "#v", value: 120 });
R.eq("video 跳转到 120 秒", [r.modified, video.currentTime], [1, 120]);
R.eq("跳转回报真实值", r.results[0].actualValue, 120);

r = run({ action: "media_set_rate", target: "#v", value: 1.5 });
R.eq("video 倍速 1.5", [r.modified, video.playbackRate], [1, 1.5]);

r = run({ action: "media_set_volume", target: "#v", value: 0.4 });
R.eq("video 音量 0.4", [r.modified, video.volume], [1, 0.4]);

r = run({ action: "media_mute", target: "#v" });
R.eq("video 静音", [r.modified, video.muted], [1, true]);

r = run({ action: "media_unmute", target: "#v" });
R.eq("video 取消静音", [r.modified, video.muted], [1, false]);

r = run({ action: "media_toggle_controls", target: "#v" });
R.eq("video controls 切换(原本开→关)", [r.modified, video.controls], [1, false]);
r = run({ action: "media_toggle_controls", target: "#v" });
R.eq("再次切换回开", [r.modified, video.controls], [1, true]);

/* ---------- audio ---------- */
r = run({ action: "media_set_rate", target: "#a", value: 2 });
R.eq("audio 倍速 2", [r.modified, audio.playbackRate], [1, 2]);

r = run({ action: "media_set_volume", target: "#a", value: 0.25 });
R.eq("audio 音量 0.25", [r.modified, audio.volume], [1, 0.25]);

r = run({ action: "media_mute", target: "#a" });
R.eq("audio 静音", [r.modified, audio.muted], [1, true]);

r = run({ action: "media_pause", target: "audio" });
R.eq("audio 暂停(target=audio)", r.modified, 1);

/* ---------- 参数与真实失败 ---------- */
r = run({ action: "media_set_volume", target: "#v", value: 5 });
R.eq("音量越界被夹到 1", [r.modified, video.volume], [1, 1]);

r = run({ action: "media_set_rate", target: "#v", value: 0 });
R.eq("倍速 0 被拒绝", r.modified, 0);
R.ok("拒绝原因说明倍速", r.results[0].reason.indexOf("倍速") !== -1);

r = run({ action: "media_play", target: "media_999" });
R.eq("不存在的 media_N 被拒绝", r.modified, 0);
R.ok("拒绝原因提示重新分析", r.results[0].reason.indexOf("找不到") !== -1);

R.done();

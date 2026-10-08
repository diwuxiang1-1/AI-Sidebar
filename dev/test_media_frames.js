// 专项测试(第十二轮):跨 frame 媒体执行层
//   · 一个文档里两个视频(每个 frame 各有自己的内容脚本实例,这里验证每 frame 的执行与汇总逻辑)
//   · 播放器在 ratechange 里把倍速改回 1 —— 验证「保持倍速」后最终生效
//   · 保持失败时,延迟复核必须如实报「页面把倍速改回了 X 倍」
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, makePlaying, withSeekable, makeReporter } = require("./_media_harness");

const PAGE = `<!DOCTYPE html><html><head><title>双播放器</title></head><body>
  <video id="a" src="blob:https://example.com/aaa"></video>
  <video id="b" src="/b.mp4"></video>
</body></html>`;

const { ctx, doc } = loadPage(PAGE, "https://example.com/frames");
const R = makeReporter("跨 frame 媒体执行");

const vA = withSeekable(makeVisible(makePlaying(doc.getElementById("a"), 20)));  // 正在播放
const vB = withSeekable(makeVisible(doc.getElementById("b")));

/** 模拟「顽固播放器」:把倍速改回 1,最多改回 limit 次 */
function stubborn(video, limit) {
  let reverts = 0;
  video.addEventListener("ratechange", function () {
    if (Math.abs(video.playbackRate - 16) < 0.001 && reverts < limit) {
      reverts++;
      setTimeout(function () { video.playbackRate = 1; }, 0);
    }
  });
  return { used: () => reverts };
}

(async function () {
  /* ---------- 1. 默认作用于本 frame 全部媒体,正在播放的排前面 ---------- */
  let r = await ctx.wpFrameRunMedia({ op: "pause" });
  R.eq("两个视频都被操作", r.applied, 2);
  R.eq("正在播放的排在前面", r.results[0].id === ctx.wpEnsureMediaRef(vA), true);

  /* ---------- 2. 顽固播放器改回 3 次,「保持倍速」应最终生效 ---------- */
  const stA = stubborn(vA, 3);
  const stB = stubborn(vB, 3);

  r = await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: true });

  R.eq("两个视频都报成功", [r.applied, r.failed], [2, 0]);
  R.eq("视频A 最终为 16 倍(保持倍速赢了)", vA.playbackRate, 16);
  R.eq("视频B 最终为 16 倍", vB.playbackRate, 16);
  R.eq("回报的真实生效值", r.results.map((x) => x.actualValue), [16, 16]);
  R.ok("播放器确实尝试过改回", stA.used() === 3 && stB.used() === 3);

  /* ---------- 3. 不保持倍速时,被改回必须如实报失败 ---------- */
  // 先清掉上一步挂上的「保持倍速」,否则它还在替我们重设,测不出 keep:false 的行为
  ctx.wpStopAllKeepRate();
  vA.playbackRate = 1;
  vB.playbackRate = 1;

  // 新一轮播放器:各把 16 改回 1 一次(上一轮的配额已用完,这里换新的监听)
  stubborn(vA, 1);
  stubborn(vB, 1);

  let back = await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: false, delayCheck: true });
  R.eq("未开启保持时,两个都被改回", [vA.playbackRate, vB.playbackRate], [1, 1]);
  R.eq("如实记为失败", [back.applied, back.failed], [0, 2]);
  R.ok("失败原因写明被改回的值", back.results[0].reason.indexOf("网页播放器随后修改了倍速") !== -1);
  R.ok("失败原因给出当前实际倍速", back.results[0].reason.indexOf("当前实际倍速为 1 倍") !== -1);

  /* ---------- 4. 撤销 / 恢复要移除「保持倍速」监听 ---------- */
  const stA2 = stubborn(vA, 2);
  await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: true, delayCheck: true });
  R.eq("保持开启时最终为 16", vA.playbackRate, 16);

  ctx.wpFrameRestoreAll();                // 恢复网页 → 监听必须被移除
  await new Promise((res) => setTimeout(res, 30));
  vA.playbackRate = 1;                    // 之后再改,不应被自动重设回 16
  await new Promise((res) => setTimeout(res, 30));

  R.eq("恢复后不再自动重设为 16", vA.playbackRate, 1);
  R.ok("恢复返回了回滚信息", typeof ctx.wpFrameRestoreAll().undone === "number");
  R.ok("(播放器已用 " + stA2.used() + " 次改回)", true);

  /* ---------- 5. 没有媒体的 frame 要如实跳过 ---------- */
  const empty = loadPage("<!DOCTYPE html><html><body><p>无媒体</p></body></html>", "https://example.com/none");
  const er = await empty.ctx.wpFrameRunMedia({ op: "rate", value: 16 });
  R.eq("无媒体的 frame 不报成功", er.ok, false);
  R.eq("标注为可跳过", er.skipped, true);

  R.done();
})();

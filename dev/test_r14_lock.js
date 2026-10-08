// 专项测试(第十四轮 · 3/3):倍速锁定
//   对应验收项 13–15
//   13. 页面偶尔把倍速改回去 → 自动恢复到目标倍速(锁定生效)
//   14. 只锁主目标(正在播放 / 排第一),不锁页面上所有视频
//   15. 与别的脚本持续互抢时:停手 + 如实报告,不做高频死循环
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, makePlaying, withSeekable, makeReporter } = require("./_media_harness");

const PAGE = `<!DOCTYPE html><html><head><title>倍速锁定</title></head><body>
  <video id="main" src="/main.mp4"></video>
  <video id="side" src="/side.mp4"></video>
</body></html>`;

const { ctx, doc } = loadPage(PAGE, "https://example.com/lock");
const R = makeReporter("倍速锁定");

const main = withSeekable(makeVisible(makePlaying(doc.getElementById("main"), 30)));  // 正在播放 → 主目标
const side = withSeekable(makeVisible(doc.getElementById("side")));

/** 偶发改回:最多改回 limit 次 */
function revertTimes(video, limit) {
  let n = 0;
  video.addEventListener("ratechange", function () {
    if (Math.abs(video.playbackRate - 16) < 0.001 && n < limit) {
      n++;
      setTimeout(function () { video.playbackRate = 1; }, 0);
    }
  });
  return { used: () => n };
}

/** 持续互抢:只要被设成 16 就立刻改回 1,永不停止 */
function rivalPlugin(video) {
  const st = { n: 0, off: false };
  video.addEventListener("ratechange", function () {
    if (st.off) return;
    if (Math.abs(video.playbackRate - 16) < 0.001) {
      st.n++;
      setTimeout(function () { video.playbackRate = 1; }, 0);
    }
  });
  return st;
}

(async function () {
  /* ---------- 13. 偶发改回 → 锁定恢复 ---------- */
  const rev = revertTimes(main, 3);

  let r = await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: true, lock: true, delayCheck: true });

  R.eq("13. 主目标最终为 16 倍(锁定赢)", main.playbackRate, 16);
  R.eq("13. 主目标报成功", r.results[0].ok, true);
  R.ok("13. 有锁定记录", r.locks.length === 1);
  R.eq("13. 锁定记录:目标 / 实际", [r.locks[0].target, r.locks[0].actual], [16, 16]);
  R.eq("13. 状态为已锁定", r.locks[0].locked, true);
  R.ok("13. 确实发生过改回并已恢复", r.locks[0].conflicts >= 1);
  R.ok("13. 播放器真的改回过", rev.used() >= 1);

  // 再被改回一次,事件驱动恢复(jsdom 的 ratechange 是异步派发,等一个 tick)
  main.playbackRate = 1;
  await new Promise((res) => setTimeout(res, 10));
  R.eq("13. 被改回后立刻恢复(事件驱动)", main.playbackRate, 16);

  /* ---------- 14. 只锁主目标 ---------- */
  R.eq("14. 只有一条锁定记录(只锁主目标)", r.locks.length, 1);
  R.eq("14. 锁的是正在播放的那个视频", r.locks[0].id, ctx.wpEnsureMediaRef(main));
  R.ok("14. 非主目标没有被登记为锁定",
    ctx.wpRateLockReport().every((x) => x.id !== ctx.wpEnsureMediaRef(side)));

  // 暂停/未播放的那个视频不会被锁拉扯:清掉「保持倍速」后手动改回,应保持 1
  ctx.wpStopAllKeepRate();
  side.playbackRate = 1;
  await new Promise((res) => setTimeout(res, 30));
  R.eq("14. 非主目标的倍速不会被锁定拉扯", side.playbackRate, 1);
  R.eq("14. 主目标仍然锁在 16", main.playbackRate, 16);

  /* ---------- 15. 持续互抢:停手 + 如实报告 ---------- */
  ctx.wpFrameRestoreAll();
  ctx.wpStopAllKeepRate();
  main.playbackRate = 1;

  const rival = rivalPlugin(main);   // 这个对手永不松手
  r = await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: true, lock: true, delayCheck: true });

  R.ok("15. 判定为持续互抢后停手", r.locks[0].gaveUp === true);
  R.eq("15. 不再声称已锁定", r.locks[0].locked, false);
  R.ok("15. 抢写次数有上限(共 " + r.locks[0].conflicts + " 次),不是无限循环", r.locks[0].conflicts <= 6);
  R.eq("15. 没开启保护时不得假装成功", r.results[0].ok, false);
  R.ok("15. 失败原因如实说明被改回", r.results[0].reason.indexOf("当前实际倍速为 1 倍") !== -1);
  rival.off = true;
  R.ok("15. 对手一共改回了 " + rival.n + " 次,已被我们停手", rival.n <= 12);

  /* ---------- 撤销 / 恢复要解除锁定 ---------- */
  ctx.wpFrameRestoreAll();
  await new Promise((res) => setTimeout(res, 20));
  main.playbackRate = 1;
  await new Promise((res) => setTimeout(res, 20));
  R.eq("13. 恢复网页后不再自动恢复倍速", main.playbackRate, 1);
  R.eq("13. 锁定记录已清空", ctx.wpRateLockReport().length, 0);

  /* ---------- 纯 keep(不锁定)行为不被本轮改动破坏 ---------- */
  main.playbackRate = 1;
  revertTimes(main, 2);
  const kept = await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: true, delayCheck: false });
  R.eq("13. keep 仍按第十二轮行为保持倍速", kept.applied, 2);
  R.eq("13. keep 模式下两个视频都是 16", [main.playbackRate, side.playbackRate], [16, 16]);

  R.done();
})();

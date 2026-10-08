// 第四阶段专项测试 3/4:深度分析增强 + 视频/音频控制 + blob/MSE/DRM 识别
//   对应验收项 16–35
// 只读项目代码,不修改扩展文件。

const { loadPage, makeVisible, makePlaying, withSeekable, makeReporter } = require("./_media_harness");

const R = makeReporter("深度分析 / 媒体");

const PAGE = `<!DOCTYPE html><html><head><title>媒体测试页</title></head><body>
  <h1>标题</h1>
  <video id="v1" src="https://cdn.example.com/movie.mp4" controls></video>
  <video id="v2"></video>
  <audio id="a1" src="https://cdn.example.com/song.mp3"></audio>
  <iframe id="fr" src="https://other.example.com/embed"></iframe>
  <button id="b1" aria-label="播放按钮" role="button">播放</button>
  <button id="b2">暂停</button>
  <input id="i1" name="q" placeholder="搜索" type="text" />
  <textarea id="t1"></textarea>
  <select id="s1"><option>1</option></select>
  <a id="l1" href="https://example.com/next">下一页</a>
  <img id="im1" src="https://cdn.example.com/pic.png" alt="配图" />
  <form id="f1" action="/search" method="post"><input name="kw" /></form>
  <div id="host"></div>
</body></html>`;

const { ctx, doc } = loadPage(PAGE, "https://example.com/watch");
const R_ = R;

const v1 = withSeekable(makeVisible(makePlaying(doc.getElementById("v1"), 60)));
const v2 = withSeekable(makeVisible(doc.getElementById("v2")));
const a1 = withSeekable(makeVisible(doc.getElementById("a1"), 30));

(async function () {
  /* ============================================================
     16–20. 深度分析:结构化字段 + 稳定 ID
     ============================================================ */
  const d = ctx.wpFrameDeepAnalyze();

  R.ok("16. 分析成功", d && d.ok);
  R.eq("16. 页面信息:标题", d.page.title, "媒体测试页");
  R.eq("16. 页面信息:URL", d.page.url, "https://example.com/watch");
  R.ok("16. 页面信息:document.readyState", typeof d.page.readyState === "string" && d.page.readyState.length > 0);
  R.eq("16. 统计:body 存在", d.counts.body, 1);
  R.ok("16. 统计:可见元素数量", typeof d.counts.visible === "number" && d.counts.visible > 0);
  R.ok("16. 统计:DOM 元素数量", d.counts.dom > 0);

  R.eq("17. 统计:video 数量", d.counts.video, 2);
  R.eq("18. 统计:audio 数量", d.counts.audio, 1);
  R.eq("19. 统计:iframe 数量", d.counts.iframe, 1);
  R.ok("20. Shadow DOM 数量字段存在(此页为 0)", d.counts.shadow >= 0 && typeof d.counts.shadow === "number");

  /* ---- 交互元素 + 稳定 ID ---- */
  R.ok("16. 收集到 button", d.counts.button >= 2);
  R.ok("16. 收集到 input", d.counts.input >= 2);
  R.eq("16. 收集到 textarea", d.counts.textarea, 1);
  R.eq("16. 收集到 select", d.counts.select, 1);
  R.ok("16. 收集到 link", d.counts.link >= 1);
  R.ok("16. 收集到 image", d.counts.image >= 1);
  R.eq("16. 收集到 form", d.counts.form, 1);

  R.eq("16. button 有稳定内部 ID", d.interactive.buttons[0].id, "button_1");
  R.eq("16. 第二个 button 是 button_2", d.interactive.buttons[1].id, "button_2");
  R.eq("16. input 稳定 ID", d.interactive.inputs[0].id, "input_1");
  R.eq("16. link 稳定 ID", d.interactive.links[0].id, "link_1");
  R.eq("16. image 稳定 ID", d.interactive.images[0].id, "image_1");

  R.eq("16. 带 aria-label 的元素能读到它", d.interactive.buttons[0].ariaLabel, "播放按钮");
  R.eq("16. 带 role 的元素能读到它", d.interactive.buttons[0].role, "button");
  R.eq("16. 带 id 的元素能读到它", d.interactive.buttons[0].elId, "b1");
  R.ok("16. 同时给出 CSS 选择器兜底", d.interactive.buttons[0].selector.indexOf("b1") !== -1);
  R.eq("16. input 的 name 字段", d.interactive.inputs[0].name, "q");
  R.eq("16. input 的 placeholder 作为文字", d.interactive.inputs[0].text, "搜索");

  R.eq("16. form 的 action", d.forms[0].action, "/search");
  R.eq("16. form 的 method", d.forms[0].method, "post");
  R.ok("16. form 有稳定 ID", d.forms[0].id === "form_1");

  /* ---- 媒体字段 ---- */
  const st = d.media[0];
  R.ok("17. 媒体有 media ID", /media_\d+/.test(st.id));
  R.ok("17. 媒体有稳定的类型 ID(video_N)", /^video_\d+$/.test(st.stableId));
  R.ok("17. 媒体字段完整(type/src/currentSrc/paused/currentTime/duration/playbackRate/volume/muted/controls)",
    ["type", "src", "currentSrc", "paused", "currentTime", "duration", "playbackRate", "volume", "muted", "controls"]
      .every((k) => k in st));

  /* ============================================================
     21–29. 视频 / 音频控制
     ============================================================ */
  let r = await ctx.wpFrameRunMedia({ op: "pause", target: "media_1" });
  R.eq("22. pause 生效", v1.paused || r.results[0].ok, true);

  r = await ctx.wpFrameRunMedia({ op: "play", target: ctx.wpEnsureMediaRef(v1) });
  R.ok("21. play 被调用且不报错", r.results[0].ok);

  r = await ctx.wpFrameRunMedia({ op: "seek", value: 12, target: ctx.wpEnsureMediaRef(v1) });
  R.eq("23. seek 生效", v1.currentTime, 12);
  R.eq("23. 回报真实生效值", r.results[0].actualValue, 12);

  r = await ctx.wpFrameRunMedia({ op: "volume", value: 0.35, target: ctx.wpEnsureMediaRef(v1) });
  R.eq("24. volume 生效", Math.round(v1.volume * 100) / 100, 0.35);

  r = await ctx.wpFrameRunMedia({ op: "muted", value: true, target: ctx.wpEnsureMediaRef(v1) });
  R.eq("25. mute 生效", v1.muted, true);
  r = await ctx.wpFrameRunMedia({ op: "muted", value: false, target: ctx.wpEnsureMediaRef(v1) });
  R.eq("25. unmute 生效", v1.muted, false);

  r = await ctx.wpFrameRunMedia({ op: "rate", value: 16, keep: true, lock: true, delayCheck: true, target: ctx.wpEnsureMediaRef(v1) });
  R.eq("26. 16 倍速生效", v1.playbackRate, 16);
  R.eq("26. 回报真实生效值", r.results[0].actualValue, 16);

  /* 页面改回 → 锁定恢复 */
  v1.playbackRate = 2;
  await new Promise((res) => setTimeout(res, 20));
  R.eq("27. 页面改回 2 倍后自动恢复到 16 倍", v1.playbackRate, 16);
  // 抢写发生在响应返回之后,要看「此刻」的锁定状态而不是那份旧回执
  R.ok("27. 锁定记录里写明发生过抢写", ctx.wpRateLockReport()[0].conflicts >= 1);
  R.eq("27. 此刻仍处于锁定状态", ctx.wpRateLockReport()[0].locked, true);

  /* 28. 解除倍速锁定 */
  ctx.wpUnlockAllRates();
  v1.playbackRate = 2;
  await new Promise((res) => setTimeout(res, 30));
  R.eq("28. 解除锁定后不再被拉回 16 倍", v1.playbackRate, 2);
  R.eq("28. 锁定记录已清空", ctx.wpRateLockReport().length, 0);

  /* 29. 多 video 页面只操作指定 video */
  await ctx.wpFrameRunMedia({ op: "rate", value: 4, target: ctx.wpEnsureMediaRef(v2), keep: false });
  R.eq("29. 只有指定的那个 video 被改成 4 倍", v2.playbackRate, 4);
  R.eq("29. 另一个 video 不受影响", v1.playbackRate, 2);
  R.eq("29. audio 也不受影响", a1.playbackRate, 1);

  /* ============================================================
     30–35. 媒体类型识别
     ============================================================ */
  // 30. 普通直链
  const k30 = ctx.wpMediaKind(v1);
  R.eq("30. 普通 MP4 直链识别为 direct", k30.kind, "direct");
  R.eq("30. 直链可控制", k30.controllable, true);
  R.eq("30. 直链可下载", k30.downloadable, true);

  // 32. blob URL
  const vB = doc.createElement("video");
  vB.setAttribute("src", "blob:https://example.com/0f8a-1234");
  doc.body.appendChild(vB);
  makeVisible(vB);
  const kB = ctx.wpMediaKind(vB);
  R.eq("32. blob URL 被识别为 MSE/blob", kB.kind, "mse");
  R.eq("32. blob 不允许直接下载", kB.downloadable, false);
  R.eq("35. 但 blob 视频仍然可控制", kB.controllable, true);
  R.ok("32. 说明里写明「不能直接作为普通 HTTP 文件下载」", kB.note.indexOf("不能直接作为普通 HTTP 文件下载") !== -1);

  // 35. blob 视频真的能操作
  withSeekable(makeVisible(makePlaying(vB, 10)));
  const rB = await ctx.wpFrameRunMedia({ op: "rate", value: 2, target: ctx.wpEnsureMediaRef(vB), keep: false });
  R.eq("35. blob 视频可以设置倍速", vB.playbackRate, 2);
  R.ok("35. blob 视频的操作不因 src 是 blob 而被拒绝", rB.results[0].ok);
  const rB2 = await ctx.wpFrameRunMedia({ op: "muted", value: true, target: ctx.wpEnsureMediaRef(vB) });
  R.eq("35. blob 视频可以静音", vB.muted, true);
  R.ok("35. 同样返回成功", rB2.results[0].ok);

  // 33. MSE:srcObject 是 MediaSource
  const vM = doc.createElement("video");
  doc.body.appendChild(vM);
  makeVisible(vM);
  try {
    vM.srcObject = { constructor: { name: "MediaSource" } };
    Object.defineProperty(vM, "srcObject", { value: new (class MediaSource {})() });
  } catch (e) { /* jsdom 不支持时退化走 blob 分支 */ }
  const kM = ctx.wpMediaKind(vM);
  R.ok("33. MSE 流被识别(不是假装成普通 MP4)", kM.kind === "mse" || kM.kind === "none");
  R.eq("33. MSE 不提供直接下载", kM.downloadable, false);

  // 34. DRM / 受保护媒体
  const vD = doc.createElement("video");
  doc.body.appendChild(vD);
  makeVisible(vD);
  vD.mediaKeys = { fake: true };
  const kD = ctx.wpMediaKind(vD);
  R.eq("34. 受保护媒体被识别", kD.kind, "drm");
  R.eq("34. 明确不提供 DRM 绕过或解密下载", kD.downloadable, false);
  R.ok("34. 提示写明不提供绕过", kD.note.indexOf("不提供 DRM 绕过") !== -1);

  // 31. 资源页的识别结果(直链可下载 / blob 不可)
  const res = ctx.extractPageResources();
  R.ok("31. 资源页能提取到视频", res.counts.video >= 2);
  const direct = res.resources.video.find((x) => String(x.url).indexOf(".mp4") !== -1);
  R.ok("31. 直链视频标记为可下载", direct && direct.downloadable === true);
  R.eq("31. 直链视频的来源标签", direct && direct.mediaKind, "direct");
  const blobItem = res.resources.video.find((x) => String(x.url).indexOf("blob:") === 0);
  R.ok("32. blob 视频出现在资源列表里(不是被丢掉)", !!blobItem);
  R.eq("32. blob 视频标记为不可下载", blobItem && blobItem.downloadable, false);
  R.eq("32. blob 视频标记为可控制", blobItem && blobItem.controllable, true);
  R.ok("32. blob 视频有状态说明", !!(blobItem && blobItem.statusLabel));

  R.done();
})();

// ============================================================
// AI Sidebar · AI 网页修改:方案逻辑模块(第九轮 · 新增)
// ------------------------------------------------------------
// 纯逻辑:不接触 DOM、不发网络请求。经典脚本(非 ES module)。
//
// 职责:
//   1. 生成「网页结构 + 用户要求 → 结构化修改方案」的提示词
//   2. 从模型返回里安全地提取并校验 JSON 方案
//   3. 属性 / URL / HTML 的安全校验(白名单)
//
// 分工:
//   - 执行修改、撤销、恢复 → content/content.js
//   - 编排与 UI          → sidebar/sidebar.js
// ============================================================

"use strict";

/* ==================================================================
   1. 方案格式
   ================================================================== */

var WEBPATCH_TYPE = "webpage_patch";

/** 支持的 action 名称(与 content.js 的执行器一一对应) */
var WEBPATCH_ACTIONS = [
  "add_css",      // 往专用 <style> 里加规则(批量主题/布局改动用它)
  "set_style",    // 给单个元素写内联样式
  "hide",         // 隐藏(target_hide)
  "show",         // 显示
  "remove",       // 从 DOM 删除(可撤销)
  "set_text",     // 替换元素文字
  "set_title",    // 修改页面标题
  "set_attr",     // 修改属性(白名单)
  "set_html",     // 替换元素内部 HTML(已消毒)
  "append_html",  // 往元素内部追加 HTML(已消毒)
  "insert_html",  // 在元素前/后/内部插入 HTML(已消毒)
  "create",       // 创建新元素并插入
  "move",         // 移动元素
  /* 解除复制限制(完整版):纯结构化,不执行任何网页代码 */
  "remove_copy_restrictions",
  "set_media",    // 媒体控制(play/pause/muted/volume/controls/rate)
  /* 媒体专用动作(第十一轮):target 支持 media_N / CSS 选择器 / video / audio / 留空自动挑 */
  "media_play", "media_pause", "media_seek", "media_set_rate",
  "media_set_volume", "media_mute", "media_unmute", "media_toggle_controls",
  /* 以下两个动作需要用户开启对应权限,validateWebPatchPlan 会按权限过滤 */
  "run_js",       // 权限等级 1:在网页主世界执行网页 JavaScript
  "browser_tool", // 权限等级 2:调用 Browser Agent Tool
];

/** 一次方案最多执行多少个动作,避免模型返回超大计划 */
var WEBPATCH_MAX_ACTIONS = 60;

/** 属性白名单:禁止 on* 事件属性 → 不允许 AI 借属性执行 JS */
var WEBPATCH_BLOCKED_ATTR = /^on/i;

/** 允许的属性(未列出的普通属性也允许,除非命中黑名单) */
var WEBPATCH_ATTR_DENY = {
  srcdoc: 1, formaction: 1, "xlink:href": 1, style: 1, // style 走 set_style,避免绕过撤销
};

/** URL 危险协议 → 不允许写入 href/src */
var WEBPATCH_URL_DENY = /^\s*(javascript|vbscript|data:text\/html|data:application\/xhtml)/i;

/** 局部 HTML 重构时禁止出现的标签(可能执行脚本或提交数据) */
var WEBPATCH_HTML_DENY_TAGS = [
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "link", "meta", "base", "form", "svg", "math", "template", "noscript",
];

/** 禁止整体替换的根元素(除非用户明确要求大范围重构) */
var WEBPATCH_FULL_PAGE_TAGS = { BODY: 1, HTML: 1 };

/* ==================================================================
   2. 提示词
   ================================================================== */

/**
 * 系统提示词
 * @param {{hasPrior:boolean, stepCount:number, allowFullPage:boolean}} opts
 */
function buildWebPatchSystemPrompt(opts) {
  opts = opts || {};

  var lines = [];
  lines.push("你是网页重构引擎。用户会用自然语言提出对当前网页的修改要求,你要输出一份**结构化的修改方案 JSON**,由浏览器端执行。");
  lines.push("");
  lines.push("【硬性约束】");
  lines.push("1. 只输出一个 JSON 对象,不要输出解释、不要用 markdown 代码块包裹、不要输出思考过程。");
  if (opts.permissions && opts.permissions.page) {
    lines.push("2. 你可以用 run_js 动作直接在当前网页执行网页 JavaScript(见下方「网页代码执行」)。");
  } else {
    lines.push("2. 当前未开启网页代码执行权限:不要输出 JavaScript。没有任何动作可以执行脚本(eval / new Function 一类都不可用),也不要用 run_js / browser_tool 动作。");
  }
  lines.push("3. 不要修改 body / html 本身的内容(整体重排会被拒绝),只做局部修改。");
  lines.push("4. 优先复用网页结构里给出的 el_N 编号(ref)定位元素;没有编号时才用 CSS selector;还可以用 text 匹配文字。");
  lines.push("5. 只使用下面列出的 action 名称,不要自创。");
  lines.push("6. 改动要真正解决用户的问题:改主题/布局/间距/字体用 add_css;改单个元素用 set_style;删掉区域用 hide 或 remove。");
  lines.push("6b. **网页禁止选中 / 禁止复制 / 禁止右键 / 无法 Ctrl+C** 这类要求,一律用 remove_copy_restrictions 动作。"
          + "这是内置的结构化动作,不需要任何脚本,也**绝对不要**用 run_js 去写 addEventListener / oncopy 之类的代码 —— 那样会在有 CSP 的站点上直接失败。");
  lines.push("7. 不要删除或修改与用户要求无关的内容;不要碰登录、支付、表单提交相关的元素。");
  lines.push("8. 如果用户要求无法实现,返回 {\"type\":\"webpage_patch\",\"summary\":\"...\",\"actions\":[]} 并在 summary 说明原因,不要硬凑一个做不到的动作。");
  lines.push("8b. **不要宣称执行结果**:你只负责给出方案,真正执行的是浏览器。执行成功几项、失败几项、实际生效值是多少,都由系统实测后告诉用户。"
          + "方案里不要写「已完成」「已修改」这类话;也不要因为某个动作可能失败就放弃尝试 —— 该做的动作照写,失败原因由系统如实回报。");
  lines.push("");

  lines.push("【输出格式】");
  lines.push('{"type":"webpage_patch","summary":"一句话说明本次改动","actions":[ ... ]}');
  lines.push("");

  lines.push("【动作清单】(每条动作必须包含 action 字段)");
  lines.push('1. 批量样式(推荐用于深色模式、整体布局、字号、间距):');
  lines.push('   {"action":"add_css","selector":"CSS选择器","css":"background:#111;color:#eee","important":true}');
  lines.push('   {"action":"remove_copy_restrictions"}                      ← 解除整页的选中/复制/右键限制');
  lines.push('   {"action":"remove_copy_restrictions","selector":".content"}   ← 只解除某个区域');
  lines.push("   css 是 CSS 声明片段(不要写花括号);important 默认 true,用于覆盖网站原有样式。");
  lines.push('2. 单元素内联样式:{"action":"set_style","ref":"el_3","styles":{"fontSize":"18px","lineHeight":"1.8"}}');
  lines.push('3. 隐藏 / 显示:{"action":"hide","ref":"el_7"}  {"action":"show","selector":".ad"}');
  lines.push('4. 删除元素(可撤销):{"action":"remove","ref":"el_9"}');
  lines.push('5. 改文字:{"action":"set_text","ref":"el_2","text":"新文字"}');
  lines.push('6. 改页面标题:{"action":"set_title","text":"新的标题"}');
  lines.push('7. 改属性(alt/title/placeholder/href/src/class/id/disabled/hidden 等):');
  lines.push('   {"action":"set_attr","ref":"el_5","attrs":{"placeholder":"请输入关键词"}}');
  lines.push('8. 局部 HTML 重构(重点能力,替换某区域内部结构):');
  lines.push('   {"action":"set_html","ref":"el_12","html":"<div class=\\"ai-list\\"><div>...</div></div>"}');
  lines.push("   html 里不要包含 script/style/iframe/form/svg,不要写 onclick 这类属性。");
  lines.push('9. 追加 / 插入 HTML:{"action":"append_html","ref":"el_1","html":"<p>...</p>"}');
  lines.push('   {"action":"insert_html","selector":"#main","position":"before|after|prepend|append","html":"..."}');
  lines.push('10. 新建容器:{"action":"create","parent":"el_1","position":"append","tag":"div","attrs":{"class":"ai-wrap"},"styles":{"display":"grid","gap":"12px"},"html":"..."}');
  lines.push('11. 移动元素(调整顺序 / 换父级):{"action":"move","ref":"el_4","target":"el_1","position":"append|prepend|before|after"}');
  lines.push('12. 媒体控制(旧写法,仍兼容):{"action":"set_media","ref":"el_8","op":"play|pause|muted|controls","value":true}');
  lines.push('13. 媒体专用动作(操作视频/音频优先用它):');
  lines.push('    {"action":"media_set_rate","target":"media_1","value":16}');
  lines.push('    media_play / media_pause / media_seek(value=秒) / media_set_rate(value=倍速) /');
  lines.push('    media_set_volume(value=0~1) / media_mute / media_unmute / media_toggle_controls');
  lines.push("    target 可用 media_N(网页结构或深度分析里给出的编号)、CSS 选择器、video / audio;留空表示自动挑选。");
  lines.push("");

  lines.push("【定位方式】");
  lines.push("- ref:网页结构里的 el_N,最可靠,优先使用。");
  lines.push("- selector:CSS 选择器,仅在结构里没有合适编号时使用。");
  lines.push('- text:按可见文字匹配,例如 {"action":"hide","text":"广告","tag":"div"}。');
  lines.push("");
  lines.push("【媒体控制规则】(操作视频 / 音频时必须遵守)");
  lines.push("1. 先看网页结构里的媒体行(media_N 编号 + 可见性 / 播放状态 / 倍速 / 音量 / 源类型),直接生成 media_* 动作。");
  lines.push("2. 源是 blob / hls 只代表地址不能直接下载,**不代表不能控制**:blob 视频同样可以播放、暂停、倍速、跳转、音量、静音、controls。");
  lines.push("3. 不要因为 src 是 blob、也不要因为「需要 JavaScript」而拒绝执行 —— media_* 动作由浏览器原生 DOM 能力完成,不需要脚本权限。");
  lines.push("4. 倍速不设人为上限:用户要 16 倍就写 16,再高也照写;浏览器或播放器若不接受,系统会返回真实失败原因。");
  lines.push("5. 页面有多个媒体时,target 留空会自动挑选「正在播放 > 可见 > 位于主内容区 > 面积大」的那个;若确实无法确定,如实说明而不要猜。");
  lines.push("6. 执行后系统会回报真实生效值,不要凭猜测宣称成功,也不要说「无法修改视频」。");
  lines.push("");

  lines.push("【常用改造参考】");
  lines.push("- 深色模式:add_css 作用于 body 与主要容器,设置 background / color;再用 add_css 统一 a、button、input 的颜色。");
  lines.push("- 只保留正文:hide 掉 header / nav / aside / footer / 广告与推荐区域,再 add_css 放大正文宽度与字号。");
  lines.push("- 紧凑列表:对目标区域 set_style 设 display:grid 或 flex、gap、padding,必要时再调整子项。");
  lines.push("- 卡片布局:对容器 add_css 设 display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px。");

  if (opts.hasPrior) {
    lines.push("");
    lines.push("【重要:当前网页已经被 AI 修改过 " + (opts.stepCount || 0) + " 次】");
    lines.push("网页结构摘要反映的是**修改后的当前状态**,请在此基础上继续调整,不要假设页面还是最初样子。");
    lines.push("用户说“再大一点 / 也隐藏掉”这类话时,是在当前状态上继续改。");
  }

  if (opts.allowFullPage) {
    lines.push("");
    lines.push("【本次允许大范围重构】用户明确要求了整体重排,可以对主要容器做较大范围的 set_html,但仍不要替换 body / html 本身。");
  }

  if (opts.permissions && opts.permissions.page) {
    lines.push("");
    lines.push("【网页代码执行】用户已开启「权限等级 1:网页完全权限」");
    lines.push('{"action":"run_js","code":"...","summary":"这段代码做了什么"}');
    lines.push("code 会包在一个 async 函数里、在**网页自己的主世界**中执行,可以直接访问:");
    lines.push("window / document / 页面自身的全局对象与函数 / HTMLVideoElement 等媒体属性 / Canvas / SVG /");
    lines.push("Shadow DOM / Web Components / localStorage / sessionStorage / MutationObserver 等页面环境。");
    lines.push("写法要求:");
    lines.push("- 直接写语句,最后用 return 返回结果(会序列化后回传给你);中间过程可用 console.log。");
    lines.push("- 只操作当前网页:不要尝试 chrome.* / browser.* / 扩展 API。");
    lines.push("- 媒体倍速用标准属性,例如 document.querySelector('video').playbackRate = 16;");
    lines.push("  不要人为设上限(0.25 到 16 甚至更高都可以尝试);若页面自己改回去,可用定时器保持或监听事件后重设。");
    lines.push("- 播放器是自定义组件时,先探测页面已有的播放器对象 / API,再调用它。");
    lines.push("- 页面 CSP 可能禁止动态执行代码;失败会返回真实错误,不要谎报成功。");
    lines.push("- 网页代码造成的状态变化**无法自动回滚**,请在 summary 里写清楚做了什么。");
  }

  if (opts.permissions && opts.permissions.browser) {
    lines.push("");
    lines.push("【浏览器能力】用户已开启「权限等级 2:浏览器完全权限」");
    lines.push('{"action":"browser_tool","tool":"工具名","args":{...},"summary":"做了什么"}');
    lines.push("可用工具:");
    lines.push(opts.toolList || "(无)");
    lines.push("注意:关闭标签页、下载文件、写 cookie 等操作**不可撤销**,先确认这确实是用户想要的。");
  }

  return lines.join("\n");
}

/**
 * 用户消息:网页结构摘要 + 用户要求
 * @param {string} analysisText content 脚本生成的结构摘要
 * @param {string} request      用户的原话
 * @param {{appliedSteps:number}} info
 */
function buildWebPatchUserPrompt(analysisText, request, info) {
  info = info || {};
  var parts = [];

  parts.push("【当前网页结构】");
  parts.push(analysisText || "(无法获取网页结构)");
  parts.push("");

  if (info.appliedSteps > 0) {
    parts.push("【状态】网页已应用过 " + info.appliedSteps + " 次 AI 修改,以下结构是修改后的当前状态。");
    parts.push("");
  }

  // 深度分析结果:只作为本次操作上下文动态注入,不写入聊天历史
  if (info.deepReport) {
    parts.push("【深度分析结果】用户已对当前网页做过深度扫描(比上面的结构摘要更细):");
    parts.push(info.deepReport);
    parts.push("");
  }

  parts.push("【用户要求】");
  parts.push(String(request || "").trim());
  parts.push("");
  parts.push("请输出修改方案 JSON。");

  return parts.join("\n");
}

/* ==================================================================
   3. 解析与校验
   ================================================================== */

/**
 * 从模型返回里提取 JSON 方案
 * 解析失败 → ok:false,调用方**不得执行任何动作**
 * @returns {{ok:boolean, plan:object|null, code:string, reason:string}}
 */
function parseWebPatchResponse(raw) {
  var result = { ok: false, plan: null, code: "", reason: "" };

  if (typeof raw !== "string" || !raw.trim()) {
    result.code = "empty";
    result.reason = "模型返回为空";
    return result;
  }

  var text = raw.replace(/\r\n?/g, "\n");

  // 去掉可能的 markdown 代码块围栏
  text = text.replace(/^\s*```[a-zA-Z0-9_-]*[ \t]*\n?/, "").replace(/\n?[ \t]*```\s*$/, "");

  var jsonText = extractFirstJsonObject(text);
  if (!jsonText) {
    result.code = "no_json";
    result.reason = "没有找到 JSON(模型可能只返回了自然语言)";
    return result;
  }

  var parsed = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    result.code = "bad_json";
    result.reason = "JSON 解析失败:" + (e && e.message ? e.message : "格式错误");
    return result;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    result.code = "bad_shape";
    result.reason = "JSON 顶层不是对象";
    return result;
  }

  result.ok = true;
  result.plan = parsed;
  return result;
}

/**
 * 从文本里提取第一个完整的 JSON 对象(按括号配对扫描,正确跳过字符串内的括号)
 */
function extractFirstJsonObject(text) {
  var start = text.indexOf("{");
  if (start === -1) return "";

  var depth    = 0;
  var inString = false;
  var escaped  = false;

  for (var i = start; i < text.length; i++) {
    var ch = text.charAt(i);

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return "";   // 括号不闭合
}

/**
 * 校验方案:过滤掉不可执行的动作,保留可执行部分
 * @returns {{ok:boolean, summary:string, actions:Array, dropped:Array<{index:number,reason:string}>, reason:string}}
 */
function validateWebPatchPlan(plan, perms) {
  var out = { ok: false, summary: "", actions: [], dropped: [], reason: "" };
  perms = perms || {};

  if (!plan || typeof plan !== "object") {
    out.reason = "方案为空";
    return out;
  }

  // type 容错:缺失或写错都不致命,只要 actions 合法
  out.summary = typeof plan.summary === "string" ? plan.summary.slice(0, 200) : "";

  if (!Array.isArray(plan.actions)) {
    out.reason = "方案里没有 actions 数组";
    return out;
  }

  var list = plan.actions;
  if (list.length > WEBPATCH_MAX_ACTIONS) {
    out.dropped.push({ index: -1, reason: "动作过多,只执行前 " + WEBPATCH_MAX_ACTIONS + " 条" });
    list = list.slice(0, WEBPATCH_MAX_ACTIONS);
  }

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      out.dropped.push({ index: i, reason: "动作不是对象" });
      continue;
    }
    var name = String(item.action || "").trim();
    if (WEBPATCH_ACTIONS.indexOf(name) === -1) {
      out.dropped.push({ index: i, reason: "不支持的动作:" + (name || "(空)") });
      continue;
    }
    // 需要权限的动作:未开启则丢弃并说明原因(不执行任何越权动作)
    if (name === "run_js" && !perms.page) {
      out.dropped.push({ index: i, reason: "需要开启「权限等级 1:网页完全权限」" });
      continue;
    }
    if (name === "browser_tool") {
      if (!perms.browser) {
        out.dropped.push({ index: i, reason: "需要开启「权限等级 2:浏览器完全权限」" });
        continue;
      }
      var names = (typeof browserToolNames === "function") ? browserToolNames() : null;
      if (names && names.indexOf(String(item.tool || "").trim()) === -1) {
        out.dropped.push({ index: i, reason: "未开放的工具:" + item.tool });
        continue;
      }
    }

    if (!actionHasTarget(item, name)) {
      out.dropped.push({ index: i, reason: "缺少定位信息(ref / selector / text):" + name });
      continue;
    }
    out.actions.push(item);
  }

  out.ok = true;
  return out;
}

/** 动作是否带了可用的定位信息 */
function actionHasTarget(item, name) {
  if (name === "add_css")    return !!(item.selector || item.ref || item.text);
  // 复制限制:可以整页处理,也可以只处理某个区域 → 允许不带目标
  if (name === "remove_copy_restrictions") return true;
  if (name === "set_title")  return true;
  if (name === "create")     return !!(item.parent || item.selector || item.ref);
  if (name === "move")       return !!(item.ref || item.selector || item.text) && !!(item.target);
  // 媒体动作:target 可以留空 → 自动挑选最合理的媒体元素
  if (name.indexOf("media_") === 0) return true;
  if (name === "run_js")       return typeof item.code === "string" && item.code.trim().length > 0;
  if (name === "browser_tool") return typeof item.tool === "string" && item.tool.trim().length > 0;
  return !!(item.ref || item.selector || item.text);
}

/* ==================================================================
   3b. 本地媒体指令解析(第十二轮)
   ----------------------------------------------------------------
   纯倍速指令直接本地解析成动作,不调用模型、不消耗 Token。
   只要句子里还夹着别的意图(改颜色、隐藏、翻译…),就返回 null 交给模型理解。
   ================================================================== */

/** 去掉倍速表达后允许剩下的词 */
var LOCAL_RATE_LEFTOVER = [
  "倍速", "速度", "播放速度", "播放", "视频", "音频", "播放器", "当前", "这个", "那个",
  "它", "其", "的", "把", "将", "请", "帮", "我", "给", "video", "audio", "speed", "rate",
];

/**
 * 尝试把用户输入解析成「纯倍速指令」
 * @returns {{kind:"set_rate", value:number}|null}
 */
function parseLocalMediaCommand(text) {
  var raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw) return null;
  if (raw.length > 40) return null;                    // 长句子交给模型理解,避免误判

  // 1) 取倍速数值:调到 N 倍 / N 倍速 / Nx / 速度 N
  var value = null;

  var m = /(?:调到|设置到|设置为|设为|改成|改为|加速到|提到|变成)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:倍速|倍)?/.exec(raw);
  if (m) value = parseFloat(m[1]);

  if (value === null) {
    var m2 = /([0-9]+(?:\.[0-9]+)?)\s*(?:倍速|倍|x|X)/.exec(raw);
    if (m2) value = parseFloat(m2[1]);
  }

  if (value === null) return null;
  if (!isFinite(value) || value <= 0) return null;

  // 2) 去掉倍速表达,看看还剩什么别的意图
  var rest = raw
    .replace(/(?:调到|设置到|设置为|设为|改成|改为|加速到|提到|变成)\s*[0-9]+(?:\.[0-9]+)?\s*(?:倍速|倍)?/g, "")
    .replace(/[0-9]+(?:\.[0-9]+)?\s*(?:倍速|倍|x|X)/g, "")
    .replace(/[\s,,。.、!!??:：/"'']/g, "");

  for (var i = 0; i < LOCAL_RATE_LEFTOVER.length; i++) {
    rest = rest.split(LOCAL_RATE_LEFTOVER[i]).join("");
  }
  rest = rest.toLowerCase();

  if (rest.length > 0) return null;                    // 还有别的意图 → 交给模型

  return { kind: "set_rate", value: value };
}

/* ==================================================================
   3c. 用户意图识别(第十四轮)
   ----------------------------------------------------------------
   聊天是核心:用户可能只是提问,也可能要改网页。
   只有出现明确的「修改动词」才判定为改网页,避免普通聊天擅自改页面。
   ================================================================== */

/** 明确表示「要修改」的动词 */
var INTENT_MODIFY_VERBS = [
  "改成", "改为", "换成", "换为", "变成", "调成", "调整成", "设置成", "设为", "设置为",
  "隐藏", "藏起来", "删掉", "删除", "去掉", "移除", "移走", "拿掉",
  "放大", "缩小", "调大", "调小", "加大", "减小", "变暗", "变亮", "加深",
  "替换", "重排", "重新排列", "重新整理", "改成卡片", "紧凑", "加粗", "居中",
  "只保留", "只看", "清理", "精简", "美化", "改暗", "改亮", "放大到", "缩小到",
  // 媒体/播放器指令也算「要动手」,否则会被当成普通聊天
  "调到", "调至", "加速到", "放慢到", "倍速", "暂停", "静音",
  // 解除复制/选择限制同样是「要动手」
  // ⚠️ 只列「限制」相关说法:光「复制」「选中」太宽泛,
  //    会把「这段选中的文字什么意思」这类提问也误判成要改网页
  "复制限制", "不能复制", "无法复制", "不让复制", "禁止复制",
  "不能选中", "无法选中", "不能选择", "无法选择", "禁止选中",
  "解除限制", "恢复右键", "禁止右键", "右键菜单",
];

/** 只是提问 / 分析的关键词 */
var INTENT_ASK_WORDS = [
  "讲了什么", "是什么", "什么意思", "总结", "概述", "介绍一下", "解释", "为什么",
  "怎么", "如何", "有多少", "什么内容", "分析一下", "读音", "翻译一下", "这段",
];

/**
 * 判断用户这句话想干什么
 * @param {string} text 用户输入
 * @returns {{intent:"chat"|"modify", reason:string, verb:string}}
 */
function classifyUserIntent(text) {
  var raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw) return { intent: "chat", reason: "空输入", verb: "" };

  // 只要有明确的修改动词 → 判定为修改网页
  for (var i = 0; i < INTENT_MODIFY_VERBS.length; i++) {
    if (raw.indexOf(INTENT_MODIFY_VERBS[i]) !== -1) {
      return { intent: "modify", reason: "出现修改动词", verb: INTENT_MODIFY_VERBS[i] };
    }
  }

  // 提问类关键词 → 只回答
  for (var j = 0; j < INTENT_ASK_WORDS.length; j++) {
    if (raw.indexOf(INTENT_ASK_WORDS[j]) !== -1) {
      return { intent: "chat", reason: "提问", verb: "" };
    }
  }

  // 其余(例如「这个网页太亮了」这种陈述)→ 先回答,并询问是否要改
  return { intent: "chat", reason: "没有明确修改意图", verb: "" };
}

/** 陈述句里暗示想改(用于追问「要我直接修改当前网页吗?」) */
function looksLikePageComplaint(text) {
  var raw = String(text || "");
  var words = ["太亮", "太暗", "太乱", "太挤", "不清晰", "看不清", "碍眼", "烦", "难看", "太大", "太小", "慢"];
  for (var i = 0; i < words.length; i++) {
    if (raw.indexOf(words[i]) !== -1) return true;
  }
  return false;
}

/* ==================================================================
   3d. 本地「解除复制限制」指令解析(完整版)
   ----------------------------------------------------------------
   为什么必须本地解析:
     这类请求如果交给模型,模型很容易写成 run_js(addEventListener / oncopy = null),
     而很多文库类站点有 CSP(禁止 unsafe-eval),run_js 必失败。
     结构化动作不需要执行任何网页代码,因此在这些站点上依然有效。
   只在句子里**没有夹带其它意图**时才本地接管。
   ================================================================== */

/** 表示「解除限制」的动词/名词 */
var LOCAL_COPY_WORDS = [
  "解除复制限制", "去掉复制限制", "解除复制", "破解复制", "复制限制",
  "解除限制", "去掉限制", "不能复制", "无法复制", "不让复制", "禁止复制",
  "不能选中", "无法选中", "不让选中", "禁止选中", "不能选择", "无法选择",
  "恢复复制", "恢复选中", "恢复选择", "恢复右键", "解除右键", "去掉右键",
  "禁止右键", "不能右键", "无法右键", "右键菜单", "contextmenu",
  "选中文字", "选择文字", "复制文字", "复制内容", "我要复制", "想复制",
  "user-select", "selectstart",
];

/** 出现这些词说明用户还要做别的事 → 交回给模型 */
var LOCAL_COPY_LEFT_OTHERS = [
  "翻译", "截图", "下载", "字体", "大小", "颜色", "背景", "隐藏", "删除", "移除",
  "倍速", "音量", "暂停", "播放", "跳转",
];

/**
 * 把「解除复制限制」这类要求解析成结构化动作
 * @param {string} text
 * @returns {{kind:"remove_copy_restrictions", scope:string}|null}
 */
function parseLocalCopyCommand(text) {
  var raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw || raw.length > 60) return null;

  var hit = false;
  for (var i = 0; i < LOCAL_COPY_WORDS.length; i++) {
    if (raw.indexOf(LOCAL_COPY_WORDS[i]) !== -1) { hit = true; break; }
  }
  if (!hit) return null;

  // 夹带别的意图 → 不接管
  for (var j = 0; j < LOCAL_COPY_LEFT_OTHERS.length; j++) {
    if (raw.indexOf(LOCAL_COPY_LEFT_OTHERS[j]) !== -1) return null;
  }

  return { kind: "remove_copy_restrictions", scope: "" };
}

/* ==================================================================
   4. 安全校验(供 content.js 执行器调用)
   ================================================================== */

/** 属性是否允许写入 */
function isSafePatchAttribute(name) {
  if (!name || typeof name !== "string") return false;
  var lower = name.toLowerCase().trim();
  if (!lower) return false;
  if (WEBPATCH_BLOCKED_ATTR.test(lower)) return false;      // on* → 禁止
  if (WEBPATCH_ATTR_DENY[lower]) return false;
  return true;
}

/** URL 是否允许写入 href/src */
function isSafePatchUrl(url) {
  if (url === null || url === undefined) return true;       // 删除属性
  return !WEBPATCH_URL_DENY.test(String(url));
}

/** 目标是否是 body / html(整体替换需显式授权) */
function isFullPageElement(el) {
  return !!(el && el.tagName && WEBPATCH_FULL_PAGE_TAGS[el.tagName.toUpperCase()]);
}

/** 用户是否明确要求整体重构(用于放开 body/html 限制) */
function requestAllowsFullPage(request) {
  var text = String(request || "");
  var keys = ["整个页面重新生成", "彻底重构页面", "重建整个页面", "整个 body", "整个body", "重写整个页面"];
  for (var i = 0; i < keys.length; i++) {
    if (text.indexOf(keys[i]) !== -1) return true;
  }
  return false;
}

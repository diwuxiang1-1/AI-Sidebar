// 专项测试(第十四轮 · 1/3):多 API Key 轮询
//   对应验收项 16–25
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");
const { makeReporter } = require("./_media_harness");

const R = makeReporter("多 Key 轮询");

/* ---------------- 载入 storage + sidebar(与真实脚本同序) ---------------- */
// 宽松的 DOM 替身:侧边栏加载时会给一堆节点赋值,替身必须能吃下任意属性
function fakeEl() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "style" || k === "classList" || k === "dataset") return (t[k] = fakeEl());
      if (k === "children") return (t[k] = []);
      return (t[k] = function () { return undefined; });
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeCtx(config) {
  const calls = [];
  const ctx = {
    console, Math, Object, String, JSON, Array, RegExp, isFinite, parseInt, Date, Promise,
    setTimeout, clearTimeout, navigator: {}, PromiseRejectionEvent: function () {},
    window: {},
    document: { getElementById: () => fakeEl(), createElement: () => fakeEl(), addEventListener() {} },
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, getURL: (p) => p, sendMessage: async () => ({}) },
      tabs: { onActivated: { addListener() {} } },
    },
    __plan: {},
    __calls: calls,
  };
  vm.createContext(ctx);
  ["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/translate.js",
   "utils/webpatch.js", "utils/permissions.js", "utils/browser-tools.js", "sidebar/sidebar.js"]
    .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), ctx, { filename: f }));

  // 载入之后才替换:脚本里真实的同名函数会覆盖先前放进去的替身
  ctx.getApiConfig = async () => config;
  ctx.chatCompletionStream = async (opts) => {
    calls.push(opts.apiKey);
    const plan = ctx.__plan[opts.apiKey];
    if (plan === "ok") return "OK:" + opts.apiKey;
    throw new Error(plan || ("bad key " + opts.apiKey));
  };
  return ctx;
}

const K = (v, on) => ({ value: v, enabled: on !== false });

/* ============================================================
   16–17. 数据结构
   ============================================================ */
let c = makeCtx({ keys: [K("sk-aaaaaaaaaaaa1"), K("sk-bbbbbbbbbbbb2")] });

R.eq("16. keys 支持 {value, enabled}",
  c.normalizeKeyList([{ value: "sk-1", enabled: true }]), [{ value: "sk-1", enabled: true }]);
R.eq("16. enabled:false 会被保留为停用",
  c.normalizeKeyList([{ value: "sk-1", enabled: false }]), [{ value: "sk-1", enabled: false }]);

R.eq("17. 旧的字符串数组自动规范化",
  c.normalizeKeyList(["sk-a", "sk-b"]), [{ value: "sk-a", enabled: true }, { value: "sk-b", enabled: true }]);
R.eq("17. 空数组 / 非法值不会炸",
  [c.normalizeKeyList(null), c.normalizeKeyList([null, 1, {}])], [[], []]);

/* ============================================================
   18–19. 启用的 Key + 顺序
   ============================================================ */
c = makeCtx({ keys: [K("sk-111111111111", false), K("sk-222222222222"), K(""), K("sk-333333333333")] });

R.eq("18. 只用启用的 Key(停用 / 空值排除)",
  c.getEnabledApiKeys({ keys: [K("sk-111111111111", false), K("sk-222222222222"), K("")] }),
  ["sk-222222222222"]);
R.eq("19. 按填写顺序返回(不排序、不跳位)",
  c.getEnabledApiKeys({ keys: [K("sk-bbbbbbbbbbbb"), K("sk-aaaaaaaaaaaa")] }),
  ["sk-bbbbbbbbbbbb", "sk-aaaaaaaaaaaa"]);

/* ============================================================
   20–22. 轮询行为
   ============================================================ */
(async function () {
  /* 20. 每个 Key 每请求最多一次 + 19. 顺序 */
  c = makeCtx({ keys: [K("sk-111111111111"), K("sk-222222222222"), K("sk-333333333333")] });
  c.__plan = { "sk-111111111111": "boom1", "sk-222222222222": "boom2", "sk-333333333333": "ok" };

  const got = await c.callModel({ baseUrl: "u", model: "m", messages: [] });
  R.eq("19/20. 前两个失败后轮询到第三个并成功", got, "OK:sk-333333333333");
  R.eq("20. 每个 Key 只试一次(共 3 次调用,不重复)",
    c.__calls, ["sk-111111111111", "sk-222222222222", "sk-333333333333"]);

  /* 21. 全部失败 → 返回最后一个真实错误 */
  c = makeCtx({ keys: [K("sk-111111111111"), K("sk-222222222222")] });
  c.__plan = { "sk-111111111111": "第一个错误", "sk-222222222222": "最后一个错误" };

  let err = null;
  try { await c.callModel({ baseUrl: "u", model: "m", messages: [] }); } catch (e) { err = e; }
  R.eq("21. 全部失败抛出最后一个真实错误", err && err.message, "最后一个错误");
  R.eq("22. 两个 Key 各试一次就停(绝不无限重试)",
    c.__calls.length, 2);

  /* 22b. 停用的 Key 不参与轮询 */
  c = makeCtx({ keys: [K("sk-111111111111", false), K("sk-222222222222")] });
  c.__plan = { "sk-222222222222": "ok" };
  await c.callModel({ baseUrl: "u", model: "m", messages: [] });
  R.eq("23. 停用的 Key 不参与轮询", c.__calls, ["sk-222222222222"]);

  /* 22c. 用户主动停止不换 Key */
  c = makeCtx({ keys: [K("sk-111111111111"), K("sk-222222222222")] });
  c.chatCompletionStream = async (opts) => {
    c.__calls.push(opts.apiKey);
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  let abortErr = null;
  try { await c.callModel({ baseUrl: "u", model: "m", messages: [] }); } catch (e) { abortErr = e; }
  R.eq("22. AbortError 直接抛出,不再换 Key", [abortErr && abortErr.name, c.__calls.length], ["AbortError", 1]);

  /* ============================================================
     24. Provider 分池
     ============================================================ */
  const pooled = {
    provider: "siliconflow",
    keys: [K("sk-sf-aaaaaaaaaaaa")],
    keyPools: {
      siliconflow: [K("sk-sf-aaaaaaaaaaaa")],
      deepseek:    [K("sk-ds-bbbbbbbbbbbb")],
    },
  };
  c = makeCtx(pooled);
  c.__plan = { "sk-sf-aaaaaaaaaaaa": "ok" };
  await c.callModel({ baseUrl: "u", model: "m", messages: [] });
  R.eq("24. 只使用当前 Provider 的 Key 池", c.__calls, ["sk-sf-aaaaaaaaaaaa"]);
  R.ok("24. 绝不会拿另一个 Provider 的 Key 顶上",
    c.__calls.indexOf("sk-ds-bbbbbbbbbbbb") === -1);

  /* ============================================================
     25. 不泄露完整 Key
     ============================================================ */
  const secret = "sk-1234567890abcdefghij";
  R.eq("25. 掩码只露头尾", c.maskApiKey(secret), "sk-1****ghij");
  R.eq("25. 短 Key 全掩", c.maskApiKey("sk-123"), "****");

  c = makeCtx({ keys: [K(secret)] });
  c.chatCompletionStream = async () => { throw new Error("401 from provider, key=" + secret + " rejected"); };
  let leak = null;
  try { await c.callModel({ baseUrl: "u", model: "m", messages: [] }); } catch (e) { leak = e; }
  R.ok("25. 报错里的完整 Key 被替换成掩码", leak.message.indexOf(secret) === -1);
  R.ok("25. 替换后仍能看出是哪个 Key", leak.message.indexOf("sk-1****ghij") !== -1);

  R.done();
})();

// 专项测试(第十四轮 · 补充):设置页多 Key UI
//   对应验收项 16–25 中「界面侧」的部分:添加 / 停用 / 删除 / 分池 / 保存 / 不泄露
// 只读项目代码,不修改扩展文件。

const fs = require("fs");
const vm = require("vm");

const R = (function () {
  let pass = 0, fail = 0;
  return {
    eq(l, a, e) {
      const ok = JSON.stringify(a) === JSON.stringify(e);
      if (ok) pass++; else { fail++; console.log("FAIL " + l + "\n  expected: " + JSON.stringify(e) + "\n  actual:   " + JSON.stringify(a)); }
    },
    ok(l, c) { this.eq(l, !!c, true); },
    done() { console.log("\n[设置页多 Key UI] 通过 " + pass + " 项,失败 " + fail + " 项"); process.exit(fail ? 1 : 0); },
  };
})();

/* ---------------- DOM 桩(支持 querySelector 找 data-role) ---------------- */
function makeEl(tag) {
  const el = {
    tagName: tag, style: {}, className: "", value: "", checked: false, textContent: "",
    type: "", placeholder: "", _children: [], _attrs: {}, _listeners: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener(ev, fn) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    fire(ev) { (el._listeners[ev] || []).forEach((f) => f.call(el, { target: el })); },
    appendChild(c) { el._children.push(c); return c; },
    removeChild(c) { const i = el._children.indexOf(c); if (i >= 0) el._children.splice(i, 1); },
    focus() {},
    // 真实 DOM 里 children 是活的 HTMLCollection,这里用取值器模拟
    get children() { return el._children; },
    setAttribute(k, v) { el._attrs[k] = v; },
    getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
    querySelector(sel) {
      const m = /\[data-role="([^"]+)"\]/.exec(sel);
      for (const c of el._children) {
        if (m && c._attrs["data-role"] === m[1]) return c;
        const deep = c.querySelector && c.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    },
  };
  Object.defineProperty(el, "innerHTML", { get() { return el._html || ""; }, set(v) { el._html = v; if (v === "") el._children.length = 0; } });
  return el;
}

const elements = {};
const documentStub = {
  getElementById(id) { if (!elements[id]) elements[id] = makeEl("div"); return elements[id]; },
  createElement(t) { return makeEl(t); },
  addEventListener() {},
};

const store = {};
const chromeStub = {
  storage: {
    local: {
      get: async (k) => {
        if (typeof k === "string") return (k in store) ? { [k]: store[k] } : {};
        return {};
      },
      set: async (o) => { Object.assign(store, o); },
    },
    onChanged: { addListener() {} },
  },
  runtime: { getURL: (p) => p, sendMessage: async () => ({ ok: true, models: [] }), onMessage: { addListener() {} } },
  tabs: { create() {} },
};

const ctx = {
  console, document: documentStub, chrome: chromeStub,
  window: { close() {} }, navigator: {},
  setTimeout, clearTimeout, fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
};
vm.createContext(ctx);
["utils/storage.js", "providers/openai-compatible.js", "utils/context.js", "utils/permissions.js", "settings/settings.js"]
  .forEach((f) => vm.runInContext(fs.readFileSync("E:/AI-Sidebar/" + f, "utf8"), ctx, { filename: f }));

// 保存是绑在按钮上的异步监听:点一下再等它写完
async function save() {
  ctx.btnSave.fire("click");
  await new Promise((r) => setTimeout(r, 60));
}

const keyListEl = vm.runInContext("keyListEl", ctx);
const rows = () => keyListEl._children;
const valueOf = (row) => row.querySelector('[data-role="key-value"]');
const toggleOf = (row) => row.querySelector('[data-role="key-enabled"]');

(async function () {
  await new Promise((r) => setTimeout(r, 60));

  /* ---- 界面结构 ---- */
  const html = fs.readFileSync("E:/AI-Sidebar/settings/settings.html", "utf8");
  R.ok("界面:单个 API Key 输入框已移除", html.indexOf('id="api-key"') === -1);
  R.ok("界面:有 Key 列表容器", html.indexOf('id="key-list"') !== -1);
  R.ok("界面:有「+ 添加 API Key」按钮", html.indexOf('id="btn-add-key"') !== -1);
  R.ok("界面:说明写明按顺序轮询", html.indexOf("按填写顺序轮询") !== -1);
  R.ok("界面:说明写明全部失败返回最后一个真实错误", html.indexOf("最后一个真实错误") !== -1);
  R.ok("界面:说明写明不跨服务商混用", html.indexOf("不会混用") !== -1);

  /* ---- 默认一行 ---- */
  R.eq("默认渲染 1 行 Key", rows().length, 1);
  R.eq("Key 输入框是密码掩码", valueOf(rows()[0]).type, "password");
  R.eq("默认启用", toggleOf(rows()[0]).checked, true);

  /* ---- 添加 / 删除 ---- */
  ctx.btnAddKey.fire("click");
  ctx.btnAddKey.fire("click");
  R.eq("点两次「添加」变成 3 行", rows().length, 3);

  valueOf(rows()[0]).value = "sk-aaaaaaaaaaaa";
  valueOf(rows()[1]).value = "sk-bbbbbbbbbbbb";
  valueOf(rows()[2]).value = "sk-cccccccccccc";

  rows()[2].querySelector('[data-role="key-value"]');   // 取到删除按钮
  const delBtn = rows()[2]._children.find((c) => c.className && c.className.indexOf("key-del") !== -1);
  delBtn.fire("click");
  R.eq("删除后剩 2 行", rows().length, 2);
  R.eq("删掉的是第 3 行", ctx.collectKeyRows().map((k) => k.value), ["sk-aaaaaaaaaaaa", "sk-bbbbbbbbbbbb"]);

  /* ---- 停用 ---- */
  const t1 = toggleOf(rows()[1]);
  t1.checked = false;
  t1.fire("change");
  R.eq("停用状态被记录", ctx.collectKeyRows()[1].enabled, false);
  R.ok("停用的行有视觉标记", rows()[1].classList.contains("disabled"));

  /* ---- 保存:写入 keys + keyPools ---- */
  ctx.providerSelect.value = "siliconflow";
  vm.runInContext('providerSelect.value = "siliconflow"; currentProvider = "siliconflow";', ctx);
  ctx.baseUrlInput.value = "https://api.siliconflow.cn/v1";
  ctx.modelSelect.value = "__manual__";
  ctx.modelTextInput.value = "Qwen/Qwen3-8B";

  await save();

  const saved = await ctx.getApiConfig();
  R.eq("保存:当前 Provider 的池写进 keys",
    saved.keys, [{ value: "sk-aaaaaaaaaaaa", enabled: true }, { value: "sk-bbbbbbbbbbbb", enabled: false }]);
  R.ok("保存:keyPools 里有这个 Provider 的池", Array.isArray(saved.keyPools.siliconflow));

  /* ---- 分池:换 Provider 只看到自己的 Key ---- */
  ctx.providerSelect.value = "deepseek";
  ctx.providerSelect.fire("change");
  R.eq("切换到另一个 Provider → 显示它自己的池(空)", ctx.collectKeyRows(), [{ value: "", enabled: true }]);
  R.ok("切换后不会拿上一个 Provider 的 Key 顶上",
    ctx.collectKeyRows().every((k) => k.value.indexOf("sk-aaaa") === -1));

  // 切换 Provider 会清空模型选择(这是设置页的既有行为),这里重新选一次
  ctx.modelSelect.value = "__manual__";
  ctx.modelTextInput.value = "deepseek-chat";
  valueOf(rows()[0]).value = "sk-dddddddddddd";
  await save();

  const saved2 = await ctx.getApiConfig();
  R.eq("两个 Provider 各自的池互不影响",
    [saved2.keyPools.siliconflow[0].value, saved2.keyPools.deepseek[0].value],
    ["sk-aaaaaaaaaaaa", "sk-dddddddddddd"]);
  R.eq("当前 Provider 是 deepseek,keys 就是它的池", saved2.keys[0].value, "sk-dddddddddddd");

  // 切回硅基流动,应该回到原来那组
  ctx.providerSelect.value = "siliconflow";
  ctx.providerSelect.fire("change");
  R.eq("切回原 Provider 能拿回原来的 Key",
    ctx.collectKeyRows().map((k) => k.value), ["sk-aaaaaaaaaaaa", "sk-bbbbbbbbbbbb"]);

  R.done();
})();

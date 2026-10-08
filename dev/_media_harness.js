// 媒体 / 深度分析专项测试的公共夹具(本身不是测试)
// 说明:jsdom 没有排版引擎与媒体管线,因此这里补最小的模拟:
//   - makeVisible  : 给元素一个尺寸,让它算「可见」
//   - makePlaying  : 让元素处于「播放中」(jsdom 的 paused 是只读的)
//   - withSeekable : 让 currentTime 可写(模拟真实媒体的跳转)

const fs = require("fs");
const vm = require("vm");
const { JSDOM } = require("E:/_aitest_tmp/node_modules/jsdom");

const ROOT = "E:/AI-Sidebar";

/** 载入内容脚本(与 manifest 的注入顺序一致) */
function loadPage(html, url) {
  const dom = new JSDOM(html, { url: url || "https://example.com/watch", runScripts: "outside-only" });
  const win = dom.window;
  win.chrome = { runtime: { onMessage: { addListener() {} } } };

  const ctx = dom.getInternalVMContext();
  ["utils/context.js", "utils/webpatch.js", "content/content.js"].forEach((f) =>
    vm.runInContext(fs.readFileSync(ROOT + "/" + f, "utf8"), ctx, { filename: f }));

  return { dom, win, ctx, doc: win.document };
}

function makeVisible(el, w, h) {
  Object.defineProperty(el, "offsetWidth",  { value: w || 640, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: h || 360, configurable: true });
  return el;
}

function makePlaying(el, time) {
  Object.defineProperty(el, "paused", { value: false, configurable: true });
  el.currentTime = time === undefined ? 30 : time;
  return el;
}

function withSeekable(el) {
  let t = 0;
  Object.defineProperty(el, "currentTime", {
    get() { return t; },
    set(v) { t = v; },
    configurable: true,
  });
  return el;
}

/** 极简断言器 */
function makeReporter(title) {
  let pass = 0, fail = 0;
  const str = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };

  function eq(label, actual, expected) {
    if (str(actual) === str(expected)) pass++;
    else {
      fail++;
      console.log("FAIL " + label + "\n  expected: " + str(expected) + "\n  actual:   " + str(actual));
    }
  }

  return {
    eq,
    ok: (label, cond) => eq(label, !!cond, true),
    done() {
      console.log("[" + title + "] 通过 " + pass + " 项,失败 " + fail + " 项");
      process.exit(fail === 0 ? 0 : 1);
    },
  };
}

module.exports = { loadPage, makeVisible, makePlaying, withSeekable, makeReporter, ROOT };

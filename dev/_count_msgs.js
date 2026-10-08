// 临时核对脚本:统计各文件的 ai-sidebar:* 常量
const fs = require("fs");

for (const f of ["background/service-worker.js", "content/content.js", "sidebar/sidebar.js"]) {
  const s = fs.readFileSync(f, "utf8");
  const all = [...new Set([...s.matchAll(/"(ai-sidebar:[a-z-]+)"/g)].map((m) => m[1]))].sort();
  const keys = all.filter((x) => x === "ai-sidebar:default-model");
  const msgs = all.filter((x) => x !== "ai-sidebar:default-model");
  console.log(f);
  console.log("  全部字符串 " + all.length + " 个 / 其中消息类型 " + msgs.length + " 个 / storage key " + keys.length + " 个");
}

const bg = fs.readFileSync("background/service-worker.js", "utf8");
const set = [...new Set([...bg.matchAll(/"(ai-sidebar:[a-z-]+)"/g)].map((m) => m[1]))];
console.log("\n后台里出现的全部(含 storage key): " + set.length);
console.log(set.join(", "));

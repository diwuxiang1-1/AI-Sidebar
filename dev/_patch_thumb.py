# -*- coding: utf-8 -*-
"""收尾轮:网页资源 → 图片列表增加缩略图(只改图片,不动其他资源类型的逻辑)"""

import io

p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()

def rep(tag, old, new):
    global s
    c = s.count(old)
    print(tag, "=", c)
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# 1) 图片资源加缩略图容器
rep("thumb-slot",
    '''function makeResourceItem(item) {
  var row = document.createElement("div");
  row.className = "res-item";

  var meta = document.createElement("div");
  meta.className = "res-meta";
''',
    '''function makeResourceItem(item) {
  var row = document.createElement("div");
  row.className = "res-item";

  // 图片资源:最前面放一个缩略图(第四阶段收尾)
  if (item.type === "image") {
    row.appendChild(makeImageThumb(item));
  }

  var meta = document.createElement("div");
  meta.className = "res-meta";
''')

# 2) 缩略图实现
rep("thumb-fn",
    '''/** 资源地址形态的简短标签 */''',
    '''/**
 * 图片资源的缩略图
 * ----------------------------------------------------------------
 * · 直接用当前已经拿到的图片地址渲染,不额外下载、不上传、不走第三方
 * · 尺寸由 CSS 限制(96×72,object-fit: contain),不会撑坏列表
 * · 加载失败时换成统一的占位块,不影响列表里其他资源
 * · 点缩略图和点「打开」是同一个行为
 */
function makeImageThumb(item) {
  var box = document.createElement("div");
  box.className = "res-thumb";
  box.title = item.url || "";

  var img = document.createElement("img");
  img.className = "res-thumb-img";
  img.alt = item.name || "图片";
  img.loading = "lazy";      // 图片多时不要一次性全部加载
  img.decoding = "async";

  // 加载失败 / 空地址 → 换成失败占位,绝不抛错、不影响其它资源
  img.addEventListener("error", function () {
    box.classList.add("failed");
    img.remove();
    var ph = document.createElement("span");
    ph.className = "res-thumb-ph";
    ph.textContent = "图片加载失败";
    box.appendChild(ph);
  });

  if (item.url) {
    img.src = item.url;
  } else {
    // 没有地址:直接给占位,不发起请求
    box.classList.add("failed");
    var ph0 = document.createElement("span");
    ph0.className = "res-thumb-ph";
    ph0.textContent = "无图片地址";
    box.appendChild(ph0);
  }

  if (item.url) {
    img.addEventListener("click", function () { openResource(item.url); });
    box.addEventListener("click", function () { openResource(item.url); });
  }

  if (img.parentNode === null && !box.classList.contains("failed")) box.appendChild(img);
  return box;
}

/** 资源地址形态的简短标签 */''')

io.open(p, "w", encoding="utf-8", newline="").write(s)

# 3) CSS
p2 = "sidebar/sidebar.css"
c = io.open(p2, encoding="utf-8").read()
old = "/* 资源媒体状态行(第四阶段) */"
new = '''/* 图片缩略图(第四阶段收尾) */
.res-thumb {
  flex-shrink: 0; width: 96px; height: 72px;
  display: flex; align-items: center; justify-content: center;
  margin-right: 8px; border-radius: 4px; overflow: hidden;
  border: 1px solid rgba(31,35,40,0.12); background: #ffffff;
  cursor: pointer;
}
.res-thumb-img {
  max-width: 96px; max-height: 72px;
  width: auto; height: auto;
  object-fit: contain; display: block;
}
.res-thumb.failed { background: #f0f1f3; cursor: default; }
.res-thumb-ph { font-size: 10px; color: #9aa0a6; text-align: center; padding: 0 4px; }

/* 资源媒体状态行(第四阶段) */'''
assert c.count(old) == 1
c = c.replace(old, new, 1)

oldd = "  .res-status-line { color: #9aa0a6; }"
newd = ("  .res-status-line { color: #9aa0a6; }\n"
        "  .res-thumb { border-color: rgba(255,255,255,0.12); background: #2b2d31; }\n"
        "  .res-thumb.failed { background: #232528; }\n"
        "  .res-thumb-ph { color: #6e7681; }")
assert c.count(oldd) == 1
c = c.replace(oldd, newd, 1)
io.open(p2, "w", encoding="utf-8", newline="").write(c)
print("缩略图 CSS 已加入")

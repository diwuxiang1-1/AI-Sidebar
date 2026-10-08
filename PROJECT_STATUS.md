# AI Sidebar · 项目交接与开发说明

> 本文档以**当前实际代码**为唯一依据,逐项核对过 `manifest.json`、各目录源码与 `dev/` 测试。
> 与代码冲突时,以代码为准;发现文档与代码不一致,请改文档,不要改代码去迁就文档。
> 最后更新:**完整版冻结**轮(API Key 安全 / 行为诚实 / Token 真实化 / 选中文字预览)。

---

## 1. 项目定位

### 这是一个什么项目

一个运行在 **Microsoft Edge / Google Chrome 侧边栏(Side Panel)** 的浏览器扩展。
它把「AI 助手」放在浏览器右侧常驻面板里,并且**让 AI 能真正操作你正在看的网页**:
读网页、翻译网页、改网页、控制网页里的视频。

### 解决什么问题

日常在浏览器里读文章、看视频、查资料时,AI 与网页是割裂的:
要分析文章得复制粘贴,要把网页变深色得装另一个插件,要把视频调 16 倍速又得装一个。
本项目把这些收进一个面板:AI 直接看到当前网页,并且**在用户明确授权下**直接动手改。

### 核心使用方式

1. 点扩展图标 → 右侧打开侧边栏
2. 在设置页填自己的 API(Base URL / Key / Model)
3. 聊天框输入:
   - 「这篇文章讲了什么」→ 普通问答(带网页上下文)
   - 「把背景改成深色」→ AI 生成结构化修改方案 → 真正改掉网页
   - 「把视频调到 16 倍」→ 本地解析,直接控制播放器(不消耗 Token)
4. 面板顶部始终显示「AI 当前操作目标」,可以锁定多个网页互不干扰

### BYOK 的含义

**B**ring **Y**our **O**wn **K**ey —— 本项目**不带任何内置 API、不转发、不代收费**。
API Key 由用户自己填,存在浏览器本地 `chrome.storage.local`,请求由侧边栏直接发往用户配置的服务商。
扩展**没有自己的后端**,也没有任何代码把 Key 或网页内容发送到第三方。

### 浏览器扩展运行环境

| 项 | 值 |
|---|---|
| 清单版本 | Manifest V3 |
| 最低版本 | Chrome / Edge **116+**(用到 Side Panel API) |
| 权限 | `sidePanel` `storage` `activeTab` `scripting` `tabs` `history` `cookies` `downloads` |
| host 权限 | `<all_urls>`(内容脚本需要注入任意网页) |
| 后台 | Service Worker(经典脚本)**非持久化**,浏览器随时可能回收 |

### 当前项目边界

**负责**:侧边栏 UI、聊天、翻译、网页读取与修改、媒体控制、多 Tab 目标管理、两级可选权限。

**不负责(明确不做)**:

- ❌ 不提供 AI 服务,不代理请求,不保存用户的 Key 到任何服务器
- ❌ 不破解 DRM / 不解密受保护媒体 / 不绕过付费墙
- ❌ 不窃取 Cookie、密码、Token、API Key,不读取其他 Tab 的敏感信息
- ❌ 不做网络请求拦截 / 不劫持请求 / 不做 TLS 解密
- ❌ 不做后台监控用户的所有网页(只在用户主动操作时读当前目标网页)
- ❌ 不做隐蔽持久化、不做流媒体下载、不做视频站专用下载

---

## 2. 当前最终功能清单

> 逐项对照源码确认过。✅ = 已实现并有测试覆盖;⚠️ = 已实现但有能力边界。

### 2.1 侧边栏 / Side Panel

| 功能 | 状态 | 入口 / 位置 |
|---|---|---|
| 点击扩展图标打开侧边栏 | ✅ | `chrome.sidePanel.setPanelBehavior` + `action.onClicked` 兜底 |
| 双页面切换(聊天 / 网页资源) | ✅ | 顶部 `[聊天] [网页资源]` |
| **AI 当前操作目标栏**(常驻) | ✅ | 顶部,显示 `Tab 12 · 网页标题` |
| 锁定目标面板(多目标卡片) | ✅ | 目标栏右侧「已锁定 N」 |
| 设置页入口 | ✅ | 顶部「设置」/ 配置栏 |

> ⚠️ 浏览器**没有官方关闭侧边栏的 API**,扩展无法用代码关掉它(只能用户手动关)。

### 2.2 AI 聊天

| 功能 | 状态 | 说明 |
|---|---|---|
| 流式输出 | ✅ | SSE 逐字渲染 |
| 停止生成 | ✅ | `AbortController`,停止后保留已生成内容 |
| 重新生成 | ✅ | 撤回最后一条助手消息后重发 |
| 错误提示 | ✅ | 网络 / 鉴权 / 格式错误分别给可读提示 |
| Markdown 风格文本渲染 | ⚠️ | 纯文本气泡,不渲染 Markdown 语法 |
| 上下文模式 | ✅ | `普通聊天` / `当前网页`(见 2.6) |
| 聊天与网页修改结果同流 | ✅ | 修改结果、`[撤销]` 按钮都出现在聊天里 |

### 2.3 Provider / API 配置

| 功能 | 状态 |
|---|---|
| 6 个服务商预设(DeepSeek / OpenAI / SiliconFlow / Claude / Google / 自定义) | ✅ |
| Base URL 自动填充 + 手动覆盖 | ✅ |
| 测试连接 | ✅ |
| 获取模型列表 | ✅ |
| 模型下拉 + 手动输入 Model ID | ✅ |
| 配置名称 | ✅ |

### 2.4 API Key 多 Key 与轮询

| 功能 | 状态 | 说明 |
|---|---|---|
| 同一服务商多个 Key | ✅ | 设置页可增删 |
| 每个 Key 独立启用 / 停用 | ✅ | 停用的不参与轮询 |
| 每个 Key 单独删除 | ✅ | |
| **按 Provider 分池** | ✅ | `keyPools[provider]`,换服务商只看到自己的 Key |
| 同 Provider 内顺序轮询 | ✅ | 按填写顺序 |
| 失败自动切换下一个 Key | ✅ | |
| 每个 Key 每个请求最多一次 | ✅ | 不会重复打同一个 Key |
| 全部失败返回最后一个真实错误 | ✅ | |
| 绝不无限重试 | ✅ | 尝试次数 = 启用 Key 数量 |
| 用户主动停止不换 Key | ✅ | `AbortError` 直接抛出 |
| Key 掩码 / 日志不泄露 | ✅ | `maskApiKey()`;报错文本里的完整 Key 会被替换成掩码 |
| 输入框密码掩码 | ✅ | `type="password"` |

⚠️ 轮询**不区分错误类型**:401(Key 无效)与 429(限流)都会切换下一个 Key。
⚠️ 轮询位置不持久化 —— 每次请求都从第一个启用的 Key 开始。

### 2.5 会话管理

| 功能 | 状态 |
|---|---|
| 新建会话 | ✅ |
| 会话历史列表(切换 / 删除) | ✅ |
| 首条消息自动命名 | ✅ |
| 自动持久化到 `chrome.storage.local` | ✅ |
| 旧版单会话自动迁移 | ✅ |
| 会话重命名 / 搜索 / 导出 | ❌ 未实现 |

### 2.6 当前网页上下文

| 功能 | 状态 | 说明 |
|---|---|---|
| 「当前网页」模式 | ✅ | 注入标题 / 地址 / 正文 |
| 工具栏「当前网页」(手动读一次) | ✅ | |
| 「读取完整网页」 | ✅ | 不截断,用于长文 |
| Token 估算 + 超长截断 | ✅ | |
| 上下文长度可配置 | ✅ | 2000 / 4000 / 8000 / 16000 / 自定义 |
| Token 估算显示开关 | ✅ | |
| 费用提示开关 | ✅ | 内置参考价表 |
| 网页上下文**动态注入** | ✅ | **不写入聊天历史**(见第 7 章) |

### 2.7 自动选中文字上下文

| 功能 | 状态 | 说明 |
|---|---|---|
| 网页上选中文字 → 自动捕获 | ✅ | |
| 输入框上方轻量 chip「已选中 N 字 [×]」 | ✅ | |
| 发送时自动作为上下文注入 | ✅ | **普通聊天模式也会注入** |
| 「选中文字」不再是独立模式 | ✅ | 已合并为自动上下文 |

### 2.8 网页翻译

| 功能 | 状态 |
|---|---|
| 8 种目标语言(中/英/日/韩/法/德/西/俄) | ✅ |
| 2 种方式(意思翻译 / 专业术语) | ✅ |
| 只处理文本节点,**绝不重建 body** | ✅ |
| 长页面分批翻译 | ✅ |
| 编号映射,解析不出编号即判本批失败 | ✅ |
| 停止翻译 | ✅ |
| **逐字恢复原文**(不依赖 API) | ✅ |
| 已翻译内容不重复翻译 | ✅ |
| 页面切换 / 刷新安全(页面 token 校验) | ✅ |

### 2.9 网页资源检查器

| 功能 | 状态 | 说明 |
|---|---|---|
| 四类资源:图片 / 链接 / 视频 / 音频 | ✅ | |
| 分组折叠 + 数量 | ✅ | |
| 打开 / 复制完整地址 | ✅ | |
| **图片缩略图** | ✅ | 96×72,`object-fit: contain`,失败给占位 |
| 媒体状态行(来源 / 状态 / 控制 / 下载) | ✅ | |
| 直链媒体下载按钮 | ✅ | 只有普通 HTTP 直链才有,走权限等级 2 |
| **解除复制 / 选择 / 右键限制** | ✅ | 结构化动作 `remove_copy_restrictions`,不用 eval |
| **多模态网页上下文**(按需截图) | ✅ | 设置页「网页截图」= 按需 / 总是 / 关闭 |
| **使用者语言**(8 种,与翻译目标语言独立) | ✅ | 设置页「使用者语言」 |
| **文件输入**(文本本地读取 + 图片走视觉) | ✅ | 输入框旁边 📎 |
| **API Key 泄露防护**(错误信息源头脱敏 + 网页内容按不可信数据处理) | ✅ | 全链路 |
| **真实 Token 用量**(只显示 API 返回的 usage;没有就写「未提供」) | ✅ | 回复下方的用量行 |
| **选中文字预览**(直接看到内容 · 复制完整原文 · 纯本地) | ✅ | 输入框上方 |
| blob / MSE / DRM 明确标注不可下载 | ✅ | |

### 2.10 AI 修改当前网页

| 功能 | 状态 |
|---|---|
| 自然语言 → 结构化修改方案 | ✅ |
| 24 种动作(见第 8 章) | ✅ |
| 执行结果是**真实回执**,不是模型自称 | ✅ |
| 部分失败逐条说明原因 | ✅ |
| 纯倍速指令本地解析,不调用模型 | ✅ |
| 聊天里直接下修改指令 | ✅ |

### 2.11 WebPatch(网页修改引擎)

| 功能 | 状态 |
|---|---|
| `el_N` / `media_N` 内存编号(不往页面写属性) | ✅ |
| 选择器 / 文本匹配兜底定位 | ✅ |
| 专用 `<style id="ai-webpage-style">` | ✅ |
| HTML 消毒(经 `<template>` 惰性解析) | ✅ |
| 原子回滚(每个动作失败只回退自己) | ✅ |
| 级联撤销 / 全部恢复 | ✅ |
| 不可撤销动作如实标注 | ✅ |

### 2.12 JavaScript 执行能力

| 功能 | 状态 | 前置条件 |
|---|---|---|
| 在**网页主世界**执行网页 JS | ✅ | 设置页开启「权限等级 1」 |
| 真实返回值返回聊天(object/array/undefined/异常) | ✅ | |
| CSP 禁止 `unsafe-eval` 时如实报错 | ⚠️ | 站点限制 |

### 2.13 深度网页分析

| 功能 | 状态 |
|---|---|
| 页面信息(title / URL / readyState / viewport / 滚动位置) | ✅ |
| 规模统计(DOM / 可见元素 / video / audio / iframe / Shadow DOM) | ✅ |
| 媒体完整状态(11 个字段) | ✅ |
| **交互元素结构化**(button / input / textarea / select / link / image / form) | ✅ |
| **稳定内部 ID**(`button_1` / `input_1` / `video_1` …) | ✅ |
| aria-label / role / id / class / name / type / disabled | ✅ |
| iframe 列表(含跨域标注) | ✅ |
| Shadow DOM 检测 | ✅ |
| **跨 frame 汇总**(`all_frames` 注入后聚合) | ✅ |
| 分析结果作为下次修改的上下文,**不写入聊天历史** | ✅ |

### 2.14 视频 / 音频控制

| 功能 | 状态 |
|---|---|
| play / pause | ✅ |
| seek(带真实生效值回报) | ✅ |
| volume / mute / unmute | ✅ |
| set_rate(0.05–100,**无人工上限**) | ✅ |
| controls 显示切换 | ✅ |
| 状态查询(倍速 / 音量 / 进度 / 时长 / 暂停 / readyState) | ✅ |
| 自动挑选目标(正在播放 > 可见 > 主内容区 > 面积) | ✅ |
| 无法确定时如实报错,**不猜** | ✅ |
| 跨 frame 执行(B 站这类播放器在 iframe 里的站点) | ✅ |

### 2.15 playbackRate / 16× 锁定

| 功能 | 状态 |
|---|---|
| 设置倍速并回报真实值 | ✅ |
| 页面改回后自动恢复(事件驱动) | ✅ |
| 低频定时校验(1 秒一次,**不是高频死循环**) | ✅ |
| **只锁主目标**,不锁页面上所有视频 | ✅ |
| 与其他倍速插件互抢 → 主动停手并如实说明 | ✅ |
| 解除锁定 | ✅ |
| 撤销 / 恢复网页时自动解除锁定 | ✅ |

### 2.16 Tab 目标 / Tab 锁定

| 功能 | 状态 |
|---|---|
| 锁定当前网页为 AI 操作目标 | ✅ |
| 记录 tabId / windowId / url / title / favicon / 锁定时间 / 状态 | ✅ |
| 同时锁定多个(上限 8 个) | ✅ |
| 在多个目标之间切换 | ✅ |
| **「浏览器活动 Tab」与「AI 操作目标」明确区分** | ✅ |
| 未锁定时退化为「当前活动网页」 | ✅ |
| 多目标且用户没说清 → **先问,不猜** | ✅ |

### 2.17 多 Tab 独立状态

| 状态项 | 隔离方式 |
|---|---|
| 网页修改步数 / 撤销栈 | 内容脚本天然按 Tab 隔离;侧边栏按 tabId 存档 |
| 深度分析结果 | 按 tabId 隔离 |
| 媒体目标(`media_N` 编号) | 按 frame / Tab 隔离 |
| 修改恢复计划 | `{tabId, url, actions}`,按目标存 |

### 2.18 页面刷新后的修改恢复

| 功能 | 状态 |
|---|---|
| 刷新后自动重放结构化修改 | ✅ |
| **只存修改动作,不存 DOM / HTML** | ✅ |
| 按 URL 匹配(忽略 hash) | ✅ |
| 元素已不存在时逐条如实报失败 | ✅ |
| 同目标同地址的后续修改合并成一条 | ✅ |
| 「清除该网页修改」 | ✅ |
| 「重新分析网页」 | ✅ |

⚠️ 只有**整页重新加载**才触发;SPA 站内路由切换不触发。

### 2.19 blob / MSE 媒体识别

| 功能 | 状态 |
|---|---|
| blob: URL 识别 | ✅ |
| MSE(MediaSource / SourceBuffer)识别 | ✅ |
| HLS(m3u8)识别 | ✅ |
| `data:` 内嵌媒体识别 | ✅ |
| **blob/MSE 视频仍然可以播放 / 暂停 / 倍速 / 跳转 / 音量** | ✅ |
| 明确区分「不能下载」与「不能控制」 | ✅ |

### 2.20 直接媒体资源处理

| 资源类型 | 能否控制 | 能否下载 |
|---|---|---|
| 普通 MP4 / WebM / MP3 直链 | ✅ 能 | ✅ 能(权限等级 2) |
| blob / MSE 流 | ✅ 能 | ❌ 不能(不是普通文件) |
| HLS(m3u8) | ✅ 能 | ❌ 不能 |
| `data:` 内嵌 | ✅ 能 | ❌ 不能 |
| DRM / EME 受保护 | ✅ 按页面自身能力 | ❌ **不做绕过/解密** |

### 2.21 两级权限系统

| 等级 | 允许 | 默认 |
|---|---|---|
| 基础 | 聊天 / 翻译 / 网页读取 / 资源 / **结构化**网页修改 / 锁定并操作当前显示的网页 | 始终开启 |
| 等级 1:网页完全权限 | 网页 JS 执行(主世界)、**操作非当前显示的锁定网页** | 关闭 |
| 等级 2:浏览器完全权限 | 12 个 Browser Tool(标签页 / 历史 / Cookie / 下载 / 扩展存储) | 关闭 |

后台**独立校验**权限,不信任侧边栏传来的任何标志。所有敏感操作写入审计日志(最近 100 条)。

### 2.22 Undo / Restore

| 功能 | 状态 |
|---|---|
| 逐步撤销 | ✅ |
| 全部恢复网页 | ✅ |
| 跨 frame 撤销(媒体记录) | ✅ |
| 不可撤销动作(`run_js` / `browser_tool`)明确告知 | ✅ |
| 播放/暂停为尽力还原 | ⚠️ |
| 聊天里的 `[撤销]` 按钮 | ✅ |

### 2.23 现有测试

29 个测试文件、**1302 项断言,当前全绿**。详见第 13 章。

---

## 3. 技术栈

| 项 | 选择 | 说明 |
|---|---|---|
| 清单 | **Manifest V3** | Service Worker 后台 |
| 语言 | **原生 JavaScript(ES5 风格 + async/await)** | 无 TypeScript |
| 框架 | **无** | 不用 React / Vue / Svelte |
| 构建 | **无** | 没有 webpack / vite / rollup |
| 依赖 | **零 npm 依赖** | 项目目录内没有 `node_modules`、没有 `package.json` |
| 模块 | **经典脚本 + 全局作用域** | 不用 ES Module,不用 `import` / `export` |
| 样式 | 原生 CSS + `prefers-color-scheme` 暗色 | |
| 存储 | `chrome.storage.local` | 无 IndexedDB、无 localStorage 业务数据 |
| AI 调用 | `fetch` + SSE 流式,**从侧边栏直接发出** | OpenAI 兼容协议 |
| 后端 | **没有** | 无服务器、无中转、无遥测 |
| 测试 | Node.js + jsdom(装在**项目外** `E:\_aitest_tmp`) | 测试脚本只读项目代码 |

**为什么不用框架/构建**:见第 7 章。

---

## 4. 完整目录结构

```
E:\AI-Sidebar\
├─ manifest.json                   39 行   MV3 清单:权限、内容脚本、侧边栏入口
├─ PROJECT_STATUS.md                     本文档
├─ icons\                                ⚠️ 空目录 —— 清单里没声明图标,浏览器用默认图标
├─ background\
│  └─ service-worker.js          1282 行   后台:目标解析 + 消息中转 + Tab 生命周期 + 权限执行
├─ providers\
│  └─ openai-compatible.js        232 行   OpenAI 兼容 Provider:请求构造 + SSE 流式解析
├─ sidebar\
│  ├─ sidebar.html                194 行   侧边栏 DOM(聊天页 / 资源页 / 各面板)
│  ├─ sidebar.css                 435 行   侧边栏样式(含暗色)
│  └─ sidebar.js                 3066 行   侧边栏全部逻辑(最大文件)
├─ content\
│  ├─ content.js                 3136 行   内容脚本:网页读取 / 翻译引擎 / WebPatch 执行器 / 媒体核心 / 深度分析
│  └─ content.css                   7 行   占位,当前不向页面注入任何可见样式
├─ settings\
│  ├─ settings.html               333 行   API 配置 / 上下文 / 权限 / 多 Key
│  └─ settings.js                 476 行   设置页逻辑
├─ utils\
│  ├─ storage.js                  251 行   API 配置 + 会话 + 多 Key 数据层
│  ├─ targets.js                  315 行   锁定目标 + 修改恢复计划数据层
│  ├─ context.js                  351 行   Token 估算 / 上下文截断 / 费用
│  ├─ translate.js                274 行   翻译配置 / 提示词 / 结果解析 / 批次预算
│  ├─ webpatch.js                 532 行   修改方案格式 / 动作白名单 / 提示词 / 解析 / 安全校验 / 意图识别
│  ├─ permissions.js              133 行   两级权限读写 + 审计日志
│  ├─ i18n.js                     约 250 行 界面语言(8 种,与翻译目标语言独立)
│  ├─ files.js                    约 250 行 文件输入:本地读取 / 分类 / 大小限制
│  └─ browser-tools.js            239 行   12 个 Browser Agent Tool
└─ dev\                                    开发与测试(不参与运行,可整体删除)
   ├─ _media_harness.js                    jsdom 测试工具(页面装载 / 媒体模拟 / 断言上报)
   ├─ test_*.js                    26 个   测试文件
   └─ _patch_*.py / *.py                  历史补丁脚本(一次性,已执行完毕,可删)
```

### 关键文件:干什么 / 谁调用 / 改了会怎样

#### `manifest.json`

- **作用**:声明权限、内容脚本注入规则、侧边栏入口、后台脚本
- **谁读它**:浏览器
- **改动影响**:
  - 改 `permissions` → 装扩展时会重新弹权限确认
  - 改 `content_scripts` → **所有页面**的注入行为变化(注意 `all_frames` / `match_about_blank`)
  - 改 `background.service_worker` → 后台路径变化,`importScripts` 的相对路径基准随之变化
- ⚠️ 改完必须「重新加载扩展」**并刷新所有已打开的网页**

#### `background/service-worker.js`

- **作用**:
  1. 打开侧边栏(`action.onClicked` + `setPanelBehavior`)
  2. **`guardTarget(msg)` 统一解析「这次操作哪个 Tab」**
  3. 消息中转:侧边栏 ↔ 内容脚本
  4. `chrome.tabs.onRemoved` / `onUpdated` 维护锁定目标状态
  5. 跨 frame 注入(`allFrames`)并汇总媒体 / 深度分析结果
  6. 权限校验(`runPageCode` / `runBrowserToolChecked`)
  7. 修改恢复计划的存储与下发
- **谁调用它**:侧边栏(`chrome.runtime.sendMessage`)、内容脚本(主动上报)
- **改动影响**:这里是**唯一的执行枢纽**。改坏 → 所有网页功能瘫痪
- ⚠️ **SW 启动失败 = 全部功能死亡**:`importScripts` 必须用 `/utils/...` 绝对路径
  (相对路径会从 `/background/` 解析 → 404 → 顶层代码不再执行 → `onMessage` 监听器没注册)。
  所有可能失败的初始化(权限模块、Tab 事件注册)都包了 `try/catch` 降级。

#### `sidebar/sidebar.js`

- **作用**:聊天、会话、上下文组装、Provider 调用与 Key 轮询、翻译编排、修改编排、
  资源页渲染、目标面板、权限 UI、审计日志展示
- **谁调用它**:`sidebar.html`
- **改动影响**:侧边栏的一切。文件最大(3000+ 行),改之前先按第 15 章定位到具体函数

#### `content/content.js`

- **作用**:在网页里跑的所有东西 ——
  页面信息 / 正文提取 / 资源提取 / 翻译引擎 / WebPatch 执行器 / 媒体核心 / 深度分析 /
  刷新后自动恢复
- **谁调用它**:后台中转的消息;也被 `chrome.scripting.executeScript({allFrames})` 按名字调用
  (`wpFrameRunMedia` / `wpFrameDeepAnalyze` / `wpFrameUndoLast` / `wpFrameRestoreAll`)
- **改动影响**:**所有页面**的行为。改坏可能导致页面异常(内容脚本与页面同处一个浏览器进程)
- ⚠️ 被注入调用的那几个函数必须**自包含**(不能引用 service worker 里的变量)

#### `providers/openai-compatible.js`

- **作用**:构造 `/chat/completions` 请求、解析 SSE 流、产出标准错误对象
- **谁调用它**:侧边栏(`callModel` → `chatCompletionStream`)
- **改动影响**:所有 AI 功能。换协议(如 Anthropic 原生)要动这里

#### `settings/*`

- **作用**:API 配置(含多 Key)、上下文设置、权限开关
- **谁调用它**:扩展打开的独立标签页
- **改动影响**:只影响配置读写

#### `utils/*`

| 文件 | 作用 | 谁用 |
|---|---|---|
| `storage.js` | API 配置 / 会话 / Key 池 | 侧边栏、设置页 |
| `targets.js` | 锁定目标 / 恢复计划 | 侧边栏、**后台**(importScripts) |
| `context.js` | Token 估算 / 截断 / 费用 | 侧边栏、设置页、内容脚本 |
| `translate.js` | 翻译配置 / 提示词 / 解析 | 侧边栏、内容脚本 |
| `webpatch.js` | 动作白名单 / 提示词 / 解析 / 校验 / 意图识别 | 侧边栏、内容脚本 |
| `permissions.js` | 权限 + 审计日志 | 侧边栏、设置页、**后台** |
| `browser-tools.js` | 12 个浏览器工具 | 侧边栏(描述)、**后台**(执行) |

> ⚠️ `targets.js` / `permissions.js` / `browser-tools.js` 是**双端共用**的:
> 既被 `<script>` 加载进页面,也被 `importScripts` 加载进 Service Worker。
> 因此它们**只能依赖 `chrome.storage`**,不能碰 DOM。

#### `dev/*`

- **作用**:测试与历史补丁脚本
- **谁调用它**:开发者手动 `node dev/test_xxx.js`
- **改动影响**:**零**。`dev/` 不参与扩展运行,可以整体删除
- ⚠️ `_media_harness.js` 是测试公共工具,删了会导致大多数测试跑不起来

---

## 5. 整体架构

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │                             用户                                      │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ 点击 / 输入
                 ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Sidebar  (sidebar/sidebar.html + sidebar.js)   —— 扩展页面世界       │
 │  · 聊天 UI / 会话 / 上下文组装 / 目标面板 / 资源页 / 设置入口          │
 │  · 直接 fetch 用户自己的 API(流式)                                   │
 │  · 通过 chrome.runtime.sendMessage 请求一切网页能力                    │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ chrome.runtime.sendMessage({type, targetTabId?})
                 ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Service Worker  (background/service-worker.js)  —— 后台世界          │
 │  · guardTarget():决定「这次操作哪个 Tab」                              │
 │  · 权限校验(等级 1 / 等级 2)                                          │
 │  · Tab 生命周期监听 → 维护锁定目标                                     │
 │  · chrome.scripting.executeScript 跨 frame 注入 / MAIN world 注入      │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ chrome.tabs.sendMessage(tabId, msg, {frameId:0})
                 ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Content Script  (content/content.js)  —— 网页的「孤立世界」           │
 │  · 读取页面 / 翻译 / WebPatch 执行 / 媒体控制 / 深度分析              │
 │  · 拿不到 chrome.* 的敏感 API,能力止步于这个页面                     │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ DOM / 媒体元素
                 ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │                          当前网页                                     │
 └──────────────────────────────────────────────────────────────────────┘


 另一条独立的链路(AI 请求不经过后台):

 ┌──────────────┐   fetch(流式 SSE)   ┌─────────────────────────┐
 │   Sidebar    │ ──────────────────► │  用户自己的 API 服务商   │
 │  (callModel) │ ◄────────────────── │  (OpenAI 兼容协议)       │
 └──────────────┘   逐 token 回传      └─────────────────────────┘
```

### 代码分别跑在哪里

| 世界 | 文件 | 能做什么 | 不能做什么 |
|---|---|---|---|
| **侧边栏**(扩展页面) | `sidebar/*`、`utils/*`、`providers/*`、`settings/*` | DOM、`chrome.runtime`、`chrome.tabs`(部分)、`fetch` | 不能直接碰网页 DOM |
| **Service Worker**(后台) | `background/*`、`utils/*` | `chrome.*` 全套(受权限限制)、`scripting` 注入 | 没有 DOM,会被随时回收 |
| **内容脚本**(网页孤立世界) | `content/*`、`utils/context|translate|webpatch` | 当前页面的 DOM / 事件 | 拿不到 `chrome.*` 业务 API |
| **网页主世界**(MAIN world) | `run_js` 注入的代码 | 页面自己的 JS 对象 / 函数 | 拿不到扩展 API,且受页面 CSP 限制 |

### 哪些操作必须经过 background

**全部网页操作**:读取、翻译、修改、媒体、深度分析、资源、撤销恢复。
原因:侧边栏**没有**直接访问网页 DOM 的能力,必须由后台解析目标 Tab 再转发/注入。

### 哪些请求直接从 Sidebar 发出

**AI API 请求**。侧边栏直接 `fetch` 用户配置的 Base URL,后台不参与。
好处:后台被回收也不影响正在进行的对话;Key 不经过后台。

### 页面修改代码运行在哪里

**内容脚本的孤立世界**(结构化动作)。只有 `run_js` 例外 —— 它由后台用
`chrome.scripting.executeScript({world:"MAIN"})` 注入到**网页主世界**,才能访问页面自己的对象。

---

## 6. 最重要的数据流

### 6.1 AI 聊天

```
用户输入
  → onSend → doSend(text)
  → loadContextSettings()           读上下文配置
  → getApiConfig()                  读 API 配置
  → classifyUserIntent(text)        意图识别:聊天 or 改网页?
  → buildChatContext()              组装上下文(网页正文 / 选中文字)
  → messages.push + appendMessage   进会话、进 UI
  → callModel({...})                多 Key 轮询入口
      → resolveKeyPool()            取当前 Provider 里启用的 Key
      → chatCompletionStream()      providers/openai-compatible.js
      → fetch(SSE)                  直接打用户 API
      → onToken 回调                → 气泡逐字更新
  → messages.push(assistant)
  → saveActiveSession()             持久化
```

### 6.2 当前网页上下文

```
用户切到「当前网页」模式
  → doSend → buildChatContext()
  → sendMsg({type: GET_PAGE_TEXT, targetTabId})   自动带上目标
  → Service Worker: guardTarget(msg)              解析目标 Tab
  → chrome.tabs.sendMessage(tabId, msg, {frameId:0})
  → Content Script: extractPageText()             读标题/地址/正文
  → 回到侧边栏
  → buildPageContextMessage(pageCtx)              截断到配置上限
  → refreshEstimate()                             显示 Token 估算
  → 作为 system 消息**动态注入本次请求**
  → 不进 messages 数组 → **不写入聊天历史**
```

### 6.3 AI 修改网页

```
用户:「把背景改成深色」
  → classifyUserIntent → "modify"
  → chooseTargetIfAmbiguous()        多目标且没说清 → 先问,不弹执行
  → runChatModify(text)
  → onPatchApply()
      → parseLocalMediaCommand()     纯倍速指令:本地直接执行,不调模型
      → sendMsg(PATCH_ANALYZE)       取网页结构摘要(el_N / media_N)
      → buildWebPatchSystemPrompt()  告诉模型可用动作与格式
      → callModel()                  模型返回 JSON 方案
      → parseWebPatchResponse()      解析
      → validateWebPatchPlan()       动作白名单 + 权限过滤
      → groupPatchActions()          按通道分组:structured / media / js / tool
      → sendMsg(PATCH_APPLY)         → 内容脚本 wpApplyPlan()
                                        → wpRunAction() 逐个执行
                                        → 记录回滚信息到 step.records
      → 真实回执(成功数 / 失败数 / 实际生效值)
  → 结果 + [撤销] 写入聊天流
  → saveRecoveryPlan()              存下动作,供刷新后恢复
```

### 6.4 媒体控制

```
用户:「把视频调到 16 倍」/ AI 生成 media_set_rate
  → parseLocalMediaCommand()        本地语法解析(不消耗 Token)
  → sendMsg(MEDIA_APPLY, {op:"rate", value:16, lock:true})
  → Service Worker: guardTarget() + mediaApplyAcrossFrames()
  → chrome.scripting.executeScript({allFrames:true}, aiFrameRunMedia)
      → 每个 frame 的 wpFrameRunMedia(job)
          → wpFrameMediaList()      本 frame 的媒体,按优先级排序
          → wpResolveMediaTarget()  media_N / 选择器 / video / 自动挑
          → wpMediaOperation()      真实操作 + 读回实际值
          → 主目标挂 wpLockRate()
  → aggregateMediaFrames()          汇总各 frame 的真实结果
  → 侧边栏显示:目标倍速 / 实际倍速 / 状态
```

---

## 7. 最关键的设计决策

### 7.1 为什么不用 React / Vue / 构建工具

- **约束**:浏览器扩展的 Service Worker 与内容脚本都由浏览器直接加载**源文件**,没有打包步骤。
  引入构建链会让「改一行 → 重新加载扩展」变成「改一行 → 跑构建 → 重新加载」。
- **收益**:项目 11000 行、零依赖、双击即装。任何人拿到文件夹就能改、就能跑。
- **代价**:没有组件化、没有类型检查。用**明确的函数边界 + 注释**代替。

### 7.2 为什么用经典脚本 / 全局作用域

- 内容脚本由 `manifest.json` 按数组顺序注入**经典脚本**,不能用 `import`。
- Service Worker 用 `importScripts()`,同样是经典脚本。
- 侧边栏是普通 HTML 页面,用 `<script src>` 顺序加载。
- 三处都是**同一批 `utils/*.js`**,所以只能靠全局作用域共享。
- **代价**:脚本加载顺序被冻结 ——
  `sidebar.html`: `storage → provider → context → translate → webpatch → permissions → browser-tools → targets → sidebar`
  `content_scripts`: `context → webpatch → content`
  **改动顺序会静默破坏功能**。

### 7.3 为什么消息类型必须保持同步

`MSG` 常量在 **3 个文件里各写了一份**(`sidebar.js` / `content.js` / `service-worker.js`),
没有共享模块。原因:三端加载方式不同,没法共用一份。
**后果**:新增消息类型必须**同时改三处**,漏一处的表现是「消息发出去没人应答」,不报错、很难查。

### 7.4 为什么网页上下文动态注入,而不是永久写入聊天历史

- 网页正文动辄几千 token。写进历史 → 每条后续消息都要重发一遍 → **费用爆炸**。
- 而且用户切到别的网页后,旧正文会污染对话。
- 做法:每次发送时**临时**取一次当前网页,拼进本次请求的 system 消息,请求完就丢。
- 同理:深度分析结果也只作为**下一次**修改请求的上下文,不进历史。

### 7.5 为什么网页修改用结构化 Patch,而不是让 AI 随便执行代码

- **可撤销**:结构化动作知道「改了什么」,能反向还原;任意 JS 做不到。
- **可校验**:动作在白名单里,参数能检查;任意 JS 无法审查。
- **权限可控**:结构化修改属于基础权限;执行 JS 必须用户显式开启等级 1。
- **可解释**:UI 能逐条告诉用户「改了 5 项,其中 1 项失败,原因是……」。

### 7.6 为什么要有 Undo / Restore

改网页是**破坏性**操作。没有撤销,用户不敢用。
实现方式:每个动作执行前把「原值」记进 `step.records`,撤销时反向写回;
`remove` 这类会丢节点的动作会先记录父节点与位置,恢复时插回去。

### 7.7 为什么 Tab 状态必须独立

用户经常同时在几个页面上干活。如果共用一个状态:
在 B 站锁了 16 倍速,切到文章页 → 撤销栈、深度分析、媒体编号全部串味。
所以:内容脚本的状态天然按 Tab 隔离(每个 Tab 一个内容脚本实例),
侧边栏额外用 `targetStates[tabId]` 存「本目标的修改步数 / 深度分析结果」。

### 7.8 为什么 API Key 按 Provider 分池

硅基流动的 Key 拿到 DeepSeek 的 Base URL 上去用,一定 401。
如果做成一个大池子,轮询会拿着错误的 Key 打到错误的服务商,用户看到的是莫名其妙的鉴权失败。
所以:`keyPools[provider]`,换服务商只看自己那一组,**绝不跨 Provider 顶替**。

### 7.9 为什么媒体控制和媒体下载是两件事

`<video>` 能不能**控制**取决于元素本身(页面有没有锁死 `playbackRate`);
能不能**下载**取决于**资源地址的形态**(是不是一个普通的 HTTP 文件)。
两者完全独立。混为一谈的后果就是:看见 blob 就报「不支持」,其实倍速、静音全都能用。

### 7.10 为什么 blob / MSE 不等于「视频无法控制」

`blob:https://…` 只是说这段数据由页面在内存里生成(MSE 喂流),
`video` 元素依然是标准 HTML 元素,`playbackRate`、`volume`、`currentTime` 全都有效。
**只有**页面自己用 JS 把 `playbackRate` 的 setter 锁死,才真的不能改 —— 那时返回真实原因。

### 7.11 为什么 DRM / EME 不做绕过

- 绕过 DRM 在许多司法辖区**本身就是违法的**(规避技术保护措施)。
- 实现它需要网络拦截 + 解密,与本项目「不做请求劫持 / 不做 TLS 解密」的红线冲突。
- 正确做法:检测到 `mediaKeys` 就**明确告诉用户**「这是受保护媒体,不提供解密下载」,
  播放控制仍按页面自身能力进行。

---

## 8. AI 修改网页系统详解(WebPatch)

### 8.1 AI 输出什么

模型必须返回**一个 JSON 方案**(不是自然语言):

```json
{
  "type": "webpage_patch",
  "summary": "把页面改成深色并隐藏侧栏",
  "actions": [
    { "action": "add_css", "selector": "body", "css": "background:#111;color:#eee", "important": true },
    { "action": "hide",    "ref": "el_7" },
    { "action": "set_text","ref": "el_2", "text": "新标题" }
  ]
}
```

提示词由 `buildWebPatchSystemPrompt()` 生成,里面写清了动作清单、字段名、可用元素编号。

### 8.2 如何解析

`parseWebPatchResponse(raw)`:
容忍模型常见的包裹(```json 代码块、前后解释文字),提取 JSON;
解析失败 → **判为失败并报错**,不做「猜一个出来」的兜底。

### 8.3 如何验证

`validateWebPatchPlan(plan, perms)`:

1. `action` 必须在 `WEBPATCH_ACTIONS` 白名单里 → 否则丢弃
2. 动作数量上限 `WEBPATCH_MAX_ACTIONS = 60`
3. `set_attr` 属性白名单:`on*` 事件属性一律拒绝
4. `run_js` / `browser_tool` 需要对应权限 → 无权限则丢弃并记入 `dropped`
5. 被丢弃的动作会**如实告诉用户**「另有 N 条动作未被采纳(权限不足或不受支持)」

### 8.4 支持哪些操作(24 种)

**结构化动作(14,可撤销)**

| 动作 | 作用 | 关键字段 |
|---|---|---|
| `add_css` | 往专用 `<style>` 加规则,批量主题/布局用 | `selector`, `css`(字符串), `important` |
| `set_style` | 单个元素内联样式(自动 camelCase → kebab-case) | `ref`/`selector`, `style` |
| `hide` / `show` | 隐藏 / 显示 | `ref`/`selector`/`text` |
| `remove` | 从 DOM 删除(记录位置,可恢复) | |
| `set_text` | 替换元素文字 | `text` |
| `set_title` | 修改页面标题 | `text` |
| `set_attr` | 修改属性(白名单) | `name`, `value` |
| `set_html` | 替换内部 HTML(经 `<template>` + 消毒) | `html` |
| `append_html` | 内部追加 HTML | |
| `insert_html` | 前 / 后 / 内部插入 HTML | `position` |
| `create` | 创建新元素并插入 | |
| `move` | 移动元素 | |
| `set_media` | 旧式媒体入口(仍兼容) | |

**媒体专用动作(8,可撤销)**
`media_play` `media_pause` `media_seek` `media_set_rate`
`media_set_volume` `media_mute` `media_unmute` `media_toggle_controls`
→ 与 `set_media` **共用同一个执行核心** `wpMediaOperation`;倍速允许 0.05–100(不设人为上限);
执行后必须回报 `actualValue`,不达标就返回真实失败原因。

**需要权限的动作(2,不可撤销)**
`run_js`(等级 1)、`browser_tool`(等级 2)

### 8.5 如何找到目标元素

可靠性顺序:

1. **内部编号**(`el_N` / `media_N`)—— 内存注册表映射,**绝不往页面写任何属性**
2. **CSS 选择器** —— `document.querySelector`
3. **文本匹配** —— `text` + 可选 `tag`

媒体目标额外支持 `video` / `audio` / 留空 → 按
「正在播放 > 可见 > 主内容区 > 面积」自动挑选;**无法确定时如实报错,不猜**。

### 8.6 如何执行

`wpApplyPlan(msg)`:

```
for each action:
    mark = step.records.length        记录本动作写入前的回滚位置
    try:
        wpRunAction(act, step, allowFull)
        成功 → modified++, 收集 detail / actualValue
        失败 → 只回滚本动作(mark 之后新增的记录),收集失败原因
```

**原子性**:一个动作失败**不会**连累同一批里的其他动作。

### 8.7 如何返回结果

返回给侧边栏的是**内容脚本的真实回执**,不是模型的自述:

```
{ ok, modified, failed, failures:[{action, reason}], steps, canUndo, message }
```

侧边栏会把它整理成「已执行 N 项修改,其中 M 项未能完成」+ 逐条失败原因。

### 8.8 如何撤销

`wpUndoLast()` 弹出最后一个 step,按 `records` **逆序**回滚:
`set_style` → 写回旧值;`remove` → 插回原位置;`add_css` → 从样式表删规则;
媒体操作 → 按记录的旧值还原(播放/暂停为尽力还原)。

### 8.9 如何恢复

`wpRestoreAll()` 把所有 step 逆序全部回滚,并清空专用样式表、停止倍速锁定。

### 8.10 安全限制

- 动作白名单,白名单外一律丢弃
- `set_attr` 拒绝 `on*` 事件属性
- HTML 经 `<template>` 惰性解析 + 消毒(移除 script / 事件属性 / javascript: 等)
- `remove` / `set_html` 这类破坏性动作有「整页替换」保护开关
- `run_js` / `browser_tool` 必须用户显式开启对应权限,后台**独立校验**
- 失败逐条如实报告,不假装成功

---

## 9. 权限系统

### Level 0:基础权限(始终开启)

普通 AI 聊天 · 网页读取 · 选中文字 · 网页翻译 · 网页资源 · **结构化**网页修改 ·
锁定目标并操作**浏览器当前正在显示**的那个网页 · 撤销 / 恢复

### Level 1:网页完全权限(默认关闭)

- 在**网页主世界**执行网页 JavaScript(`run_js`)
- **操作浏览器当前未显示的锁定网页**(跨 Tab 读写 / 修改 / 媒体 / 深度分析)

> 为什么跨 Tab 要等级 1:在后台悄悄改一个用户看不见的页面,风险等级明显高于改他正在看的页面。

### Level 2:浏览器完全权限(默认关闭)

突破当前网页范围:

| 工具 | 作用 |
|---|---|
| `tabs.list` / `tabs.open` / `tabs.close` / `tabs.activate` / `tabs.navigate` / `tabs.reload` | 标签页管理 |
| `history.search` | 浏览历史 |
| `cookies.get` / `cookies.set` | Cookie |
| `downloads.start` | **下载**(资源页的「下载」按钮走这个) |
| `storage.get` / `storage.set` | 扩展存储 |

共 12 个。

### 哪些危险操作必须用户明确开启

- 执行网页代码 → 等级 1
- 操作非当前显示的页面 → 等级 1
- 关闭标签页 / 下载文件 / 写入 Cookie → 等级 2(**不可撤销**)

### 权限不足时的表现

**不抛 JS 错误**,统一返回:
> 「当前权限不足,请在设置中开启「权限等级 N:…」后再使用……」

### 哪些操作明确禁止

DRM 破解 · 解密下载 · 绕过付费墙 · 窃取 Cookie / 密码 / Token / API Key ·
读取其他 Tab 的敏感信息 · 后台监控所有网页 · 网络请求劫持 · TLS 解密 · 隐蔽持久化

### 审计日志

所有敏感操作写入 `ai-sidebar:audit-log`(最近 100 条,界面显示 20 条)。

---

## 10. 多 Tab / 页面生命周期

### AI 当前操作的是哪个 Tab

由 `chrome.storage.local` 里的 `ai-sidebar:targets` 决定:

```js
{
  list: [ { tabId, windowId, url, title, favicon, lockedAt, lastSeenUrl, state } ],
  activeId: 12          // ← AI 当前操作目标
}
```

`state` 取值:`locked` / `closed` / `navigated`。

### 如何锁定目标 Tab

侧边栏「锁定此网页」→ `TARGET_LOCK` → 后台读当前活动 Tab → 写入 `list`,`activeId` 指向它。
上限 8 个,超出会**明确提示**,不静默丢弃。

### 为什么不能简单用「当前浏览器活动 Tab」

因为用户会切 Tab。
若始终用活动 Tab:用户锁定网页 A → 去网页 B 查个资料 → 回来跟 AI 说「把背景改深色」→
**改的是 B**。这是本项目在第四阶段要解决的头号问题。

现在:`guardTarget(msg)` 优先用消息里的 `targetTabId`,没有才退化成活动 Tab。
侧边栏的 `sendMsg()` 会自动给所有网页操作类消息盖上 `targetTabId`。

### 多 Tab 如何隔离

- 网页修改步数 / 撤销栈:内容脚本按 Tab 天然隔离 + 侧边栏 `targetStates[tabId]` 存档
- 深度分析结果、媒体编号:同上
- 修改恢复计划:`{tabId, url, actions}` 存 `ai-sidebar:patch-plans`
- 切换目标时:`snapshotTargetState()` → `restoreTargetState()` → 再向真实页面 `PATCH_STATE` 对账

### URL 改变如何处理

`chrome.tabs.onUpdated` 收到新 URL:

1. 写回 `url` / `title` / `favicon`
2. 新地址 ≠ `lastSeenUrl` → `state = "navigated"`
3. 侧边栏提示「目标网页已导航到新地址,需要重新确认」
4. 此状态下**拒绝执行**(除非消息带 `allowNavigated`),避免「以为在改 A,其实在改 B」
5. 用户点「重新确认此目标」→ `state` 回到 `locked`

### Tab 关闭如何处理

`chrome.tabs.onRemoved` → `state = "closed"` → 侧边栏显示「目标网页已关闭」并**拒绝执行**。
目标**保留在列表里**(不静默消失),用户可以手动解除。

### 页面刷新如何处理

刷新后 Tab 还在、URL 没变 → 目标保持 `locked`;
内容脚本重新注入,`document_idle` 后延迟 800ms 主动向后台询问是否有恢复计划 → 自动重放。

### 多目标歧义

锁定了 ≥2 个网页,用户又说「把背景改成黑色」:
先看这句话里有没有点名(标题 / 域名片段)。
点名了 → 自动切过去执行;没点名 → **在聊天里弹出目标选择按钮,不猜**。

---

## 11. 媒体系统

### video / audio 如何识别

`document.querySelectorAll("video, audio")` + `wpMediaTag()` 校验标签,
每个 frame 独立收集,再由后台 `allFrames` 注入后汇总。

### media ID 如何生成

两套编号:

| 编号 | 形式 | 用途 |
|---|---|---|
| `media_N` | `media_1` | **操作时引用**(内存注册表,不写页面属性) |
| 稳定 ID | `video_1` / `audio_1` | 深度分析报告里给 AI 看的语义编号 |

跨 frame 时后台会加前缀:`f3_media_1`。

### playbackRate

直接读写 `el.playbackRate`,允许 **0.05–100**,不设人为上限。
执行后**读回真实值**回报;不达标返回真实原因。

### 16×

就是 `playbackRate = 16`。部分播放器(尤其视频站)会在 `ratechange` 里改回去,
所以有专门的**锁定**机制。

### speed lock

```
设置 → capture 阶段监听 ratechange → 读回实际值
  · 值对了 → 不管
  · 被改回 → 立刻恢复(事件驱动)
  · 同一秒内抢写超过 5 次 → 判定为与其他脚本互抢 → 停手并如实说明
  · 另有 1 秒一次的低频定时校验兜底
```

**只锁主目标**(正在播放 / 可见 / 最大的那个),不会把页面上所有视频都锁成 16×。
撤销 / 恢复网页时自动解除锁定。

### play / pause / seek / volume / mute …

全部走 `wpMediaOperation(el, op, value, step, ref)`,统一:
真实执行 → 读回实际值 → 记入撤销记录 → 返回 `actualValue`。

### blob URL

`blob:https://…` → 页面在内存里生成的数据(MSE 喂流)。
**能控制**(播放/暂停/倍速/跳转/音量/静音),**不能下载**(不是普通 HTTP 文件)。

### MSE

`video.srcObject instanceof MediaSource`,或 `src` 是 blob → 归为 MSE 流。
同 blob:能控制,不能下载。

### 普通 MP4 / WebM

`src` 是普通 HTTP(S) 地址 → 能控制,**也能下载**(资源页的「下载」按钮,走权限等级 2)。

### DRM / EME

检测 `mediaKeys` / `webkitKeys` → 标记为受保护媒体。
**不提供解密下载**,播放控制仍按页面自身能力进行,并明确告诉用户。

### 汇总

| 类型 | 控制 | 下载 | 说明 |
|---|---|---|---|
| 普通 MP4/WebM/MP3 直链 | ✅ | ✅ | 走等级 2 的 `downloads.start` |
| blob / MSE | ✅ | ❌ | 页面内存数据流 |
| HLS(m3u8) | ✅ | ❌ | 分片流,需要专门下载器 |
| `data:` 内嵌 | ✅ | ❌ | 没有独立地址 |
| DRM / EME | 按页面能力 | ❌ | 不做绕过与解密 |

---

## 12. API Provider 系统

### Provider 配置

`settings/settings.html` → `PROVIDER_PRESETS`(6 个):

| id | 名称 | Base URL |
|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` |
| `openai` | OpenAI | `https://api.openai.com/v1` |
| `siliconflow` | SiliconFlow | `https://api.siliconflow.cn/v1` |
| `claude` | Claude | `https://api.anthropic.com/v1` |
| `google` | Google | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `custom` | 自定义 | 空,手填 |

### Base URL / Model ID

选服务商自动填 Base URL(可手动改)。Model ID 可下拉选(获取模型列表)或手输。

### API Key / 多 Key

```js
keys:     [ { value: "sk-…", enabled: true }, … ]   // 当前 Provider 的池
keyPools: { siliconflow: [...], deepseek: [...] }   // 每个 Provider 各自的池
```

旧格式 `["sk-a","sk-b"]` 会自动规范化成新格式。

### 同 Provider 内轮询

`resolveKeyPool()` → 取当前 Provider 里 `enabled && value` 的 Key,按填写顺序。

### 失败切换 / 最大重试次数

```
for 每个启用的 Key:
    try  → 成功就返回
    catch → 记下错误,换下一个
全部失败 → 抛出最后一个真实错误
```

**尝试次数 = 启用 Key 的数量**,每个 Key 每个请求最多一次,**绝不无限重试**。
用户主动停止(`AbortError`)直接抛出,不换 Key。

### 不允许跨 Provider 混 Key

只读当前配置的 `keys`,不同 Provider 的池互不可见。换服务商只会切到它自己的池。

### OpenAI-compatible 的含义

请求 `POST {baseUrl}/chat/completions`,body 用 `{model, messages, stream:true}`,
鉴权用 `Authorization: Bearer {key}`,响应按 SSE 逐行 `data: {...}` 解析。
**不是** OpenAI 官方协议的服务商,只要兼容这套格式就能用。

⚠️ Claude / Google 预设只有 Base URL,**原生协议未适配**,大概率不可用。
可靠的是 DeepSeek / OpenAI / SiliconFlow。

---

## 13. 测试体系

依赖 `jsdom`,装在**项目外**的 `E:\_aitest_tmp`(项目本身保持零依赖)。
所有测试**只读**项目代码,不修改扩展文件。

运行方式(在项目根目录):

```bash
export NODE_PATH=E:/_aitest_tmp/node_modules
node dev/test_webpatch.js
```

或一次性全跑:见第 17 章第 9 步。

### 测试文件清单

| 文件 | 断言 | 测什么 | 类型 |
|---|---|---|---|
| `test_webpatch.js` | 129 | WebPatch 全链路:解析 / 执行 / 撤销 / 恢复 / 安全 / 编排 | 单元 + 集成 |
| `test_final.js` | 83 | API Key 安全 / 行为诚实 / 历史残留 / 语言唯一性 / 真实用量 / 选中文字按需 | 单元 + 结构 |
| `test_full.js` | 77 | 完整版:文件输入(格式/限制/上下文)+ 8 种语言 + 视觉上下文 | 单元 + 集成 |
| `test_copy.js` | 38 | 解除复制限制:样式覆盖 / 内联属性 / JS 拦截 / 不误伤按钮 / 撤销 | 集成 |
| `test_permissions.js` | 94 | 两级权限读写 / 独立性 / 审计 / 过滤 / 后台边界 | 单元 |
| `test_resources_page.js` | 84 | 资源提取 + 页面切换 + 渲染 + 打开/复制 + **缩略图** | 结构测试 |
| `test_s4_media.js` | 75 | 深度分析结构化字段 + 稳定 ID / 视频控制 / 16× 锁定 / blob·MSE·DRM | 集成 |
| `test_content_translate.js` | 71 | 翻译引擎(假 DOM) | 单元 |
| `test_translate.js` | 58 | 翻译配置 / 提示词 / 结果解析 / 预算 | 单元 |
| `test_context.js` | 54 | Token 估算 / 截断 / 费用 / 配置迁移 | 单元 |
| `test_translate_flow.js` | 47 | 翻译端到端编排(Provider 打桩) | 集成 |
| `test_deep_analyze.js` | 45 | 深度分析:字段 / iframe / Shadow DOM / 报告形态 | 集成 |
| `test_real_page.js` | 41 | 真实网页 HTML(jsdom):结构不变 + 原文逐字恢复 | 集成 |
| `test_r14_chat.js` | 39 | 聊天交互整合:上下文模式 / 自动选区 chip / 意图识别 | 集成 |
| `test_media_swboot.js` | 37 | SW 启动 + 深度分析中转 + 权限模块故障降级 | 结构 |
| `test_sidebar_integration.js` | 37 | 按真实加载顺序装载脚本 + 配置结构契约 | 冒烟 |
| `test_s4_targets.js` | 36 | 锁定目标 / 多目标切换 / Tab 关闭 / 导航确认 / 跨 Tab 权限 | 集成 |
| `test_thumb.js` | 30 | 图片缩略图:普通图 / 多图 / 加载失败 / 大图 / 小图 / 点击打开 | 结构 |
| `test_sw_boot.js` | 28 | SW 启动链 + 6 类消息中转 + 降级 | 结构 |
| `test_media_regress.js` | 23 | 原有 14 种动作 + 撤销 + 恢复不受媒体改动影响 | 回归 |
| `test_round13.js` | 23 | 本地倍速解析 + run_js 返回值格式化 | 单元 |
| `test_r14_lock.js` | 23 | 倍速锁定:偶发改回恢复 / 只锁主目标 / 持续互抢停手 | 集成 |
| `test_s4_recover.js` | 22 | 刷新后恢复:自动重放 / 元素消失如实报失败 / 计划结构 | 集成 |
| `test_media_basic.js` | 21 | video/audio 播放·暂停·跳转·倍速·音量·静音·controls | 单元 |
| `test_r14_settings.js` | 21 | 设置页多 Key UI:添加·停用·删除 / 保存 / 严格分池 | 结构 |
| `test_s4_chat.js` | 20 | 聊天 × 目标:自动带 targetTabId / 歧义先问 / 状态隔离 | 集成 |
| `test_r14_keys.js` | 18 | 多 Key 轮询:顺序 / 每 Key 每请求一次 / 全失败最后错误 | 单元 |
| `test_media_pick.js` | 17 | 媒体目标挑选优先级 / blob 视频仍可控制 | 单元 |
| `test_media_frames.js` | 17 | 跨 frame 媒体执行 + 保持倍速 | 集成 |

**合计:29 个文件 / 1302 项断言 / 0 失败。**

### 测试类型说明

- **单元测试**:纯逻辑,喂数据断言输出(如 `test_context.js`)
- **结构测试**:用最小 DOM / chrome 桩按真实顺序装载脚本,断言 DOM 结构与消息流
- **集成测试**:用 jsdom 装真实 HTML 页面 + 桩后台,跑完整链路
- **浏览器人工测试**:jsdom 覆盖不到的部分(见第 17 章第 5-8 步)

### ⚠️ 关于 "API / network timeout"

如果测试或运行时出现 **`operation timed out` / `Failed to fetch` / 连接超时**:

- 这是**外部运行环境问题**(网络不通、服务商不可用、代理问题),**不是项目代码失败**。
- 判定方法:改跑不依赖网络的测试(如 `test_webpatch.js`、`test_context.js`),
  它们全绿就说明代码没问题。
- **不要**因为一次超时就重写文件、重新生成代码或反复重跑整套测试。

---

## 14. 已知限制

### 浏览器限制(无法通过改代码解决)

| # | 限制 | 说明 |
|---|---|---|
| 1 | **侧边栏没有官方关闭 API** | 只能打开,不能由扩展代码关闭 |
| 2 | Service Worker 会被回收 | 非持久化;内存里的注册表(`el_N`)会丢,网页修改后刷新要靠落盘的计划恢复 |
| 3 | 主世界执行受页面 CSP 限制 | 页面禁止 `unsafe-eval` 时 `run_js` 不可用(会如实报错) |
| 4 | 跨域 iframe 内容不可读 | 深度分析会标注「跨域,内容不可访问」 |
| 5 | 浏览器内部页面不支持 | `edge://` `chrome://` `about:` 等无法注入内容脚本,一律返回友好错误 |
| 6 | 关闭标签页 / 下载 / 写 Cookie 不可撤销 | 界面上会明确说明 |

### Content Script / Page World 限制

| # | 限制 | 说明 |
|---|---|---|
| 7 | 内容脚本在孤立世界 | 拿不到 `chrome.*` 业务 API,也拿不到页面自己的 JS 变量(要 `run_js` 走主世界) |
| 8 | `media_N` / `el_N` 是内存注册表 | 页面刷新后编号失效,需要重新分析 |
| 9 | 内容脚本与页面同进程 | 极重的页面分析可能让页面卡顿,已设规模上限 |

### blob / MSE / DRM

| # | 限制 | 说明 |
|---|---|---|
| 10 | blob / MSE 不能下载 | 数据在页面内存里,没有可下载的 HTTP 地址;**控制不受影响** |
| 11 | HLS 不能下载 | 分片流,需要专门下载器 |
| 12 | DRM / EME 不绕过 | 明确不做解密下载 |

### API 服务商兼容性

| # | 限制 | 说明 |
|---|---|---|
| 13 | Claude / Google 原生协议未适配 | 只有 Base URL 预设,走 OpenAI 兼容协议,大概率不可用 |
| 14 | 费用价格表可能过时 | 硬编码 12 条公开参考价,只算输入侧;查不到显示「无法估算费用」 |
| 15 | 轮询不区分错误类型 | 401(Key 无效)与 429(限流)都会切换下一个 Key |
| 16 | 轮询位置不持久化 | 每次请求都从第一个启用的 Key 开始 |
| 17 | 不重试同一条消息 | 一次请求内每个 Key 只打一次 |

### 其他实际限制

| # | 限制 | 说明 |
|---|---|---|
| 18 | 修改网页面板**没有「停止」按钮** | 生成方案期间无法中断 |
| 19 | 出错消息样式 | 以普通气泡显示(纯视觉问题) |
| 20 | SPA 路由切换后资源页不自动刷新 | 需手动点「刷新」 |
| 21 | 刷新恢复不覆盖 SPA 路由变化 | 只有整页重新加载才触发恢复 |
| 22 | 媒体倍速锁定不参与刷新恢复 | 刷新后 `video` 是新元素,`media_N` 编号失效 |
| 23 | 锁定目标上限 8 个 | 超出会明确提示 |
| 24 | `icons/` 是空目录 | 清单里没声明图标,浏览器用默认图标 |
| 25 | Markdown 不渲染 | 助手回复按纯文本显示 |
| 26 | 截图只能抓当前显示的标签页 | `captureVisibleTab` 抓不到后台标签,窗口最小化也抓不到;会如实说明并退回文字上下文 |
| 27 | PDF / Word / Excel 暂不解析 | 浏览器原生 API 拿不到这些格式的文本,引入 pdf.js / mammoth / sheetjs 会破坏「零依赖」;当前明确提示不支持并建议另存为 txt / md / csv |
| 28 | 视觉模型靠模型名启发式判断 | 名字对不上时先按不支持处理;若实际支持,可把「网页截图」设为「总是」。真的不支持时也会自动去掉图片重试一次 |
| 29 | 解除复制限制只管前端限制 | 图片型内容、服务端权限控制、需登录才能看的内容不在范围内 |
| 30 | Token 用量依赖服务商返回 | 走 `stream_options.include_usage`;服务商不支持时**显示「未提供实际用量」**,不做本地估算 |
| 31 | 费用只在服务商直接返回时显示 | 本地价格表已移除(会过时,算错比不显示更糟) |
| 32 | 不可信数据边界是提示词层面的防护 | 结构上 API Key 从不进入任何 prompt,边界声明是第二道防线,不是唯一防线 |
| 33 | **真实浏览器人工验证不完整** | jsdom 无排版引擎与媒体管线,可见性/播放行为靠模拟 |

---

## 15. 如何修改这个项目

> 通用原则:**先读现有代码,再动手**。每一条都给了「先看哪个函数」,不要通读 3000 行。

### 「我要修改聊天 UI」

| 改什么 | 去哪 |
|---|---|
| 气泡样式 / 布局 | `sidebar/sidebar.css`(搜 `.message` `.chat-list` `.chat-form`) |
| 消息 DOM 结构 | `sidebar/sidebar.js` → `appendMessage` / `createStreamingBubble` / `appendError` |
| 输入框行为 | `sidebar/sidebar.js` → `onSend` / `doSend` |
| 顶部栏 / 工具栏按钮 | `sidebar/sidebar.html` + `sidebar.js` 里的 `const xxxEl = document.getElementById(...)` |
| 流式渲染 | `sidebar/sidebar.js` → `doSend` 里的 `onToken` 回调 |

### 「我要修改 API」

| 改什么 | 去哪 |
|---|---|
| 请求格式 / SSE 解析 | `providers/openai-compatible.js` |
| 加新服务商预设 | `utils/storage.js` → `PROVIDER_PRESETS` |
| 设置页表单 | `settings/settings.html` + `settings/settings.js` |
| Key 轮询逻辑 | `sidebar/sidebar.js` → `resolveKeyPool` / `callModel` |
| Key 数据结构 | `utils/storage.js` → `normalizeKeyList` / `getEnabledApiKeys` / `getPrimaryApiKey` |
| 模型价格表 | `utils/context.js` |

### 「我要修改网页读取」

| 改什么 | 去哪 |
|---|---|
| 提取标题 / 正文 | `content/content.js` → `extractPageInfo` / `extractPageText` |
| 上下文拼装 / 截断 | `sidebar/sidebar.js` → `buildPageContextMessage` / `buildChatContext`;`utils/context.js` |
| 新增长度配置 | `utils/context.js` + `settings/*` + `sidebar.js` 的 `loadContextSettings` |

### 「我要增加网页操作」

1. `utils/webpatch.js` → `WEBPATCH_ACTIONS`(加动作名)
2. `utils/webpatch.js` → `buildWebPatchSystemPrompt`(告诉模型怎么用)
3. `content/content.js` → 新增 `wpActXxx(act, step)` 并在 `wpRunAction` 的 `switch` 里接上
4. 需要回滚 → 在 `step.records` 里记原值,并在 `wpUndoRecord` 里处理
5. 需要权限 → `utils/webpatch.js` → `validateWebPatchPlan` 过滤
6. `dev/test_webpatch.js` 加断言

### 「我要修改媒体控制」

| 改什么 | 去哪 |
|---|---|
| 单个媒体操作 | `content/content.js` → `wpMediaOperation` |
| 目标挑选优先级 | `content/content.js` → `wpFrameMediaList` 的排序 |
| 媒体编号 | `wpEnsureMediaRef` / `wpResolveMediaTarget` |
| 倍速锁定 | `wpLockRate` / `wpUnlockRate` / `wpRateLockReport` |
| 跨 frame 汇总 | `background/service-worker.js` → `aggregateMediaFrames` |
| 媒体形态识别(直链/blob/MSE/DRM) | `content/content.js` → `wpMediaKind` |
| 侧边栏显示 | `sidebar/sidebar.js` → `runLocalRateCommand` |

### 「我要修改权限」

| 改什么 | 去哪 |
|---|---|
| 权限读写 | `utils/permissions.js` |
| 权限界面 | `settings/settings.html` + `settings.js` |
| **后台强制校验**(关键) | `background/service-worker.js` → `guardTarget`(跨 Tab)、`runPageCode`(等级 1)、`runBrowserToolChecked`(等级 2) |
| 可用浏览器工具 | `utils/browser-tools.js` → `BROWSER_TOOLS` |
| 审计日志显示 | `sidebar/sidebar.js` → `renderAuditLog` |

> ⚠️ 新增任何敏感能力,**必须**在后台加校验,不能只靠界面禁用按钮。

### 「我要修改资源页」

| 改什么 | 去哪 |
|---|---|
| 提取规则 | `content/content.js` → `extractPageResources` / `collectResources` / `imageResourceInfo` / `linkResourceInfo` / `mediaResourceInfo` |
| 渲染 / 分组 / 折叠 | `sidebar/sidebar.js` → `renderResources` / `makeResourceGroup` / `makeResourceItem` |
| **图片缩略图** | `sidebar/sidebar.js` → `makeImageThumb`;`sidebar/sidebar.css` → `.res-thumb*` |
| 打开 / 复制 / 下载 | `sidebar/sidebar.js` → `openResource` / `copyResourceUrl` / `downloadResource` |
| 数量上限 | `content/content.js` → `RES_MAX_PER_TYPE` |

### 「我要修改设置页」

- `settings/settings.html`(结构 + 样式)
- `settings/settings.js`(逻辑)
- 存储层:对应 `utils/*.js` 里的读写函数
- ⚠️ 设置页脚本加载顺序:`storage → provider → context → permissions → settings.js`

---

## 16. 修改规则

1. **先读现有代码,再修改**。不要凭文档或猜测动手。
2. **不要无理由重构**。能改 5 行就不要重写 500 行。
3. **不要随意改变消息协议**。`MSG` 常量在 3 个文件里,改名要同步三处。
4. **不要改变已有数据结构**。`ai-sidebar:*` 里的字段被多处读取;
   确实要改就必须写兼容读(参考 `normalizeKeyList` 对旧格式的处理)。
5. **不要删除已有功能**。要下线就先确认没有测试依赖它。
6. **修改一个模块后必须检查关联模块**:
   - 改 `content.js` → 检查 `service-worker.js` 的注入函数与 `sidebar.js` 的消费端
   - 改 `sidebar.js` 的消息发送 → 检查后台是否有对应 `case`
7. **修改 `manifest.json` 后必须检查 SW / content / sidebar**:
   路径、权限、`content_scripts` 注入规则一变,三处都可能受影响。
8. **新增消息类型必须同步相关端**:`sidebar.js` + `service-worker.js` + `content.js`(如涉及)。
   漏一处的表现是「消息发出去没人应答」,**不报错**,只能靠日志排查。
9. **修改 WebPatch 必须运行 `node dev/test_webpatch.js`**。
10. **不要为了修一个 UI 问题重写整个项目**。
11. **不确定就问**,不要猜用户的意图然后改一堆东西。
12. 改完必须:**重新加载扩展** → **刷新已打开的网页**(旧内容脚本会失效)。

---

## 17. 从零开始复现项目

### 1. 准备环境

- Microsoft Edge 或 Google Chrome **116 或更高**
- 项目文件夹(无需 `npm install`,项目零依赖)
- 可选:一个 OpenAI 兼容的 API Key(DeepSeek / SiliconFlow / OpenAI 任一)

### 2. 加载扩展

1. 地址栏输入 `edge://extensions`(Chrome 是 `chrome://extensions`)
2. 打开左下角「开发人员模式」
3. 点「加载解压缩的扩展」→ 选择 `E:\AI-Sidebar` 文件夹
4. 工具栏上出现扩展图标

### 3. 配置 API

1. 点扩展图标 → 打开侧边栏
2. 点顶部「设置」
3. 选服务商(会自动填 Base URL)
4. 填 API Key(可加多个,每个可单独启用/停用)
5. 点「获取模型」或手动输入 Model ID
6. 点「测试连接」→ 显示成功后「保存」

### 4. 启动

- 点扩展图标即可打开侧边栏(已设为原生行为)
- 打开任意普通网页(不是 `edge://` 内部页)

### 5. 测试聊天

- 聊天框输入「你好」→ 应按流式逐字回复
- 点「停止」应能中断
- 刷新侧边栏后会话应还在(「历史」里)

### 6. 测试网页读取

- 点「普通聊天」旁边的「当前网页」→ 输入「这篇文章讲了什么」→ 应基于网页内容回答
- 点工具栏「读取完整网页」→ 应读到更长的正文
- 在网页上选中一段文字 → 输入框上方出现「已选中 N 字」chip → 提问时应能用到

### 7. 测试网页修改

- 开着「当前网页」,在聊天框输入「把背景改成深色,正文放大」
- 网页应真的变化,聊天里出现「已执行 N 项修改」+ `[撤销]`
- 点 `[撤销]` → 网页应还原
- 点工具栏「修改网页」→「深度分析网页」→ 应列出媒体与页面要素
- 按 F5 刷新 → 页面应**自动重新应用**刚才的修改,聊天里出现恢复结果

### 8. 测试媒体

- 打开一个带视频的页面(如 B 站)
- 说「把当前视频调到 16 倍」→ **用眼睛确认播放速度真的变快**
- 若播放器改回去 → 应自动恢复,面板显示「已锁定」
- 说「暂停视频」「音量调到 50%」
- 点「网页资源」→ 看视频的「来源 / 状态 / 控制 / 下载」四段
- 图片分组里应能看到**缩略图**

### 9. 运行测试

```bash
cd /e/AI-Sidebar
export NODE_PATH=E:/_aitest_tmp/node_modules

# 全部 26 个套件
for t in webpatch permissions resources_page content_translate translate context \
         translate_flow deep_analyze real_page media_swboot sidebar_integration \
         sw_boot media_regress round13 media_basic media_frames media_pick \
         r14_keys r14_chat r14_lock r14_settings \
         s4_targets s4_recover s4_media s4_chat thumb; do
  node "dev/test_$t.js" | tail -1
done
```

预期:每个文件都是「通过 N 项,失败 0 项」。

---

## 18. 项目开发历史

> 只记录**真正改变架构或能力**的阶段。

### 阶段 1:初始扩展

- **解决**:让 AI 出现在浏览器侧边栏
- **改了什么**:`manifest.json` + 最小 SW + 空的侧边栏页面
- **为什么**:Side Panel 是 MV3 里唯一能常驻在浏览器右侧的官方容器

### 阶段 2:AI Chat

- **解决**:能和 AI 对话
- **改了什么**:`providers/openai-compatible.js`(SSE 流式)、聊天 UI、会话持久化
- **为什么这样设计**:BYOK 直连,不引入后端 → Key 不经过任何服务器

### 阶段 3:Web Context

- **解决**:AI 看不见用户正在看的网页
- **改了什么**:内容脚本 + 消息中转 + 网页正文提取
- **为什么这样设计**:正文**动态注入**而不是写进历史 —— 否则每条后续消息都要重发几千 token

### 阶段 4:Translation

- **解决**:外文网页阅读
- **改了什么**:独立翻译引擎,只改文本节点、逐字记录原文
- **为什么这样设计**:重建 `body` 会破坏页面事件与 React 类站点;逐字记录才能**不依赖 API** 还原

### 阶段 5:Resource Inspector

- **解决**:看不清页面里有什么资源
- **改了什么**:拆出第二个页面,四类资源 + 打开/复制
- **为什么这样设计**:资源清单属于「查看」而非「对话」,混在聊天里会互相打断

### 阶段 6:WebPatch

- **解决**:只能读不能改
- **改了什么**:结构化动作体系(现 24 种)、`el_N` 编号、撤销/恢复
- **为什么这样设计**:见 7.5 / 7.6 —— **可撤销、可校验、可解释**,且不需要高危权限

### 阶段 7:Deep Analysis / Media

- **解决**:AI 不知道页面上有哪些媒体、点哪里
- **改了什么**:媒体完整状态、iframe / Shadow DOM、8 个媒体动作、跨 frame 汇总
- **为什么这样设计**:很多站点的播放器在 iframe 里,只改顶层文档会「看起来成功但没生效」

### 阶段 8:Permission

- **解决**:改网页能力变强后需要边界
- **改了什么**:两级权限 + 后台独立校验 + 审计日志
- **为什么这样设计**:权限等级对应**风险等级**,不是功能多少;
  结构化修改属基础权限,执行任意代码 / 跨 Tab 才需要升级

### 阶段 9:Multi-Key

- **解决**:单 Key 限流就中断
- **改了什么**:Key 池、启用/停用、顺序轮询、失败切换、按 Provider 分池
- **为什么按 Provider 分池**:跨服务商顶替 Key 必然鉴权失败,还会掩盖真正的问题

### 阶段 10:Tab / Persistence

- **解决**:① 切 Tab 会操作错网页 ② 刷新后修改全丢
- **改了什么**:`utils/targets.js`、后台 `guardTarget()`、Tab 生命周期监听、按 URL 重放修改计划
- **为什么这样设计**:
  - 目标解析放在**后台统一做**,而不是每个调用点自己查 —— 这样不会有漏网的路径
  - 恢复只存**动作**不存 DOM —— 存 DOM 会随页面变化立刻过期,还会无限膨胀

### 阶段 11:Finalization

- **解决**:文档严重落后于代码;资源页图片看不清
- **改了什么**:重写本文档(以代码为准)、图片资源增加缩略图
- **为什么**:交接文档的价值在于**准确**;一个说「尚未实现」的文档比没有文档更糟

---

## 19. 当前最终状态

### 核心功能开发已经结束

聊天 · 网页上下文 · 翻译 · 资源 · 网页修改 · 媒体控制 · 权限 · 多 Key · 多 Tab 目标 ·
刷新恢复 · 解除复制限制 · 使用者语言 · 视觉上下文 · 文件输入
—— 全部完成并有测试覆盖(29 个套件 / 1302 项断言 / 0 失败)。

### 后续原则

**只做**:

- ✅ Bug Fix
- ✅ 性能优化
- ✅ 兼容性修复(新版本浏览器、新站点行为)
- ✅ 安全修复
- ✅ 发布维护(版本号、图标、商店文案)

**不再做**:

- ❌ 继续堆新功能
- ❌ 架构重构
- ❌ 引入框架 / 构建链

### 什么时候可以例外

只有在**修 Bug 需要**、或**浏览器 API 发生破坏性变更**时,才动架构,
并且必须:先跑通全部 26 个测试 → 改 → 再跑一遍确认没有回归。

---

## 20. 下一阶段:网页版(仅规划,本轮不实现)

> **网页版属于下一轮独立项目 / 开发阶段,本轮不实现、不写代码。**
> 下面只说明「如果要做,哪些东西必须重新设计」。

### 为什么不能把扩展直接搬过去

扩展版的很多能力建立在**浏览器扩展特权**上,网页版天生没有:

| 扩展版能力 | 网页版为什么做不到 |
|---|---|
| 读任意网页的 DOM | 跨域限制,网页版只能读自己域名下的页面 |
| 修改任意网页 | 同源策略,不能碰别的站点 |
| 多 Tab 独立目标 | 网页版只能操作自己这一个标签页 |
| `chrome.scripting` 注入主世界 | 没有这个 API |
| `chrome.downloads` | 没有 |
| `chrome.storage` | 没有 |

### 需要重新设计的部分

1. **前端**:可以自由选框架(React/Vue),因为不再受「浏览器直接加载源文件」约束
2. **后端**:必须有(否则 API Key 暴露在前端)
3. **API Key 安全**:
   - 扩展版:Key 存在用户本地,请求从用户浏览器直发服务商
   - 网页版:若沿用直连,Key 在前端内存/浏览器存储里,风险更高;
     若走服务端代理,则变成「平台代付/代管 Key」—— 这是完全不同的产品与成本模型
4. **用户数据**:需要账号体系、数据归属、隐私政策、删除机制
5. **浏览器网页权限**:
   - 只能操作自己站点内的页面
   - 想操作别的网站,唯一合规路径是让用户**装扩展**或**粘贴内容**
6. **网页修改能力**:退化为「对**本应用自己的页面**做修改」,或对用户粘贴的 HTML 做处理
7. **多 Tab 能力**:网页版只能管自己;跨标签页需要 `BroadcastChannel` 且限同源
8. **与扩展版的区别**:
   - 扩展版 = 能动手改**别人的**网页(特权)
   - 网页版 = 只能处理**自己的**页面与用户主动给的内容(无特权)

### 本轮明确不做

网页版的前端、后端、账号、数据库、部署 —— 全部留到下一轮独立立项。

---

*文档结束。如需确认任何一条,请直接打开对应源文件核对 —— 本文档以代码为准。*

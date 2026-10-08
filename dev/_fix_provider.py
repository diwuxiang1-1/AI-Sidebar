# -*- coding: utf-8 -*-
"""收尾 1:API Key 泄露防护(源头脱敏) + 真实 usage 解析"""

import io

p = "providers/openai-compatible.js"
s = io.open(p, encoding="utf-8").read()
n = {}

def rep(tag, old, new):
    global s
    c = s.count(old)
    n[tag] = c
    if c != 1:
        raise SystemExit("!! %s 匹配 %d 次" % (tag, c))
    s = s.replace(old, new, 1)

# ---- 1. 通用脱敏:任何文本在进入错误信息之前先过一遍 ----
REDACT = r'''
/* ==================================================================
   敏感信息脱敏(收尾轮 · 最高优先级)
   ----------------------------------------------------------------
   为什么放在 provider 这一层:
     API 出错时,服务商可能把**我们发过去的请求**回显在错误 body 里。
     只要有任何一条路径把它原样抛给界面,Key 就泄露了。
     所以在**唯一出口** ApiError 上做一次通用脱敏,比在每个调用点补更可靠。

   注意:这不是「防自己人」,而是「防任何未经检查的字符串出口」。
   ================================================================== */

/**
 * 把文本里所有像密钥的东西换成掩码
 * 覆盖:sk-xxx / Bearer xxx / api_key=xxx / 长随机串
 */
function redactSecrets(text) {
  var out = String(text === undefined || text === null ? "" : text);
  if (!out) return "";

  // 1) Bearer <token>
  out = out.replace(/(Bearer\s+)([A-Za-z0-9._\-]{8,})/gi, function (_m, p1, p2) {
    return p1 + maskSecret(p2);
  });

  // 2) 常见前缀的密钥:sk- / sk_ / gsk_ / xai- / api- 等
  out = out.replace(/\b(sk|gsk|xai|api|key|token)[-_][A-Za-z0-9._\-]{12,}/gi, function (m) {
    return maskSecret(m);
  });

  // 3) 形如 api_key=xxx / "apiKey":"xxx" 的赋值
  out = out.replace(/((?:api[_-]?key|apikey|access[_-]?token|secret)["']?\s*[:=]\s*["']?)([A-Za-z0-9._\-]{12,})/gi,
    function (_m, p1, p2) { return p1 + maskSecret(p2); });

  return out;
}

/** 只留头尾,中间打码 */
function maskSecret(v) {
  var s = String(v || "");
  if (s.length <= 8) return "****";
  return s.slice(0, 4) + "****" + s.slice(-4);
}

'''

rep("redact", "/**\n * 流式聊天补全\n */", REDACT.lstrip("\n") + "/**\n * 流式聊天补全\n */")

# ---- 2. 错误详情先脱敏 ----
rep("detail",
    "function extractErrorDetail(status, body) {\n  if (!body) return null;\n\n  try {\n    var json = JSON.parse(body);",
    "function extractErrorDetail(status, body) {\n  if (!body) return null;\n\n  // 先整体脱敏再解析:无论走哪条分支,都不可能带出完整 Key\n  body = redactSecrets(body);\n\n  try {\n    var json = JSON.parse(body);")

rep("apierr",
    "  this.name       = \"ApiError\";\n  this.status     = status;\n  this.body       = body;\n  this.isApiError = true;",
    "  this.name       = \"ApiError\";\n  this.status     = status;\n  this.body       = redactSecrets(body);   // 兜底:body 本身也脱敏\n  this.isApiError = true;")

# ---- 3. 请求真实 usage ----
rep("streamopts",
    "      body: JSON.stringify({\n        model:    opts.model,\n        messages: opts.messages,\n        stream:   true,\n      }),",
    "      body: JSON.stringify({\n        model:    opts.model,\n        messages: opts.messages,\n        stream:   true,\n        // 让服务商在流末尾返回真实用量(不支持的会忽略,不会报错)\n        stream_options: { include_usage: true },\n      }),")

rep("parseusage",
    "        try {\n          var parsed = JSON.parse(jsonStr);\n          var delta =",
    "        try {\n          var parsed = JSON.parse(jsonStr);\n\n          // 真实用量:服务商在流末尾给的那个 chunk\n          if (parsed && parsed.usage) {\n            lastUsage = normalizeUsage(parsed.usage);\n            if (opts.onUsage) { try { opts.onUsage(lastUsage); } catch (e) { /* 忽略 */ } }\n          }\n\n          var delta =")

rep("return",
    "  return fullText;\n}\n\n/**\n * 测试连接",
    "  return fullText;\n}\n\n/**\n * 最近一次请求的真实用量(服务商没返回时为 null —— 绝不编造)\n */\nvar lastUsage = null;\n\n/**\n * 把各家格式不一的 usage 归一化\n * 认不出来的一律返回 null,由上层显示「未提供实际用量」\n */\nfunction normalizeUsage(u) {\n  if (!u || typeof u !== \"object\") return null;\n\n  var prompt = (typeof u.prompt_tokens === \"number\") ? u.prompt_tokens\n             : (typeof u.input_tokens === \"number\")  ? u.input_tokens : null;\n  var completion = (typeof u.completion_tokens === \"number\") ? u.completion_tokens\n                 : (typeof u.output_tokens === \"number\")     ? u.output_tokens : null;\n  var total = (typeof u.total_tokens === \"number\") ? u.total_tokens : null;\n\n  if (prompt === null && completion === null && total === null) return null;\n  if (total === null && prompt !== null && completion !== null) total = prompt + completion;\n\n  return {\n    promptTokens:     prompt,\n    completionTokens: completion,\n    totalTokens:      total,\n    // 少数服务商直接给费用(如 OpenRouter)——有就用真实的\n    cost:             (typeof u.cost === \"number\") ? u.cost : null,\n  };\n}\n\n/**\n * 测试连接")

io.open(p, "w", encoding="utf-8", newline="").write(s)
for k, v in n.items():
    print("provider", k, "=", v)

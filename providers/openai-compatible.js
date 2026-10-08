// ============================================================
// AI Sidebar · OpenAI Compatible Provider(第五阶段维护)
// ------------------------------------------------------------
// 改进:错误消息携带 API 返回的具体原因 + 获取模型列表
// ============================================================

"use strict";

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

/**
 * 流式聊天补全
 */
async function chatCompletionStream(opts) {
  var baseUrl = opts.baseUrl.replace(/\/+$/, "");
  var url     = baseUrl + "/chat/completions";

  var response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + opts.apiKey,
      },
      body: JSON.stringify({
        model:    opts.model,
        messages: opts.messages,
        stream:   true,
        // 让服务商在流末尾返回真实用量(不支持的会忽略,不会报错)
        stream_options: { include_usage: true },
      }),
      signal: opts.signal,
    });
  } catch (e) {
    throw new ApiError(0, "", "网络不可达 —— 请检查 Base URL 或网络连接");
  }

  if (!response.ok) {
    var errorBody = "";
    try { errorBody = await response.text(); } catch (e) { /* ignore */ }
    throw new ApiError(response.status, errorBody);
  }

  var reader   = response.body.getReader();
  var decoder  = new TextDecoder();
  var buffer   = "";
  var fullText = "";

  try {
    while (true) {
      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.indexOf("data: ") !== 0) continue;

        var jsonStr = line.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          var parsed = JSON.parse(jsonStr);

          // 真实用量:服务商在流末尾给的那个 chunk
          if (parsed && parsed.usage) {
            lastUsage = normalizeUsage(parsed.usage);
            if (opts.onUsage) { try { opts.onUsage(lastUsage); } catch (e) { /* 忽略 */ } }
          }

          var delta =
            parsed.choices &&
            parsed.choices[0] &&
            parsed.choices[0].delta &&
            parsed.choices[0].delta.content;

          if (delta) {
            fullText += delta;
            if (opts.onToken) opts.onToken(delta, fullText);
          }
        } catch (e) {
          // SSE 行解析失败,跳过
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "", "流式读取中断: " + (e.message || "未知"));
  }

  return fullText;
}

/**
 * 最近一次请求的真实用量(服务商没返回时为 null —— 绝不编造)
 */
var lastUsage = null;

/**
 * 把各家格式不一的 usage 归一化
 * 认不出来的一律返回 null,由上层显示「未提供实际用量」
 */
function normalizeUsage(u) {
  if (!u || typeof u !== "object") return null;

  var prompt = (typeof u.prompt_tokens === "number") ? u.prompt_tokens
             : (typeof u.input_tokens === "number")  ? u.input_tokens : null;
  var completion = (typeof u.completion_tokens === "number") ? u.completion_tokens
                 : (typeof u.output_tokens === "number")     ? u.output_tokens : null;
  var total = (typeof u.total_tokens === "number") ? u.total_tokens : null;

  if (prompt === null && completion === null && total === null) return null;
  if (total === null && prompt !== null && completion !== null) total = prompt + completion;

  return {
    promptTokens:     prompt,
    completionTokens: completion,
    totalTokens:      total,
    // 少数服务商直接给费用(如 OpenRouter)——有就用真实的
    cost:             (typeof u.cost === "number") ? u.cost : null,
  };
}

/**
 * 测试连接 —— 验证 API 可达且 Key 有效
 */
async function testConnection(opts) {
  var baseUrl = opts.baseUrl.replace(/\/+$/, "");
  var url     = baseUrl + "/chat/completions";

  var response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + opts.apiKey,
      },
      body: JSON.stringify({
        model:      opts.model,
        messages:   [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream:     false,
      }),
    });
  } catch (e) {
    throw new ApiError(0, "", "网络不可达 —— 请检查 Base URL 或网络连接");
  }

  if (!response.ok) {
    var errorBody = "";
    try { errorBody = await response.text(); } catch (e) { /* ignore */ }
    throw new ApiError(response.status, errorBody);
  }

  return true;
}

/**
 * 获取模型列表 —— GET {baseUrl}/models
 * 返回 [{ id, name }] 供下拉框使用
 */
async function fetchModels(opts) {
  var baseUrl = opts.baseUrl.replace(/\/+$/, "");
  var url     = baseUrl + "/models";

  var response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + opts.apiKey,
      },
    });
  } catch (e) {
    throw new ApiError(0, "", "无法获取模型列表 —— 请检查网络或该服务是否提供 /models 端点");
  }

  if (!response.ok) {
    var errorBody = "";
    try { errorBody = await response.text(); } catch (e) { /* ignore */ }
    throw new ApiError(response.status, errorBody);
  }

  var json;
  try { json = await response.json(); } catch (e) {
    throw new ApiError(0, "", "模型列表返回格式异常");
  }

  // 兼容多种返回格式
  var list = null;
  if (json.data && Array.isArray(json.data)) {
    list = json.data;  // OpenAI / SiliconFlow 格式
  } else if (json.models && Array.isArray(json.models)) {
    list = json.models;
  } else if (Array.isArray(json)) {
    list = json;
  }

  if (!list || list.length === 0) {
    throw new ApiError(0, "", "该服务没有返回可用模型列表");
  }

  return list.map(function (item) {
    return {
      id:   item.id   || item.name  || item.model || "",
      name: item.name || item.id    || item.model || "",
    };
  }).filter(function (m) { return m.id; });
}

/**
 * 从 API 错误响应中提取具体原因,并隐藏敏感信息
 */
function extractErrorDetail(status, body) {
  if (!body) return null;

  // 先整体脱敏再解析:无论走哪条分支,都不可能带出完整 Key
  body = redactSecrets(body);

  try {
    var json = JSON.parse(body);

    // 常见格式: { error: { message: "..." } }
    if (json.error) {
      if (typeof json.error === "string") return json.error;
      if (json.error.message) return json.error.message;
      if (json.error.code) return "code: " + json.error.code;
    }

    // { detail: "..." }
    if (json.detail) return json.detail;

    // { message: "..." }
    if (json.message) return json.message;

    return null;
  } catch (e) {
    // 纯文本 body —— 截取前 200 字符
    var text = body.trim();
    if (text.length > 200) text = text.slice(0, 200) + "…";
    return text || null;
  }
}

/**
 * API 错误对象(改进版)
 */
function ApiError(status, body, overrideMsg) {
  this.name       = "ApiError";
  this.status     = status;
  this.body       = redactSecrets(body);   // 兜底:body 本身也脱敏
  this.isApiError = true;

  if (overrideMsg) {
    this.message = overrideMsg;
    return;
  }

  var detail = extractErrorDetail(status, body);

  if (status === 401 || status === 403) {
    this.message = "API Key 无效或没有权限" + (detail ? " — " + detail : "");
  } else if (status === 429) {
    this.message = "API 请求频率或额度受限" + (detail ? " — " + detail : "");
  } else if (status === 0) {
    this.message = body || "网络请求失败";
  } else {
    this.message = "HTTP " + status + (detail ? " — " + detail : " (无详细信息)");
  }
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;
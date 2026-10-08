# -*- coding: utf-8 -*-
"""完整版 5e:模型不认图片时自动退回纯文本重试一次(只改 doSend,按位置取第一处)"""

import io

p = "sidebar/sidebar.js"
s = io.open(p, encoding="utf-8").read()

OLD = '''  } catch (err) {
    handleStreamError(err);
    await saveActiveSession(messages, sessionName);
  } finally {
    stopGenerating();
    abortController = null;
    refreshEstimate();   // 第七阶段:回复结束后刷新预估
  }
}'''

NEW = '''  } catch (err) {
    // 完整版:模型其实不吃图片 → 去掉截图重试一次,不让整轮对话失败
    if (lastShot && isImageRejectedError(err) && !isAbortError(err)) {
      var strippedMsg = stripImageFromLastUser(apiMessages);

      if (strippedMsg) {
        appendMessage("system", "【视觉上下文】当前模型似乎不接受图片输入,已自动改用文字上下文重试。");
        try {
          var retryText = await callModel({
            baseUrl:  config.baseUrl,
            model:    config.model,
            messages: strippedMsg,
            signal:   abortController ? abortController.signal : undefined,
            onToken:  function (_d, currentFullText) {
              if (activeAiBubble) { activeAiBubble.textContent = currentFullText; scrollToBottom(); }
            },
          });
          messages.push({ role: "assistant", content: retryText });
          addRegenerateRow();
          await saveActiveSession(messages, sessionName);
          return;
        } catch (retryErr) {
          err = retryErr;   // 重试也失败 → 走原来的错误处理
        }
      }
    }

    handleStreamError(err);
    await saveActiveSession(messages, sessionName);
  } finally {
    stopGenerating();
    abortController = null;
    refreshEstimate();   // 第七阶段:回复结束后刷新预估
  }
}

/** 用户主动停止(不算错误,也不该重试) */
function isAbortError(err) {
  return !!(err && (err.name === "AbortError" || err.aborted));
}

/**
 * 去掉最后一条用户消息里的图片,只留文字
 * 用于「模型不支持图片」时重试;找不到图片则返回 null
 */
function stripImageFromLastUser(apiMessages) {
  var out = apiMessages.slice();

  for (var i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user" || !Array.isArray(out[i].content)) continue;

    var textParts = out[i].content.filter(function (p) { return p && p.type === "text"; });
    out[i] = {
      role:    "user",
      content: textParts.length ? textParts.map(function (p) { return p.text; }).join("\\n") : "",
    };
    return out;
  }
  return null;
}'''

c = s.count(OLD)
print("catch 候选 =", c)
assert c >= 1, "catch 锚点"

# doSend 在文件里靠前,取第一处
idx = s.index(OLD)
s = s[:idx] + NEW + s[idx + len(OLD):]

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("图片兜底已加入(第一处 = doSend)")

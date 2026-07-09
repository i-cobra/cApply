/**
 * Runs in the page (MAIN) world.
 * - Hooks fetch to capture ChatGPT conversation SSE (works in background tabs)
 * - Injects prompt + sends without focus() so the user's tab stays put
 */
(function () {
  if (window.__cApplyChatGPTInjectLoaded) return;
  window.__cApplyChatGPTInjectLoaded = true;

  const EDITOR_SELECTORS = [
    "#prompt-textarea",
    "div#prompt-textarea",
    "textarea#prompt-textarea",
    'div#prompt-textarea[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][id="prompt-textarea"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-placeholder]',
    "footer div[contenteditable='true']",
    "form div[contenteditable='true']",
    'div[contenteditable="true"]',
  ];

  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid="composer-submit-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'form button[type="submit"]',
  ];

  /** @type {{ text: string, done: boolean, error: string | null, started: boolean }} */
  window.__cApplyStreamCapture = {
    text: "",
    done: false,
    error: null,
    started: false,
  };

  let streamCaptureGeneration = 0;

  function resetStreamCapture() {
    streamCaptureGeneration += 1;
    window.__cApplyStreamCapture = {
      text: "",
      done: false,
      error: null,
      started: false,
      generation: streamCaptureGeneration,
    };
    notifyStreamWaiters();
  }

  /** @type {Array<(result: { text?: string, error?: string }) => void>} */
  window.__cApplyStreamWaiters = window.__cApplyStreamWaiters || [];

  function notifyStreamWaiters() {
    const cap = window.__cApplyStreamCapture || {};
    if (!cap.done) return;

    const waiters = window.__cApplyStreamWaiters.splice(0);
    for (const resolve of waiters) {
      resolve({
        text: cap.text || "",
        error: cap.error || undefined,
      });
    }
  }

  /** @type {HTMLAudioElement | null} */
  let keepaliveAudio = null;

  window.__cApplyStartKeepalive = function () {
    if (keepaliveAudio) return;
    try {
      keepaliveAudio = new Audio();
      keepaliveAudio.loop = true;
      keepaliveAudio.volume = 0.001;
      keepaliveAudio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      keepaliveAudio.play().catch(() => {});
    } catch {
      // ignore
    }
  };

  window.__cApplyStopKeepalive = function () {
    if (!keepaliveAudio) return;
    try {
      keepaliveAudio.pause();
      keepaliveAudio.src = "";
    } catch {
      // ignore
    }
    keepaliveAudio = null;
  };

  function spoofPageVisibility() {
    try {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    } catch {
      // ignore
    }
  }

  function isPresent(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isUsableElement(el) {
    return Boolean(el && el.isConnected);
  }

  function findEditor() {
    spoofPageVisibility();
    for (const sel of EDITOR_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (!isUsableElement(el)) continue;
        if (el.tagName === "TEXTAREA") return el;
        if (el.isContentEditable || el.getAttribute("contenteditable") !== "false") {
          return el;
        }
      }
    }
    return null;
  }

  function findSendButton() {
    spoofPageVisibility();
    for (const sel of SEND_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      for (const btn of nodes) {
        if (btn.disabled) continue;
        if (isUsableElement(btn)) return btn;
      }
    }
    return null;
  }

  function getEditorText(editor) {
    if (!editor) return "";
    if (editor.tagName === "TEXTAREA") return editor.value || "";
    return editor.innerText?.trim() || editor.textContent?.trim() || "";
  }

  function setTextareaValue(editor, text) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(editor, text);
    } else {
      editor.value = text;
    }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillContentEditable(editor, text) {
    try {
      editor.focus({ preventScroll: true });
    } catch {
      // ignore
    }

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (document.execCommand("insertText", false, text)) {
        editor.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" })
        );
        if (getEditorText(editor).length >= Math.min(text.length, 32)) return;
      }
    } catch {
      // fallback below
    }

    editor.innerHTML = "";
    for (const line of text.split("\n")) {
      const p = document.createElement("p");
      p.textContent = line || "\u200B";
      editor.appendChild(p);
    }
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })
    );
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
      })
    );
  }

  function fillEditor(editor, text) {
    if (editor.tagName === "TEXTAREA") {
      setTextareaValue(editor, text);
      return;
    }
    fillContentEditable(editor, text);
  }

  function clickSend(sendBtn) {
    sendBtn.click();
  }

  function submitComposer(editor) {
    const sendBtn = findSendButton();
    if (sendBtn) {
      clickSend(sendBtn);
      return { ok: true, method: "button" };
    }

    const form = editor.closest("form");
    if (form) {
      form.requestSubmit();
      return { ok: true, method: "form" };
    }

    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      })
    );
    return { ok: false, method: "enter" };
  }

  window.__cApplyComposerReady = function (minLength = 20) {
    spoofPageVisibility();
    const editor = findEditor();
    if (!editor) {
      return { ready: false, error: "Composer not found on page." };
    }

    const textLength = getEditorText(editor).length;
    const sendBtn = findSendButton();

    return {
      ready: textLength >= minLength && Boolean(sendBtn),
      textLength,
      hasSend: Boolean(sendBtn),
    };
  };

  /** @type {Record<string, string>} */
  window.__cApplyCapturedHeaders = window.__cApplyCapturedHeaders || {};

  function captureHeaders(headers) {
    if (!headers) return;
    const h = headers instanceof Headers ? headers : new Headers(headers);
    const names = [
      "openai-sentinel-chat-requirements-token",
      "openai-sentinel-proof-token",
      "openai-sentinel-turnstile-token",
      "x-conduit-token",
      "oai-device-id",
      "oai-client-version",
      "chatgpt-account-id",
    ];
    for (const name of names) {
      const value = h.get(name);
      if (value) window.__cApplyCapturedHeaders[name] = value;
    }
  }

  function isConversationUrl(url) {
    return (
      url.includes("/backend-api/conversation") ||
      url.includes("/backend-anon/f/conversation") ||
      url.includes("/f/conversation")
    );
  }

  /**
   * @param {unknown} parsed
   * @returns {string}
   */
  function extractStreamChunk(parsed) {
    if (!parsed || typeof parsed !== "object") return "";

    const record = /** @type {Record<string, unknown>} */ (parsed);

    if (typeof record.v === "string") return record.v;

    const v = record.v;
    if (v && typeof v === "object") {
      const vRecord = /** @type {Record<string, unknown>} */ (v);
      const message = vRecord.message;
      if (message && typeof message === "object") {
        const parts = /** @type {{ content?: { parts?: unknown[] } }} */ (message)
          .content?.parts;
        if (Array.isArray(parts)) {
          return parts.filter((p) => typeof p === "string").join("");
        }
      }
    }

    const message = record.message;
    if (message && typeof message === "object") {
      const parts = /** @type {{ content?: { parts?: unknown[] } }} */ (message)
        .content?.parts;
      if (Array.isArray(parts)) {
        return parts.filter((p) => typeof p === "string").join("");
      }
    }

    return "";
  }

  function isRecoverableStreamError(err) {
    const message = err?.message || String(err || "");
    return (
      err?.name === "AbortError" ||
      /abort/i.test(message) ||
      /BodyStreamBuffer/i.test(message) ||
      /cancel/i.test(message)
    );
  }

  function markStreamCaptureDone(text = "", error = null, generation = null) {
    const cap = window.__cApplyStreamCapture || {};
    if (generation != null && cap.generation !== generation) return;
    cap.text = text || cap.text || "";
    cap.error = error;
    cap.done = true;
    cap.started = true;
    notifyStreamWaiters();
  }

  /**
   * @param {Response} response
   * @param {number} generation
   */
  async function consumeConversationStream(response, generation) {
    if (!response.body) {
      throw new Error("Empty response body from ChatGPT.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const chunk = extractStreamChunk(parsed);
            if (chunk) {
              const cap = window.__cApplyStreamCapture;
              if (!cap || cap.generation !== generation) return fullText.trim();
              fullText += chunk;
              cap.text = fullText;
              cap.started = true;
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      return fullText.trim();
    } catch (err) {
      const partial = fullText.trim();
      if (partial) return partial;
      if (isRecoverableStreamError(err)) return "";
      throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  function installFetchHook() {
    if (window.__cApplyFetchHooked) return;
    window.__cApplyFetchHooked = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      let [request, init] = args;
      const url =
        typeof request === "string"
          ? request
          : request instanceof Request
            ? request.url
            : String(request);

      const method = String(
        init?.method || (request instanceof Request ? request.method : "GET")
      ).toUpperCase();

      if (
        method === "POST" &&
        isConversationUrl(url) &&
        window.__cApplyActiveChatModelConfig &&
        init?.body &&
        typeof init.body === "string"
      ) {
        try {
          const body = JSON.parse(init.body);
          const cfg = window.__cApplyActiveChatModelConfig;
          if (cfg.conversationModel) body.model = cfg.conversationModel;
          if (cfg.reasoningEffort) {
            body.reasoning = { effort: cfg.reasoningEffort };
            body.reasoning_effort = cfg.reasoningEffort;
          }
          init = { ...init, body: JSON.stringify(body) };
        } catch {
          // keep original body
        }
      }

      if (init?.headers) captureHeaders(init.headers);
      if (request instanceof Request) captureHeaders(request.headers);

      const response = await originalFetch(request, init);

      if (isConversationUrl(url) && response.ok) {
        const generation = window.__cApplyStreamCapture?.generation ?? streamCaptureGeneration;
        window.__cApplyStreamCapture.started = true;
        const clone = response.clone();
        consumeConversationStream(clone, generation)
          .then((text) => {
            markStreamCaptureDone(
              text?.trim() || window.__cApplyStreamCapture.text || "",
              null,
              generation
            );
          })
          .catch((err) => {
            const cap = window.__cApplyStreamCapture || {};
            if (cap.generation !== generation) return;
            const partial = cap.text?.trim() || "";
            if (partial) {
              markStreamCaptureDone(partial, null, generation);
              return;
            }
            if (isRecoverableStreamError(err)) {
              markStreamCaptureDone("", null, generation);
              return;
            }
            markStreamCaptureDone("", err.message || String(err), generation);
          });
      }

      return response;
    };

    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__cApplyUrl = String(url);
      this.__cApplyRequestHeaders = {};
      return xhrOpen.call(this, method, url, ...rest);
    };

    const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__cApplyRequestHeaders) {
        this.__cApplyRequestHeaders[name.toLowerCase()] = value;
      }
      captureHeaders(new Headers(this.__cApplyRequestHeaders || {}));
      return xhrSetHeader.call(this, name, value);
    };

    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      const url = this.__cApplyUrl || "";
      if (isConversationUrl(url)) {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") {
              const text = String(this.responseText || "").trim();
              if (text) {
                window.__cApplyStreamCapture.text = text;
                window.__cApplyStreamCapture.done = true;
                window.__cApplyStreamCapture.started = true;
              }
            }
          } catch {
            // ignore
          }
        });
      }
      return xhrSend.apply(this, args);
    };
  }

  installFetchHook();

  function isGenerating() {
    const cap = window.__cApplyStreamCapture;
    if (cap?.started && !cap?.done && !cap?.error) return true;

    const stopBtn = document.querySelector('[data-testid="stop-button"]');
    if (stopBtn && isPresent(stopBtn) && !stopBtn.disabled) return true;

    for (const btn of document.querySelectorAll('button[aria-label*="Stop"]')) {
      if (isPresent(btn) && !btn.disabled) return true;
    }

    return false;
  }

  function countAssistantMessages() {
    return document.querySelectorAll('[data-message-author-role="assistant"]').length;
  }

  function getAssistantResponseText(assistantCountBefore) {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (msgs.length <= assistantCountBefore) return "";

    const msg = msgs[msgs.length - 1];
    if (!msg) return "";

    /** @type {string[]} */
    const candidates = [];

    const addCandidate = (value) => {
      const trimmed = value?.trim();
      if (trimmed && trimmed.includes("{")) candidates.push(trimmed);
    };

    for (const el of msg.querySelectorAll("pre code, pre, code")) {
      addCandidate(el.textContent);
    }

    const fullText = msg.innerText?.trim() || msg.textContent?.trim() || "";

    let best = "";
    let bestScore = 0;
    /** @type {string[]} */
    const resumeCandidates = [];
    for (const text of candidates) {
      const isResume =
        text.includes('"tailoredResume"') ||
        text.includes('"resume"') ||
        text.includes('"contact"');
      if (!isResume) continue;

      resumeCandidates.push(text);
      const score = (text.includes('"atsScore"') ? 1_000_000 : 0) + text.length;
      if (score > bestScore) {
        bestScore = score;
        best = text;
      }
    }

    const withAts = resumeCandidates.filter((text) => text.includes('"atsScore"'));
    if (withAts.length) return withAts[withAts.length - 1];

    if (best.includes('"atsScore"')) return best;

    if (
      fullText.includes('"tailoredResume"') &&
      fullText.includes('"atsScore"')
    ) {
      const jsonStart = fullText.lastIndexOf("{");
      if (jsonStart >= 0) return fullText.slice(jsonStart);
    }

    if (best) return best;
    if (candidates.length) return candidates[candidates.length - 1];

    return fullText;
  }

  window.__cApplyResetStreamCapture = resetStreamCapture;

  window.__cApplyHasComposer = function () {
    return Boolean(findEditor());
  };

  window.__cApplyPollStreamCapture = function () {
    const cap = window.__cApplyStreamCapture || {};
    const text = cap.text || "";
    return {
      done: Boolean(cap.done),
      started: Boolean(cap.started),
      error: cap.error || null,
      text,
      hasJson: text.includes("{"),
      generating: isGenerating(),
    };
  };

  /**
   * @param {string} prompt
   * @param {boolean} autoSend
   */
  window.__cApplySubmitComposer = function () {
    try {
      spoofPageVisibility();

      const editor = findEditor();
      if (!editor) {
        return { ok: false, error: "Composer not found on page." };
      }

      const assistantCountBefore = countAssistantMessages();
      const submitted = submitComposer(editor);

      if (!submitted.ok && !findSendButton()) {
        return { ok: false, error: "Send button not found." };
      }

      return { ok: true, sent: true, assistantCountBefore };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };

  window.__cApplyRunInjectSync = function (prompt, autoSend) {
    try {
      spoofPageVisibility();
      if (autoSend) resetStreamCapture();

      const editor = findEditor();
      if (!editor) {
        return { ok: false, error: "Composer not found on page." };
      }

      fillEditor(editor, prompt);

      if (!autoSend) {
        return { ok: true, sent: false };
      }

      const assistantCountBefore = countAssistantMessages();
      const submitted = submitComposer(editor);

      if (!submitted.ok && !findSendButton()) {
        return { ok: false, error: "Send button not found. Open a ChatGPT chat first." };
      }

      return {
        ok: true,
        sent: true,
        assistantCountBefore,
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };

  /**
   * @param {number} assistantCountBefore
   */
  window.__cApplyPollChatGPTResponse = function (assistantCountBefore) {
    spoofPageVisibility();

    const stream = window.__cApplyPollStreamCapture();
    const domText = getAssistantResponseText(assistantCountBefore);
    const generating = stream.generating || isGenerating();

    const messageCount = countAssistantMessages();
    const hasNewMessage = messageCount > assistantCountBefore;

    if (stream.text) {
      return {
        generating,
        hasNew: hasNewMessage,
        textLength: stream.text.length,
        text: stream.text,
        domText,
        hasJson: stream.text.includes("{") || domText.includes("{"),
        fromStream: true,
        messageCount,
      };
    }

    if (stream.error) {
      return { error: stream.error, domText, generating };
    }

    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    const latestAssistant = hasNewMessage ? msgs[msgs.length - 1] : null;
    const textLength =
      latestAssistant?.innerText?.length || latestAssistant?.textContent?.length || 0;

    return {
      generating,
      hasNew: hasNewMessage,
      textLength,
      text: domText,
      domText,
      hasJson: domText.includes("{"),
      fromStream: false,
      messageCount,
    };
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeModelLabel(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function modelLabelMatches(optionText, targetLabel) {
    const option = normalizeModelLabel(optionText);
    const target = normalizeModelLabel(targetLabel);
    if (!target) return false;
    if (option === target) return true;
    if (target === "instant" && /\binstant\b/.test(option)) return true;
    if (target === "high" && /\bhigh\b/.test(option) && !/extra\s*high/.test(option)) {
      return true;
    }
    return option.includes(target);
  }

  function readCurrentModelLabel() {
    const switcher = document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    const text = switcher?.textContent?.trim();
    if (text && text.length < 80) return text;
    return "";
  }

  window.__cApplySetActiveChatModelConfig = function (config) {
    window.__cApplyActiveChatModelConfig = config || null;
  };

  window.__cApplySelectChatModel = async function (label) {
    spoofPageVisibility();
    const target = String(label || "").trim();
    if (!target) return { ok: true, skipped: true };

    const current = readCurrentModelLabel();
    if (modelLabelMatches(current, target)) {
      return { ok: true, alreadySelected: true, current };
    }

    const switcher = document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    if (!switcher) {
      return { ok: false, error: "ChatGPT model switcher not found." };
    }

    switcher.click();
    await sleep(350);

    const wrappers = document.querySelectorAll("[data-radix-popper-content-wrapper]");
    const menu = wrappers[wrappers.length - 1] || document.body;
    const options = menu.querySelectorAll(
      '[role="menuitem"], [role="menuitemradio"], [role="option"], button'
    );

    for (const opt of options) {
      const text = opt.textContent?.trim() || "";
      if (!text || text.length > 80) continue;
      if (modelLabelMatches(text, target)) {
        opt.click();
        await sleep(250);
        return { ok: true, selected: text, current: readCurrentModelLabel() };
      }
    }

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    return { ok: false, error: `Model "${target}" was not found in the ChatGPT model menu.` };
  };

  async function getChatGPTSession() {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    return response.json();
  }

  function buildConversationBody(prompt) {
    const pathMatch = location.pathname.match(/\/c\/([0-9a-f-]+)/i);
    const cfg = window.__cApplyActiveChatModelConfig;
    /** @type {Record<string, unknown>} */
    const body = {
      action: "next",
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: "user" },
          content: { content_type: "text", parts: [prompt] },
          metadata: {},
        },
      ],
      conversation_id: pathMatch?.[1] || crypto.randomUUID(),
      parent_message_id: crypto.randomUUID(),
      model: cfg?.conversationModel || "auto",
      timezone_offset_min: new Date().getTimezoneOffset(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      history_and_training_disabled: false,
      conversation_mode: { kind: "primary_assistant" },
    };

    if (cfg?.reasoningEffort) {
      body.reasoning = { effort: cfg.reasoningEffort };
      body.reasoning_effort = cfg.reasoningEffort;
    }

    return body;
  }

  function buildApiHeaders(accessToken, session) {
    /** @type {Record<string, string>} */
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...window.__cApplyCapturedHeaders,
    };

    const accountId =
      session?.account?.id ||
      session?.user?.id ||
      headers["chatgpt-account-id"] ||
      headers["ChatGPT-Account-Id"];

    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId;
    }

    return headers;
  }

  async function sendViaBackendApi(prompt) {
    spoofPageVisibility();
    resetStreamCapture();
    window.__cApplyStartKeepalive?.();

    const session = await warmChatGPTSession();
    const accessToken = session.accessToken;
    await acquireSentinelHeaders(accessToken, session);

    const endpoints = [
      "/backend-api/conversation",
      "/backend-anon/f/conversation",
    ];

    const body = buildConversationBody(prompt);
    const headers = buildApiHeaders(accessToken, session);
    let lastError = "ChatGPT API request failed.";

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          credentials: "include",
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          lastError = `ChatGPT API ${response.status}${errText ? `: ${errText.slice(0, 160)}` : ""}`;
          continue;
        }

        const text = await consumeConversationStream(response);
        if (text?.trim()) {
          window.__cApplyStreamCapture.text = text;
          window.__cApplyStreamCapture.done = true;
          notifyStreamWaiters();
          return text.trim();
        }
      } catch (err) {
        lastError = err.message || String(err);
      }
    }

    throw new Error(lastError);
  }

  async function waitForStreamCapture(timeoutMs = 300000) {
    const cap = window.__cApplyStreamCapture || {};
    if (cap.done) {
      if (cap.error) throw new Error(cap.error);
      if (cap.text?.trim()) return cap.text.trim();
      throw new Error("ChatGPT returned an empty response.");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = window.__cApplyStreamWaiters.indexOf(onDone);
        if (idx >= 0) window.__cApplyStreamWaiters.splice(idx, 1);
        reject(new Error("Timed out waiting for ChatGPT response."));
      }, timeoutMs);

      const onDone = (result) => {
        clearTimeout(timer);
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        const text = result.text?.trim() || "";
        if (text) resolve(text);
        else reject(new Error("ChatGPT returned an empty response."));
      };

      window.__cApplyStreamWaiters.push(onDone);
    });
  }

  async function warmChatGPTSession() {
    spoofPageVisibility();
    window.__cApplyStartKeepalive?.();

    for (let i = 0; i < 40; i++) {
      try {
        const session = await getChatGPTSession();
        if (session?.accessToken) return session;
      } catch {
        // retry
      }
      await sleep(500);
    }

    throw new Error("Not logged in to ChatGPT. Sign in at chatgpt.com first.");
  }

  async function acquireSentinelHeaders(accessToken, session) {
    const baseHeaders = buildApiHeaders(accessToken, session);
    const deviceId =
      baseHeaders["oai-device-id"] ||
      localStorage.getItem("oai-did") ||
      localStorage.getItem("oai-device-id") ||
      crypto.randomUUID();

    const endpoints = [
      "/backend-api/sentinel/chat-requirements",
      "/backend-anon/sentinel/chat-requirements",
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...baseHeaders,
            "oai-device-id": deviceId,
          },
          body: JSON.stringify({ p: "" }),
          credentials: "include",
        });

        if (!response.ok) continue;

        const data = await response.json();
        const token =
          data?.token ||
          data?.arkose?.token ||
          data?.turnstile?.token;

        if (token) {
          window.__cApplyCapturedHeaders["openai-sentinel-chat-requirements-token"] =
            token;
        }

        const pow = data?.proofofwork || data?.proof_of_work || data?.pow;
        if (pow?.seed && pow?.difficulty) {
          const proof = await solveProofOfWork(pow.seed, pow.difficulty);
          if (proof) {
            window.__cApplyCapturedHeaders["openai-sentinel-proof-token"] = proof;
          }
        }

        return;
      } catch {
        // try next endpoint
      }
    }
  }

  async function solveProofOfWork(seed, difficulty) {
    const config = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join("|");

    const target = difficulty;
    const maxAttempts = 250000;

    for (let i = 0; i < maxAttempts; i++) {
      const payload = `${seed}:${i}:${config}`;
      const hash = await fnv1aHex(payload);
      if (hash.slice(0, target.length) <= target) {
        return `gAAAAAB${btoa(
          JSON.stringify({
            seed,
            difficulty,
            config,
            solution: i,
          })
        )}`;
      }
    }

    return null;
  }

  async function fnv1aHex(input) {
    const data = new TextEncoder().encode(input);
    let hash = 2166136261;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /**
   * Primary path: direct API (works in background tabs). Fallback: composer UI.
   * @param {string} prompt
   * @param {boolean} autoSend
   */
  window.__cApplyRunPromptAsync = async function (prompt, autoSend) {
    spoofPageVisibility();
    window.__cApplyStartKeepalive?.();

    try {
      if (!autoSend) {
        const result = window.__cApplyRunInjectSync(prompt, false);
        if (!result.ok) throw new Error(result.error || "Could not insert prompt.");
        return "";
      }

      const uiResult = window.__cApplyRunInjectSync(prompt, true);
      if (!uiResult.ok || !uiResult.sent) {
        throw new Error(uiResult.error || "Could not send prompt to ChatGPT.");
      }

      return await waitForStreamCapture();
    } finally {
      window.__cApplyStopKeepalive?.();
    }
  };
})();

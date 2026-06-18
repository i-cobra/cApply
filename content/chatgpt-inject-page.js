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

  function resetStreamCapture() {
    window.__cApplyStreamCapture = {
      text: "",
      done: false,
      error: null,
      started: false,
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
    sendBtn.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    sendBtn.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    sendBtn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    );
  }

  function submitComposer(editor) {
    const sendBtn = findSendButton();
    if (sendBtn) {
      clickSend(sendBtn);
      return true;
    }

    const form = editor.closest("form");
    if (form) {
      form.requestSubmit();
      return true;
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
    return false;
  }

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
   * @param {unknown} value
   * @param {number} depth
   * @returns {string[] | null}
   */
  function findMessageParts(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10) return null;

    const record = /** @type {Record<string, unknown>} */ (value);
    const content = record.content;
    if (content && typeof content === "object") {
      const parts = /** @type {{ parts?: unknown[] }} */ (content).parts;
      if (Array.isArray(parts)) {
        const strings = parts.filter((part) => typeof part === "string");
        if (strings.length) return strings;
      }
    }

    for (const nested of Object.values(record)) {
      if (!nested || typeof nested !== "object") continue;
      const found = findMessageParts(nested, depth + 1);
      if (found) return found;
    }

    return null;
  }

  /**
   * @param {unknown} parsed
   * @returns {string}
   */
  function extractStreamChunk(parsed) {
    if (!parsed || typeof parsed !== "object") return "";

    if (Array.isArray(parsed)) {
      return parsed.map((item) => extractStreamChunk(item)).join("");
    }

    const record = /** @type {Record<string, unknown>} */ (parsed);

    const operation = typeof record.o === "string" ? record.o : "";
    const path = typeof record.p === "string" ? record.p : "";
    const value = record.v;

    if (
      operation &&
      path.includes("content/parts") &&
      (operation === "append" || operation === "replace" || operation === "add")
    ) {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) {
        return value.filter((part) => typeof part === "string").join("");
      }
    }

    if (typeof value === "string") {
      if (!path || path.includes("/message/content/parts") || path.includes("/content/parts")) {
        return value;
      }
    }

    if (Array.isArray(value)) {
      const nested = value.map((item) => extractStreamChunk(item)).join("");
      if (nested) return nested;
    }

    if (value && typeof value === "object") {
      const nested = extractStreamChunk(value);
      if (nested) return nested;

      const parts = findMessageParts(value);
      if (parts) return parts.join("");
    }

    const parts = findMessageParts(record);
    if (parts) return parts.join("");

    const message = record.message;
    if (message && typeof message === "object") {
      const messageParts = findMessageParts(message);
      if (messageParts) return messageParts.join("");
    }

    const delta = record.delta;
    if (delta && typeof delta === "object") {
      const content = /** @type {{ content?: string }} */ (delta).content;
      if (typeof content === "string") return content;
    }

    const choices = record.choices;
    if (Array.isArray(choices)) {
      return choices
        .map((choice) => {
          if (!choice || typeof choice !== "object") return "";
          const choiceDelta = /** @type {{ delta?: { content?: string } }} */ (choice).delta;
          return typeof choiceDelta?.content === "string" ? choiceDelta.content : "";
        })
        .join("");
    }

    return "";
  }

  /**
   * @param {string} buffer
   * @returns {string}
   */
  function extractJsonFromRawSse(buffer) {
    const jsonStart = buffer.indexOf("{");
    const jsonEnd = buffer.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return "";

    const candidate = buffer.slice(jsonStart, jsonEnd + 1);
    if (
      candidate.includes('"tailoredResume"') ||
      candidate.includes('"resume"') ||
      candidate.includes('"contact"')
    ) {
      return candidate;
    }

    return "";
  }

  /**
   * @param {Response} response
   */
  async function consumeConversationStream(response) {
    if (!response.body) {
      throw new Error("Empty response body from ChatGPT.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let latestFullText = "";
    let rawSse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkText = decoder.decode(value, { stream: true });
      buffer += chunkText;
      rawSse += chunkText;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed === "object") {
            const record = /** @type {Record<string, unknown>} */ (parsed);
            const streamError =
              (typeof record.error === "string" && record.error) ||
              (typeof record.detail === "string" && record.detail);
            if (streamError) {
              throw new Error(streamError);
            }
          }

          const chunk = extractStreamChunk(parsed);
          if (chunk) fullText += chunk;

          const parts = findMessageParts(parsed);
          if (parts?.length) {
            const joined = parts.join("");
            if (joined.length >= latestFullText.length) {
              latestFullText = joined;
            }
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }

    const resolved = (fullText || latestFullText || extractJsonFromRawSse(rawSse)).trim();
    return resolved;
  }

  function installFetchHook() {
    if (window.__cApplyFetchHooked) return;
    window.__cApplyFetchHooked = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const init = args[1];
      const request = args[0];
      const url =
        typeof request === "string"
          ? request
          : request instanceof Request
            ? request.url
            : String(request);

      if (init?.headers) captureHeaders(init.headers);
      if (request instanceof Request) captureHeaders(request.headers);

      const response = await originalFetch(...args);

      if (isConversationUrl(url) && response.ok) {
        window.__cApplyStreamCapture.started = true;
        const clone = response.clone();
        consumeConversationStream(clone)
          .then((text) => {
            window.__cApplyStreamCapture.started = true;
            if (!text?.trim()) return;
            window.__cApplyStreamCapture.text = text.trim();
            window.__cApplyStreamCapture.done = true;
            notifyStreamWaiters();
          })
          .catch((err) => {
            window.__cApplyStreamCapture.error = err.message || String(err);
            window.__cApplyStreamCapture.done = true;
            notifyStreamWaiters();
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
              const raw = String(this.responseText || "").trim();
              if (!raw) return;

              consumeConversationStream(
                new Response(raw, {
                  headers: { "Content-Type": "text/event-stream" },
                })
              )
                .then((text) => {
                  if (!text) return;
                  window.__cApplyStreamCapture.text = text;
                  window.__cApplyStreamCapture.done = true;
                  window.__cApplyStreamCapture.started = true;
                  notifyStreamWaiters();
                })
                .catch(() => {
                  // ignore
                });
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
    const msg =
      msgs.length > assistantCountBefore
        ? msgs[msgs.length - 1]
        : msgs[msgs.length - 1];
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

    for (let i = candidates.length - 1; i >= 0; i--) {
      const text = candidates[i];
      if (
        text.includes('"resume"') ||
        text.includes('"tailoredResume"') ||
        text.includes('"contact"')
      ) {
        return text;
      }
    }

    if (candidates.length) return candidates[candidates.length - 1];

    return msg.innerText?.trim() || msg.textContent?.trim() || "";
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
  window.__cApplyRunInjectSync = function (prompt, autoSend) {
    try {
      spoofPageVisibility();
      resetStreamCapture();

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

      if (!submitted && !findSendButton()) {
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
    if (stream.done && stream.text) {
      return {
        generating: false,
        hasNew: true,
        textLength: stream.text.length,
        text: stream.text,
        hasJson: stream.hasJson,
        fromStream: true,
        messageCount: countAssistantMessages(),
      };
    }

    if (stream.error) {
      return { error: stream.error };
    }

    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    const hasNew = msgs.length > assistantCountBefore;
    const assistant = hasNew ? msgs[msgs.length - 1] : null;
    const text = getAssistantResponseText(assistantCountBefore);
    const textLength = assistant?.innerText?.length || assistant?.textContent?.length || 0;

    return {
      generating: stream.generating || isGenerating(),
      hasNew,
      textLength,
      text: stream.text || text,
      hasJson: (stream.text || text).includes("{"),
      fromStream: false,
      messageCount: msgs.length,
    };
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getChatGPTSession() {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    return response.json();
  }

  function buildConversationBody(prompt) {
    const pathMatch = location.pathname.match(/\/c\/([0-9a-f-]+)/i);
    return {
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
      model: "auto",
      timezone_offset_min: new Date().getTimezoneOffset(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      history_and_training_disabled: false,
      conversation_mode: { kind: "primary_assistant" },
    };
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
    const readCapturedText = () => {
      const cap = window.__cApplyStreamCapture || {};
      if (cap.text?.trim()) return cap.text.trim();

      const poll = window.__cApplyPollChatGPTResponse?.(0);
      if (poll?.text?.trim()) return poll.text.trim();

      return "";
    };

    const cap = window.__cApplyStreamCapture || {};
    if (cap.done) {
      if (cap.error) throw new Error(cap.error);
      const text = readCapturedText();
      if (text) return text;
      throw new Error("ChatGPT returned an empty response.");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = window.__cApplyStreamWaiters.indexOf(onDone);
        if (idx >= 0) window.__cApplyStreamWaiters.splice(idx, 1);
        const lateText = readCapturedText();
        if (lateText) resolve(lateText);
        else reject(new Error("Timed out waiting for ChatGPT response."));
      }, timeoutMs);

      const onDone = () => {
        clearTimeout(timer);
        const capNow = window.__cApplyStreamCapture || {};
        if (capNow.error) {
          reject(new Error(capNow.error));
          return;
        }
        const text = readCapturedText();
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

      try {
        return await sendViaBackendApi(prompt);
      } catch (apiError) {
        const uiResult = window.__cApplyRunInjectSync(prompt, true);
        if (!uiResult.ok || !uiResult.sent) {
          throw apiError;
        }
        return await waitForStreamCapture();
      }
    } finally {
      window.__cApplyStopKeepalive?.();
    }
  };
})();

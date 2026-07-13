/**
 * Runs in the page (MAIN) world on claude.ai.
 * Exposes the same __cApply* API surface as chatgpt-inject-page.js.
 */
(function () {
  if (window.__cApplyClaudeInjectLoaded) return;
  window.__cApplyClaudeInjectLoaded = true;

  const EDITOR_SELECTORS = [
    'div.ProseMirror[contenteditable="true"]',
    '[data-testid="composer-input"]',
    '[aria-label="Message Claude"][contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]',
  ];

  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send Message"]',
    'button[aria-label*="Send message" i]',
    'button[aria-label*="Send" i]',
    '[role="button"][aria-label*="Send message" i]',
    '[role="button"][aria-label*="Send" i]',
    'button[type="submit"]',
  ];

  const ASSISTANT_TURN_SELECTORS = [
    ".row-start-2",
    '[data-testid="assistant-turn-content"]',
    ".font-claude-response",
  ];

  /** @type {{ text: string, done: boolean, error: string | null, started: boolean, generation?: number }} */
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
      document.hasFocus = () => true;
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
    /** @type {HTMLElement[]} */
    const candidates = [];

    for (const sel of EDITOR_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (!isUsableElement(el)) continue;
        if (el.tagName === "TEXTAREA") {
          candidates.push(el);
          continue;
        }
        if (el.isContentEditable || el.getAttribute("contenteditable") !== "false") {
          candidates.push(el);
        }
      }
    }

    if (!candidates.length) return null;

    const seen = new Set();
    const unique = candidates.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });

    for (const el of unique) {
      const container = el.closest(
        'form, fieldset, footer, [data-testid="composer"], [class*="composer"]'
      );
      if (findSendButtonInScope(container)) return el;
    }

    return unique.sort((a, b) => {
      const topA = a.getBoundingClientRect().top;
      const topB = b.getBoundingClientRect().top;
      return topB - topA;
    })[0];
  }

  function isSendEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  /**
   * @param {Element | null | undefined} scope
   * @param {{ allowDisabled?: boolean }} [options]
   */
  function findSendButtonInScope(scope, options = {}) {
    const { allowDisabled = false } = options;
    if (!scope) return null;

    for (const sel of SEND_SELECTORS) {
      const nodes = scope.querySelectorAll(sel);
      for (const btn of nodes) {
        if (!allowDisabled && !isSendEnabled(btn)) continue;
        if (isUsableElement(btn)) return btn;
      }
    }
    return null;
  }

  /**
   * @param {Element | null | undefined} editor
   * @param {{ allowDisabled?: boolean }} [options]
   */
  function findSendButtonNearEditor(editor, options = {}) {
    if (!editor) return null;

    const container = editor.closest(
      'form, fieldset, footer, [data-testid="composer"], [class*="composer"]'
    );
    const near = findSendButtonInScope(container, options);
    if (near) return near;

    /** @type {Element | null} */
    let sibling = editor.parentElement;
    for (let depth = 0; sibling && depth < 6; depth += 1) {
      const btn = findSendButtonInScope(sibling, options);
      if (btn) return btn;
      sibling = sibling.parentElement;
    }

    return null;
  }

  /**
   * @param {{ allowDisabled?: boolean, editor?: Element | null }} [options]
   */
  function findSendButton(options = {}) {
    const { allowDisabled = false, editor = null } = options;
    spoofPageVisibility();

    const near = findSendButtonNearEditor(editor || findEditor(), { allowDisabled });
    if (near) return near;

    for (const sel of SEND_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      for (const btn of nodes) {
        if (!allowDisabled && !isSendEnabled(btn)) continue;
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

  function fillViaInputData(editor, text) {
    try {
      editor.focus({ preventScroll: true });
    } catch {
      // ignore
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const before = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text,
    });
    editor.dispatchEvent(before);

    const input = new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    });
    editor.dispatchEvent(input);
  }

  function recordInjectResult(editor, expectedLength) {
    const textLength = getEditorText(editor).length;
    const fillOk = textLength >= 8 || expectedLength >= 8;
    window.__cApplyLastInject = {
      length: textLength,
      expected: expectedLength,
      ok: fillOk,
      at: Date.now(),
    };
    return { textLength, fillOk };
  }

  function fillViaTiptap(editor, text) {
    /** @type {{ chain?: () => { focus: () => { clearContent: () => { insertContent: (value: string) => { run: () => boolean } } } } } | null} */
    const tiptap = editor?.editor || null;
    if (!tiptap?.chain) return false;

    try {
      tiptap.chain().focus().clearContent().insertContent(text).run();
      return getEditorText(editor).length >= Math.min(text.length, 32);
    } catch {
      return false;
    }
  }

  function fillContentEditable(editor, text) {
    try {
      if (fillViaTiptap(editor, text)) return;
    } catch {
      // fallback below
    }

    try {
      fillViaInputData(editor, text);
      if (getEditorText(editor).length >= Math.min(text.length, 32)) return;
    } catch {
      // fallback below
    }

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

    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      editor.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        })
      );
      if (getEditorText(editor).length >= Math.min(text.length, 32)) return;
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
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
      })
    );
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })
    );
    editor.dispatchEvent(new Event("change", { bubbles: true }));

    if (getEditorText(editor).length < Math.min(text.length, 32) && text.length) {
      editor.textContent = text;
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })
      );
    }
  }

  function fillEditor(editor, text) {
    if (editor.tagName === "TEXTAREA") {
      setTextareaValue(editor, text);
      return;
    }
    fillContentEditable(editor, text);
  }

  function clickSend(sendBtn) {
    spoofPageVisibility();
    try {
      sendBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      // ignore
    }
    try {
      sendBtn.focus({ preventScroll: true });
    } catch {
      // ignore
    }

    try {
      sendBtn.click();
      return;
    } catch {
      // fallback below
    }

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      sendBtn.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
      );
    }
  }

  function submitViaKeyboard(editor) {
    try {
      editor.focus({ preventScroll: true });
    } catch {
      // ignore
    }

    /** @type {KeyboardEventInit[]} */
    const combos = [
      { key: "Enter", code: "Enter", keyCode: 13, which: 13 },
      { key: "Enter", code: "Enter", keyCode: 13, which: 13, ctrlKey: true },
      { key: "Enter", code: "Enter", keyCode: 13, which: 13, metaKey: true },
    ];

    for (const init of combos) {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );
      editor.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );
    }

    return { ok: true, method: "keyboard" };
  }

  function submitComposer(editor) {
    const sendBtn =
      findSendButtonNearEditor(editor) ||
      findSendButton({ editor, allowDisabled: true });

    if (sendBtn && isSendEnabled(sendBtn)) {
      clickSend(sendBtn);
      return { ok: true, method: "button" };
    }

    const form = editor.closest("form");
    if (form) {
      form.requestSubmit();
      return { ok: true, method: "form" };
    }

    return submitViaKeyboard(editor);
  }

  function waitForSendButtonEnabled(editor, maxMs = 3500) {
    const deadline = Date.now() + maxMs;
    return new Promise((resolve) => {
      const tick = () => {
        const sendBtn = findSendButtonNearEditor(editor) || findSendButton({ editor });
        if (sendBtn && isSendEnabled(sendBtn)) {
          resolve(sendBtn);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  async function submitComposerAsync(editor) {
    const sendBtn = await waitForSendButtonEnabled(editor);
    if (sendBtn) {
      clickSend(sendBtn);
      return { ok: true, method: "button", sent: true };
    }

    const fallback = submitComposer(editor);
    return { ...fallback, sent: Boolean(fallback.ok) };
  }

  window.__cApplyComposerReady = function (minLength = 20) {
    spoofPageVisibility();
    const editor = findEditor();
    if (!editor) {
      return { ready: false, error: "Composer not found on page." };
    }

    const textLength = getEditorText(editor).length;
    const sendBtn = findSendButtonNearEditor(editor, { allowDisabled: true });
    const lastInject = window.__cApplyLastInject;
    const recentInject =
      lastInject?.ok &&
      lastInject.expected >= minLength &&
      Date.now() - (lastInject.at || 0) < 60_000;

    return {
      ready:
        (textLength >= minLength || recentInject) &&
        (Boolean(sendBtn) || Boolean(editor.closest("form")) || recentInject),
      textLength,
      hasSend: Boolean(sendBtn),
      fillOk: Boolean(recentInject),
    };
  };

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
   * @param {unknown} parsed
   * @returns {string}
   */
  function extractStreamChunk(parsed) {
    if (!parsed || typeof parsed !== "object") return "";

    const record = /** @type {Record<string, unknown>} */ (parsed);

    if (record.type === "content_block_delta") {
      const delta = record.delta;
      if (delta && typeof delta === "object") {
        const deltaRecord = /** @type {Record<string, unknown>} */ (delta);
        if (deltaRecord.type === "text_delta" && typeof deltaRecord.text === "string") {
          return deltaRecord.text;
        }
        if (typeof deltaRecord.text === "string") return deltaRecord.text;
      }
    }

    if (typeof record.delta === "string") return record.delta;
    if (typeof record.text === "string") return record.text;

    return "";
  }

  function isClaudeStreamResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    return (
      contentType.includes("event-stream") ||
      contentType.includes("text/event-stream") ||
      contentType.includes("text/plain")
    );
  }

  function isClaudeCompletionUrl(url) {
    const normalized = String(url || "");
    return (
      normalized.includes("/completion") ||
      normalized.includes("/chat_conversations") ||
      normalized.includes("/append_message") ||
      normalized.includes("/api/messages") ||
      normalized.includes("/api/chat") ||
      /chat_conversations\/[^/?]+\/completion/.test(normalized)
    );
  }

  /**
   * @param {Response} response
   * @param {number} generation
   */
  async function consumeConversationStream(response, generation) {
    if (!response.body) {
      throw new Error("Empty response body from Claude.");
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
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let data = "";
          if (trimmed.startsWith("data:")) {
            data = trimmed.slice(5).trim();
          } else if (trimmed.startsWith("{")) {
            data = trimmed;
          } else {
            continue;
          }

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
    if (window.__cApplyClaudeFetchHooked) return;
    window.__cApplyClaudeFetchHooked = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url =
        typeof args[0] === "string"
          ? args[0]
          : args[0] instanceof Request
            ? args[0].url
            : String(args[0]);

      const method = String(
        args[1]?.method || (args[0] instanceof Request ? args[0].method : "GET")
      ).toUpperCase();

      const response = await originalFetch(...args);

      if (
        method === "POST" &&
        response.ok &&
        isClaudeStreamResponse(response) &&
        isClaudeCompletionUrl(url)
      ) {
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
      this.__cApplyClaudeUrl = String(url);
      this.__cApplyClaudeMethod = String(method || "GET").toUpperCase();
      return xhrOpen.call(this, method, url, ...rest);
    };

    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      const url = this.__cApplyClaudeUrl || "";
      const method = this.__cApplyClaudeMethod || "GET";
      if (method === "POST" && isClaudeCompletionUrl(url)) {
        const generation = window.__cApplyStreamCapture?.generation ?? streamCaptureGeneration;
        window.__cApplyStreamCapture.started = true;
        this.addEventListener("load", () => {
          try {
            const text = String(this.responseText || "").trim();
            if (text) {
              markStreamCaptureDone(text, null, generation);
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

    for (const sel of ['[data-is-streaming="true"]', 'button[aria-label*="Stop"]']) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (isPresent(el) && !el.disabled) return true;
      }
    }

    return false;
  }

  function getAssistantTurns() {
    for (const sel of ASSISTANT_TURN_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      if (!nodes.length) continue;

      /** @type {Element[]} */
      const turns = [];
      const seen = new Set();

      for (const el of nodes) {
        if (seen.has(el)) continue;

        let nested = false;
        for (const existing of turns) {
          if (existing.contains(el) || el.contains(existing)) {
            nested = true;
            break;
          }
        }
        if (nested) continue;

        seen.add(el);
        turns.push(el);
      }

      if (turns.length) return turns;
    }

    return [];
  }

  function countAssistantMessages() {
    return getAssistantTurns().length;
  }

  function getAssistantMessages() {
    return getAssistantTurns();
  }

  function getAssistantResponseText(assistantCountBefore) {
    const msgs = getAssistantMessages();
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

    if (fullText.includes('"tailoredResume"') && fullText.includes('"atsScore"')) {
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

  window.__cApplySubmitComposer = function () {
    try {
      spoofPageVisibility();

      const editor = findEditor();
      if (!editor) {
        return { ok: false, error: "Composer not found on page." };
      }

      const assistantCountBefore = countAssistantMessages();
      const submitted = submitComposer(editor);

      if (!submitted.ok && !findSendButton({ editor, allowDisabled: true })) {
        return { ok: false, error: "Send button not found." };
      }

      return { ok: true, sent: true, assistantCountBefore };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };

  window.__cApplySubmitComposerAsync = async function () {
    try {
      spoofPageVisibility();

      const editor = findEditor();
      if (!editor) {
        return { ok: false, error: "Composer not found on page." };
      }

      const assistantCountBefore = countAssistantMessages();
      const submitted = await submitComposerAsync(editor);

      if (!submitted.ok && !findSendButton({ editor, allowDisabled: true })) {
        return { ok: false, error: "Send button not found." };
      }

      return { ok: true, sent: true, assistantCountBefore, method: submitted.method };
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
      const { textLength, fillOk } = recordInjectResult(editor, prompt.length);

      if (!autoSend) {
        return { ok: true, sent: false, textLength, fillOk };
      }

      const assistantCountBefore = countAssistantMessages();
      const submitted = submitComposer(editor);

      if (!submitted.ok && !findSendButton({ editor, allowDisabled: true })) {
        return { ok: false, error: "Send button not found. Open a Claude chat first." };
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

  window.__cApplyRunInjectAsync = async function (prompt, autoSend) {
    try {
      spoofPageVisibility();
      if (autoSend) resetStreamCapture();

      const editor = findEditor();
      if (!editor) {
        return { ok: false, error: "Composer not found on page." };
      }

      fillEditor(editor, prompt);
      const { textLength, fillOk } = recordInjectResult(editor, prompt.length);

      if (!autoSend) {
        return { ok: true, sent: false, textLength, fillOk };
      }

      const assistantCountBefore = countAssistantMessages();
      const submitted = await submitComposerAsync(editor);

      if (!submitted.ok && !findSendButton({ editor, allowDisabled: true })) {
        return { ok: false, error: "Send button not found. Open a Claude chat first." };
      }

      return {
        ok: true,
        sent: true,
        assistantCountBefore,
        method: submitted.method,
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };

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

    const msgs = getAssistantTurns();
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

  window.__cApplySetActiveChatModelConfig = function () {
    // Claude model selection is not automated.
  };

  window.__cApplySelectChatModel = async function () {
    return { ok: true, skipped: true };
  };
})();

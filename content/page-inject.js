/**
 * Runs in page context to interact with ChatGPT's React/ProseMirror editor.
 */

(function () {
  if (window.__cApplyPageInjectLoaded) return;
  window.__cApplyPageInjectLoaded = true;

  const EDITOR_SELECTORS = [
    'div#prompt-textarea[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"][role="textbox"]',
  ];

  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'form button[type="submit"]',
  ];

  function findEditor() {
    for (const sel of EDITOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findSendButton() {
    for (const sel of SEND_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) return btn;
    }
    return null;
  }

  function clearEditor(editor) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false, null);
  }

  function insertText(editor, text) {
    editor.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    const ok = document.execCommand("insertText", false, text);

    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" })
    );

    if (!ok) {
      editor.textContent = text;
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })
      );
    }
  }

  function waitForEditor(maxMs = 15000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = () => {
        const editor = findEditor();
        if (editor) {
          resolve(editor);
          return;
        }
        if (Date.now() - start > maxMs) {
          reject(new Error("ChatGPT composer not found. Log in and open a chat."));
          return;
        }
        setTimeout(tick, 300);
      };

      tick();
    });
  }

  async function injectPrompt(prompt, autoSend) {
    const editor = await waitForEditor();
    clearEditor(editor);
    insertText(editor, prompt);

    if (autoSend) {
      await new Promise((r) => setTimeout(r, 400));
      const sendBtn = findSendButton();
      if (sendBtn) {
        sendBtn.click();
      }
    }

    return { ok: true };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "capply-content" || data.type !== "INJECT_PROMPT") return;

    const reply = (payload) => {
      window.postMessage(
        { source: "capply-page", requestId: data.requestId, ...payload },
        "*"
      );
    };

    try {
      const result = await injectPrompt(data.prompt, data.autoSend);
      reply(result);
    } catch (err) {
      reply({ ok: false, error: err.message || String(err) });
    }
  });
})();

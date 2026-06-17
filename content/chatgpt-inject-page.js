/**
 * Runs in the page (MAIN) world. Reads window.__cApplyInjectPayload, writes __cApplyInjectResult.
 */
(function () {
  const { prompt, autoSend } = window.__cApplyInjectPayload || {};

  if (!prompt) {
    window.__cApplyInjectResult = { ok: false, error: "No prompt payload." };
    return;
  }

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
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send"]',
    'form button[type="submit"]',
  ];

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findEditor() {
    for (const sel of EDITOR_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        if (el.tagName === "TEXTAREA") return el;
        if (el.isContentEditable || el.getAttribute("contenteditable") !== "false") {
          return el;
        }
      }
    }
    return null;
  }

  function findSendButton() {
    for (const sel of SEND_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && isVisible(btn)) return btn;
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

  function clearContentEditable(editor) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
  }

  function insertContentEditable(editor, text) {
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
      editor.innerHTML = "";
      for (const line of text.split("\n")) {
        const p = document.createElement("p");
        p.textContent = line || "\u200B";
        editor.appendChild(p);
      }
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" })
      );
    }
  }

  function waitForEditor(maxMs) {
    return new Promise((resolve, reject) => {
      const existing = findEditor();
      if (existing) {
        resolve(existing);
        return;
      }

      let settled = false;
      const finish = (fn, val) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        fn(val);
      };

      const observer = new MutationObserver(() => {
        const editor = findEditor();
        if (editor) finish(resolve, editor);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      const timer = setTimeout(() => {
        const editor = findEditor();
        if (editor) finish(resolve, editor);
        else finish(reject, new Error("Composer not found on page."));
      }, maxMs);
    });
  }

  async function run() {
    const editor = await waitForEditor(12000);

    if (editor.tagName === "TEXTAREA") {
      setTextareaValue(editor, prompt);
    } else {
      clearContentEditable(editor);
      insertContentEditable(editor, prompt);
    }

    if (autoSend) {
      await new Promise((r) => setTimeout(r, 500));
      const sendBtn = findSendButton();
      if (sendBtn) sendBtn.click();
    }

    return { ok: true };
  }

  run()
    .then((result) => {
      window.__cApplyInjectResult = result;
    })
    .catch((err) => {
      window.__cApplyInjectResult = {
        ok: false,
        error: err.message || String(err),
      };
    });
})();

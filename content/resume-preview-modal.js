/**
 * Injected into the active page to show a resume PDF preview modal.
 */
(function () {
  const ROOT_ID = "capply-resume-preview-root";
  const STYLE_ID = "capply-resume-preview-style";

  /**
   * @param {string} base64
   * @param {string} [title]
   */
  function showResumePreviewModal(base64, title = "Resume preview") {
    const existing = document.getElementById(ROOT_ID);
    if (existing) existing.remove();

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${ROOT_ID} {
          all: initial;
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          background: rgba(8, 10, 16, 0.72);
          backdrop-filter: blur(4px);
          font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
        }

        #${ROOT_ID} * {
          box-sizing: border-box;
        }

        #${ROOT_ID} .capply-preview-dialog {
          display: flex;
          flex-direction: column;
          width: min(920px, 100%);
          height: min(88vh, 900px);
          border-radius: 14px;
          overflow: hidden;
          background: #11151d;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        }

        #${ROOT_ID} .capply-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          background: #171b24;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        #${ROOT_ID} .capply-preview-title {
          margin: 0;
          flex: 1;
          min-width: 0;
          font-size: 17px;
          font-weight: 700;
          color: #eef1f6;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        #${ROOT_ID} .capply-preview-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        #${ROOT_ID} button.capply-preview-btn {
          all: unset;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 34px;
          padding: 0 14px;
          border-radius: 9px;
          border: 1px solid transparent;
          font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
          font-size: 15px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: 0;
          cursor: pointer;
          user-select: none;
          transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
          -webkit-appearance: none;
          appearance: none;
        }

        #${ROOT_ID} button.capply-preview-btn:focus-visible {
          outline: 2px solid rgba(16, 163, 127, 0.55);
          outline-offset: 2px;
        }

        #${ROOT_ID} button.capply-preview-btn:active:not(:disabled) {
          transform: translateY(1px);
        }

        #${ROOT_ID} button.capply-preview-btn:disabled {
          opacity: 0.55;
          cursor: wait;
          transform: none;
        }

        #${ROOT_ID} button.capply-preview-btn .capply-preview-btn-icon {
          display: inline-flex;
          flex-shrink: 0;
          width: 14px;
          height: 14px;
        }

        #${ROOT_ID} button.capply-preview-btn-refresh {
          background: #10a37f;
          border-color: #10a37f;
          color: #ffffff;
        }

        #${ROOT_ID} button.capply-preview-btn-refresh:hover:not(:disabled) {
          background: #0d8c6d;
          border-color: #0d8c6d;
        }

        #${ROOT_ID} button.capply-preview-btn-close {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.14);
          color: #eef1f6;
        }

        #${ROOT_ID} button.capply-preview-btn-close:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.11);
          border-color: rgba(255, 255, 255, 0.22);
        }

        #${ROOT_ID} .capply-preview-frame-wrap {
          flex: 1;
          min-height: 0;
          background: #525659;
          position: relative;
        }

        #${ROOT_ID} .capply-preview-frame {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #fff;
        }

        #${ROOT_ID} .capply-preview-error {
          margin: 0;
          padding: 32px 24px;
          color: #ffb4b4;
          text-align: center;
          font-size: 16px;
          line-height: 1.5;
        }

        #${ROOT_ID} .capply-preview-loading {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(82, 86, 89, 0.92);
          color: #eef1f6;
          font-size: 16px;
          font-weight: 600;
        }
      `;
      document.documentElement.appendChild(style);
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", title || "Resume preview");

    const dialog = document.createElement("div");
    dialog.className = "capply-preview-dialog";

    const header = document.createElement("div");
    header.className = "capply-preview-header";

    const heading = document.createElement("p");
    heading.className = "capply-preview-title";
    heading.textContent = title || "Resume preview";

    const actions = document.createElement("div");
    actions.className = "capply-preview-actions";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "capply-preview-btn capply-preview-btn-refresh";
    refreshBtn.innerHTML = `
      <svg class="capply-preview-btn-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3.5a6.5 6.5 0 1 1-4.6 11.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M3.5 6.5V3.5H6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Refresh</span>
    `;
    refreshBtn.setAttribute("aria-label", "Refresh preview");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "capply-preview-btn capply-preview-btn-close";
    closeBtn.innerHTML = `
      <svg class="capply-preview-btn-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Close</span>
    `;
    closeBtn.setAttribute("aria-label", "Close preview");

    actions.append(refreshBtn, closeBtn);
    header.append(heading, actions);

    const frameWrap = document.createElement("div");
    frameWrap.className = "capply-preview-frame-wrap";

    let objectUrl = null;
    let loadingEl = null;

    function revokeObjectUrl() {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    }

    function setLoading(active, message = "Refreshing preview…") {
      if (active) {
        if (!loadingEl) {
          loadingEl = document.createElement("div");
          loadingEl.className = "capply-preview-loading";
          frameWrap.appendChild(loadingEl);
        }
        loadingEl.textContent = message;
        return;
      }

      loadingEl?.remove();
      loadingEl = null;
    }

    function showError(message) {
      revokeObjectUrl();
      frameWrap.replaceChildren();
      const error = document.createElement("p");
      error.className = "capply-preview-error";
      error.textContent = message;
      frameWrap.appendChild(error);
    }

    function renderPdf(pdfBase64) {
      if (!pdfBase64) {
        showError("Missing resume preview data.");
        return;
      }

      revokeObjectUrl();
      frameWrap.replaceChildren();

      const bytes = Uint8Array.from(atob(pdfBase64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      objectUrl = URL.createObjectURL(blob);

      const frame = document.createElement("iframe");
      frame.className = "capply-preview-frame";
      frame.title = heading.textContent || "Resume PDF preview";
      frame.src = objectUrl;
      frameWrap.appendChild(frame);
    }

    function cleanup() {
      revokeObjectUrl();
      document.removeEventListener("keydown", onKeyDown, true);
      root.remove();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cleanup();
      }
    }

    async function refreshPreview() {
      refreshBtn.disabled = true;
      const refreshLabel = refreshBtn.querySelector("span");
      if (refreshLabel) refreshLabel.textContent = "Refreshing…";
      setLoading(true);

      try {
        const response = await chrome.runtime.sendMessage({
          type: "REFRESH_RESUME_PREVIEW",
        });

        if (!response?.ok || !response.base64) {
          throw new Error(response?.error || "Could not refresh preview.");
        }

        if (response.title) {
          heading.textContent = response.title;
          root.setAttribute("aria-label", response.title);
        }

        renderPdf(response.base64);
      } catch (err) {
        showError(err?.message || "Could not refresh preview.");
      } finally {
        setLoading(false);
        refreshBtn.disabled = false;
        const refreshLabel = refreshBtn.querySelector("span");
        if (refreshLabel) refreshLabel.textContent = "Refresh";
      }
    }

    refreshBtn.addEventListener("click", () => {
      refreshPreview();
    });
    closeBtn.addEventListener("click", cleanup);
    root.addEventListener("click", (event) => {
      if (event.target === root) cleanup();
    });
    document.addEventListener("keydown", onKeyDown, true);

    try {
      renderPdf(base64);
    } catch (err) {
      showError(err?.message || "Could not load resume preview.");
    }

    dialog.append(header, frameWrap);
    root.appendChild(dialog);
    document.documentElement.appendChild(root);
    closeBtn.focus();
  }

  window.__cApplyShowResumePreviewModal = showResumePreviewModal;
})();

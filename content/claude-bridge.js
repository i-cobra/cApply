/**
 * Content script — injects Claude page-world API early (document_start).
 */
(function initBridge() {
  if (window.__cApplyClaudeBridgeLoaded) return;
  window.__cApplyClaudeBridgeLoaded = true;

  function injectScript(file) {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(file);
    script.async = false;
    (document.documentElement || document.head).appendChild(script);
  }

  injectScript("content/claude-inject-page.js");

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "INJECT_PROMPT") return false;

    const requestId = `capply-${Date.now()}`;

    const onPageMessage = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "capply-page" || data.requestId !== requestId) return;

      window.removeEventListener("message", onPageMessage);
      sendResponse(data);
    };

    window.addEventListener("message", onPageMessage);

    window.postMessage(
      {
        source: "capply-content",
        type: "INJECT_PROMPT",
        requestId,
        prompt: message.prompt,
        autoSend: message.autoSend,
      },
      "*"
    );

    return true;
  });
})();

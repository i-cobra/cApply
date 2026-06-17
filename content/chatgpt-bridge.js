/**
 * Content script bridge — injects page script and relays messages.
 */

(function initBridge() {
  if (window.__cApplyBridgeLoaded) return;
  window.__cApplyBridgeLoaded = true;

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("content/page-inject.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "INJECT_PROMPT") return;

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

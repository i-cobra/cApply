/**
 * One-shot script executed via chrome.scripting to check bridge readiness.
 */
(function () {
  return { ready: Boolean(window.__cApplyBridgeLoaded) };
})();

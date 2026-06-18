import { buildFillProfilePrompt, buildTailorPrompt } from "./lib/prompt.js";
import { parseTailorResponse } from "./lib/tailor-response.js";
import { serializeResume } from "./lib/resume-structure.js";

const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_HOSTS = ["chatgpt.com", "chat.openai.com"];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

async function enableSidePanelForAllTabs() {
  try {
    await chrome.sidePanel.setOptions({
      path: "popup/popup.html",
      enabled: true,
    });
  } catch {
    // ignore
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  enableSidePanelForAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanelForAllTabs();
});

/** @type {Map<string, string>} */
const resumePreviewCache = new Map();

const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

function storeResumePreview(base64) {
  const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  resumePreviewCache.set(id, base64);
  globalThis.setTimeout(() => {
    resumePreviewCache.delete(id);
  }, PREVIEW_CACHE_TTL_MS);
  return id;
}

async function openResumePreviewTab(id, label = "") {
  const previewUrl = new URL(chrome.runtime.getURL("preview/resume-preview.html"));
  previewUrl.searchParams.set("id", id);
  if (label) {
    previewUrl.searchParams.set("title", label);
  }

  await chrome.tabs.create({
    url: previewUrl.toString(),
    active: true,
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TAILOR_RESUME") {
    handleTailorResume(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "FILL_PROFILE") {
    handleFillProfile(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GRAB_PAGE_TEXT") {
    handleGrabPageText()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "OPEN_CHATGPT_LOGIN") {
    openChatGPTLogin()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "PREVIEW_RESUME") {
    handlePreviewResume(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_RESUME_PREVIEW") {
    const base64 = resumePreviewCache.get(message.id);
    if (!base64) {
      sendResponse({ ok: false, error: "Preview expired or not found." });
      return false;
    }
    resumePreviewCache.delete(message.id);
    sendResponse({ ok: true, base64 });
    return false;
  }
});

async function handlePreviewResume(message) {
  const base64 = message.base64;
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Missing resume preview data.");
  }

  const id = storeResumePreview(base64);
  const title = typeof message.title === "string" ? message.title.trim() : "";
  await openResumePreviewTab(id, title);
  return { ok: true };
}

async function handleGrabPageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  const url = tab?.url || "";

  if (!tabId) {
    throw new Error("No active tab. Open a job posting page first.");
  }

  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    throw new Error("Open a job posting page in the browser, then click Grab from page.");
  }

  if (CHATGPT_HOSTS.some((h) => url.includes(h))) {
    throw new Error("Switch to the job posting tab first, then click Grab from page.");
  }

  const hasAccess = await chrome.permissions.contains({
    origins: ["https://*/*", "http://*/*"],
  });

  if (!hasAccess) {
    throw new Error(
      "Page access not granted. Click Grab from page again and allow permission."
    );
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/grab-job-description.js"],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__cApplyGrabbedText,
  });

  if (!result?.trim()) {
    throw new Error("Could not extract text from this page.");
  }

  return { ok: true, text: result, pageUrl: url };
}

async function handleTailorResume(payload) {
  const { resume, jobDescription, options, autoSend, jobWindowId } = payload;

  if (!resume?.trim()) {
    throw new Error("Resume is empty. Add your resume in the extension popup.");
  }
  if (!jobDescription?.trim()) {
    throw new Error("Job description is empty.");
  }

  const prompt = buildTailorPrompt({ resume, jobDescription, options });
  return runChatGPTPrompt(prompt, autoSend, jobWindowId);
}

async function handleFillProfile(payload) {
  const { sourceText, existingResume, extraInstructions, autoSend } = payload;

  if (!sourceText?.trim() && !existingResume?.trim()) {
    throw new Error("Paste resume source text or add existing profile content first.");
  }

  const prompt = buildFillProfilePrompt({
    sourceText: sourceText || "",
    existingResume: existingResume || "",
    extraInstructions: extraInstructions || "",
  });

  return runChatGPTPrompt(prompt, autoSend);
}

async function getJobTabContext() {
  const [jobTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    jobTabId: jobTab?.id ?? null,
    jobWindowId: jobTab?.windowId ?? null,
  };
}

async function runChatGPTPrompt(prompt, autoSend, explicitJobWindowId) {
  const jobWindowId =
    explicitJobWindowId ?? (await getJobTabContext()).jobWindowId;
  const tab = await findOrOpenChatGPTTab(jobWindowId);

  await ensureTabAwake(tab.id);
  await waitForTabLoad(tab.id);
  await ensureChatGPTReady(tab.id);
  await prepareBackgroundChatGPTTab(tab.id);
  await ensurePageApi(tab.id);
  await waitForChatGPTReady(tab.id);

  if (!autoSend) {
    await runInjectOnly(tab.id, prompt);
    return { ok: true, tabId: tab.id, sent: false, responseText: "" };
  }

  const responseText = await runPromptWithPolling(tab.id, prompt);

  return {
    ok: true,
    tabId: tab.id,
    sent: true,
    responseText,
  };
}

function hasBalancedJsonBraces(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
  }

  return depth === 0;
}

function hasTailorResumeMarkers(text) {
  if (!text?.includes("{")) return false;
  return (
    text.includes('"tailoredResume"') ||
    text.includes('"resume"') ||
    text.includes('"contact"')
  );
}

function hasTailorResumeJson(text) {
  if (!hasTailorResumeMarkers(text) || text.length <= 80) return false;
  if (hasAtsScoreProperty(text) && text.length > 200) return true;
  return hasBalancedJsonBraces(text);
}

function hasAtsScoreProperty(text) {
  return text.includes('"atsScore"') || text.includes('"ats_score"');
}

function looksLikeTailorJson(text) {
  return hasTailorResumeMarkers(text) && hasAtsScoreProperty(text) && text.length > 80;
}

function pickCaptureText(capture) {
  const stream = capture.streamText || "";
  const dom = capture.domText || "";
  const hasNew = Boolean(capture.hasNewAssistant);
  const inFlight = Boolean(capture.generating || capture.streamStarted);

  if (!hasNew && !inFlight) return "";

  if (inFlight && !hasNew) return stream;

  if (
    dom.includes('"tailoredResume"') &&
    dom.includes('"atsScore"') &&
    dom.length > 200
  ) {
    return dom;
  }

  if (!stream) return dom;
  if (!dom) return stream;

  const streamHasAts = hasAtsScoreProperty(stream);
  const domHasAts = hasAtsScoreProperty(dom);

  if (domHasAts && !streamHasAts) return dom;
  if (streamHasAts && !domHasAts) return stream;

  return dom.length > stream.length ? dom : stream;
}

async function injectAndSend(tabId, prompt) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => window.__cApplyResetStreamCapture?.(),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const [{ result: fillResult }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (text) => window.__cApplyRunInjectSync(text, false),
      args: [prompt],
    });

    if (!fillResult?.ok) {
      if (attempt === 1) {
        return fillResult || { ok: false, error: "Could not fill ChatGPT composer." };
      }
      await sleep(1000);
      continue;
    }

    await sleep(attempt === 0 ? 900 : 1200);

    const ready = await waitForComposerReady(tabId, 4000);
    if (!ready.ready) {
      if (attempt === 1) {
        return { ok: false, error: ready.error || "ChatGPT composer did not accept the prompt." };
      }
      continue;
    }

    const [{ result: sendResult }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__cApplySubmitComposer?.(),
    });

    if (sendResult?.ok && sendResult.sent) {
      return sendResult;
    }

    if (attempt === 1) {
      return sendResult || { ok: false, error: "Could not send prompt to ChatGPT." };
    }
  }

  return { ok: false, error: "Could not send prompt to ChatGPT." };
}

async function waitForComposerReady(tabId, maxMs = 4000) {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () =>
        typeof window.__cApplyComposerReady === "function"
          ? window.__cApplyComposerReady(20)
          : { ready: true },
    });

    if (result?.ready) return result;
    await sleep(250);
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () =>
      typeof window.__cApplyComposerReady === "function"
        ? window.__cApplyComposerReady(20)
        : { ready: false, error: "Composer check unavailable." },
  });

  return result || { ready: false, error: "ChatGPT composer did not accept the prompt." };
}

async function pollCapture(tabId, assistantCountBefore = 0) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (countBefore) => {
      const stream =
        typeof window.__cApplyPollStreamCapture === "function"
          ? window.__cApplyPollStreamCapture()
          : null;

      const domPoll =
        typeof window.__cApplyPollChatGPTResponse === "function"
          ? window.__cApplyPollChatGPTResponse(countBefore)
          : null;

      return {
        streamText: stream?.text?.trim() || "",
        streamDone: Boolean(stream?.done),
        streamStarted: Boolean(stream?.started),
        streamError: stream?.error || null,
        generating: Boolean(stream?.generating || domPoll?.generating),
        hasNewAssistant: Boolean(domPoll?.hasNew),
        domText: (domPoll?.domText || domPoll?.text || "").trim(),
      };
    },
    args: [assistantCountBefore],
  });

  return result || {};
}

async function runPromptWithPolling(tabId, prompt) {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__cApplyStartKeepalive?.(),
    });

    const sendResult = await injectAndSend(tabId, prompt);
    if (!sendResult?.ok || !sendResult.sent) {
      throw new Error(sendResult?.error || "Could not send prompt to ChatGPT.");
    }

    const assistantCountBefore = sendResult.assistantCountBefore ?? 0;

    const startedDeadline = Date.now() + 20000;
    while (Date.now() < startedDeadline) {
      const capture = await pollCapture(tabId, assistantCountBefore);
      if (
        capture.streamStarted ||
        capture.generating ||
        capture.hasNewAssistant ||
        capture.streamText
      ) {
        break;
      }
      await sleep(500);
    }

    let lastError = "ChatGPT did not return resume JSON.";
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await waitForCapturedResponse(tabId, assistantCountBefore);
      if (text) return text;
      await sleep(1000);
    }

    throw new Error(lastError);
  } finally {
    await chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => window.__cApplyStopKeepalive?.(),
      })
      .catch(() => {});
    await chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});
  }
}

function isRecoverableStreamCaptureError(message) {
  if (!message) return false;
  return (
    /abort/i.test(message) ||
    /BodyStreamBuffer/i.test(message) ||
    /cancel/i.test(message)
  );
}

function isUsableTailorResponse(text) {
  if (!text?.trim() || !hasAtsScoreProperty(text)) return false;
  try {
    const { structured, atsScore } = parseTailorResponse(text);
    return Boolean(serializeResume(structured).trim()) && Boolean(atsScore);
  } catch {
    return false;
  }
}

async function waitForCapturedResponse(tabId, assistantCountBefore) {
  const deadline = Date.now() + 310000;
  let lastText = "";
  let stableRounds = 0;

  while (Date.now() < deadline) {
    const capture = await pollCapture(tabId, assistantCountBefore);

    if (capture.generating) {
      stableRounds = 0;
      lastText = "";
      await sleep(500);
      continue;
    }

    const candidate = pickCaptureText(capture);

    if (
      capture.streamError &&
      !candidate &&
      !isRecoverableStreamCaptureError(capture.streamError)
    ) {
      throw new Error(capture.streamError);
    }

    if (!candidate) {
      stableRounds = 0;
      lastText = "";
      await sleep(500);
      continue;
    }

    if (!hasTailorResumeMarkers(candidate) || candidate.length <= 80) {
      stableRounds = 0;
      lastText = candidate;
      await sleep(500);
      continue;
    }

    if (!hasAtsScoreProperty(candidate)) {
      stableRounds = 0;
      lastText = candidate;
      await sleep(500);
      continue;
    }

    if (candidate === lastText) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastText = candidate;
    }

    if (stableRounds >= 2 && isUsableTailorResponse(candidate)) {
      return candidate;
    }

    await sleep(500);
  }

  const finalCapture = await pollCapture(tabId, assistantCountBefore);
  if (finalCapture.generating) return "";

  const final = pickCaptureText(finalCapture) || lastText?.trim() || "";
  return isUsableTailorResponse(final) ? final : "";
}

async function ensurePageApi(tabId) {
  const [{ result: ready }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () =>
      typeof window.__cApplyRunInjectSync === "function" &&
      typeof window.__cApplySubmitComposer === "function" &&
      typeof window.__cApplyComposerReady === "function",
  });

  if (ready) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      window.__cApplyChatGPTInjectLoaded = false;
    },
  });

  await loadChatGPTPageApi(tabId);
  await sleep(800);

  const [{ result: readyAfter }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () =>
      typeof window.__cApplyRunInjectSync === "function" &&
      typeof window.__cApplySubmitComposer === "function" &&
      typeof window.__cApplyComposerReady === "function",
  });

  if (!readyAfter) {
    throw new Error("Could not initialize ChatGPT automation on the page.");
  }
}

async function waitForChatGPTReady(tabId, maxMs = 120000) {
  const deadline = Date.now() + maxMs;
  let reloaded = false;

  while (Date.now() < deadline) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        if (typeof window.__cApplyHasComposer === "function" && window.__cApplyHasComposer()) {
          return { ready: true };
        }
        try {
          const session = await fetch("/api/auth/session", {
            credentials: "include",
          }).then((res) => res.json());
          return { ready: Boolean(session?.accessToken) };
        } catch {
          return { ready: false };
        }
      },
    });

    if (result?.ready) return;

    if (!reloaded && Date.now() > deadline - maxMs + 35000) {
      reloaded = true;
      await chrome.tabs.reload(tabId).catch(() => {});
      await waitForTabLoad(tabId);
      await sleep(4000);
      await prepareBackgroundChatGPTTab(tabId);
      await loadChatGPTPageApi(tabId);
    }

    await sleep(1000);
  }

  throw new Error(
    "ChatGPT is not ready. Sign in at chatgpt.com in this browser, then try Tailor again."
  );
}

async function runInjectOnly(tabId, prompt) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (text) => {
      if (typeof window.__cApplyRunInjectSync !== "function") {
        return { ok: false, error: "ChatGPT inject API missing." };
      }
      return window.__cApplyRunInjectSync(text, false);
    },
    args: [prompt],
  });

  if (!result?.ok) {
    throw new Error(result?.error || "Could not insert prompt into ChatGPT.");
  }
}

async function prepareBackgroundChatGPTTab(tabId) {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      try {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => false,
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
      } catch {
        // ignore
      }
    },
  });
}

function isChatGPTUrl(url) {
  return Boolean(url && CHATGPT_HOSTS.some((h) => url.includes(h)));
}

async function findOrOpenChatGPTTab(jobWindowId) {
  const allTabs = await chrome.tabs.query({});
  const existingAnywhere = allTabs.find((t) => isChatGPTUrl(t.url));
  if (existingAnywhere?.id) return existingAnywhere;

  if (jobWindowId) {
    const inJobWindow = await chrome.tabs.query({ windowId: jobWindowId });
    const existing = inJobWindow.find((t) => isChatGPTUrl(t.url));
    if (existing?.id) return existing;

    return chrome.tabs.create({
      windowId: jobWindowId,
      url: CHATGPT_URL,
      active: false,
    });
  }

  return chrome.tabs.create({ url: CHATGPT_URL, active: false });
}

async function openChatGPTLogin() {
  const { jobWindowId } = await getJobTabContext();
  const tab = await findOrOpenChatGPTTab(jobWindowId);
  await chrome.tabs.update(tab.id, { active: true, url: CHATGPT_URL });
}

async function ensureTabAwake(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.discarded) return;

  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);
  await sleep(2500);
}

async function ensureChatGPTReady(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";

  if (!CHATGPT_HOSTS.some((h) => url.includes(h))) {
    await chrome.tabs.update(tabId, { url: CHATGPT_URL });
    await waitForTabLoad(tabId);
    await sleep(3000);
    return;
  }

  if (
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("/api/auth")
  ) {
    await chrome.tabs.update(tabId, { url: CHATGPT_URL });
    await waitForTabLoad(tabId);
    await sleep(3000);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const check = async () => {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        resolve();
        return;
      }
      setTimeout(check, 300);
    };
    check();
  });
}

async function loadChatGPTPageApi(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["content/chatgpt-inject-page.js"],
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

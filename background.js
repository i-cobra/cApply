import { buildFillProfilePrompt, buildTailorPrompt } from "./lib/prompt.js";

const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_HOSTS = ["chatgpt.com", "chat.openai.com"];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

function notifyJobTabChanged(tabId, url, reason) {
  chrome.runtime
    .sendMessage({ type: "JOB_TAB_CHANGED", tabId, url, reason })
    .catch(() => {});
}

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const urlChangeTimers = new Map();

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.sidePanel.setOptions({
      tabId,
      path: "popup/popup.html",
      enabled: true,
    });
    notifyJobTabChanged(tabId, tab.url || "", "activated");
  } catch {
    // ignore restricted tabs
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  chrome.sidePanel
    .setOptions({
      tabId,
      path: "popup/popup.html",
      enabled: true,
    })
    .catch(() => {});

  const existing = urlChangeTimers.get(tabId);
  if (existing) clearTimeout(existing);

  urlChangeTimers.set(
    tabId,
    setTimeout(() => {
      urlChangeTimers.delete(tabId);
      notifyJobTabChanged(tabId, tab.url || "", "url");
    }, 400)
  );
});

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
});

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
  const { resume, jobDescription, options, autoSend } = payload;

  if (!resume?.trim()) {
    throw new Error("Resume is empty. Add your resume in the extension popup.");
  }
  if (!jobDescription?.trim()) {
    throw new Error("Job description is empty.");
  }

  const prompt = buildTailorPrompt({ resume, jobDescription, options });
  return runChatGPTPrompt(prompt, autoSend);
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

async function runChatGPTPrompt(prompt, autoSend) {
  const { jobWindowId } = await getJobTabContext();
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

  const responseText = await runPromptAsync(tab.id, prompt);

  return {
    ok: true,
    tabId: tab.id,
    sent: true,
    responseText,
  };
}

async function ensurePageApi(tabId) {
  const [{ result: ready }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => typeof window.__cApplyRunPromptAsync === "function",
  });

  if (ready) return;

  await loadChatGPTPageApi(tabId);
  await sleep(800);

  const [{ result: readyAfter }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => typeof window.__cApplyRunPromptAsync === "function",
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

async function runPromptAsync(tabId, prompt) {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__cApplyStartKeepalive?.(),
    });

    const [{ result: started }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (text) => {
        if (typeof window.__cApplyRunPromptAsync !== "function") {
          window.__cApplyJobResult = {
            status: "error",
            error: "ChatGPT async API missing.",
          };
          return { started: false };
        }

        window.__cApplyJobResult = { status: "running" };
        window.__cApplyRunPromptAsync(text, true)
          .then((responseText) => {
            window.__cApplyJobResult = {
              status: "done",
              responseText: responseText || "",
            };
          })
          .catch((err) => {
            window.__cApplyJobResult = {
              status: "error",
              error: err?.message || String(err),
            };
          });

        return { started: true };
      },
      args: [prompt],
    });

    if (!started?.started) {
      const [{ result: job }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => window.__cApplyJobResult,
      });
      throw new Error(job?.error || "Could not start ChatGPT request.");
    }

    const deadline = Date.now() + 310000;

    while (Date.now() < deadline) {
      await sleep(500);

      const [{ result: state }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const job = window.__cApplyJobResult || { status: "running" };
          const stream =
            typeof window.__cApplyPollStreamCapture === "function"
              ? window.__cApplyPollStreamCapture()
              : null;

          if (stream?.text?.trim()) {
            return {
              status: "done",
              responseText: stream.text.trim(),
            };
          }

          if (stream?.error) {
            return { status: "error", error: stream.error };
          }

          const domPoll =
            typeof window.__cApplyPollChatGPTResponse === "function"
              ? window.__cApplyPollChatGPTResponse(0)
              : null;

          if (domPoll?.text?.trim() && domPoll.hasJson) {
            return {
              status: "done",
              responseText: domPoll.text.trim(),
            };
          }

          if (domPoll?.error) {
            return { status: "error", error: domPoll.error };
          }

          return job;
        },
      });

      if (state?.status === "done") {
        const text = state.responseText?.trim() || "";
        if (text) return text;
        throw new Error(
          "ChatGPT finished but no JSON response was captured. Try again."
        );
      }

      if (state?.status === "error") {
        throw new Error(state.error || "ChatGPT request failed.");
      }
    }

    throw new Error("Timed out waiting for ChatGPT. Try again.");
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__cApplyStopKeepalive?.(),
    }).catch(() => {});
    await chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => {});
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
  if (!jobWindowId) {
    const [jobTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    jobWindowId = jobTab?.windowId;
  }

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
    return;
  }

  if (!url.includes("chatgpt.com") || url.includes("/c/")) {
    await chrome.tabs.update(tabId, { url: CHATGPT_URL });
    await waitForTabLoad(tabId);
    await sleep(2000);
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

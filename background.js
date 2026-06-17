import { buildTailorPrompt } from "./lib/prompt.js";

const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_HOSTS = ["chatgpt.com", "chat.openai.com"];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TAILOR_RESUME") {
    handleTailorResume(message.payload)
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
});

async function handleGrabPageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  if (!tabId) {
    throw new Error("No active tab. Open a job posting page first.");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selectors = [
        "[data-automation='jobDescription']",
        ".jobs-description__content",
        "#job-details",
        ".job-description",
        "[class*='job-description']",
        "article",
        "main",
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.innerText?.trim().length > 200) {
          return el.innerText.trim().slice(0, 15000);
        }
      }

      const main = document.querySelector("main") || document.body;
      return main.innerText.trim().slice(0, 15000);
    },
  });

  if (!result?.trim()) {
    throw new Error("Could not extract text from this page.");
  }

  return { ok: true, text: result };
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
  const tab = await findOrOpenChatGPTTab();

  await waitForTabLoad(tab.id);
  await ensureChatGPTReady(tab.id);
  await injectPrompt(tab.id, prompt, autoSend);

  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return { ok: true, tabId: tab.id };
}

async function findOrOpenChatGPTTab() {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(
    (t) => t.url && CHATGPT_HOSTS.some((h) => t.url.includes(h))
  );

  if (existing) {
    return existing;
  }

  return chrome.tabs.create({ url: CHATGPT_URL, active: false });
}

async function ensureChatGPTReady(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";

  if (!CHATGPT_HOSTS.some((h) => url.includes(h))) {
    await chrome.tabs.update(tabId, { url: CHATGPT_URL });
    await waitForTabLoad(tabId);
    await sleep(1500);
    return;
  }

  // Auth / landing pages may not expose the composer until we open the main app.
  if (
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("/api/auth")
  ) {
    await chrome.tabs.update(tabId, { url: CHATGPT_URL });
    await waitForTabLoad(tabId);
    await sleep(1500);
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

async function injectPrompt(tabId, prompt, autoSend) {
  const maxAttempts = 8;
  let lastError = "Composer not found on page.";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt === 4) {
      try {
        await chrome.tabs.reload(tabId);
        await waitForTabLoad(tabId);
        await sleep(2000);
      } catch {
        // ignore reload issues
      }
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (text, send) => {
          window.__cApplyInjectPayload = { prompt: text, autoSend: send };
          window.__cApplyInjectResult = undefined;
        },
        args: [prompt, Boolean(autoSend)],
      });

      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        files: ["content/chatgpt-inject-page.js"],
      });

      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        await sleep(400);

        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => window.__cApplyInjectResult,
        });

        if (result?.ok) return;
        if (result?.error) {
          lastError = result.error;
          break;
        }
      }
    } catch (err) {
      lastError = err.message || String(err);
    }

    await sleep(500);
  }

  throw new Error(
    `Could not reach ChatGPT composer. ${lastError} Try refreshing chatgpt.com and click Tailor again.`
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

import { buildFillProfilePrompt, buildTailorPrompt, buildAutoApplyPrompt, buildRestructureJobDescriptionPrompt } from "./lib/prompt.js";
import { parseTailorResponse, hasTailoredContent } from "./lib/tailor-response.js";
import { parseRestructureJobResponse } from "./lib/restructure-job-response.js";
import {
  autoApplyResponseLooksComplete,
  hasAutoApplyMarkers,
  isUsableAutoApplyResponse,
  parseAutoApplyResponse,
} from "./lib/auto-apply-response.js";
import { serializeResume, resumeToLlmShape } from "./lib/resume-structure.js";
import {
  buildResumeDownloadFilename,
  encodeResumePdfBase64,
} from "./lib/resume-pdf.js";
import { loadJobContext, ACTIVE_CONTEXT_KEY, SHARED_CONTEXT_KEY } from "./lib/job-context.js";
import { inferJobRole } from "./lib/tailor-history.js";
import { loadSettings, mergePromptInstructions } from "./lib/settings.js";
import { callOpenAiChat } from "./lib/openai-api.js";
import { getHybridAutoApplySteps } from "./lib/auto-apply-hybrid.js";
import {
  CHATGPT_MODEL_HIGH,
  CHATGPT_MODEL_INSTANT,
  getChatGptModelConfig,
} from "./lib/chatgpt-models.js";
import {
  getLlmProvider,
  isAnyLlmUrl,
  isProviderUrl,
  LLM_PROVIDERS,
} from "./lib/llm-provider.js";
import "./lib/jspdf/jspdf.umd.min.js";

const CHATGPT_PROVIDER = LLM_PROVIDERS.chatgpt;

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

  if (message.type === "RESTRUCTURE_JOB_DESCRIPTION") {
    handleRestructureJobDescription(message.payload)
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
    openLlmLogin()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "PREVIEW_RESUME_ON_PAGE") {
    handlePreviewResumeOnPage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "REFRESH_RESUME_PREVIEW") {
    handleRefreshResumePreview()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "AUTO_APPLY_JOB") {
    handleAutoApplyJob(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function handlePreviewResumeOnPage(message) {
  const base64 = message.base64;
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Missing resume preview data.");
  }

  const title = typeof message.title === "string" ? message.title.trim() : "";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  const url = tab?.url || "";

  if (!tabId) {
    throw new Error("No active browser tab. Open a web page first.");
  }

  if (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  ) {
    throw new Error("Open a regular web page in the browser, then preview again.");
  }

  const hasAccess = await chrome.permissions.contains({
    origins: ["https://*/*", "http://*/*"],
  });

  if (!hasAccess) {
    throw new Error(
      "Page access not granted. Click Preview resume again and allow permission."
    );
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/resume-preview-modal.js"],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (pdfBase64, previewTitle) => {
      window.__cApplyShowResumePreviewModal?.(pdfBase64, previewTitle);
    },
    args: [base64, title || "Resume preview"],
  });

  return { ok: true };
}

async function handleRefreshResumePreview() {
  const stored = await chrome.storage.local.get(ACTIVE_CONTEXT_KEY);
  const contextKey = stored[ACTIVE_CONTEXT_KEY] || SHARED_CONTEXT_KEY;
  const state = await loadJobContext(contextKey);
  const structured = state?.structured;

  if (!structured || !serializeResume(structured).trim()) {
    throw new Error("No tailored resume to preview.");
  }

  const name = structured.contact?.name?.trim() || "Resume";
  const role = state?.position?.trim() || inferJobRole(state?.jobDescription || "");
  const title = role ? `${name} — ${role}` : name;
  const base64 = await encodeResumePdfBase64(structured);

  return { ok: true, base64, title };
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

  if (isAnyLlmUrl(url)) {
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
    func: () => ({
      text: window.__cApplyGrabbedText,
      meta: window.__cApplyGrabbedMeta || null,
    }),
  });

  const text = result?.text?.trim();
  if (!text) {
    throw new Error("Could not extract text from this page.");
  }

  return { ok: true, text, meta: result?.meta || null, pageUrl: url };
}

const AUTO_APPLY_MAX_ROUNDS = 8;

async function handleAutoApplyJob(payload) {
  const {
    structured,
    companyName = "",
    position = "",
    jobUrl = "",
    jobDescription = "",
    jobWindowId,
  } = payload || {};

  if (!structured || !serializeResume(structured).trim()) {
    throw new Error("Tailor a resume first, then try Auto Apply.");
  }

  const [jobTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const jobTabId = jobTab?.id;
  const pageUrl = jobTab?.url || "";

  if (!jobTabId) {
    throw new Error("No active browser tab. Open the job posting page first.");
  }

  if (
    pageUrl.startsWith("chrome://") ||
    pageUrl.startsWith("chrome-extension://") ||
    pageUrl.startsWith("edge://") ||
    pageUrl.startsWith("about:")
  ) {
    throw new Error("Open the job posting page in the browser, then click Auto Apply.");
  }

  if (isAnyLlmUrl(pageUrl)) {
    throw new Error("Switch to the job posting tab first, then click Auto Apply.");
  }

  const hasAccess = await chrome.permissions.contains({
    origins: ["https://*/*", "http://*/*"],
  });

  if (!hasAccess) {
    throw new Error(
      "Page access not granted. Click Auto Apply again and allow permission."
    );
  }

  const name = structured.contact?.name?.trim() || "Resume";
  const role = position.trim() || inferJobRole(jobDescription || "");
  const filename = buildResumeDownloadFilename(name, role);
  const pdfBase64 = await encodeResumePdfBase64(structured);
  const applicant = resumeToLlmShape(structured);
  const job = {
    companyName: companyName.trim(),
    position: role,
    jobUrl: jobUrl.trim() || pageUrl,
    jobDescription: jobDescription.trim().slice(0, 8000),
  };

  const settings = await loadSettings();
  /** @type {Record<string, unknown> | null} */
  let lastResult = null;
  let previousSummary = "";
  /** @type {string[]} */
  const summaries = [];

  for (let round = 0; round < AUTO_APPLY_MAX_ROUNDS; round += 1) {
    const snapshot = await captureJobPageSnapshot(jobTabId, applicant);

    if (settings.hybridAutoApply) {
      const hybridSteps = getHybridAutoApplySteps(pageUrl, snapshot);
      if (hybridSteps.length) {
        lastResult = await executeJobPageActions(jobTabId, hybridSteps, {
          pdfBase64,
          filename,
          autoAdvance: true,
        });
        if (lastResult.submitted) {
          return {
            ok: true,
            summary: "Application submitted via platform autofill.",
            rounds: round + 1,
            submitted: true,
            summaries: ["Hybrid autofill completed the flow."],
          };
        }
        await sleep(1200);
      }
    }

    const prompt = buildAutoApplyPrompt({
      snapshot,
      applicant,
      job,
      round,
      previousSummary,
      lastResult,
    });

    const responseText = await runAutoApplyChatGPTPrompt(prompt, jobWindowId);
    const plan = parseAutoApplyResponse(responseText);
    summaries.push(plan.summary);
    previousSummary = plan.summary;

    if (plan.status === "blocked") {
      throw new Error(plan.blocker || plan.summary || "Auto apply blocked on this page.");
    }

    lastResult = await executeJobPageActions(jobTabId, plan.steps, {
      pdfBase64,
      filename,
      autoAdvance: true,
    });

    if (plan.status === "done" || lastResult.submitted) {
      return {
        ok: true,
        summary: plan.summary,
        rounds: round + 1,
        submitted: true,
        summaries,
      };
    }

    if (!lastResult.ok && lastResult.errors?.length) {
      throw new Error(lastResult.errors[0]);
    }

    const tab = await chrome.tabs.get(jobTabId).catch(() => null);
    const isSmartRecruiters = tab?.url?.includes("smartrecruiters.com");
    const isOneClickUi = tab?.url?.includes("/oneclick-ui/");
    await sleep(isOneClickUi ? 4500 : isSmartRecruiters ? 3500 : 2200);
  }

  throw new Error(
    "Auto apply did not finish within the step limit. Continue manually on the job page."
  );
}

async function captureJobPageSnapshot(tabId, applicant = null) {
  await ensureJobPageAutomation(tabId);

  const tabMeta = await chrome.tabs.get(tabId).catch(() => null);
  const isOneClickUi = tabMeta?.url?.includes("/oneclick-ui/");

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => window.__cApplyPrepareApplySurface?.(),
  });

  await sleep(isOneClickUi ? 4000 : 2500);
  await waitForTabLoad(tabId).catch(() => {});
  await sleep(isOneClickUi ? 1500 : 1000);

  if (applicant) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (profile) => window.__cApplyLocalAutofillFromProfile?.(profile),
      args: [applicant],
    });
    await sleep(500);
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => window.__cApplyCapturePageSnapshot?.(),
  });

  if (!result?.elements?.length) {
    throw new Error(
      "Could not scan the job page for form fields. Click \"I'm interested\" to open the form, then try Auto Apply again."
    );
  }

  return result;
}

async function executeJobPageActions(tabId, steps, uploadPayload) {
  await ensureJobPageAutomation(tabId);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (actionSteps, upload) =>
      window.__cApplyExecuteAutoApplyActions?.(actionSteps, upload),
    args: [steps, uploadPayload],
  });

  return (
    result || {
      ok: false,
      completed: [],
      errors: ["Auto-apply actions did not run."],
      submitted: false,
    }
  );
}

async function ensureJobPageAutomation(tabId) {
  const [{ result: ready }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () =>
      typeof window.__cApplyCapturePageSnapshot === "function" &&
      typeof window.__cApplyExecuteAutoApplyActions === "function",
  });

  if (ready) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["content/job-apply-automation.js"],
  });

  await sleep(400);
}

async function runAutoApplyChatGPTPrompt(prompt, jobWindowId) {
  const tab = await findOrOpenLlmTab(CHATGPT_PROVIDER, jobWindowId);

  await ensureTabAwake(tab.id);
  await waitForTabLoad(tab.id);
  await ensureLlmReady(tab.id, CHATGPT_PROVIDER);
  await prepareBackgroundLlmTab(tab.id);
  await ensurePageApi(tab.id, CHATGPT_PROVIDER);
  await waitForLlmReady(tab.id, CHATGPT_PROVIDER);

  return runAutoApplyPromptWithPolling(tab.id, prompt, CHATGPT_PROVIDER);
}

function pickAutoApplyCaptureText(capture) {
  const stream = capture.streamText || "";
  const dom = capture.domText || "";
  const hasNew = Boolean(capture.hasNewAssistant);
  const inFlight = Boolean(capture.generating || capture.streamStarted);

  if (!hasNew && !inFlight) {
    if (hasAutoApplyMarkers(dom) && dom.length > 40) return dom;
    if (hasAutoApplyMarkers(stream) && stream.length > 40) return stream;
    return "";
  }

  if (inFlight && !hasNew) return stream;
  if (dom.includes('"steps"') && dom.length > 80) return dom;
  if (!stream) return dom;
  if (!dom) return stream;
  return dom.length > stream.length ? dom : stream;
}

async function runAutoApplyPromptWithPolling(tabId, prompt, provider = CHATGPT_PROVIDER) {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

  const stopKeepalive = startBackgroundKeepalive();

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__cApplyStartKeepalive?.(),
    });

    const sendResult = await injectAndSend(tabId, prompt, CHATGPT_MODEL_HIGH, provider);
    if (!sendResult?.ok || !sendResult.sent) {
      throw new Error(sendResult?.error || provider.sendError);
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

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const text = await waitForAutoApplyResponse(tabId, assistantCountBefore);
      if (text) return text;
      await sleep(1000);
    }

    throw new Error("ChatGPT did not return an auto-apply JSON plan.");
  } finally {
    stopKeepalive();
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

async function waitForAutoApplyResponse(tabId, assistantCountBefore) {
  const deadline = Date.now() + 180000;
  let lastText = "";
  let stableRounds = 0;

  while (Date.now() < deadline) {
    const capture = await pollCapture(tabId, assistantCountBefore);
    const candidate = pickAutoApplyCaptureText(capture);

    if (
      capture.streamError &&
      !candidate &&
      !isRecoverableStreamCaptureError(capture.streamError)
    ) {
      throw new Error(capture.streamError);
    }

    if (!candidate || !hasAutoApplyMarkers(candidate) || candidate.length <= 40) {
      stableRounds = 0;
      lastText = candidate || "";
      await sleep(500);
      continue;
    }

    if (candidate === lastText) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastText = candidate;
    }

    const ready =
      stableRounds >= (autoApplyResponseLooksComplete(candidate) ? 1 : 2) &&
      isUsableAutoApplyResponse(candidate);

    if (ready && (!capture.generating || autoApplyResponseLooksComplete(candidate))) {
      return candidate;
    }

    await sleep(500);
  }

  const finalCapture = await pollCapture(tabId, assistantCountBefore);
  const final = pickAutoApplyCaptureText(finalCapture) || lastText?.trim() || "";
  return isUsableAutoApplyResponse(final) ? final : "";
}

async function handleTailorResume(payload) {
  const { jobDescription, options, autoSend, jobWindowId } = payload;

  if (!jobDescription?.trim()) {
    throw new Error("Job description is empty.");
  }

  const settings = await loadSettings();
  const prompt = buildTailorPrompt({
    jobDescription,
    options: {
      ...options,
      extraInstructions: mergePromptInstructions(
        settings.promptModifyTailor,
        options?.extraInstructions
      ),
    },
  });

  if (settings.useOpenAiApi && settings.openAiApiKey?.trim()) {
    const responseText = await callOpenAiChat({
      apiKey: settings.openAiApiKey,
      model: settings.openAiModel,
      prompt,
      reasoningEffort: getChatGptModelConfig(CHATGPT_MODEL_HIGH).reasoningEffort,
    });
    return { ok: true, sent: true, responseText, source: "openai-api" };
  }

  const provider = getLlmProvider(settings);
  return runLlmPrompt(
    prompt,
    autoSend ?? settings.autoSend,
    jobWindowId,
    buildTailorResponseProfile(provider),
    CHATGPT_MODEL_HIGH,
    provider
  );
}

async function handleFillProfile(payload) {
  const { sourceText, existingResume, extraInstructions, autoSend } = payload;

  if (!sourceText?.trim() && !existingResume?.trim()) {
    throw new Error("Paste resume source text or add existing profile content first.");
  }

  const settings = await loadSettings();
  const provider = getLlmProvider(settings);
  const prompt = buildFillProfilePrompt({
    sourceText: sourceText || "",
    existingResume: existingResume || "",
    extraInstructions: mergePromptInstructions(
      settings.promptModifyFillProfile,
      extraInstructions
    ),
  });

  return runLlmPrompt(
    prompt,
    autoSend,
    undefined,
    buildTailorResponseProfile(provider),
    CHATGPT_MODEL_INSTANT,
    provider
  );
}

async function handleRestructureJobDescription(payload) {
  const { jobDescription, position = "", companyName = "", autoSend, jobWindowId } = payload || {};

  if (!jobDescription?.trim()) {
    throw new Error("Job description is empty.");
  }

  const settings = await loadSettings();
  const prompt = buildRestructureJobDescriptionPrompt({
    jobDescription,
    position,
    companyName,
    extraInstructions: settings.promptModifyRestructure,
  });

  if (settings.useOpenAiApi && settings.openAiApiKey?.trim()) {
    const responseText = await callOpenAiChat({
      apiKey: settings.openAiApiKey,
      model: settings.openAiModel,
      prompt,
      reasoningEffort: getChatGptModelConfig(CHATGPT_MODEL_INSTANT).reasoningEffort,
    });
    return { ok: true, sent: true, responseText, source: "openai-api" };
  }

  const provider = getLlmProvider(settings);
  return runLlmPrompt(
    prompt,
    autoSend ?? settings.autoSend,
    jobWindowId,
    buildRestructureResponseProfile(provider),
    CHATGPT_MODEL_INSTANT,
    provider
  );
}

async function getJobTabContext() {
  const [jobTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    jobTabId: jobTab?.id ?? null,
    jobWindowId: jobTab?.windowId ?? null,
  };
}

async function runLlmPrompt(
  prompt,
  autoSend,
  explicitJobWindowId,
  profile,
  modelTier = CHATGPT_MODEL_HIGH,
  provider = CHATGPT_PROVIDER
) {
  const jobWindowId =
    explicitJobWindowId ?? (await getJobTabContext()).jobWindowId;
  const tab = await findOrOpenLlmTab(provider, jobWindowId);

  await ensureTabAwake(tab.id);
  await waitForTabLoad(tab.id);
  await ensureLlmReady(tab.id, provider);
  await prepareBackgroundLlmTab(tab.id);
  await ensurePageApi(tab.id, provider);
  await waitForLlmReady(tab.id, provider);

  if (!autoSend) {
    await runInjectOnly(tab.id, prompt, modelTier, provider);
    return { ok: true, tabId: tab.id, sent: false, responseText: "", provider: provider.id };
  }

  const responseText = await runPromptWithPolling(tab.id, prompt, profile, modelTier, provider);

  return {
    ok: true,
    tabId: tab.id,
    sent: true,
    responseText,
    provider: provider.id,
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

function hasRestructureJobMarkers(text) {
  if (!text?.includes("{")) return false;
  return (
    text.includes('"jobDescription"') ||
    text.includes('"job_description"') ||
    text.includes('"description"')
  );
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

function pickTailorCaptureText(capture) {
  const stream = capture.streamText || "";
  const dom = capture.domText || "";
  const hasNew = Boolean(capture.hasNewAssistant);
  const inFlight = Boolean(capture.generating || capture.streamStarted);

  if (!hasNew && !inFlight) {
    if (hasTailorResumeMarkers(dom) && dom.length > 80) return dom;
    if (hasTailorResumeMarkers(stream) && stream.length > 80) return stream;
    return "";
  }

  if (inFlight && !hasNew) return stream;

  if (dom.includes('"tailoredResume"') && dom.length > 200) {
    return dom;
  }

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

function pickRestructureCaptureText(capture) {
  const stream = capture.streamText || "";
  const dom = capture.domText || "";
  const hasNew = Boolean(capture.hasNewAssistant);
  const inFlight = Boolean(capture.generating || capture.streamStarted);

  if (!hasNew && !inFlight) {
    if (hasRestructureJobMarkers(dom) && dom.length > 50) return dom;
    if (hasRestructureJobMarkers(stream) && stream.length > 50) return stream;
    return "";
  }

  if (inFlight && !hasNew) {
    return hasRestructureJobMarkers(stream) ? stream : "";
  }

  if (hasRestructureJobMarkers(dom) && dom.length > 50) return dom;
  if (hasRestructureJobMarkers(stream) && stream.length > 50) return stream;

  return dom.length > stream.length ? dom : stream;
}

async function prepareChatGptModel(tabId, modelTier, provider = CHATGPT_PROVIDER) {
  if (!provider.supportsModelSelection) {
    return { ok: true, skipped: true };
  }

  const config = getChatGptModelConfig(modelTier);

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (cfg) => {
      window.__cApplySetActiveChatModelConfig?.(cfg);
    },
    args: [config],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (label) => window.__cApplySelectChatModel?.(label),
    args: [config.label],
  });

  return result || { ok: true };
}

async function injectAndSend(tabId, prompt, modelTier = CHATGPT_MODEL_HIGH, provider = CHATGPT_PROVIDER) {
  await prepareChatGptModel(tabId, modelTier, provider);

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
        return fillResult || { ok: false, error: provider.composerFillError };
      }
      await sleep(1000);
      continue;
    }

    await sleep(attempt === 0 ? 900 : 1200);

    const ready = await waitForComposerReady(tabId, 4000);
    if (!ready.ready) {
      if (attempt === 1) {
        return { ok: false, error: ready.error || provider.composerReadyError };
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
      return sendResult || { ok: false, error: provider.sendError };
    }
  }

  return { ok: false, error: provider.sendError };
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

async function runPromptWithPolling(
  tabId,
  prompt,
  profile,
  modelTier = CHATGPT_MODEL_HIGH,
  provider = CHATGPT_PROVIDER
) {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

  const stopKeepalive = startBackgroundKeepalive();

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => window.__cApplyStartKeepalive?.(),
    });

    const sendResult = await injectAndSend(tabId, prompt, modelTier, provider);
    if (!sendResult?.ok || !sendResult.sent) {
      throw new Error(sendResult?.error || provider.sendError);
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

    const lastError = profile.emptyError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await waitForCapturedResponse(tabId, assistantCountBefore, profile);
      if (text) return text;
      await sleep(1000);
    }

    throw new Error(lastError);
  } finally {
    stopKeepalive();
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
  if (!text?.trim() || !hasTailorResumeMarkers(text) || text.length <= 80) return false;
  try {
    const { structured } = parseTailorResponse(text);
    return hasTailoredContent(structured) || Boolean(serializeResume(structured).trim());
  } catch {
    return false;
  }
}

function isUsableRestructureResponse(text) {
  if (!text?.trim() || !hasRestructureJobMarkers(text) || text.length <= 50) return false;
  try {
    const parsed = parseRestructureJobResponse(text);
    return Boolean(parsed.jobDescription.trim());
  } catch {
    return false;
  }
}

function responseLooksComplete(text) {
  if (!text?.trim()) return false;
  if (hasAtsScoreProperty(text) && hasBalancedJsonBraces(text)) return true;
  return hasBalancedJsonBraces(text) && text.includes('"tailoredResume"');
}

function restructureLooksComplete(text) {
  if (!text?.trim()) return false;
  return hasRestructureJobMarkers(text) && hasBalancedJsonBraces(text);
}

function stableRoundsNeeded(text) {
  return responseLooksComplete(text) ? 1 : 2;
}

function restructureStableRoundsNeeded(text) {
  return restructureLooksComplete(text) ? 1 : 2;
}

/** @typedef {{
 *   minLength: number,
 *   emptyError: string,
 *   hasMarkers: (text: string) => boolean,
 *   pickCaptureText: (capture: Record<string, unknown>) => string,
 *   isUsable: (text: string) => boolean,
 *   looksComplete: (text: string) => boolean,
 *   stableRoundsNeeded: (text: string) => number
 * }} LlmResponseProfile */

/**
 * @param {import("./lib/llm-provider.js").LlmProviderConfig} provider
 * @returns {LlmResponseProfile}
 */
function buildTailorResponseProfile(provider) {
  return {
    minLength: 80,
    emptyError: provider.emptyResponseError,
    hasMarkers: hasTailorResumeMarkers,
    pickCaptureText: pickTailorCaptureText,
    isUsable: isUsableTailorResponse,
    looksComplete: responseLooksComplete,
    stableRoundsNeeded,
  };
}

/**
 * @param {import("./lib/llm-provider.js").LlmProviderConfig} provider
 * @returns {LlmResponseProfile}
 */
function buildRestructureResponseProfile(provider) {
  return {
    minLength: 50,
    emptyError: `${provider.label} did not return restructured job description JSON.`,
    hasMarkers: hasRestructureJobMarkers,
    pickCaptureText: pickRestructureCaptureText,
    isUsable: isUsableRestructureResponse,
    looksComplete: restructureLooksComplete,
    stableRoundsNeeded: restructureStableRoundsNeeded,
  };
}

function startBackgroundKeepalive() {
  const timer = setInterval(() => {
    chrome.runtime.getPlatformInfo?.().catch(() => {});
  }, 20_000);
  return () => clearInterval(timer);
}

async function waitForCapturedResponse(
  tabId,
  assistantCountBefore,
  profile
) {
  const deadline = Date.now() + 310000;
  let lastText = "";
  let stableRounds = 0;

  while (Date.now() < deadline) {
    const capture = await pollCapture(tabId, assistantCountBefore);
    const candidate = profile.pickCaptureText(capture);

    if (
      capture.streamError &&
      !candidate &&
      !isRecoverableStreamCaptureError(capture.streamError)
    ) {
      throw new Error(capture.streamError);
    }

    if (
      !candidate ||
      !profile.hasMarkers(candidate) ||
      candidate.length <= profile.minLength
    ) {
      stableRounds = 0;
      lastText = candidate || "";
      await sleep(500);
      continue;
    }

    if (candidate === lastText) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastText = candidate;
    }

    const ready =
      stableRounds >= profile.stableRoundsNeeded(candidate) &&
      profile.isUsable(candidate);

    if (ready && (!capture.generating || profile.looksComplete(candidate))) {
      return candidate;
    }

    await sleep(500);
  }

  const finalCapture = await pollCapture(tabId, assistantCountBefore);
  const final = profile.pickCaptureText(finalCapture) || lastText?.trim() || "";
  return profile.isUsable(final) ? final : "";
}

async function ensurePageApi(tabId, provider = CHATGPT_PROVIDER) {
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
    func: (flag) => {
      window[flag] = false;
    },
    args: [provider.injectLoadedFlag],
  });

  await loadLlmPageApi(tabId, provider);
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
    throw new Error(provider.initError);
  }
}

async function waitForLlmReady(tabId, provider = CHATGPT_PROVIDER, maxMs = 120000) {
  const deadline = Date.now() + maxMs;
  let reloaded = false;

  while (Date.now() < deadline) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (providerId) => {
        if (typeof window.__cApplyHasComposer === "function" && window.__cApplyHasComposer()) {
          return { ready: true };
        }

        if (providerId === "chatgpt") {
          try {
            const session = await fetch("/api/auth/session", {
              credentials: "include",
            }).then((res) => res.json());
            return { ready: Boolean(session?.accessToken) };
          } catch {
            return { ready: false };
          }
        }

        return { ready: false };
      },
      args: [provider.id],
    });

    if (result?.ready) return;

    if (!reloaded && Date.now() > deadline - maxMs + 35000) {
      reloaded = true;
      await chrome.tabs.reload(tabId).catch(() => {});
      await waitForTabLoad(tabId);
      await sleep(4000);
      await prepareBackgroundLlmTab(tabId);
      await loadLlmPageApi(tabId, provider);
    }

    await sleep(1000);
  }

  throw new Error(provider.notReadyError);
}

async function runInjectOnly(tabId, prompt, modelTier = CHATGPT_MODEL_HIGH, provider = CHATGPT_PROVIDER) {
  await prepareChatGptModel(tabId, modelTier, provider);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (text, missingError) => {
      if (typeof window.__cApplyRunInjectSync !== "function") {
        return { ok: false, error: missingError };
      }
      return window.__cApplyRunInjectSync(text, false);
    },
    args: [prompt, provider.injectMissingError],
  });

  if (!result?.ok) {
    throw new Error(result?.error || provider.composerFillError);
  }
}

async function prepareBackgroundLlmTab(tabId) {
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

async function findOrOpenLlmTab(provider, jobWindowId) {
  const allTabs = await chrome.tabs.query({});
  const existingAnywhere = allTabs.find((t) => isProviderUrl(t.url, provider));
  if (existingAnywhere?.id) return existingAnywhere;

  if (jobWindowId) {
    const inJobWindow = await chrome.tabs.query({ windowId: jobWindowId });
    const existing = inJobWindow.find((t) => isProviderUrl(t.url, provider));
    if (existing?.id) return existing;

    return chrome.tabs.create({
      windowId: jobWindowId,
      url: provider.url,
      active: false,
    });
  }

  return chrome.tabs.create({ url: provider.url, active: false });
}

async function openLlmLogin() {
  const settings = await loadSettings();
  const provider = getLlmProvider(settings);
  const { jobWindowId } = await getJobTabContext();
  const tab = await findOrOpenLlmTab(provider, jobWindowId);
  await chrome.tabs.update(tab.id, { active: true, url: provider.url });
}

async function ensureLlmReady(tabId, provider = CHATGPT_PROVIDER) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || "";

  if (!isProviderUrl(url, provider)) {
    await chrome.tabs.update(tabId, { url: provider.url });
    await waitForTabLoad(tabId);
    await sleep(3000);
    return;
  }

  if (
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("/api/auth")
  ) {
    await chrome.tabs.update(tabId, { url: provider.url });
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

async function loadLlmPageApi(tabId, provider = CHATGPT_PROVIDER) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [provider.injectScript],
  });
}

async function ensureTabAwake(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.discarded) return;

  await chrome.tabs.reload(tabId);
  await waitForTabLoad(tabId);
  await sleep(2500);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

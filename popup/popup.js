import { readResumeFile } from "../lib/pdf-extract.js";
import { scoreTier } from "../lib/ats-score.js";
import { buildAnalysisReport } from "../lib/analysis-report.js";
import { emptyResume, normalizeResume, parseResumeText, serializeResume } from "../lib/resume-structure.js";
import {
  addTailorHistoryEntry,
  clearTailorHistory,
  exportHistoryCsv,
  formatHistoryDate,
  getEntryStatus,
  getHistoryStats,
  inferJobRole,
  loadTailorHistory,
  normalizeJobRoleTitle,
  removeTailorHistoryEntry,
  setTailorHistoryApplied,
  setTailorHistoryNotes,
  setTailorHistoryStatus,
} from "../lib/tailor-history.js";
import {
  getActiveBrowserTab,
  getJobContextKey,
  loadJobContext,
  saveJobContext,
} from "../lib/job-context.js";
import { loadSettings, saveSettings } from "../lib/settings.js";
import { getLlmProviderLabel, getLlmProviderIconSvg } from "../lib/llm-provider.js";
import { shouldShowOnboarding, completeOnboarding, ONBOARDING_STEPS } from "../lib/onboarding.js";
import { parseRestructureJobResponse } from "../lib/restructure-job-response.js";
import {
  buildResumeDownloadFilename,
  downloadResumePdf,
  encodeResumePdfBase64,
} from "../lib/resume-pdf.js";
import { parseTailorResponse, normalizeAtsScoreResult, hasTailoredContent } from "../lib/tailor-response.js";
import {
  buildDisplayAtsScore,
  ensureTailoredResumeCoverage,
} from "../lib/job-core-skills.js";
import { createResumeEditor } from "./resume-editor.js";

const PROFILE_KEY = "capply_profile_resume";
const PROFILE_STRUCTURED_KEY = "capply_profile_resume_structured";
const APPLICATION_KEY = "capply_application_resume";
const APPLICATION_STRUCTURED_KEY = "capply_application_resume_structured";
const APPLICATION_CHANGES_KEY = "capply_application_changes";
const APPLICATION_ATS_KEY = "capply_application_ats";
const APPLICATION_COMPANY_KEY = "capply_application_company";
const APPLICATION_JOB_URL_KEY = "capply_application_job_url";
const LEGACY_APPLICATION_KEYS = [
  APPLICATION_KEY,
  APPLICATION_STRUCTURED_KEY,
  APPLICATION_CHANGES_KEY,
  APPLICATION_ATS_KEY,
  APPLICATION_COMPANY_KEY,
  APPLICATION_JOB_URL_KEY,
];
const LEGACY_KEY = "capply_resume";
const LEGACY_STRUCTURED_KEY = "capply_resume_structured";
const PAGE_ORIGINS = ["https://*/*", "http://*/*"];

const TAB_IDS = ["application", "history", "analysis", "profile"];

const els = {
  mainTabs: document.querySelectorAll(".main-tab"),
  tabPanels: {
    profile: document.getElementById("panel-profile"),
    application: document.getElementById("panel-application"),
    history: document.getElementById("panel-history"),
    analysis: document.getElementById("panel-analysis"),
  },
  profileResumeEditor: document.getElementById("profileResumeEditor"),
  fillProfileBtn: document.getElementById("fillProfileBtn"),
  tailoredResumeSection: document.getElementById("tailoredResumeSection"),
  tailoredResumeEditor: document.getElementById("tailoredResumeEditor"),
  jobDescription: document.getElementById("jobDescription"),
  companyName: document.getElementById("companyName"),
  position: document.getElementById("position"),
  jobUrl: document.getElementById("jobUrl"),
  jobPosted: document.getElementById("jobPosted"),
  jobCreated: document.getElementById("jobCreated"),
  jobModified: document.getElementById("jobModified"),
  tailorBtn: document.getElementById("tailorBtn"),
  tailorBtnIcon: document.getElementById("tailorBtnIcon"),
  tailorBtnLabel: document.querySelector("#tailorBtn .tailor-btn-label"),
  applicationActionsSecondary: document.getElementById("applicationActionsSecondary"),
  downloadResumeBtn: document.getElementById("downloadResumeBtn"),
  previewResumeBtn: document.getElementById("previewResumeBtn"),
  newApplicationBtn: document.getElementById("newApplicationBtn"),
  editApplicationBtn: document.getElementById("editApplicationBtn"),
  applicationFields: document.getElementById("applicationFields"),
  autoFillApplicationBtn: document.getElementById("autoFillApplicationBtn"),
  grabFromPage: document.getElementById("grabFromPage"),
  restructureJobBtn: document.getElementById("restructureJobBtn"),
  clearProfile: document.getElementById("clearProfile"),
  downloadProfileResumeBtn: document.getElementById("downloadProfileResumeBtn"),
  profileFile: document.getElementById("profileFile"),
  saveProfile: document.getElementById("saveProfile"),
  profileStatus: document.getElementById("profileStatus"),
  status: document.getElementById("status"),
  atsScoreSection: document.getElementById("atsScoreSection"),
  atsScoreRing: document.getElementById("atsScoreRing"),
  atsScoreValue: document.getElementById("atsScoreValue"),
  atsScoreSummary: document.getElementById("atsScoreSummary"),
  atsResumeSource: document.getElementById("atsResumeSource"),
  historyList: document.getElementById("historyList"),
  historyEmpty: document.getElementById("historyEmpty"),
  historySearch: document.getElementById("historySearch"),
  historyCompanySearch: document.getElementById("historyCompanySearch"),
  historyPositionSearch: document.getElementById("historyPositionSearch"),
  clearHistory: document.getElementById("clearHistory"),
  jobsTabs: document.querySelectorAll(".jobs-tab"),
  settingsBtn: document.getElementById("settingsBtn"),
  coverLetterSection: document.getElementById("coverLetterSection"),
  coverLetter: document.getElementById("coverLetter"),
  copyCoverLetterBtn: document.getElementById("copyCoverLetterBtn"),
  analysisEmpty: document.getElementById("analysisEmpty"),
  analysisReport: document.getElementById("analysisReport"),
  analysisScoreRing: document.getElementById("analysisScoreRing"),
  analysisScoreValue: document.getElementById("analysisScoreValue"),
  analysisSummary: document.getElementById("analysisSummary"),
  analysisTarget: document.getElementById("analysisTarget"),
  analysisRecommendations: document.getElementById("analysisRecommendations"),
  analysisFixableGaps: document.getElementById("analysisFixableGaps"),
  analysisUnsupportedGaps: document.getElementById("analysisUnsupportedGaps"),
  analysisPriorityKeywords: document.getElementById("analysisPriorityKeywords"),
  refreshAnalysisBtn: document.getElementById("refreshAnalysisBtn"),
  historyStats: document.getElementById("historyStats"),
  exportHistoryBtn: document.getElementById("exportHistoryBtn"),
  settingsPanel: document.getElementById("panel-settings"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  settingsStatus: document.getElementById("settingsStatus"),
  settingsDefaultTone: document.getElementById("settingsDefaultTone"),
  settingsDefaultOutput: document.getElementById("settingsDefaultOutput"),
  settingsExtraInstructions: document.getElementById("settingsExtraInstructions"),
  settingsLlmProvider: document.getElementById("settingsLlmProvider"),
  settingsAutoSend: document.getElementById("settingsAutoSend"),
  settingsUseOpenAiApi: document.getElementById("settingsUseOpenAiApi"),
  settingsOpenAiModel: document.getElementById("settingsOpenAiModel"),
  settingsOpenAiApiKey: document.getElementById("settingsOpenAiApiKey"),
  settingsPromptModifyTailor: document.getElementById("settingsPromptModifyTailor"),
  settingsPromptModifyFillProfile: document.getElementById("settingsPromptModifyFillProfile"),
  settingsPromptModifyRestructure: document.getElementById("settingsPromptModifyRestructure"),
  appSubtitle: document.getElementById("appSubtitle"),
  settingsAutoSendLabel: document.getElementById("settingsAutoSendLabel"),
  settingsPromptHint: document.getElementById("settingsPromptHint"),
  onboardingOverlay: document.getElementById("onboardingOverlay"),
  onboardingStepLabel: document.getElementById("onboardingStepLabel"),
  onboardingTitle: document.getElementById("onboardingTitle"),
  onboardingBody: document.getElementById("onboardingBody"),
  onboardingSkipBtn: document.getElementById("onboardingSkipBtn"),
  onboardingNextBtn: document.getElementById("onboardingNextBtn"),
  scrollToTopBtn: document.getElementById("scrollToTopBtn"),
};

const SCROLL_TOP_THRESHOLD = 120;

/** @type {import("../lib/tailor-history.js").JobStatus} */
let activeJobsTab = "saved";

const JOBS_EMPTY_MESSAGES = {
  saved: "No saved jobs yet. Tailor a resume on the Application tab.",
  applied: "No applied jobs yet. Mark a saved job as applied when you submit.",
  interview: "No interviews yet. Move an applied job here when you get an interview.",
  archived: "No archived jobs yet.",
};

const profileEditor = createResumeEditor(els.profileResumeEditor);

const tailoredEditor = createResumeEditor(els.tailoredResumeEditor, {
  onChange: () => {
    persistJobContext();
    updateAtsScore();
    updateApplicationActionButton();
  },
});

/** @type {string[]} */
let latestTailorChanges = [];

/** @type {import("../lib/tailor-response.js").AtsScoreResult | null} */
let latestAtsFromAi = null;

let atsUpdateTimer = 0;
let jobContextTimer = 0;

/** @type {string | null} */
let activeJobContextKey = null;

/** @type {boolean} */
let tailorInProgress = false;

/** @type {boolean} */
let restructureInProgress = false;

/** @type {boolean} */
let tailoredResumeReady = false;

/** @type {boolean} */
let applicationEditMode = false;

/** @type {string} */
let latestCoverLetter = "";

/** @type {string} */
let lastMainTab = "application";

/** @type {number} */
let onboardingStepIndex = 0;

/** @type {import("../lib/settings.js").AppSettings | null} */
let appSettings = null;

/**
 * Browser tab + storage key captured when tailoring starts so tab switches
 * during ChatGPT do not wipe the form or save results to the wrong tab.
 * @type {{ tabId: number, contextKey: string } | null}
 */
let tailorSession = null;

const TAILOR_TIMEOUT_MS = 320_000;

function getActiveLlmLabel() {
  return getLlmProviderLabel(appSettings);
}

function updateProviderUi() {
  const label = getActiveLlmLabel();
  if (els.appSubtitle) {
    els.appSubtitle.textContent = `Tailor your resume with ${label}`;
  }
  if (els.settingsAutoSendLabel) {
    els.settingsAutoSendLabel.textContent = `Auto-send to ${label} by default`;
  }
  if (els.atsResumeSource && !tailorInProgress) {
    els.atsResumeSource.textContent = label;
  }
  if (els.tailorBtnIcon) {
    els.tailorBtnIcon.innerHTML = getLlmProviderIconSvg(appSettings);
  }
}

/**
 * @param {unknown} message
 * @param {number} [timeoutMs]
 */
function sendBackgroundMessage(message, timeoutMs = TAILOR_TIMEOUT_MS) {
  const label = getActiveLlmLabel();
  return Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Tailoring timed out. Check the ${label} tab — if the JSON response is ready, click Re-tailor.`
          )
        );
      }, timeoutMs);
    }),
  ]);
}

init();

async function init() {
  await loadProfileResume();
  appSettings = await loadSettings();
  applySettingsToForm(appSettings);
  updateProviderUi();
  updateCoverLetterVisibility();

  const tab = await getActiveBrowserTab();
  if (tab) {
    activeBrowserTabId = tab.tabId;
    activeJobContextKey = getJobContextKey(tab.url, tab.tabId);
  } else {
    activeJobContextKey = getJobContextKey();
  }

  await migrateLegacyApplicationState(activeJobContextKey);
  applyApplicationState(await loadJobContext(activeJobContextKey));

  els.mainTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      getActiveBrowserTab().then((tab) => {
        if (tab) activeBrowserTabId = tab.tabId;
      });
      persistJobContext();
    }
  });

  els.tailorBtn.addEventListener("click", onTailor);
  els.newApplicationBtn.addEventListener("click", onNewApplication);
  els.editApplicationBtn.addEventListener("click", onToggleApplicationEdit);
  els.autoFillApplicationBtn.addEventListener("click", onAutoFillApplication);
  els.downloadResumeBtn.addEventListener("click", onDownloadTailoredResume);
  els.previewResumeBtn.addEventListener("click", onPreviewTailoredResume);
  els.grabFromPage.addEventListener("click", onGrabFromPage);
  els.restructureJobBtn.addEventListener("click", onRestructureJobDescription);
  els.clearProfile.addEventListener("click", onClearProfile);
  els.downloadProfileResumeBtn.addEventListener("click", onDownloadProfileResume);
  els.profileFile.addEventListener("change", onProfileFile);
  els.saveProfile.addEventListener("click", onSaveProfile);
  els.fillProfileBtn.addEventListener("click", onFillProfile);
  els.jobDescription.addEventListener("input", onApplicationInput);
  els.companyName.addEventListener("input", scheduleJobContextSave);
  els.position.addEventListener("input", scheduleJobContextSave);
  els.jobUrl.addEventListener("input", scheduleJobContextSave);
  els.settingsDefaultOutput?.addEventListener("change", updateCoverLetterVisibility);
  els.clearHistory.addEventListener("click", onClearHistory);
  els.historyList.addEventListener("click", onHistoryListClick);
  els.historyCompanySearch.addEventListener("input", () => renderHistory());
  els.historyPositionSearch.addEventListener("input", () => renderHistory());
  els.jobsTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveJobsTab(tab.dataset.jobsTab));
  });
  els.settingsBtn.addEventListener("click", showSettingsPanel);
  els.closeSettingsBtn.addEventListener("click", hideSettingsPanel);
  els.saveSettingsBtn.addEventListener("click", onSaveSettings);
  els.refreshAnalysisBtn.addEventListener("click", renderAnalysis);
  els.exportHistoryBtn.addEventListener("click", onExportHistory);
  els.copyCoverLetterBtn.addEventListener("click", onCopyCoverLetter);
  els.coverLetter.addEventListener("input", scheduleJobContextSave);
  els.onboardingSkipBtn.addEventListener("click", dismissOnboarding);
  els.onboardingNextBtn.addEventListener("click", advanceOnboarding);
  initScrollToTop();

  updateApplicationActionButton();
  await renderHistory();
  await maybeShowOnboarding();
}

async function loadProfileResume() {
  const stored = await chrome.storage.local.get([
    PROFILE_KEY,
    PROFILE_STRUCTURED_KEY,
    LEGACY_KEY,
    LEGACY_STRUCTURED_KEY,
  ]);

  if (stored[PROFILE_STRUCTURED_KEY]) {
    const structured = normalizeResume(stored[PROFILE_STRUCTURED_KEY]);
    if (!structured.skills?.trim() && stored[PROFILE_KEY]) {
      const reparsed = parseResumeText(stored[PROFILE_KEY]);
      if (reparsed.skills?.trim()) {
        structured.skills = reparsed.skills;
      }
    }
    profileEditor.setStructured(structured);
    return;
  }

  if (stored[PROFILE_KEY]) {
    profileEditor.setText(stored[PROFILE_KEY]);
    return;
  }

  if (stored[LEGACY_STRUCTURED_KEY]) {
    profileEditor.setStructured(stored[LEGACY_STRUCTURED_KEY]);
    await persistProfile();
    return;
  }

  if (stored[LEGACY_KEY]) {
    profileEditor.setText(stored[LEGACY_KEY]);
    await persistProfile();
  }
}

async function migrateLegacyApplicationState(contextKey) {
  const stored = await chrome.storage.local.get(LEGACY_APPLICATION_KEYS);
  const hasLegacy = LEGACY_APPLICATION_KEYS.some((key) => {
    const value = stored[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

  if (!hasLegacy) return;

  const existing = await loadJobContext(contextKey);
  if (
    existing?.structured ||
    existing?.resumeText?.trim() ||
    existing?.jobDescription?.trim() ||
    existing?.companyName?.trim() ||
    existing?.position?.trim() ||
    existing?.jobUrl?.trim()
  ) {
    return;
  }

  await saveJobContext(contextKey, {
    companyName: stored[APPLICATION_COMPANY_KEY] || "",
    jobUrl: stored[APPLICATION_JOB_URL_KEY] || "",
    resumeText: stored[APPLICATION_KEY] || "",
    structured: stored[APPLICATION_STRUCTURED_KEY] || null,
    changes: stored[APPLICATION_CHANGES_KEY] || [],
    atsScore: stored[APPLICATION_ATS_KEY] ?? null,
    jobDescription: "",
  });

  await chrome.storage.local.remove(LEGACY_APPLICATION_KEYS);
}

function collectApplicationState() {
  const structured = tailoredEditor.getStructured();
  const resumeText = tailoredEditor.getText();
  const hasTailored =
    hasResumeContent(structured) || Boolean(resumeText.trim());

  return {
    jobDescription: els.jobDescription.value,
    companyName: els.companyName.value.trim(),
    position: els.position.value.trim(),
    jobUrl: els.jobUrl.value.trim(),
    jobPosted: els.jobPosted.value.trim(),
    jobCreated: els.jobCreated.value.trim(),
    jobModified: els.jobModified.value.trim(),
    resumeText: hasTailored ? resumeText : "",
    structured: hasTailored ? structured : null,
    changes: latestTailorChanges,
    atsScore: latestAtsFromAi,
    coverLetter: latestCoverLetter || els.coverLetter.value.trim(),
  };
}

/**
 * @param {import("../lib/job-context.js").JobContextState | null} state
 */
function applyApplicationState(state) {
  els.jobDescription.value = state?.jobDescription ?? "";
  els.companyName.value = state?.companyName ?? "";
  els.position.value = state?.position ?? "";
  els.jobUrl.value = state?.jobUrl ?? "";
  els.jobPosted.value = state?.jobPosted ?? "";
  els.jobCreated.value = state?.jobCreated ?? "";
  els.jobModified.value = state?.jobModified ?? "";
  latestTailorChanges = state?.changes ?? [];
  latestAtsFromAi = state?.atsScore ?? null;
  latestCoverLetter = state?.coverLetter ?? "";
  els.coverLetter.value = latestCoverLetter;
  updateCoverLetterVisibility();

  if (state?.structured && hasResumeContent(normalizeResume(state.structured))) {
    showTailoredResume(state.structured, latestTailorChanges, latestAtsFromAi);
    updateAtsScore();
    return;
  }

  if (state?.resumeText?.trim()) {
    tailoredEditor.setText(state.resumeText, { silent: true });
    els.tailoredResumeSection.hidden = false;
    tailoredResumeReady = hasResumeContent(tailoredEditor.getStructured());
    updateAtsScore();
    updateApplicationActionButton();
    return;
  }

  resetTailoredApplicationUi();
  updateAtsScore();
  updateJobDescriptionActions();
}

function resetTailoredApplicationUi() {
  latestTailorChanges = [];
  latestAtsFromAi = null;
  latestCoverLetter = "";
  els.coverLetter.value = "";
  els.coverLetterSection.hidden = true;
  tailoredResumeReady = false;
  applicationEditMode = false;
  tailoredEditor.setStructured(emptyResume(), { silent: true });
  els.tailoredResumeSection.hidden = true;
  els.atsScoreSection.hidden = true;
  els.applicationActionsSecondary.hidden = true;
  updateApplicationActionButton();
}

function hasTailoredResume() {
  return tailoredResumeReady && hasResumeContent(tailoredEditor.getStructured());
}

function setTailorBtnLabel(text) {
  if (els.tailorBtnLabel) els.tailorBtnLabel.textContent = text;
}

function getTailorActionLabel() {
  if (tailorInProgress) return "Tailoring…";
  return hasTailoredResume()
    ? els.tailorBtn.dataset.retailorLabel || "Re-tailor"
    : els.tailorBtn.dataset.tailorLabel || "Tailor";
}

function getApplicationFieldElements() {
  return [
    els.jobUrl,
    els.position,
    els.companyName,
    els.jobPosted,
    els.jobCreated,
    els.jobModified,
    els.jobDescription,
  ].filter(Boolean);
}

/**
 * @param {boolean} locked
 */
function setApplicationFieldsLocked(locked) {
  for (const el of getApplicationFieldElements()) {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      if (el.type === "checkbox") {
        el.disabled = locked;
      } else {
        el.readOnly = locked;
      }
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      el.disabled = locked;
    }
  }

  els.applicationFields?.classList.toggle("is-locked", locked);
}

function updateApplicationFieldEditing() {
  const hasTailored = hasTailoredResume() && !tailorInProgress;
  const editable = !hasTailored || applicationEditMode;

  els.editApplicationBtn.hidden = !hasTailored;
  els.editApplicationBtn.textContent = applicationEditMode ? "Done" : "Edit";
  els.editApplicationBtn.setAttribute("aria-pressed", String(applicationEditMode));
  setApplicationFieldsLocked(!editable);

  if (!hasTailored) {
    applicationEditMode = false;
    els.editApplicationBtn.setAttribute("aria-pressed", "false");
  }
}

function onToggleApplicationEdit() {
  if (!hasTailoredResume() || tailorInProgress) return;

  applicationEditMode = !applicationEditMode;
  updateApplicationFieldEditing();
  updateJobDescriptionActions();

  if (applicationEditMode) {
    els.jobDescription.focus();
    setStatus("Application fields unlocked for editing.", "success");
    return;
  }

  setStatus("Application fields locked.", "success");
  void persistJobContext();
}

function updateApplicationActionButton() {
  if (
    !tailorInProgress &&
    tailoredResumeReady &&
    !hasResumeContent(tailoredEditor.getStructured())
  ) {
    tailoredResumeReady = false;
  }

  const showSecondary = hasTailoredResume() && !tailorInProgress;

  els.applicationActionsSecondary.hidden = !showSecondary;
  setTailorBtnLabel(getTailorActionLabel());
  els.tailorBtn.disabled = tailorInProgress;
  els.downloadResumeBtn.disabled = tailorInProgress;
  els.previewResumeBtn.disabled = tailorInProgress;

  if (tailorInProgress) {
    els.tailorBtn.classList.add("busy");
    els.tailorBtn.setAttribute("aria-busy", "true");
  } else {
    els.tailorBtn.classList.remove("busy");
    els.tailorBtn.setAttribute("aria-busy", "false");
  }

  updateApplicationFieldEditing();
  updateJobDescriptionActions();
  updateAtsScore();
}

function updateJobDescriptionActions() {
  const hasJobText = Boolean(els.jobDescription.value.trim());
  const applicationEditable = !hasTailoredResume() || applicationEditMode;
  const showRestructure =
    hasJobText &&
    applicationEditable &&
    !hasTailoredResume() &&
    !tailorInProgress &&
    !tailorInProgress &&
    !restructureInProgress;

  els.restructureJobBtn.hidden = !showRestructure;
  els.grabFromPage.disabled =
    !applicationEditable ||
    tailorInProgress ||
    restructureInProgress;
  els.restructureJobBtn.disabled = restructureInProgress;
  els.autoFillApplicationBtn.disabled =
    (!applicationEditable && hasTailoredResume()) ||
    tailorInProgress;
}

function getApplicationPosition() {
  return normalizeJobRoleTitle(
    els.position.value.trim() || inferJobRole(els.jobDescription.value)
  );
}

function onDownloadTailoredResume() {
  const structured = tailoredEditor.getStructured();
  const resumeText = tailoredEditor.getText().trim();

  if (!resumeText) {
    setStatus("Nothing to download.", "error");
    updateApplicationActionButton();
    return;
  }

  const name = structured.contact.name?.trim() || "resume";
  const role = getApplicationPosition();
  const filename = buildResumeDownloadFilename(name, role);

  downloadResumePdf(structured, filename);
  setStatus("Resume downloaded.", "success");
}

async function onPreviewTailoredResume() {
  const structured = tailoredEditor.getStructured();
  const resumeText = tailoredEditor.getText().trim();

  if (!resumeText) {
    setStatus("Nothing to preview.", "error");
    updateApplicationActionButton();
    return;
  }

  const name = structured.contact.name?.trim() || "Resume";
  const role = getApplicationPosition();
  const title = role ? `${name} — ${role}` : name;

  try {
    els.previewResumeBtn.disabled = true;
    await ensurePageAccess();
    const base64 = await encodeResumePdfBase64(structured);
    const response = await chrome.runtime.sendMessage({
      type: "PREVIEW_RESUME_ON_PAGE",
      base64,
      title,
    });

    if (response === undefined) {
      throw new Error(
        "Lost connection to the extension background. Reload cApply in chrome://extensions and try again."
      );
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Could not open resume preview.");
    }

    setStatus("Resume preview opened on the current page.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    updateApplicationActionButton();
  }
}

async function onNewApplication() {
  if (tailorInProgress) {
    setStatus("Wait for tailoring to finish.", "error");
    return;
  }

  els.jobDescription.value = "";
  els.companyName.value = "";
  els.position.value = "";
  els.jobUrl.value = "";
  els.jobPosted.value = "";
  els.jobCreated.value = "";
  els.jobModified.value = "";
  applicationEditMode = false;
  resetTailoredApplicationUi();
  setStatus("");

  if (!activeJobContextKey) activeJobContextKey = getJobContextKey();
  await saveJobContext(activeJobContextKey, {
    jobDescription: "",
    companyName: "",
    position: "",
    jobUrl: "",
    jobPosted: "",
    jobCreated: "",
    jobModified: "",
    resumeText: "",
    structured: null,
    changes: [],
    atsScore: null,
  });

  const tab = await getActiveBrowserTab();
  if (
    tab?.url &&
    !tab.url.startsWith("chrome") &&
    !tab.url.startsWith("edge") &&
    !tab.url.startsWith("about:")
  ) {
    els.jobUrl.value = tab.url;
    await persistJobContext();
  }

  els.jobDescription.focus();
}

async function onAutoFillApplication() {
  if (tailorInProgress) {
    setStatus("Wait for the current operation to finish.", "error");
    return;
  }

  setStatus("Auto filling from current page…");
  els.autoFillApplicationBtn.disabled = true;

  try {
    const tab = await getActiveBrowserTab();
    if (
      tab?.url &&
      !tab.url.startsWith("chrome") &&
      !tab.url.startsWith("edge") &&
      !tab.url.startsWith("about:")
    ) {
      els.jobUrl.value = tab.url;
    }

    await ensurePageAccess();
    const response = await chrome.runtime.sendMessage({ type: "GRAB_PAGE_TEXT" });
    if (!response?.ok) throw new Error(response?.error || "Failed to auto fill from page");

    els.jobDescription.value = response.text;
    if (response.pageUrl) {
      els.jobUrl.value = response.pageUrl;
    }
    if (response.meta) {
      applyGrabMeta(response.meta, { overwrite: true });
    }

    latestAtsFromAi = null;
    await persistJobContext();
    updateAtsScore();
    renderAnalysis();
    updateJobDescriptionActions();
    setStatus("Application auto filled from the current page.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    els.autoFillApplicationBtn.disabled = false;
    updateJobDescriptionActions();
  }
}

/** @type {number | null} */
let activeBrowserTabId = null;

async function flushJobContextSave() {
  window.clearTimeout(jobContextTimer);
  window.clearTimeout(atsUpdateTimer);

  if (!activeJobContextKey) activeJobContextKey = await resolveContextKey();
  await saveJobContext(activeJobContextKey, collectApplicationState());
}

async function resolveContextKey() {
  const tab = await getActiveBrowserTab();
  const url = els.jobUrl.value.trim() || tab?.url || "";
  return getJobContextKey(url, tab?.tabId ?? activeBrowserTabId ?? undefined);
}

async function persistJobContext(contextKey = activeJobContextKey) {
  window.clearTimeout(jobContextTimer);

  let key = contextKey || (await resolveContextKey());
  if (!contextKey) {
    const tab = await getActiveBrowserTab();
    if (tab) activeBrowserTabId = tab.tabId;
  }
  activeJobContextKey = key;

  await saveJobContext(key, collectApplicationState());
}

function scheduleJobContextSave() {
  window.clearTimeout(jobContextTimer);
  jobContextTimer = window.setTimeout(() => {
    persistJobContext();
  }, 250);
}

function onApplicationInput() {
  if (!hasTailoredResume()) {
    latestAtsFromAi = null;
  }
  scheduleAtsScoreUpdate();
  scheduleJobContextSave();
  updateJobDescriptionActions();
  if (!els.tabPanels.analysis.hidden) {
    renderAnalysis();
  }
}

function getActiveScrollPanel() {
  if (els.settingsPanel && !els.settingsPanel.hidden) {
    return els.settingsPanel;
  }
  return Object.values(els.tabPanels).find((panel) => !panel.hidden) ?? null;
}

function updateScrollToTopVisibility() {
  const panel = getActiveScrollPanel();
  const show = Boolean(panel && panel.scrollTop > SCROLL_TOP_THRESHOLD);
  els.scrollToTopBtn.hidden = !show;
}

function initScrollToTop() {
  const panels = [...Object.values(els.tabPanels), els.settingsPanel].filter(Boolean);
  panels.forEach((panel) => {
    panel.addEventListener("scroll", updateScrollToTopVisibility, { passive: true });
  });
  els.scrollToTopBtn.addEventListener("click", () => {
    getActiveScrollPanel()?.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setActiveTab(tabId) {
  if (!TAB_IDS.includes(tabId)) return;

  lastMainTab = tabId;
  hideSettingsPanel(false);

  els.mainTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  TAB_IDS.forEach((id) => {
    const panel = els.tabPanels[id];
    const isActive = id === tabId;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });

  if (tabId === "application") {
    updateAtsScore();
    updateCoverLetterVisibility();
  }

  updateScrollToTopVisibility();

  if (tabId === "history") {
    renderHistory();
  }

  if (tabId === "analysis") {
    renderAnalysis();
  }
}

function getCurrentMainTab() {
  const active = [...els.mainTabs].find((tab) => tab.classList.contains("active"));
  return active?.dataset.tab || lastMainTab;
}

/**
 * @param {boolean} [restoreTab]
 */
function hideSettingsPanel(restoreTab = true) {
  if (!els.settingsPanel) return;
  els.settingsPanel.hidden = true;
  els.settingsPanel.classList.remove("active");
  if (restoreTab) setActiveTab(lastMainTab);
  else updateScrollToTopVisibility();
}

function showSettingsPanel() {
  lastMainTab = getCurrentMainTab();
  TAB_IDS.forEach((id) => {
    els.tabPanels[id].hidden = true;
    els.tabPanels[id].classList.remove("active");
  });
  els.mainTabs.forEach((tab) => {
    tab.classList.remove("active");
    tab.setAttribute("aria-selected", "false");
  });
  els.settingsPanel.hidden = false;
  els.settingsPanel.classList.add("active");
  if (appSettings) applySettingsToForm(appSettings);
  updateScrollToTopVisibility();
}

/**
 * @param {import("../lib/settings.js").AppSettings} settings
 */
function applySettingsToForm(settings) {
  els.settingsDefaultTone.value = settings.defaultTone;
  els.settingsDefaultOutput.value = settings.defaultOutputFormat;
  if (els.settingsLlmProvider) {
    els.settingsLlmProvider.value = settings.llmProvider || "chatgpt";
  }
  els.settingsAutoSend.checked = settings.autoSend;
  if (els.settingsExtraInstructions) {
    els.settingsExtraInstructions.value = settings.extraInstructions || "";
  }
  els.settingsUseOpenAiApi.checked = settings.useOpenAiApi;
  els.settingsOpenAiModel.value = settings.openAiModel;
  els.settingsOpenAiApiKey.value = settings.openAiApiKey;
  if (els.settingsPromptModifyTailor) {
    els.settingsPromptModifyTailor.value = settings.promptModifyTailor || "";
  }
  if (els.settingsPromptModifyFillProfile) {
    els.settingsPromptModifyFillProfile.value = settings.promptModifyFillProfile || "";
  }
  if (els.settingsPromptModifyRestructure) {
    els.settingsPromptModifyRestructure.value = settings.promptModifyRestructure || "";
  }
}

async function onSaveSettings() {
  appSettings = await saveSettings({
    defaultTone: els.settingsDefaultTone.value,
    defaultOutputFormat: els.settingsDefaultOutput.value,
    llmProvider: els.settingsLlmProvider?.value || "chatgpt",
    autoSend: els.settingsAutoSend.checked,
    extraInstructions: els.settingsExtraInstructions?.value.trim() || "",
    useOpenAiApi: els.settingsUseOpenAiApi.checked,
    openAiModel: els.settingsOpenAiModel.value.trim() || "gpt-4o-mini",
    openAiApiKey: els.settingsOpenAiApiKey.value.trim(),
    promptModifyTailor: els.settingsPromptModifyTailor?.value.trim() || "",
    promptModifyFillProfile: els.settingsPromptModifyFillProfile?.value.trim() || "",
    promptModifyRestructure: els.settingsPromptModifyRestructure?.value.trim() || "",
  });
  applySettingsToForm(appSettings);
  updateProviderUi();
  updateCoverLetterVisibility();
  els.settingsStatus.textContent = "Settings saved.";
  els.settingsStatus.className = "status success";
}

function updateCoverLetterVisibility() {
  const wantsCoverLetter = appSettings.defaultOutputFormat === "cover letter + resume";
  const hasLetter = Boolean(latestCoverLetter.trim() || els.coverLetter.value.trim());
  els.coverLetterSection.hidden = !(wantsCoverLetter || hasLetter);
}

function onCopyCoverLetter() {
  const text = els.coverLetter.value.trim();
  if (!text) {
    setStatus("No cover letter to copy.", "error");
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => setStatus("Cover letter copied.", "success"),
    () => setStatus("Could not copy cover letter.", "error")
  );
}

function fillAnalysisList(listEl, items, emptyText) {
  listEl.innerHTML = "";
  if (!items.length) {
    const item = document.createElement("li");
    item.textContent = emptyText;
    listEl.appendChild(item);
    return;
  }
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text;
    listEl.appendChild(item);
  }
}

function renderAnalysis() {
  const profileResume = serializeResume(profileEditor.getStructured());
  const jobDescription = els.jobDescription.value.trim();
  const report = buildAnalysisReport(jobDescription, profileResume);

  if (!jobDescription || !profileResume.trim()) {
    els.analysisEmpty.hidden = false;
    els.analysisReport.hidden = true;
    return;
  }

  els.analysisEmpty.hidden = true;
  els.analysisReport.hidden = false;

  const tier = scoreTier(report.score);
  els.analysisScoreValue.textContent = String(report.score);
  els.analysisScoreRing.className = `ats-score-ring tier-${tier}`;
  els.analysisSummary.textContent = report.summary;
  els.analysisTarget.textContent = `Target: ${report.target}% keyword overlap`;

  fillAnalysisList(
    els.analysisRecommendations,
    report.recommendations,
    "No recommendations yet."
  );
  fillAnalysisList(els.analysisFixableGaps, report.fixableGaps, "No fixable gaps detected.");
  fillAnalysisList(
    els.analysisUnsupportedGaps,
    report.unsupportedGaps,
    "No unsupported gaps listed."
  );

  els.analysisPriorityKeywords.innerHTML = "";
  for (const keyword of report.priorityKeywords) {
    const tag = document.createElement("li");
    tag.textContent = keyword;
    els.analysisPriorityKeywords.appendChild(tag);
  }
}

async function onExportHistory() {
  const history = await loadTailorHistory();
  const csv = exportHistoryCsv(history);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `capply-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function maybeShowOnboarding() {
  if (!(await shouldShowOnboarding())) return;
  onboardingStepIndex = 0;
  renderOnboardingStep();
  els.onboardingOverlay.hidden = false;
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboardingStepIndex];
  if (!step) return;
  els.onboardingStepLabel.textContent = `Step ${onboardingStepIndex + 1} of ${ONBOARDING_STEPS.length}`;
  els.onboardingTitle.textContent = step.title;
  els.onboardingBody.textContent = step.body;
  els.onboardingNextBtn.textContent =
    onboardingStepIndex === ONBOARDING_STEPS.length - 1 ? "Get started" : "Next";
}

async function dismissOnboarding() {
  els.onboardingOverlay.hidden = true;
  try {
    await completeOnboarding();
  } catch {
    // Still close the overlay even if storage fails.
  }
}

async function advanceOnboarding() {
  if (onboardingStepIndex >= ONBOARDING_STEPS.length - 1) {
    await dismissOnboarding();
    return;
  }
  onboardingStepIndex += 1;
  renderOnboardingStep();
}

function setStatus(message, type = "") {
  els.status.textContent = message;
  els.status.className = `status${type ? ` ${type}` : ""}`;
}

function setProfileStatus(message, type = "") {
  els.profileStatus.textContent = message;
  els.profileStatus.className = `status${type ? ` ${type}` : ""}`;
}

function getProfileResumeText() {
  return profileEditor.getText();
}

function scheduleAtsScoreUpdate() {
  window.clearTimeout(atsUpdateTimer);
  atsUpdateTimer = window.setTimeout(updateAtsScore, 250);
}

function normalizeDisplayAtsScore(value) {
  return normalizeAtsScoreResult(value);
}

function updateAtsScore() {
  const hasResume =
    hasTailoredResume() || hasResumeContent(tailoredEditor.getStructured());

  if (!hasResume) {
    els.atsScoreSection.hidden = true;
    return;
  }

  const atsScore = normalizeDisplayAtsScore(latestAtsFromAi);

  if (!atsScore || atsScore.score == null) {
    els.atsScoreSection.hidden = tailorInProgress;
    els.atsResumeSource.textContent = getActiveLlmLabel();
    els.atsScoreValue.textContent = "—";
    els.atsScoreRing.className = "ats-score-ring";
    els.atsScoreRing.setAttribute("aria-label", "ATS match score unavailable");
    els.atsScoreSummary.textContent =
      "No ATS score was returned. Try re-tailoring this job.";
    return;
  }

  const tier = scoreTier(atsScore.score);
  const llmLabel = getActiveLlmLabel();

  els.atsResumeSource.textContent = llmLabel;
  els.atsScoreValue.textContent = String(atsScore.score);
  els.atsScoreRing.className = `ats-score-ring tier-${tier}`;
  els.atsScoreRing.setAttribute(
    "aria-label",
    `ATS match score ${atsScore.score} percent`
  );
  els.atsScoreSummary.textContent =
    atsScore.summary ||
    `${llmLabel} estimates ${atsScore.score}% ATS match for this tailored resume.`;
  els.atsScoreSection.hidden = tailorInProgress;
}

function showTailoredResume(structured, changes = [], atsScore) {
  const normalized = normalizeResume(structured);
  latestTailorChanges = changes;
  if (atsScore !== undefined) {
    latestAtsFromAi = atsScore;
  }
  tailoredResumeReady = hasResumeContent(normalized);
  tailoredEditor.setStructured(normalized, { silent: true });
  if (!tailorInProgress) {
    els.tailoredResumeSection.hidden = false;
  }
  updateAtsScore();
  updateApplicationActionButton();
  if (!tailorInProgress && hasTailoredResume()) {
    els.atsScoreSection.scrollIntoView({ block: "nearest" });
  }
}

async function persistProfile() {
  const text = profileEditor.getText();
  const structured = profileEditor.getStructured();
  await chrome.storage.local.set({
    [PROFILE_KEY]: text,
    [PROFILE_STRUCTURED_KEY]: structured,
  });
}

async function openHistoryEntry(entry) {
  els.jobDescription.value = entry.jobDescription;
  els.companyName.value = entry.companyName || "";
  els.position.value = entry.position?.trim() || historyEntryPosition(entry);
  els.jobUrl.value = entry.jobUrl || "";
  latestCoverLetter = entry.coverLetter || "";
  els.coverLetter.value = latestCoverLetter;
  updateCoverLetterVisibility();
  applicationEditMode = false;
  showTailoredResume(entry.structured, entry.changes, entry.atsScore);
  activeJobContextKey = getJobContextKey(entry.jobUrl || "", undefined);
  await persistJobContext(activeJobContextKey);
  setActiveTab("application");
  setStatus("");
}

/**
 * @param {import("../lib/tailor-history.js").TailorHistoryEntry} entry
 */
function historyEntryCompanyName(entry) {
  const company = entry.companyName?.trim();
  if (company) return company;

  const title = entry.title?.trim() || "";
  if (title.includes(" · ")) {
    return title.split(" · ")[0].trim();
  }

  return "";
}

/**
 * @param {string} companyName
 */
function historyCompanyInitial(companyName) {
  const match = companyName.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : "?";
}

/**
 * @param {string} companyName
 */
function historyCompanyLogoHue(companyName) {
  const seed = companyName.trim().toLowerCase() || "?";
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash) % 360;
}

/**
 * @param {import("../lib/tailor-history.js").TailorHistoryEntry} entry
 */
function historyEntryPosition(entry) {
  if (entry.position?.trim()) return entry.position.trim();

  const role = inferJobRole(entry.jobDescription);
  if (role) return role;

  const title = entry.title?.trim() || "";
  const company = entry.companyName?.trim() || "";
  if (company && title.includes(" · ")) {
    return title.split(" · ").slice(1).join(" · ").trim();
  }

  return title;
}

/**
 * @param {string} url
 */
function formatJobUrlHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    const trimmed = url.trim();
    return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  }
}

/**
 * @param {import("../lib/tailor-history.js").TailorHistoryEntry} entry
 * @param {string} companyQuery
 * @param {string} positionQuery
 */
function matchesHistorySearch(entry, companyQuery, positionQuery) {
  if (companyQuery) {
    const company = (entry.companyName || "").toLowerCase();
    if (!company.includes(companyQuery.toLowerCase())) return false;
  }

  if (positionQuery) {
    const query = positionQuery.toLowerCase();
    const position = historyEntryPosition(entry).toLowerCase();
    const storedPosition = (entry.position || "").toLowerCase();
    const title = (entry.title || "").toLowerCase();
    if (
      !position.includes(query) &&
      !storedPosition.includes(query) &&
      !title.includes(query)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * @param {import("../lib/tailor-history.js").JobStatus | string | undefined} tabId
 */
function setActiveJobsTab(tabId) {
  const status =
    tabId && tabId in JOBS_EMPTY_MESSAGES
      ? /** @type {import("../lib/tailor-history.js").JobStatus} */ (tabId)
      : "saved";
  activeJobsTab = status;

  els.jobsTabs.forEach((tab) => {
    const isActive = tab.dataset.jobsTab === status;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  renderHistory();
}

async function renderHistory() {
  const history = await loadTailorHistory();
  const stats = await getHistoryStats();
  const companyQuery = els.historyCompanySearch.value.trim();
  const positionQuery = els.historyPositionSearch.value.trim();
  const filtered = history.filter(
    (entry) =>
      getEntryStatus(entry) === activeJobsTab &&
      matchesHistorySearch(entry, companyQuery, positionQuery)
  );

  els.historyList.innerHTML = "";

  const hasHistory = history.length > 0;
  const hasFilters = Boolean(companyQuery || positionQuery);
  els.historySearch.hidden = !hasHistory;
  els.clearHistory.hidden = !hasHistory;
  els.exportHistoryBtn.hidden = !hasHistory;

  if (hasHistory) {
    els.historyStats.hidden = false;
    els.historyStats.innerHTML = [
      `<span class="history-stat">${stats.total} total</span>`,
      `<span class="history-stat">${stats.saved} saved</span>`,
      `<span class="history-stat">${stats.applied} applied</span>`,
      `<span class="history-stat">${stats.interview} interviews</span>`,
      stats.avgScore != null
        ? `<span class="history-stat">${stats.avgScore}% avg ATS</span>`
        : "",
    ]
      .filter(Boolean)
      .join("");
  } else {
    els.historyStats.hidden = true;
    els.historyStats.innerHTML = "";
  }

  if (!hasHistory) {
    els.historyEmpty.textContent = JOBS_EMPTY_MESSAGES[activeJobsTab];
    els.historyEmpty.hidden = false;
    return;
  }

  if (filtered.length === 0) {
    els.historyEmpty.textContent = hasFilters
      ? `No matching jobs in ${activeJobsTab}.`
      : JOBS_EMPTY_MESSAGES[activeJobsTab];
    els.historyEmpty.hidden = false;
    return;
  }

  els.historyEmpty.hidden = true;

  for (const entry of filtered) {
    const item = document.createElement("li");
    item.className = "history-item";
    item.dataset.historyId = entry.id;

    const body = document.createElement("div");
    body.className = "history-item-body";

    const companyName = historyEntryCompanyName(entry);
    const logo = document.createElement("div");
    logo.className = "history-company-logo";
    logo.style.setProperty("--history-logo-hue", String(historyCompanyLogoHue(companyName)));
    logo.textContent = historyCompanyInitial(companyName);
    logo.title = companyName || "Unknown company";
    logo.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "history-item-content";

    const header = document.createElement("div");
    header.className = "history-item-header";

    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = formatHistoryDate(entry.createdAt);
    header.appendChild(date);

    if (entry.atsScore?.score != null) {
      const score = document.createElement("span");
      score.className = `history-score tier-${scoreTier(entry.atsScore.score)}`;
      score.textContent = `${entry.atsScore.score}%`;
      header.appendChild(score);
    }

    if (entry.appliedAt) {
      const appliedDate = document.createElement("span");
      appliedDate.className = "history-date";
      appliedDate.textContent = `Applied ${formatHistoryDate(entry.appliedAt)}`;
      header.appendChild(appliedDate);
    }

    const appliedToggle = document.createElement("button");
    appliedToggle.type = "button";
    const status = getEntryStatus(entry);
    appliedToggle.className = `history-applied-toggle${status === "applied" ? " is-applied" : ""}`;
    appliedToggle.dataset.action = "toggle-applied";
    appliedToggle.setAttribute("aria-pressed", String(status === "applied"));
    appliedToggle.textContent = status === "applied" ? "✓ Applied" : "Mark applied";
    if (status !== "saved" && status !== "applied") {
      appliedToggle.hidden = true;
    }
    header.appendChild(appliedToggle);

    const title = document.createElement("p");
    title.className = "history-title";
    const position = historyEntryPosition(entry);
    const company = historyEntryCompanyName(entry);

    if (company && position) {
      title.textContent = `${company} · ${position}`;
    } else if (entry.title?.trim()) {
      title.textContent = entry.title;
      if (company && !entry.title.includes(company)) {
        title.textContent = `${company} · ${entry.title}`;
      }
    } else {
      title.textContent = position || company || "Tailored application";
    }

    const preview = document.createElement("div");
    preview.className = "history-preview";
    if (entry.jobUrl?.trim()) {
      const jobUrl = entry.jobUrl.trim();
      const link = document.createElement("a");
      link.className = "history-job-link";
      link.href = jobUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = jobUrl;
      link.textContent = "View job posting";

      const host = document.createElement("span");
      host.className = "history-job-link-host";
      host.textContent = formatJobUrlHost(jobUrl);
      link.appendChild(host);
      preview.appendChild(link);
    } else {
      const snippet = document.createElement("p");
      snippet.className = "history-preview-text";
      snippet.textContent = entry.jobDescription
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 140);
      preview.appendChild(snippet);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "link-btn";
    editBtn.dataset.action = "edit";
    editBtn.textContent = "Edit";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "link-btn";
    openBtn.dataset.action = "open";
    openBtn.textContent = "Open";
    openBtn.title = "Open in Application";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "link-btn";
    deleteBtn.dataset.action = "delete";
    deleteBtn.textContent = "Delete";

    if (status === "saved") {
      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "link-btn";
      archiveBtn.dataset.action = "set-status";
      archiveBtn.dataset.status = "archived";
      archiveBtn.textContent = "Archive";
      actions.append(editBtn, openBtn, archiveBtn, deleteBtn);
    } else if (status === "applied") {
      const interviewBtn = document.createElement("button");
      interviewBtn.type = "button";
      interviewBtn.className = "link-btn";
      interviewBtn.dataset.action = "set-status";
      interviewBtn.dataset.status = "interview";
      interviewBtn.textContent = "Interview";
      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "link-btn";
      archiveBtn.dataset.action = "set-status";
      archiveBtn.dataset.status = "archived";
      archiveBtn.textContent = "Archive";
      actions.append(editBtn, openBtn, interviewBtn, archiveBtn, deleteBtn);
    } else if (status === "interview") {
      const archiveBtn = document.createElement("button");
      archiveBtn.type = "button";
      archiveBtn.className = "link-btn";
      archiveBtn.dataset.action = "set-status";
      archiveBtn.dataset.status = "archived";
      archiveBtn.textContent = "Archive";
      actions.append(editBtn, openBtn, archiveBtn, deleteBtn);
    } else {
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "link-btn";
      restoreBtn.dataset.action = "set-status";
      restoreBtn.dataset.status = "saved";
      restoreBtn.textContent = "Restore";
      actions.append(editBtn, openBtn, restoreBtn, deleteBtn);
    }

    const details = document.createElement("details");
    details.className = "history-details";
    const summary = document.createElement("summary");
    summary.textContent = "View tailored resume";
    details.appendChild(summary);

    const resumeText = document.createElement("pre");
    resumeText.className = "history-resume-text";
    resumeText.textContent = entry.resumeText || serializeResume(entry.structured);
    details.appendChild(resumeText);

    if (entry.changes?.length) {
      const changesList = document.createElement("ul");
      changesList.className = "history-changes";
      for (const change of entry.changes) {
        const changeItem = document.createElement("li");
        changeItem.textContent = change;
        changesList.appendChild(changeItem);
      }
      details.appendChild(changesList);
    }

    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Notes";
    notesLabel.className = "field-hint";
    const notesField = document.createElement("textarea");
    notesField.className = "history-notes";
    notesField.value = entry.notes || "";
    notesField.placeholder = "Interview date, recruiter name, follow-up notes…";
    notesField.dataset.historyId = entry.id;
    notesField.addEventListener("change", async (event) => {
      const target = /** @type {HTMLTextAreaElement} */ (event.target);
      await setTailorHistoryNotes(target.dataset.historyId || entry.id, target.value);
    });
    details.append(notesLabel, notesField);

    content.append(header, title, preview, actions, details);
    body.append(logo, content);
    item.append(body);
    els.historyList.appendChild(item);
  }
}

async function onHistoryListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const item = button.closest("[data-history-id]");
  const id = item?.dataset.historyId;
  if (!id) return;

  if (button.dataset.action === "edit" || button.dataset.action === "open") {
    const history = await loadTailorHistory();
    const entry = history.find((record) => record.id === id);
    if (entry) await openHistoryEntry(entry);
    return;
  }

  if (button.dataset.action === "toggle-applied") {
    await setTailorHistoryApplied(id);
    await renderHistory();
    return;
  }

  if (button.dataset.action === "set-status") {
    const status = button.dataset.status;
    if (status) {
      await setTailorHistoryStatus(
        id,
        /** @type {import("../lib/tailor-history.js").JobStatus} */ (status)
      );
      await renderHistory();
    }
    return;
  }

  if (button.dataset.action === "delete") {
    await removeTailorHistoryEntry(id);
    await renderHistory();
    return;
  }
}

async function onClearHistory() {
  await clearTailorHistory();
  await renderHistory();
}

async function recordTailorHistory({
  jobDescription,
  structured,
  changes,
  atsScore,
  companyName,
  position,
  jobUrl,
  coverLetter = "",
}) {
  const resumeText = serializeResume(structured);
  if (!resumeText.trim()) return;

  await addTailorHistoryEntry({
    jobDescription,
    companyName,
    position,
    jobUrl,
    resumeText,
    structured,
    changes,
    atsScore,
    coverLetter,
  });
  await renderHistory();
}

function onDownloadProfileResume() {
  const structured = profileEditor.getStructured();
  const resumeText = getProfileResumeText().trim();

  if (!resumeText) {
    setProfileStatus("Nothing to download.", "error");
    return;
  }

  const name = structured.contact.name?.trim() || "resume";
  const filename = buildResumeDownloadFilename(name);

  downloadResumePdf(structured, filename);
  setProfileStatus("Resume downloaded.", "success");
}

async function onSaveProfile() {
  const text = getProfileResumeText();
  if (!text.trim()) {
    setProfileStatus("Nothing to save.", "error");
    return;
  }
  await persistProfile();
  setProfileStatus("Profile saved.", "success");
}

async function onClearProfile() {
  profileEditor.setStructured(emptyResume());
  await chrome.storage.local.remove([PROFILE_KEY, PROFILE_STRUCTURED_KEY]);
  setProfileStatus("Basic resume cleared.", "success");
}

async function onProfileFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  setProfileFillBusy(true);
  setProfileStatus(isPdf ? "Extracting text from PDF…" : "Reading file…");

  try {
    const text = await readResumeFile(file);
    await runFillProfile(text);
  } catch (err) {
    setProfileStatus(err.message || "Could not read file.", "error");
    setProfileFillBusy(false);
  } finally {
    event.target.value = "";
  }
}

async function ensurePageAccess() {
  if (await chrome.permissions.contains({ origins: PAGE_ORIGINS })) {
    return;
  }

  const granted = await chrome.permissions.request({ origins: PAGE_ORIGINS });
  if (!granted) {
    throw new Error("Permission required to read job pages. Allow access and try again.");
  }
}

/**
 * @param {{
 *   companyName?: string,
 *   position?: string,
 *   applyUrl?: string,
 *   jobPosted?: string,
 *   jobCreated?: string,
 *   jobModified?: string
 * } | null | undefined} meta
 * @param {{ overwrite?: boolean }} [options]
 */
function applyGrabMeta(meta, { overwrite = false } = {}) {
  if (!meta) return;

  const set = (el, value) => {
    if (!value) return;
    if (overwrite || !el.value.trim()) el.value = value;
  };

  set(els.companyName, meta.companyName);
  set(els.position, meta.position);
  set(els.jobUrl, meta.applyUrl);
  set(els.jobPosted, meta.jobPosted);
  set(els.jobCreated, meta.jobCreated);
  set(els.jobModified, meta.jobModified);
}

async function onGrabFromPage() {
  setStatus("Grabbing text from page…");
  els.grabFromPage.disabled = true;

  try {
    await ensurePageAccess();
    const response = await chrome.runtime.sendMessage({ type: "GRAB_PAGE_TEXT" });
    if (!response?.ok) throw new Error(response?.error || "Failed to grab text");
    els.jobDescription.value = response.text;
    if (response.pageUrl && !els.jobUrl.value.trim()) {
      els.jobUrl.value = response.pageUrl;
    }
    if (response.meta) {
      applyGrabMeta(response.meta);
    }
    latestAtsFromAi = null;
    await persistJobContext();
    setStatus("Job description grabbed from page.", "success");
    updateAtsScore();
    updateJobDescriptionActions();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    updateJobDescriptionActions();
  }
}

async function onRestructureJobDescription() {
  const jobDescription = els.jobDescription.value.trim();

  if (!jobDescription) {
    setStatus("Add a job description first.", "error");
    updateJobDescriptionActions();
    return;
  }

  if (hasTailoredResume()) {
    setStatus("Restructure is unavailable after tailoring.", "error");
    updateJobDescriptionActions();
    return;
  }

  const browserTab = await getActiveBrowserTab();
  const llmLabel = getActiveLlmLabel();
  restructureInProgress = true;
  updateJobDescriptionActions();
  setStatus(`Restructuring job description with ${llmLabel}…`);

  try {
    const response = await sendBackgroundMessage(
      {
        type: "RESTRUCTURE_JOB_DESCRIPTION",
        payload: {
          jobDescription,
          position: els.position.value.trim(),
          companyName: els.companyName.value.trim(),
          autoSend: appSettings.autoSend,
          jobWindowId: browserTab?.windowId,
        },
      },
      TAILOR_TIMEOUT_MS
    );

    if (response === undefined) {
      throw new Error(
        "Lost connection to the extension background. Reload cApply in chrome://extensions and try again."
      );
    }

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to restructure job description.");
    }

    if (!response.responseText?.trim()) {
      if (appSettings.autoSend) {
        throw new Error(
          `${llmLabel} finished but no restructured text was captured. Check the ${llmLabel} tab and try again.`
        );
      }
      setStatus(
        `Prompt ready in ${llmLabel}. Send it, then click Restructure job description again.`,
        "success"
      );
      return;
    }

    const restructured = parseRestructureJobResponse(response.responseText);
    if (!restructured.jobDescription.trim()) {
      throw new Error(`${llmLabel} returned an empty job description.`);
    }

    els.jobDescription.value = restructured.jobDescription;
    if (restructured.position && !els.position.value.trim()) {
      els.position.value = normalizeJobRoleTitle(restructured.position);
    }
    if (restructured.companyName && !els.companyName.value.trim()) {
      els.companyName.value = restructured.companyName;
    }

    latestAtsFromAi = null;
    await persistJobContext();
    updateAtsScore();
    renderAnalysis();
    setStatus("Job description restructured.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    restructureInProgress = false;
    updateJobDescriptionActions();
  }
}

function setProfileFillBusy(busy) {
  const defaultLabel =
    els.fillProfileBtn.dataset.defaultLabel || "Import from PDF";
  const labelEl = els.fillProfileBtn.querySelector(".action-btn-label");

  els.fillProfileBtn.disabled = busy;
  els.fillProfileBtn.classList.toggle("busy", busy);
  els.fillProfileBtn.setAttribute("aria-busy", String(busy));
  if (labelEl) {
    labelEl.textContent = busy ? "Importing…" : defaultLabel;
  } else {
    els.fillProfileBtn.textContent = busy ? "Importing…" : defaultLabel;
  }
  els.downloadProfileResumeBtn.disabled = busy;
  els.saveProfile.disabled = busy;
  els.clearProfile.disabled = busy;
}

function onFillProfile() {
  els.profileFile.click();
}

function hasResumeContent(structured) {
  return Boolean(serializeResume(structured).trim());
}

function mergeProfileFromSource(structured, sourceText) {
  const normalized = normalizeResume(structured);
  const trimmedSource = sourceText?.trim();
  if (!trimmedSource) return normalized;

  const local = parseResumeText(trimmedSource);
  if (!normalized.skills?.trim() && local.skills?.trim()) {
    normalized.skills = local.skills;
  }

  return normalized;
}

async function runFillProfile(sourceText = "") {
  const trimmedSource = sourceText.trim();
  const existingResume = trimmedSource
    ? ""
    : serializeResume(profileEditor.getStructured());

  if (!trimmedSource && !existingResume.trim()) {
    setProfileStatus("Choose a file to import.", "error");
    return;
  }

  setProfileFillBusy(true);
  const llmLabel = getActiveLlmLabel();
  setProfileStatus(`Sending to ${llmLabel} — waiting for JSON response…`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FILL_PROFILE",
      payload: {
        sourceText: trimmedSource,
        existingResume,
        extraInstructions: "",
        autoSend: true,
      },
    });

    if (!response?.ok) throw new Error(response?.error || "Something went wrong");

    if (!response.responseText?.trim()) {
      throw new Error(
        `${llmLabel} finished but no JSON response was captured. Check the ${llmLabel} tab.`
      );
    }

    const { structured } = parseTailorResponse(response.responseText);
    if (!hasResumeContent(structured)) {
      throw new Error(`${llmLabel} returned an empty resume.`);
    }

    profileEditor.setStructured(mergeProfileFromSource(structured, trimmedSource));
    await persistProfile();
    setProfileStatus(`Profile fields filled from ${llmLabel}.`, "success");
  } catch (err) {
    const localStructured = trimmedSource ? parseResumeText(trimmedSource) : null;
    if (localStructured && hasResumeContent(localStructured)) {
      profileEditor.setStructured(mergeProfileFromSource(localStructured, trimmedSource));
      await persistProfile();
      setProfileStatus(
        `Profile parsed locally. ${llmLabel} step failed: ${err.message}`,
        "success"
      );
    } else {
      setProfileStatus(err.message, "error");
    }
  } finally {
    setProfileFillBusy(false);
  }
}

function setTailorBusy(busy) {
  if (busy) {
    els.applicationActionsSecondary.hidden = true;
    els.tailoredResumeSection.hidden = true;
    els.atsScoreSection.hidden = true;
    els.tailorBtn.disabled = true;
    els.downloadResumeBtn.disabled = true;
    els.previewResumeBtn.disabled = true;
    els.tailorBtn.classList.add("busy");
    els.tailorBtn.setAttribute("aria-busy", "true");
    setTailorBtnLabel("Tailoring…");
    return;
  }

  if (hasTailoredResume()) {
    els.tailoredResumeSection.hidden = false;
  }
  if (normalizeDisplayAtsScore(latestAtsFromAi)?.score != null) {
    els.atsScoreSection.hidden = false;
  }
  updateApplicationActionButton();
}

async function onTailor() {
  const resume = serializeResume(profileEditor.getStructured());
  const jobDescription = els.jobDescription.value.trim();

  if (!resume.trim()) {
    setStatus("Add your basic resume in Profile first.", "error");
    setActiveTab("profile");
    return;
  }
  if (!jobDescription) {
    setStatus("Add a job description.", "error");
    els.jobDescription.focus();
    return;
  }

  const browserTab = await getActiveBrowserTab();
  if (!browserTab) {
    setStatus("No active browser tab found.", "error");
    return;
  }

  const sessionContextKey = getJobContextKey(browserTab.url, browserTab.tabId);
  activeJobContextKey = sessionContextKey;
  activeBrowserTabId = browserTab.tabId;
  await flushJobContextSave();

  tailorSession = {
    tabId: browserTab.tabId,
    contextKey: sessionContextKey,
  };
  tailorInProgress = true;

  const llmLabel = getActiveLlmLabel();
  setTailorBusy(true);
  if (!appSettings.autoSend) {
    setStatus(`Opening ${llmLabel} and inserting prompt…`);
  } else {
    setStatus("");
  }

  try {
    const response = await sendBackgroundMessage({
      type: "TAILOR_RESUME",
      payload: {
        jobDescription,
        autoSend: appSettings.autoSend,
        jobWindowId: browserTab.windowId,
        options: {
          tone: appSettings.defaultTone,
          outputFormat: appSettings.defaultOutputFormat,
          emphasize: ["keywords", "achievements", "ats", "skills", "summary"],
          extraInstructions: appSettings.extraInstructions || "",
          targetRole: getApplicationPosition(),
        },
      },
    });

    if (response === undefined) {
      throw new Error(
        "Lost connection to the extension background. Reload cApply in chrome://extensions and try again."
      );
    }

    if (!response?.ok) throw new Error(response?.error || "Something went wrong");

    if (response.responseText?.trim()) {
      const baseResume = profileEditor.getStructured();
      const { structured, changes, atsScore, coverLetter } = parseTailorResponse(
        response.responseText,
        { baseResume }
      );
      if (!hasTailoredContent(structured)) {
        throw new Error(
          `${llmLabel} finished but no usable resume JSON was captured. Check the ${llmLabel} tab and try again.`
        );
      }
      const enriched = ensureTailoredResumeCoverage(
        structured,
        jobDescription,
        resume,
        atsScore?.missingKeywords ?? [],
        { targetRole: getApplicationPosition() }
      );
      const displayAts = buildDisplayAtsScore(enriched, jobDescription, resume, atsScore);
      latestCoverLetter = coverLetter || "";
      els.coverLetter.value = latestCoverLetter;
      updateCoverLetterVisibility();
      showTailoredResume(enriched, changes, displayAts);
      activeJobContextKey = tailorSession.contextKey;
      activeBrowserTabId = tailorSession.tabId;
      await saveJobContext(tailorSession.contextKey, {
        ...collectApplicationState(),
        resumeText: serializeResume(enriched),
        structured: enriched,
        changes,
        atsScore: displayAts,
      });
      updateAtsScore();
      await recordTailorHistory({
        jobDescription,
        structured: enriched,
        changes,
        atsScore: displayAts,
        companyName: els.companyName.value.trim(),
        position: els.position.value.trim(),
        jobUrl: els.jobUrl.value.trim(),
        coverLetter: latestCoverLetter,
      });
      activeJobContextKey = tailorSession.contextKey;
      activeBrowserTabId = tailorSession.tabId;
      setActiveTab("application");
      setStatus("");
    } else if (appSettings.autoSend) {
      setStatus(
        `${llmLabel} finished but no JSON response was captured. Check the ${llmLabel} tab.`,
        "error"
      );
    } else {
      setStatus(
        `Prompt ready in ${llmLabel}. Send it, then tailor again to capture the JSON response.`,
        "success"
      );
    }
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    tailorInProgress = false;
    tailorSession = null;
    setTailorBusy(false);
  }
}

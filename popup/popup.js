import { readResumeFile } from "../lib/pdf-extract.js";
import { scoreTier } from "../lib/ats-score.js";
import { buildAnalysisReport } from "../lib/analysis-report.js";
import { emptyResume, normalizeResume, parseResumeText, serializeResume } from "../lib/resume-structure.js";
import {
  addTailorHistoryEntry,
  clearTailorHistory,
  computeHistoryStats,
  exportHistoryCsv,
  formatHistoryDate,
  formatRelativeHistoryDate,
  getEntryStatus,
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
import {
  forceRefreshSession,
  getSession,
  signIn,
  signOut,
  signUp,
} from "../lib/supabase-auth.js";
import { syncProfileToCloud, syncUserDataFromCloud } from "../lib/supabase-data.js";

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
  historyLoader: document.getElementById("historyLoader"),
  historySearch: document.getElementById("historySearch"),
  historyCompanySearch: document.getElementById("historyCompanySearch"),
  historyPositionSearch: document.getElementById("historyPositionSearch"),
  clearHistory: document.getElementById("clearHistory"),
  jobsTabs: document.querySelectorAll(".jobs-tab"),
  settingsBtn: document.getElementById("settingsBtn"),
  userBtn: document.getElementById("userBtn"),
  userAvatarInitials: document.getElementById("userAvatarInitials"),
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
  authOverlay: document.getElementById("authOverlay"),
  appShell: document.getElementById("appShell"),
  authForm: document.getElementById("authForm"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authToggleMode: document.getElementById("authToggleMode"),
  authStatus: document.getElementById("authStatus"),
  authSubtitle: document.getElementById("authSubtitle"),
  signOutBtn: document.getElementById("signOutBtn"),
  settingsAccountEmail: document.getElementById("settingsAccountEmail"),
};

const SCROLL_TOP_THRESHOLD = 120;

/** @type {import("../lib/tailor-history.js").JobStatus} */
let activeJobsTab = "saved";

/** @type {import("../lib/tailor-history.js").TailorHistoryEntry[] | null} */
let historyCache = null;
/** @type {Promise<import("../lib/tailor-history.js").TailorHistoryEntry[]> | null} */
let historyCachePromise = null;
let historyHasRenderedOnce = false;
let historyRenderToken = 0;
let historySearchDebounce = 0;

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

/** @type {boolean} */
let authSignUpMode = false;

/** @type {boolean} */
let authBusy = false;

/** @type {((user: Record<string, unknown>) => void) | null} */
let authReadyResolve = null;

/** @type {Record<string, unknown> | null} */
let currentAuthUser = null;

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

function setAuthStatus(message = "", type = "") {
  if (!els.authStatus) return;
  els.authStatus.textContent = message;
  els.authStatus.className = `status auth-status${type ? ` ${type}` : ""}`;
}

function showAuthOverlay() {
  if (els.authOverlay) els.authOverlay.hidden = false;
  if (els.appShell) els.appShell.hidden = true;
}

function showAppShell() {
  if (els.authOverlay) els.authOverlay.hidden = true;
  if (els.appShell) els.appShell.hidden = false;
}

function updateAuthModeUi() {
  if (els.authSubmitBtn) {
    els.authSubmitBtn.textContent = authSignUpMode ? "Create account" : "Sign in";
  }
  if (els.authToggleMode) {
    els.authToggleMode.textContent = authSignUpMode
      ? "Already have an account? Sign in"
      : "Need an account? Sign up";
  }
  if (els.authSubtitle) {
    els.authSubtitle.textContent = authSignUpMode
      ? "Create an account to continue"
      : "Sign in to continue";
  }
  if (els.authPassword) {
    els.authPassword.autocomplete = authSignUpMode ? "new-password" : "current-password";
    els.authPassword.placeholder = authSignUpMode
      ? "Create a password (6+ characters)"
      : "Your password";
  }
}

function getUserInitials(email) {
  const trimmed = String(email || "").trim();
  if (!trimmed) return "";

  const local = trimmed.split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function updateAccountUi() {
  const email =
    typeof currentAuthUser?.email === "string" ? currentAuthUser.email : "";
  if (els.settingsAccountEmail) {
    els.settingsAccountEmail.textContent = email || "Not signed in";
  }
  if (els.userBtn) {
    const signedIn = Boolean(email);
    els.userBtn.classList.toggle("is-signed-in", signedIn);
    els.userBtn.title = signedIn ? email : "Account";
    els.userBtn.setAttribute("aria-label", signedIn ? `Account: ${email}` : "Account");
  }
  if (els.userAvatarInitials) {
    els.userAvatarInitials.textContent = getUserInitials(email) || "?";
  }
}

function setAuthBusy(busy) {
  authBusy = busy;
  if (els.authSubmitBtn) {
    els.authSubmitBtn.disabled = busy;
    els.authSubmitBtn.classList.toggle("busy", busy);
  }
  if (els.authEmail) els.authEmail.disabled = busy;
  if (els.authPassword) els.authPassword.disabled = busy;
  if (els.authToggleMode) els.authToggleMode.disabled = busy;
}

function wireAuthListeners() {
  els.authForm?.addEventListener("submit", onAuthSubmit);
  els.authToggleMode?.addEventListener("click", () => {
    authSignUpMode = !authSignUpMode;
    setAuthStatus("");
    updateAuthModeUi();
  });
  updateAuthModeUi();
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
async function requireAuth() {
  const session = await getSession();
  if (session?.user) return session.user;

  showAuthOverlay();
  setAuthStatus("");

  return new Promise((resolve) => {
    authReadyResolve = resolve;
  });
}

async function onAuthSubmit(event) {
  event.preventDefault();
  if (authBusy) return;

  const email = els.authEmail?.value.trim() || "";
  const password = els.authPassword?.value || "";
  if (!email || !password) {
    setAuthStatus("Enter your email and password.", "error");
    return;
  }

  setAuthBusy(true);
  setAuthStatus(authSignUpMode ? "Creating account…" : "Signing in…");

  try {
    const session = authSignUpMode
      ? await signUp(email, password)
      : await signIn(email, password);
    currentAuthUser = session.user;
    setAuthStatus("");
    if (els.authPassword) els.authPassword.value = "";
    authReadyResolve?.(session.user);
    authReadyResolve = null;
  } catch (err) {
    setAuthStatus(err.message || "Authentication failed.", "error");
  } finally {
    setAuthBusy(false);
  }
}

async function onSignOut() {
  hideSettingsPanel();
  await signOut();
  currentAuthUser = null;
  updateAccountUi();
  authSignUpMode = false;
  updateAuthModeUi();
  if (els.authEmail) els.authEmail.value = "";
  if (els.authPassword) els.authPassword.value = "";
  currentAuthUser = await requireAuth();
  showAppShell();
  updateAccountUi();
  await refreshCloudData();
}

init();

async function refreshCloudData() {
  try {
    await forceRefreshSession();
    const syncResult = await syncUserDataFromCloud();
    if (syncResult.profileChanged) {
      await loadProfileResume();
    }
    if (syncResult.historyChanged) {
      invalidateHistoryCache();
      if (getCurrentMainTab() === "history") {
        scheduleHistoryRender({ force: true, showLoader: false });
      }
    }
  } catch (err) {
    console.warn("Failed to sync data from Supabase", err);
  }
}

function scheduleCloudDataRefresh() {
  void refreshCloudData();
}

async function init() {
  wireAuthListeners();
  currentAuthUser = await requireAuth();
  showAppShell();
  updateAccountUi();
  wireAppListeners();

  const [settings, tab] = await Promise.all([loadSettings(), getActiveBrowserTab()]);
  appSettings = settings;
  applySettingsToForm(appSettings);
  updateProviderUi();
  updateCoverLetterVisibility();

  if (tab) {
    activeBrowserTabId = tab.tabId;
    activeJobContextKey = getJobContextKey(tab.url, tab.tabId);
  } else {
    activeJobContextKey = getJobContextKey();
  }

  await migrateLegacyApplicationState(activeJobContextKey);
  applyApplicationState(await loadJobContext(activeJobContextKey));
  updateApplicationActionButton();

  void loadProfileResume();
  scheduleCloudDataRefresh();
  void maybeShowOnboarding();
}

function wireAppListeners() {
  els.mainTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      getActiveBrowserTab().then((activeTab) => {
        if (activeTab) activeBrowserTabId = activeTab.tabId;
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
  els.historyList.addEventListener(
    "toggle",
    (event) => {
      const target = /** @type {HTMLDetailsElement | null} */ (event.target);
      if (!target?.classList?.contains("history-overflow") || !target.open) return;
      els.historyList.querySelectorAll(".history-overflow[open]").forEach((menu) => {
        if (menu !== target) menu.open = false;
      });
    },
    true
  );
  els.historyCompanySearch.addEventListener("input", () =>
    scheduleHistoryRender({ debounceMs: 150, showLoader: false })
  );
  els.historyPositionSearch.addEventListener("input", () =>
    scheduleHistoryRender({ debounceMs: 150, showLoader: false })
  );
  els.jobsTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveJobsTab(tab.dataset.jobsTab));
  });
  els.settingsBtn.addEventListener("click", showSettingsPanel);
  els.userBtn?.addEventListener("click", showSettingsPanel);
  els.closeSettingsBtn.addEventListener("click", hideSettingsPanel);
  els.saveSettingsBtn.addEventListener("click", onSaveSettings);
  els.signOutBtn?.addEventListener("click", onSignOut);
  els.refreshAnalysisBtn.addEventListener("click", renderAnalysis);
  els.exportHistoryBtn.addEventListener("click", onExportHistory);
  els.copyCoverLetterBtn.addEventListener("click", onCopyCoverLetter);
  els.coverLetter.addEventListener("input", scheduleJobContextSave);
  els.onboardingSkipBtn.addEventListener("click", dismissOnboarding);
  els.onboardingNextBtn.addEventListener("click", advanceOnboarding);
  initScrollToTop();
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
  updateJobDescriptionActions();

  requestAnimationFrame(() => {
    applyApplicationResumeState(state);
  });
}

/**
 * @param {import("../lib/job-context.js").JobContextState | null} state
 */
function applyApplicationResumeState(state) {
  if (state?.structured && hasResumeContent(normalizeResume(state.structured))) {
    showTailoredResume(state.structured, latestTailorChanges, latestAtsFromAi, {
      scrollIntoView: false,
    });
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
  if (tailorInProgress) return "Stop tailoring";
  return hasTailoredResume()
    ? els.tailorBtn.dataset.retailorLabel || "Re-tailor"
    : els.tailorBtn.dataset.tailorLabel || "Tailor";
}

function isTailorCancelledError(message) {
  return /tailoring cancelled/i.test(String(message || ""));
}

async function stopTailoring() {
  setStatus("Stopping tailoring…");
  try {
    await chrome.runtime.sendMessage({ type: "STOP_TAILOR" });
  } catch {
    // Background may already be stopping.
  }
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
  els.tailorBtn.disabled = false;
  els.tailorBtn.title = tailorInProgress ? "Stop tailoring" : "";
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
    scheduleAtsScoreUpdate();
    updateCoverLetterVisibility();
  }

  updateScrollToTopVisibility();

  if (tabId === "history") {
    scheduleHistoryRender({
      showLoader: !historyCache && !historyCachePromise && !historyHasRenderedOnce,
    });
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

function showTailoredResume(structured, changes = [], atsScore, options = {}) {
  const { scrollIntoView = true } = options;
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
  if (scrollIntoView && !tailorInProgress && hasTailoredResume()) {
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
  await syncProfileToCloud(text, structured);
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
 * @param {string} url
 */
function formatJobSourceLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    const sources = [
      ["indeed", "Indeed"],
      ["linkedin", "LinkedIn"],
      ["glassdoor", "Glassdoor"],
      ["greenhouse", "Greenhouse"],
      ["lever.co", "Lever"],
      ["workday", "Workday"],
      ["ziprecruiter", "ZipRecruiter"],
      ["monster", "Monster"],
    ];
    for (const [needle, label] of sources) {
      if (host.includes(needle)) return label;
    }
    const base = host.split(".")[0] || host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "";
  }
}

/**
 * @param {import("../lib/tailor-history.js").TailorHistoryEntry} entry
 */
function parseHistoryCardDisplay(entry) {
  let position = historyEntryPosition(entry);
  let company = historyEntryCompanyName(entry);
  let location = "";
  let source = entry.jobUrl?.trim() ? formatJobSourceLabel(entry.jobUrl) : "";

  // "San Francisco, CA 94102 - Indeed.com · Senior Software Engineer"
  const locationRoleMatch = position.match(/^(.+?)\s*-\s*([^·]+?)\s*·\s*(.+)$/i);
  if (locationRoleMatch) {
    location = locationRoleMatch[1].trim();
    position = locationRoleMatch[3].trim();
    if (!source) {
      const titleSource = locationRoleMatch[2].trim().replace(/\.(com|org|net|io)$/i, "");
      if (titleSource) source = titleSource;
    }
  }

  // Company derived from a scraped title can be the same noise, e.g.
  // "San Francisco, CA 94102 - Indeed.com"
  const companyNoiseMatch = company.match(/^(.+?)\s*-\s*(\S+\.(?:com|org|net|io))$/i);
  if (companyNoiseMatch) {
    if (!location) location = companyNoiseMatch[1].trim();
    if (!source) source = companyNoiseMatch[2].replace(/\.(com|org|net|io)$/i, "");
    company = "";
  }

  if (company && position.startsWith(`${company} · `)) {
    position = position.slice(company.length + 3).trim();
  } else if (!company && position.includes(" · ")) {
    const parts = position.split(" · ").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const head = parts[0];
      if (!/indeed|linkedin|glassdoor|\.com/i.test(head)) {
        company = head;
        position = parts.slice(1).join(" · ");
      }
    }
  }

  if (!position) {
    position = company || entry.title?.trim() || "Tailored application";
  }

  return { position, company, location, source };
}

/**
 * @param {import("../lib/tailor-history.js").JobStatus} status
 */
function historyStatusLabel(status) {
  const labels = {
    saved: "Saved",
    applied: "Applied",
    interview: "Interview",
    archived: "Archived",
  };
  return labels[status] || "Saved";
}

/**
 * @param {string} location
 */
function formatHistoryLocation(location) {
  return location.replace(/\s+\d{5}(-\d{4})?$/, "").trim();
}

/**
 * @param {string} source
 * @param {string} [url]
 */
function formatHistorySourceDisplay(source, url = "") {
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      // fall through
    }
  }
  if (!source) return "";
  const lower = source.toLowerCase();
  if (/\.(com|org|net|io)$/.test(lower)) return lower;
  return `${lower}.com`;
}

/**
 * @param {string} name
 * @param {string} [markup]
 */
function historyIcon(name, markup) {
  const span = document.createElement("span");
  span.className = `history-icon history-icon-${name}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = markup;
  return span;
}

const HISTORY_ICON_MARKUP = {
  pin: `<svg viewBox="0 0 20 20" fill="none"><path d="M10 17s-5-4.35-5-8.25a5 5 0 1 1 10 0C15 12.65 10 17 10 17Z" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="8.75" r="1.6" fill="currentColor"/></svg>`,
  clock: `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.5V10l2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  check: `<svg viewBox="0 0 20 20" fill="none"><path d="M5 10.5 8.2 13.7 15 6.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  external: `<svg viewBox="0 0 20 20" fill="none"><path d="M11 4h5v5M16 4 9 11M8 6H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  document: `<svg viewBox="0 0 20 20" fill="none"><path d="M6 3.5h5.2L15 7.3V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6"/><path d="M11 3.5V8h4.5" stroke="currentColor" stroke-width="1.6"/></svg>`,
  bookmark: `<svg viewBox="0 0 20 20" fill="none"><path d="M5 4.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V16l-5-3-5 3V4.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  calendar: `<svg viewBox="0 0 20 20" fill="none"><rect x="4" y="5" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M7 3.5v3M13 3.5v3M4 8.5h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  archive: `<svg viewBox="0 0 20 20" fill="none"><rect x="4" y="4" width="12" height="3" rx="1" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 7v8.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 10.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};

/**
 * @param {import("../lib/tailor-history.js").JobStatus} status
 * @param {string} label
 */
function createHistoryStatusChip(status, label) {
  const chip = document.createElement("span");
  chip.className = `history-chip history-chip-status history-chip-status--${status}`;

  const iconName =
    status === "applied"
      ? "check"
      : status === "interview"
        ? "calendar"
        : status === "archived"
          ? "archive"
          : "bookmark";
  chip.append(historyIcon(iconName, HISTORY_ICON_MARKUP[iconName]));

  const text = document.createElement("span");
  text.textContent = label;
  chip.appendChild(text);
  return chip;
}

/**
 * @param {string} iso
 */
function createHistoryTimeChip(iso) {
  const chip = document.createElement("time");
  chip.className = "history-chip history-chip-time";
  chip.dateTime = iso || "";
  chip.title = formatHistoryDate(iso);
  chip.append(historyIcon("clock", HISTORY_ICON_MARKUP.clock));

  const text = document.createElement("span");
  text.textContent = formatRelativeHistoryDate(iso);
  chip.appendChild(text);
  return chip;
}

/**
 * @param {string} label
 * @param {string} action
 * @param {Record<string, string>} [dataset]
 */
function createHistoryOutlineButton(label, action, dataset = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-outline-btn";
  btn.dataset.action = action;

  const iconName = action === "toggle-resume" ? "document" : "external";
  btn.append(historyIcon(iconName, HISTORY_ICON_MARKUP[iconName]));

  const text = document.createElement("span");
  text.textContent = label;
  btn.appendChild(text);

  for (const [key, value] of Object.entries(dataset)) {
    btn.dataset[key] = value;
  }
  return btn;
}

/**
 * @param {string} href
 * @param {string} label
 */
function createHistoryPostingLink(href, label) {
  const link = document.createElement("a");
  link.className = "history-outline-btn history-outline-btn-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = href;
  link.append(historyIcon("external", HISTORY_ICON_MARKUP.external));

  const text = document.createElement("span");
  text.textContent = label;
  link.appendChild(text);
  return link;
}

/**
 * @param {number} score
 */
function createHistoryScoreRing(score) {
  const tier = scoreTier(score);
  const ring = document.createElement("div");
  ring.className = `history-score-ring tier-${tier}`;
  ring.style.setProperty("--score", String(score));
  ring.title = `ATS match score: ${score}% — estimated keyword alignment with the job description when this resume was tailored.`;
  ring.setAttribute("role", "img");
  ring.setAttribute("aria-label", `ATS match score ${score} percent`);

  const inner = document.createElement("div");
  inner.className = "history-score-ring-inner";
  inner.innerHTML = `<span class="history-score-value">${score}</span><span class="history-score-unit">%</span>`;
  ring.appendChild(inner);
  return ring;
}

/**
 * @param {string} action
 * @param {string} label
 * @param {Record<string, string>} [dataset]
 */
function createHistoryMenuButton(action, label, dataset = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-overflow-item";
  btn.dataset.action = action;
  btn.textContent = label;
  for (const [key, value] of Object.entries(dataset)) {
    btn.dataset[key] = value;
  }
  return btn;
}

/**
 * @param {HTMLElement[]} menuButtons
 */
function createHistoryOverflowMenu(menuButtons) {
  const overflow = document.createElement("details");
  overflow.className = "history-overflow";

  const trigger = document.createElement("summary");
  trigger.className = "history-overflow-trigger";
  trigger.setAttribute("aria-label", "More actions");
  trigger.textContent = "⋯";

  const menu = document.createElement("div");
  menu.className = "history-overflow-menu";
  menu.append(...menuButtons);

  overflow.append(trigger, menu);
  return overflow;
}

/**
 * @param {boolean} isApplied
 */
function createHistoryAppliedButton(isApplied) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `history-mark-applied-btn${isApplied ? " is-applied" : ""}`;
  btn.dataset.action = "toggle-applied";
  btn.setAttribute("aria-pressed", String(isApplied));
  btn.title = isApplied ? "Marked as applied" : "Mark as applied";
  btn.textContent = isApplied ? "Applied" : "Mark applied";
  return btn;
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

  scheduleHistoryRender({ showLoader: false });
}

function shouldShowHistoryLoader(showLoader) {
  if (historyHasRenderedOnce) return false;
  if (showLoader === true) return true;
  if (showLoader === false) return false;
  return !historyCache && !historyCachePromise;
}

function invalidateHistoryCache() {
  historyCache = null;
  historyCachePromise = null;
}

function hideHistoryLoader() {
  if (!els.historyLoader) return;
  els.historyLoader.hidden = true;
  els.historyLoader.setAttribute("hidden", "");
}

function showHistoryLoader() {
  if (historyHasRenderedOnce || !els.historyLoader) return;
  els.historyLoader.hidden = false;
  els.historyLoader.removeAttribute("hidden");
}

function setHistoryLoading(loading) {
  if (loading) {
    showHistoryLoader();
    if (!historyHasRenderedOnce) {
      els.historyList.hidden = true;
      els.historyEmpty.hidden = true;
      els.historyStats.hidden = true;
    }
    return;
  }

  hideHistoryLoader();
  els.historyList.hidden = false;
}

/**
 * @param {{ force?: boolean, showLoader?: boolean, debounceMs?: number }} [options]
 */
function scheduleHistoryRender(options = {}) {
  const { force = false, showLoader, debounceMs = 0 } = options;

  const run = () => {
    requestAnimationFrame(() => {
      renderHistory({ force, showLoader });
    });
  };

  if (debounceMs > 0) {
    clearTimeout(historySearchDebounce);
    historySearchDebounce = window.setTimeout(run, debounceMs);
    return;
  }

  clearTimeout(historySearchDebounce);
  run();
}

/**
 * @param {{ force?: boolean, showLoader?: boolean }} [options]
 */
async function getCachedHistory(options = {}) {
  if (options.force) invalidateHistoryCache();
  if (historyCache) return historyCache;
  if (!historyCachePromise) {
    historyCachePromise = loadTailorHistory().then((items) => {
      historyCache = items;
      return items;
    });
  }
  return historyCachePromise;
}

async function renderHistory(options = {}) {
  const token = ++historyRenderToken;
  const { force = false, showLoader = false } = options;
  const useLoader = shouldShowHistoryLoader(showLoader);

  if (useLoader) setHistoryLoading(true);

  try {
    const history = await getCachedHistory({ force });
    if (token !== historyRenderToken) return;

    const stats = computeHistoryStats(history);
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
      historyHasRenderedOnce = true;
      hideHistoryLoader();
      return;
    }

    if (filtered.length === 0) {
      els.historyEmpty.textContent = hasFilters
        ? `No matching jobs in ${activeJobsTab}.`
        : JOBS_EMPTY_MESSAGES[activeJobsTab];
      els.historyEmpty.hidden = false;
      historyHasRenderedOnce = true;
      hideHistoryLoader();
      return;
    }

    els.historyEmpty.hidden = true;

    const fragment = document.createDocumentFragment();

  for (const entry of filtered) {
    const status = getEntryStatus(entry);
    const display = parseHistoryCardDisplay(entry);

    const item = document.createElement("li");
    item.className = `history-item history-item--${status}`;
    item.dataset.historyId = entry.id;
    item.dataset.status = status;

    const body = document.createElement("div");
    body.className = "history-item-body";

    const companyName = display.company || display.position;
    const logo = document.createElement("div");
    logo.className = "history-company-logo";
    logo.style.setProperty("--history-logo-hue", String(historyCompanyLogoHue(companyName)));
    logo.textContent = historyCompanyInitial(companyName || display.position);
    logo.title = companyName || display.position || "Unknown company";
    logo.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "history-item-content";

    const header = document.createElement("div");
    header.className = "history-card-header";

    const headerMain = document.createElement("div");
    headerMain.className = "history-header-main";

    const jobTitle = document.createElement("h3");
    jobTitle.className = "history-job-title";
    jobTitle.textContent = display.position;
    headerMain.appendChild(jobTitle);

    const subtitleParts = [];
    if (display.company) subtitleParts.push(display.company);
    if (display.location) subtitleParts.push(formatHistoryLocation(display.location));
    const sourceLabel = formatHistorySourceDisplay(display.source, entry.jobUrl?.trim() || "");
    if (sourceLabel) subtitleParts.push(sourceLabel);

    if (subtitleParts.length) {
      const jobSubtitle = document.createElement("p");
      jobSubtitle.className = "history-job-subtitle";
      jobSubtitle.append(historyIcon("pin", HISTORY_ICON_MARKUP.pin));

      const subtitleText = document.createElement("span");
      subtitleText.textContent = subtitleParts.join(" · ");
      jobSubtitle.appendChild(subtitleText);
      headerMain.appendChild(jobSubtitle);
    } else if (!entry.jobUrl?.trim()) {
      const snippet = document.createElement("p");
      snippet.className = "history-job-subtitle history-job-snippet";
      snippet.textContent = entry.jobDescription.trim().replace(/\s+/g, " ").slice(0, 100);
      headerMain.appendChild(snippet);
    }

    header.appendChild(headerMain);

    if (entry.atsScore?.score != null) {
      header.appendChild(createHistoryScoreRing(entry.atsScore.score));
    }

    const chipRow = document.createElement("div");
    chipRow.className = "history-chip-row";
    chipRow.appendChild(createHistoryStatusChip(status, historyStatusLabel(status)));
    chipRow.appendChild(createHistoryTimeChip(entry.createdAt));

    if (entry.appliedAt) {
      const appliedChip = document.createElement("span");
      appliedChip.className = "history-chip history-chip-applied";
      appliedChip.title = formatHistoryDate(entry.appliedAt);
      appliedChip.append(historyIcon("check", HISTORY_ICON_MARKUP.check));
      const appliedText = document.createElement("span");
      appliedText.textContent = `Applied ${formatRelativeHistoryDate(entry.appliedAt)}`;
      appliedChip.appendChild(appliedText);
      chipRow.appendChild(appliedChip);
    }

    const divider = document.createElement("div");
    divider.className = "history-card-divider";
    divider.setAttribute("aria-hidden", "true");

    const footer = document.createElement("div");
    footer.className = "history-card-footer";

    const footerLeft = document.createElement("div");
    footerLeft.className = "history-footer-left";

    if (entry.jobUrl?.trim()) {
      footerLeft.appendChild(
        createHistoryPostingLink(entry.jobUrl.trim(), "Job posting")
      );
    }

    const resumeBtn = createHistoryOutlineButton("Resume", "toggle-resume");
    footerLeft.appendChild(resumeBtn);

    /** @type {HTMLElement[]} */
    const overflowButtons = [
      createHistoryMenuButton("open", "Open in Application"),
      createHistoryMenuButton("edit", "Edit"),
    ];

    if (status === "saved") {
      overflowButtons.push(
        createHistoryMenuButton("set-status", "Archive", { status: "archived" })
      );
    } else if (status === "applied") {
      overflowButtons.push(
        createHistoryMenuButton("set-status", "Move to interview", { status: "interview" }),
        createHistoryMenuButton("set-status", "Archive", { status: "archived" })
      );
    } else if (status === "interview") {
      overflowButtons.push(
        createHistoryMenuButton("set-status", "Archive", { status: "archived" })
      );
    } else {
      overflowButtons.push(
        createHistoryMenuButton("set-status", "Restore", { status: "saved" })
      );
    }

    overflowButtons.push(createHistoryMenuButton("delete", "Delete"));
    footerLeft.appendChild(createHistoryOverflowMenu(overflowButtons));

    const footerRight = document.createElement("div");
    footerRight.className = "history-footer-right";
    if (status === "saved" || status === "applied") {
      footerRight.appendChild(createHistoryAppliedButton(status === "applied"));
    }

    footer.append(footerLeft, footerRight);

    const details = document.createElement("details");
    details.className = "history-details history-details-panel";

    const resumeText = document.createElement("pre");
    resumeText.className = "history-resume-text";
    details.addEventListener("toggle", () => {
      resumeBtn.classList.toggle("is-active", details.open);
      if (!details.open || resumeText.dataset.loaded) return;
      resumeText.textContent = entry.resumeText || serializeResume(entry.structured);
      resumeText.dataset.loaded = "1";
    });
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

    content.append(header, chipRow, divider, footer, details);
    body.append(logo, content);
    item.append(body);
    fragment.appendChild(item);
  }

    els.historyList.appendChild(fragment);
    historyHasRenderedOnce = true;
    hideHistoryLoader();
  } finally {
    hideHistoryLoader();
    if (token === historyRenderToken) {
      els.historyList.hidden = false;
    }
  }
}

async function onHistoryListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const item = button.closest("[data-history-id]");
  const id = item?.dataset.historyId;
  if (!id) return;

  button.closest(".history-overflow")?.removeAttribute("open");

  if (button.dataset.action === "toggle-resume") {
    const details = item?.querySelector(".history-details-panel");
    if (details instanceof HTMLDetailsElement) {
      details.open = !details.open;
    }
    return;
  }

  if (button.dataset.action === "edit" || button.dataset.action === "open") {
    const history = await loadTailorHistory();
    const entry = history.find((record) => record.id === id);
    if (entry) await openHistoryEntry(entry);
    return;
  }

  if (button.dataset.action === "toggle-applied") {
    await setTailorHistoryApplied(id);
    invalidateHistoryCache();
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
      invalidateHistoryCache();
      await renderHistory();
    }
    return;
  }

  if (button.dataset.action === "delete") {
    await removeTailorHistoryEntry(id);
    invalidateHistoryCache();
    await renderHistory();
    return;
  }
}

async function onClearHistory() {
  await clearTailorHistory();
  invalidateHistoryCache();
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
  invalidateHistoryCache();
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
    els.tailorBtn.disabled = false;
    els.tailorBtn.title = "Stop tailoring";
    els.downloadResumeBtn.disabled = true;
    els.previewResumeBtn.disabled = true;
    els.tailorBtn.classList.add("busy");
    els.tailorBtn.setAttribute("aria-busy", "true");
    setTailorBtnLabel("Stop tailoring");
    return;
  }

  els.tailorBtn.title = "";
  if (hasTailoredResume()) {
    els.tailoredResumeSection.hidden = false;
  }
  if (normalizeDisplayAtsScore(latestAtsFromAi)?.score != null) {
    els.atsScoreSection.hidden = false;
  }
  updateApplicationActionButton();
}

async function onTailor() {
  if (tailorInProgress) {
    await stopTailoring();
    return;
  }

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

    if (!response?.ok) {
      if (isTailorCancelledError(response?.error)) {
        setStatus("Tailoring stopped.", "success");
        return;
      }
      throw new Error(response?.error || "Something went wrong");
    }

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
    if (isTailorCancelledError(err.message)) {
      setStatus("Tailoring stopped.", "success");
    } else {
      setStatus(err.message, "error");
    }
  } finally {
    tailorInProgress = false;
    tailorSession = null;
    setTailorBusy(false);
  }
}

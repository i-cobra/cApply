import { readResumeFile } from "../lib/pdf-extract.js";
import { computeAtsScore, scoreTier } from "../lib/ats-score.js";
import { emptyResume, parseResumeText, serializeResume } from "../lib/resume-structure.js";
import {
  addTailorHistoryEntry,
  clearTailorHistory,
  formatHistoryDate,
  loadTailorHistory,
  removeTailorHistoryEntry,
} from "../lib/tailor-history.js";
import {
  getActiveBrowserTab,
  getJobContextKey,
  loadJobContext,
  saveJobContext,
} from "../lib/job-context.js";
import { downloadResumePdf } from "../lib/resume-pdf.js";
import { parseTailorResponse } from "../lib/tailor-response.js";
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
  profileSourceText: document.getElementById("profileSourceText"),
  profileFillInstructions: document.getElementById("profileFillInstructions"),
  fillProfileBtn: document.getElementById("fillProfileBtn"),
  profileSourceSummary: document.getElementById("profileSourceSummary"),
  tailoredResumeSection: document.getElementById("tailoredResumeSection"),
  tailoredChangesWrap: document.getElementById("tailoredChangesWrap"),
  tailoredChangesList: document.getElementById("tailoredChangesList"),
  tailoredResumeEditor: document.getElementById("tailoredResumeEditor"),
  jobDescription: document.getElementById("jobDescription"),
  companyName: document.getElementById("companyName"),
  jobUrl: document.getElementById("jobUrl"),
  tone: document.getElementById("tone"),
  outputFormat: document.getElementById("outputFormat"),
  autoSend: document.getElementById("autoSend"),
  extraInstructions: document.getElementById("extraInstructions"),
  tailorBtn: document.getElementById("tailorBtn"),
  retailorBtn: document.getElementById("retailorBtn"),
  grabFromPage: document.getElementById("grabFromPage"),
  goToProfile: document.getElementById("goToProfile"),
  clearProfile: document.getElementById("clearProfile"),
  profileFile: document.getElementById("profileFile"),
  saveProfile: document.getElementById("saveProfile"),
  saveTailoredResume: document.getElementById("saveTailoredResume"),
  profileStatus: document.getElementById("profileStatus"),
  status: document.getElementById("status"),
  atsScoreSection: document.getElementById("atsScoreSection"),
  atsScoreRing: document.getElementById("atsScoreRing"),
  atsScoreValue: document.getElementById("atsScoreValue"),
  atsScoreSummary: document.getElementById("atsScoreSummary"),
  atsResumeSource: document.getElementById("atsResumeSource"),
  atsMissingCount: document.getElementById("atsMissingCount"),
  atsMissingList: document.getElementById("atsMissingList"),
  atsMissingDetails: document.getElementById("atsMissingDetails"),
  historyList: document.getElementById("historyList"),
  historyEmpty: document.getElementById("historyEmpty"),
  clearHistory: document.getElementById("clearHistory"),
};

const profileEditor = createResumeEditor(els.profileResumeEditor, {
  onChange: updateProfileSourceSummary,
});

const tailoredEditor = createResumeEditor(els.tailoredResumeEditor, {
  onChange: () => {
    latestAtsFromAi = null;
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

/**
 * Browser tab + storage key captured when tailoring starts so tab switches
 * during ChatGPT do not wipe the form or save results to the wrong tab.
 * @type {{ tabId: number, contextKey: string } | null}
 */
let tailorSession = null;

init();

async function init() {
  await loadProfileResume();

  const tab = await getActiveBrowserTab();
  if (tab) {
    await refreshJobContextForTab(tab.tabId, tab.url, {
      saveCurrent: false,
      reload: true,
    });
  }

  els.mainTabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "JOB_TAB_CHANGED") return;
    if (typeof message.tabId !== "number") return;

    refreshJobContextForTab(message.tabId, message.url || "", {
      saveCurrent: true,
      reload: message.reason === "activated",
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshJobContext({ saveCurrent: true, reload: false });
    }
  });

  els.tailorBtn.addEventListener("click", onApplicationActionClick);
  els.retailorBtn.addEventListener("click", onTailor);
  els.grabFromPage.addEventListener("click", onGrabFromPage);
  els.goToProfile.addEventListener("click", () => setActiveTab("profile"));
  els.clearProfile.addEventListener("click", onClearProfile);
  els.profileFile.addEventListener("change", onProfileFile);
  els.saveProfile.addEventListener("click", onSaveProfile);
  els.fillProfileBtn.addEventListener("click", onFillProfile);
  els.saveTailoredResume.addEventListener("click", onSaveTailoredResume);
  els.jobDescription.addEventListener("input", onApplicationInput);
  els.companyName.addEventListener("input", scheduleJobContextSave);
  els.jobUrl.addEventListener("input", scheduleJobContextSave);
  els.clearHistory.addEventListener("click", onClearHistory);
  els.historyList.addEventListener("click", onHistoryListClick);

  updateProfileSourceSummary();
  updateApplicationActionButton();
  await renderHistory();
}

function getStoredChanges() {
  return latestTailorChanges;
}

async function loadProfileResume() {
  const stored = await chrome.storage.local.get([
    PROFILE_KEY,
    PROFILE_STRUCTURED_KEY,
    LEGACY_KEY,
    LEGACY_STRUCTURED_KEY,
  ]);

  if (stored[PROFILE_STRUCTURED_KEY]) {
    profileEditor.setStructured(stored[PROFILE_STRUCTURED_KEY]);
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
  const hasTailored = !els.tailoredResumeSection.hidden && Boolean(resumeText.trim());

  return {
    jobDescription: els.jobDescription.value,
    companyName: els.companyName.value.trim(),
    jobUrl: els.jobUrl.value.trim(),
    resumeText: hasTailored ? resumeText : "",
    structured: hasTailored ? structured : null,
    changes: latestTailorChanges,
    atsScore: latestAtsFromAi,
  };
}

/**
 * @param {import("../lib/job-context.js").JobContextState | null} state
 */
function applyApplicationState(state) {
  els.jobDescription.value = state?.jobDescription ?? "";
  els.companyName.value = state?.companyName ?? "";
  els.jobUrl.value = state?.jobUrl ?? "";
  latestTailorChanges = state?.changes ?? [];
  latestAtsFromAi = state?.atsScore ?? null;

  if (state?.structured && hasResumeContent(state.structured)) {
    showTailoredResume(state.structured, latestTailorChanges, latestAtsFromAi);
    updateAtsScore();
    return;
  }

  if (state?.resumeText?.trim()) {
    tailoredEditor.setText(state.resumeText, { silent: true });
    renderTailorChanges(latestTailorChanges);
    els.tailoredResumeSection.hidden = false;
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
  tailoredEditor.setStructured(emptyResume(), { silent: true });
  renderTailorChanges([]);
  els.tailoredResumeSection.hidden = true;
  els.atsScoreSection.hidden = true;
  updateApplicationActionButton();
}

function hasTailoredResume() {
  const text = tailoredEditor.getText().trim();
  return !els.tailoredResumeSection.hidden && Boolean(text);
}

function updateApplicationActionButton() {
  const tailorLabel = els.tailorBtn.dataset.tailorLabel || "Tailor";
  const downloadLabel = els.tailorBtn.dataset.downloadLabel || "Download resume";
  const showDownload = hasTailoredResume() && !tailorInProgress;

  els.retailorBtn.hidden = !showDownload;

  if (showDownload) {
    els.tailorBtn.dataset.mode = "download";
    els.tailorBtn.textContent = downloadLabel;
    els.tailorBtn.disabled = false;
    els.tailorBtn.classList.remove("busy");
    els.tailorBtn.setAttribute("aria-busy", "false");
    return;
  }

  els.tailorBtn.dataset.mode = "tailor";
  els.tailorBtn.textContent = tailorLabel;
  els.tailorBtn.disabled = false;
  els.tailorBtn.classList.remove("busy");
  els.tailorBtn.setAttribute("aria-busy", "false");
}

function onApplicationActionClick() {
  if (els.tailorBtn.dataset.mode === "download") {
    onDownloadTailoredResume();
    return;
  }

  onTailor();
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
  const company = els.companyName.value.trim();
  const safeName = name.replace(/[<>:"/\\|?*]/g, "_");
  const filename = company
    ? `${safeName} - ${company.replace(/[<>:"/\\|?*]/g, "_")}.pdf`
    : `${safeName}.pdf`;

  downloadResumePdf(structured, filename);
  setStatus("Resume downloaded.", "success");
}

/** @type {number | null} */
let activeBrowserTabId = null;

/** @type {Promise<void>} */
let contextRefreshChain = Promise.resolve();

/**
 * @param {() => Promise<void>} task
 */
function enqueueContextRefresh(task) {
  contextRefreshChain = contextRefreshChain.then(task).catch(() => {});
  return contextRefreshChain;
}

async function flushJobContextSave() {
  window.clearTimeout(jobContextTimer);
  window.clearTimeout(atsUpdateTimer);

  if (!activeJobContextKey) return;
  await saveJobContext(activeJobContextKey, collectApplicationState());
}

/**
 * @param {number} tabId
 * @param {string} url
 * @param {{ saveCurrent?: boolean, reload?: boolean }} [options]
 */
async function refreshJobContextForTab(
  tabId,
  url,
  { saveCurrent = true, reload = false } = {}
) {
  return enqueueContextRefresh(async () => {
    if (tailorInProgress) {
      if (saveCurrent && activeJobContextKey) {
        await flushJobContextSave();
      }
      return;
    }

    const previousTabId = activeBrowserTabId;

    if (saveCurrent && activeJobContextKey) {
      await flushJobContextSave();
    }

    const activeTab = await getActiveBrowserTab();
    if (!activeTab || activeTab.tabId !== tabId) {
      return;
    }

    const nextKey = getJobContextKey(url || activeTab.url, tabId);
    const switchedTab = previousTabId !== null && tabId !== previousTabId;

    if (reload || switchedTab || previousTabId === null) {
      activeJobContextKey = nextKey;
      activeBrowserTabId = tabId;
      await migrateLegacyApplicationState(nextKey);
      const state = await loadJobContext(nextKey);
      applyApplicationState(state);
    }

    const pageUrl = url || activeTab.url;
    if (
      pageUrl &&
      !pageUrl.startsWith("chrome") &&
      !els.jobUrl.value.trim()
    ) {
      els.jobUrl.value = pageUrl;
      await persistJobContext();
    }

    if (els.tabPanels.application && !els.tabPanels.application.hidden) {
      updateProfileSourceSummary();
      updateAtsScore();
    }
  });
}

async function refreshJobContext({ saveCurrent = true, reload = false } = {}) {
  const tab = await getActiveBrowserTab();
  if (!tab) return;
  await refreshJobContextForTab(tab.tabId, tab.url, { saveCurrent, reload });
}

function scheduleJobContextSave() {
  window.clearTimeout(jobContextTimer);
  jobContextTimer = window.setTimeout(() => {
    persistJobContext();
  }, 250);
}

async function persistJobContext(contextKey = activeJobContextKey) {
  window.clearTimeout(jobContextTimer);

  let key = contextKey;
  if (!key) {
    const tab = await getActiveBrowserTab();
    if (!tab) return;
    key = getJobContextKey(tab.url, tab.tabId);
    activeJobContextKey = key;
    activeBrowserTabId = tab.tabId;
  }

  await saveJobContext(key, collectApplicationState());
}

function onApplicationInput() {
  if (latestAtsFromAi) {
    latestAtsFromAi = null;
  }
  scheduleAtsScoreUpdate();
  scheduleJobContextSave();
}

function setActiveTab(tabId) {
  if (!TAB_IDS.includes(tabId)) return;

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
    updateProfileSourceSummary();
    updateAtsScore();
  }

  if (tabId === "history") {
    renderHistory();
  }
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

function updateProfileSourceSummary() {
  const text = getProfileResumeText().trim();
  const structured = profileEditor.getStructured();
  const name = structured.contact.name?.trim();

  if (!text) {
    els.profileSourceSummary.textContent =
      "No profile resume yet. Add your basic resume in Profile.";
    els.profileSourceSummary.classList.remove("ready");
    return;
  }

  const roleCount = structured.experience.filter(
    (job) =>
      job.title?.trim() ||
      job.company?.trim() ||
      job.dates?.trim() ||
      job.bullets?.some((b) => b.trim())
  ).length;

  const label = name || "Profile resume";
  const roles = roleCount ? ` · ${roleCount} role${roleCount === 1 ? "" : "s"}` : "";
  els.profileSourceSummary.textContent = `${label}${roles} — tailoring uses a copy only.`;
  els.profileSourceSummary.classList.add("ready");
}

function getResumeForAtsScore() {
  const tailoredText = tailoredEditor.getText().trim();
  const usingTailored =
    !els.tailoredResumeSection.hidden && Boolean(tailoredText);

  return {
    text: usingTailored ? tailoredText : getProfileResumeText(),
    sourceLabel: usingTailored ? "Tailored resume" : "Profile resume",
    usingTailored,
  };
}

function scheduleAtsScoreUpdate() {
  if (latestAtsFromAi) {
    latestAtsFromAi = null;
  }
  window.clearTimeout(atsUpdateTimer);
  atsUpdateTimer = window.setTimeout(updateAtsScore, 250);
}

function renderAtsKeywordList(listEl, keywords) {
  listEl.innerHTML = "";
  for (const keyword of keywords) {
    const item = document.createElement("li");
    item.textContent = keyword;
    listEl.appendChild(item);
  }
}

function updateAtsScore() {
  const jobDescription = els.jobDescription.value.trim();
  const { text: resumeText, sourceLabel, usingTailored } = getResumeForAtsScore();

  if (!jobDescription || !resumeText.trim()) {
    els.atsScoreSection.hidden = true;
    return;
  }

  const useAi = usingTailored && latestAtsFromAi;
  const result = useAi
    ? {
        score: latestAtsFromAi.score,
        matched: [],
        missing: latestAtsFromAi.missingKeywords,
        total: latestAtsFromAi.missingKeywords.length,
        summary: latestAtsFromAi.summary,
      }
    : computeAtsScore(resumeText, jobDescription);

  const tier = scoreTier(result.score);

  els.atsScoreSection.hidden = false;
  els.atsResumeSource.textContent = useAi ? "ChatGPT" : sourceLabel;
  els.atsScoreValue.textContent = String(result.score);
  els.atsScoreRing.className = `ats-score-ring tier-${tier}`;
  els.atsScoreRing.setAttribute(
    "aria-label",
    `ATS match score ${result.score} percent`
  );

  if (useAi) {
    els.atsScoreSummary.textContent =
      result.summary ||
      `ChatGPT estimates ${result.score}% ATS match for this tailored resume.`;
    els.atsMissingCount.textContent = String(result.missing.length);
    renderAtsKeywordList(els.atsMissingList, result.missing);
    els.atsMissingDetails.hidden = result.missing.length === 0;
    return;
  }

  if (!result.total) {
    els.atsScoreSummary.textContent =
      "Add more detail to the job description to calculate keyword overlap.";
    els.atsMissingDetails.hidden = true;
    return;
  }

  els.atsScoreSummary.textContent = `${result.matched.length} of ${result.total} job keywords found in your ${sourceLabel.toLowerCase()}.`;
  els.atsMissingCount.textContent = String(result.missing.length);
  renderAtsKeywordList(els.atsMissingList, result.missing);
  els.atsMissingDetails.hidden = result.missing.length === 0;
}

function renderTailorChanges(changes) {
  els.tailoredChangesList.innerHTML = "";

  if (!changes.length) {
    els.tailoredChangesWrap.hidden = true;
    return;
  }

  for (const change of changes) {
    const item = document.createElement("li");
    item.textContent = change;
    els.tailoredChangesList.appendChild(item);
  }

  els.tailoredChangesWrap.hidden = false;
}

function showTailoredResume(structured, changes = [], atsScore = latestAtsFromAi) {
  latestTailorChanges = changes;
  latestAtsFromAi = atsScore;
  tailoredEditor.setStructured(structured, { silent: true });
  renderTailorChanges(changes);
  els.tailoredResumeSection.hidden = false;
  updateAtsScore();
  updateApplicationActionButton();
}

async function persistProfile() {
  const text = profileEditor.getText();
  const structured = profileEditor.getStructured();
  await chrome.storage.local.set({
    [PROFILE_KEY]: text,
    [PROFILE_STRUCTURED_KEY]: structured,
  });
  updateProfileSourceSummary();
}

async function persistTailoredResume({
  changes = latestTailorChanges,
  atsScore,
} = {}) {
  if (changes !== undefined) {
    latestTailorChanges = changes;
  }
  if (atsScore !== undefined) {
    latestAtsFromAi = atsScore;
  }
  await persistJobContext();
}

/**
 * @param {import("../lib/tailor-history.js").TailorHistoryEntry} entry
 */
async function openHistoryEntry(entry) {
  els.jobDescription.value = entry.jobDescription;
  els.companyName.value = entry.companyName || "";
  els.jobUrl.value = entry.jobUrl || "";
  showTailoredResume(entry.structured, entry.changes, entry.atsScore);
  await persistJobContext();
  setActiveTab("application");
  setStatus("");
}

async function renderHistory() {
  const history = await loadTailorHistory();
  els.historyList.innerHTML = "";

  const hasHistory = history.length > 0;
  els.historyEmpty.hidden = hasHistory;
  els.clearHistory.hidden = !hasHistory;

  for (const entry of history) {
    const item = document.createElement("li");
    item.className = "history-item";
    item.dataset.historyId = entry.id;

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

    const title = document.createElement("p");
    title.className = "history-title";
    title.textContent = entry.title;

    if (entry.companyName?.trim() && !entry.title.includes(entry.companyName.trim())) {
      title.textContent = `${entry.companyName.trim()} · ${entry.title}`;
    }

    const preview = document.createElement("p");
    preview.className = "history-preview";
    if (entry.jobUrl?.trim()) {
      preview.textContent = entry.jobUrl.trim();
    } else {
      preview.textContent = entry.jobDescription
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 140);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "link-btn";
    openBtn.dataset.action = "open";
    openBtn.textContent = "Open in Application";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "link-btn";
    deleteBtn.dataset.action = "delete";
    deleteBtn.textContent = "Delete";

    actions.append(openBtn, deleteBtn);

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

    item.append(header, title, preview, actions, details);
    els.historyList.appendChild(item);
  }
}

async function onHistoryListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const item = button.closest("[data-history-id]");
  const id = item?.dataset.historyId;
  if (!id) return;

  if (button.dataset.action === "delete") {
    await removeTailorHistoryEntry(id);
    await renderHistory();
    return;
  }

  if (button.dataset.action === "open") {
    const history = await loadTailorHistory();
    const entry = history.find((record) => record.id === id);
    if (entry) await openHistoryEntry(entry);
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
  jobUrl,
}) {
  const resumeText = serializeResume(structured);
  if (!resumeText.trim()) return;

  await addTailorHistoryEntry({
    jobDescription,
    companyName,
    jobUrl,
    resumeText,
    structured,
    changes,
    atsScore,
  });
  await renderHistory();
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
  updateProfileSourceSummary();
  setProfileStatus("Basic resume cleared.", "success");
}

async function onSaveTailoredResume() {
  const text = tailoredEditor.getText();
  if (!text.trim()) {
    setStatus("Nothing to save.", "error");
    return;
  }
  await persistTailoredResume();
  setStatus("Tailored resume saved.", "success");
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
    els.profileSourceText.value = text;
    await runFillProfile();
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
    latestAtsFromAi = null;
    await persistJobContext();
    setStatus("Job description grabbed from page.", "success");
    updateAtsScore();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    els.grabFromPage.disabled = false;
  }
}

function setProfileFillBusy(busy) {
  const defaultLabel =
    els.fillProfileBtn.dataset.defaultLabel || "Import from PDF";

  els.fillProfileBtn.disabled = busy;
  els.fillProfileBtn.classList.toggle("busy", busy);
  els.fillProfileBtn.setAttribute("aria-busy", String(busy));
  els.fillProfileBtn.textContent = busy ? "Importing…" : defaultLabel;
}

async function onFillProfile() {
  if (!els.profileSourceText.value.trim()) {
    els.profileFile.click();
    return;
  }

  await runFillProfile();
}

function hasResumeContent(structured) {
  return Boolean(serializeResume(structured).trim());
}

async function runFillProfile() {
  const sourceText = els.profileSourceText.value.trim();
  const existingResume = sourceText
    ? ""
    : serializeResume(profileEditor.getStructured());
  const extraInstructions = els.profileFillInstructions.value.trim();

  if (!sourceText && !existingResume.trim()) {
    setProfileStatus("Paste resume text or choose a file.", "error");
    return;
  }

  setProfileFillBusy(true);
  setProfileStatus("Sending to ChatGPT — waiting for JSON response…");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FILL_PROFILE",
      payload: {
        sourceText,
        existingResume,
        extraInstructions,
        autoSend: true,
      },
    });

    if (!response?.ok) throw new Error(response?.error || "Something went wrong");

    if (!response.responseText?.trim()) {
      throw new Error(
        "ChatGPT finished but no JSON response was captured. Check the ChatGPT tab."
      );
    }

    const { structured } = parseTailorResponse(response.responseText);
    if (!hasResumeContent(structured)) {
      throw new Error("ChatGPT returned an empty resume.");
    }

    profileEditor.setStructured(structured);
    await persistProfile();
    setProfileStatus("Profile fields filled from ChatGPT.", "success");
  } catch (err) {
    const localStructured = sourceText ? parseResumeText(sourceText) : null;
    if (localStructured && hasResumeContent(localStructured)) {
      profileEditor.setStructured(localStructured);
      await persistProfile();
      setProfileStatus(
        `Profile parsed locally. ChatGPT step failed: ${err.message}`,
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
  const tailorLabel = els.tailorBtn.dataset.tailorLabel || "Tailor";

  if (busy) {
    els.tailorBtn.dataset.mode = "tailor";
    els.retailorBtn.hidden = true;
    els.tailorBtn.disabled = true;
    els.tailorBtn.classList.add("busy");
    els.tailorBtn.setAttribute("aria-busy", "true");
    els.tailorBtn.textContent = "Tailoring…";
    return;
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

  await flushJobContextSave();

  const sessionContextKey =
    activeJobContextKey || getJobContextKey(browserTab.url, browserTab.tabId);
  activeJobContextKey = sessionContextKey;
  activeBrowserTabId = browserTab.tabId;

  tailorSession = {
    tabId: browserTab.tabId,
    contextKey: sessionContextKey,
  };
  tailorInProgress = true;

  setTailorBusy(true);
  if (!els.autoSend.checked) {
    setStatus("Opening ChatGPT and inserting prompt…");
  } else {
    setStatus("");
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TAILOR_RESUME",
      payload: {
        resume,
        jobDescription,
        autoSend: els.autoSend.checked,
        options: {
          tone: els.tone.value,
          outputFormat: els.outputFormat.value,
          emphasize: ["keywords", "achievements", "ats", "skills", "summary"],
          extraInstructions: els.extraInstructions.value.trim(),
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
      const { structured, changes, atsScore } = parseTailorResponse(
        response.responseText
      );
      showTailoredResume(structured, changes, atsScore);
      activeJobContextKey = tailorSession.contextKey;
      activeBrowserTabId = tailorSession.tabId;
      await persistJobContext(tailorSession.contextKey);
      await recordTailorHistory({
        jobDescription,
        structured,
        changes,
        atsScore,
        companyName: els.companyName.value.trim(),
        jobUrl: els.jobUrl.value.trim(),
      });
      activeJobContextKey = tailorSession.contextKey;
      activeBrowserTabId = tailorSession.tabId;
      setActiveTab("application");
      setStatus("");
    } else if (els.autoSend.checked) {
      setStatus(
        "ChatGPT finished but no JSON response was captured. Check the ChatGPT tab.",
        "error"
      );
    } else {
      setStatus(
        "Prompt ready in ChatGPT. Send it, then tailor again to capture the JSON response.",
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

import { readResumeFile } from "../lib/pdf-extract.js";
import { scoreTier } from "../lib/ats-score.js";
import { emptyResume, parseResumeText, serializeResume } from "../lib/resume-structure.js";
import {
  addTailorHistoryEntry,
  clearTailorHistory,
  formatHistoryDate,
  inferJobRole,
  loadTailorHistory,
  normalizeJobRoleTitle,
  removeTailorHistoryEntry,
} from "../lib/tailor-history.js";
import {
  getActiveBrowserTab,
  getJobContextKey,
  loadJobContext,
  saveJobContext,
} from "../lib/job-context.js";
import {
  buildResumeDownloadFilename,
  downloadResumePdf,
  encodeResumePdfBase64,
} from "../lib/resume-pdf.js";
import { parseTailorResponse, normalizeAtsScoreResult } from "../lib/tailor-response.js";
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
  tone: document.getElementById("tone"),
  outputFormat: document.getElementById("outputFormat"),
  autoSend: document.getElementById("autoSend"),
  extraInstructions: document.getElementById("extraInstructions"),
  tailorBtn: document.getElementById("tailorBtn"),
  tailorBtnLabel: document.querySelector("#tailorBtn .tailor-btn-label"),
  applicationActionsSecondary: document.getElementById("applicationActionsSecondary"),
  downloadResumeBtn: document.getElementById("downloadResumeBtn"),
  previewResumeBtn: document.getElementById("previewResumeBtn"),
  newApplicationBtn: document.getElementById("newApplicationBtn"),
  grabFromPage: document.getElementById("grabFromPage"),
  clearProfile: document.getElementById("clearProfile"),
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
let tailoredResumeReady = false;

/**
 * Browser tab + storage key captured when tailoring starts so tab switches
 * during ChatGPT do not wipe the form or save results to the wrong tab.
 * @type {{ tabId: number, contextKey: string } | null}
 */
let tailorSession = null;

const TAILOR_TIMEOUT_MS = 320_000;

/**
 * @param {unknown} message
 * @param {number} [timeoutMs]
 */
function sendBackgroundMessage(message, timeoutMs = TAILOR_TIMEOUT_MS) {
  return Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            "Tailoring timed out. Check the ChatGPT tab — if the JSON response is ready, click Re-tailor."
          )
        );
      }, timeoutMs);
    }),
  ]);
}

init();

async function init() {
  await loadProfileResume();

  activeJobContextKey = getJobContextKey();
  await migrateLegacyApplicationState(activeJobContextKey);
  applyApplicationState(await loadJobContext(activeJobContextKey));

  const tab = await getActiveBrowserTab();
  if (tab) activeBrowserTabId = tab.tabId;

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
  els.downloadResumeBtn.addEventListener("click", onDownloadTailoredResume);
  els.previewResumeBtn.addEventListener("click", onPreviewTailoredResume);
  els.grabFromPage.addEventListener("click", onGrabFromPage);
  els.clearProfile.addEventListener("click", onClearProfile);
  els.profileFile.addEventListener("change", onProfileFile);
  els.saveProfile.addEventListener("click", onSaveProfile);
  els.fillProfileBtn.addEventListener("click", onFillProfile);
  els.jobDescription.addEventListener("input", onApplicationInput);
  els.companyName.addEventListener("input", scheduleJobContextSave);
  els.position.addEventListener("input", scheduleJobContextSave);
  els.jobUrl.addEventListener("input", scheduleJobContextSave);
  els.clearHistory.addEventListener("click", onClearHistory);
  els.historyList.addEventListener("click", onHistoryListClick);
  els.historyCompanySearch.addEventListener("input", () => renderHistory());
  els.historyPositionSearch.addEventListener("input", () => renderHistory());

  updateApplicationActionButton();
  await renderHistory();
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
  els.position.value = state?.position ?? "";
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
  tailoredResumeReady = false;
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

  updateAtsScore();
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
  resetTailoredApplicationUi();
  setStatus("");

  if (!activeJobContextKey) activeJobContextKey = getJobContextKey();
  await saveJobContext(activeJobContextKey, {
    jobDescription: "",
    companyName: "",
    position: "",
    jobUrl: "",
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

/** @type {number | null} */
let activeBrowserTabId = null;

async function flushJobContextSave() {
  window.clearTimeout(jobContextTimer);
  window.clearTimeout(atsUpdateTimer);

  if (!activeJobContextKey) activeJobContextKey = getJobContextKey();
  await saveJobContext(activeJobContextKey, collectApplicationState());
}

async function persistJobContext(contextKey = activeJobContextKey) {
  window.clearTimeout(jobContextTimer);

  let key = contextKey || getJobContextKey();
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
    els.atsResumeSource.textContent = "ChatGPT";
    els.atsScoreValue.textContent = "—";
    els.atsScoreRing.className = "ats-score-ring";
    els.atsScoreRing.setAttribute("aria-label", "ATS match score unavailable");
    els.atsScoreSummary.textContent =
      "No ATS score was returned. Try re-tailoring this job.";
    return;
  }

  const tier = scoreTier(atsScore.score);

  els.atsResumeSource.textContent = "ChatGPT";
  els.atsScoreValue.textContent = String(atsScore.score);
  els.atsScoreRing.className = `ats-score-ring tier-${tier}`;
  els.atsScoreRing.setAttribute(
    "aria-label",
    `ATS match score ${atsScore.score} percent`
  );
  els.atsScoreSummary.textContent =
    atsScore.summary ||
    `ChatGPT estimates ${atsScore.score}% ATS match for this tailored resume.`;
  els.atsScoreSection.hidden = tailorInProgress;
}

function showTailoredResume(structured, changes = [], atsScore) {
  latestTailorChanges = changes;
  if (atsScore !== undefined) {
    latestAtsFromAi = atsScore;
  }
  tailoredResumeReady = hasResumeContent(structured);
  tailoredEditor.setStructured(structured, { silent: true });
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
  showTailoredResume(entry.structured, entry.changes, entry.atsScore);
  await persistJobContext();
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

async function renderHistory() {
  const history = await loadTailorHistory();
  const companyQuery = els.historyCompanySearch.value.trim();
  const positionQuery = els.historyPositionSearch.value.trim();
  const filtered = history.filter((entry) =>
    matchesHistorySearch(entry, companyQuery, positionQuery)
  );

  els.historyList.innerHTML = "";

  const hasHistory = history.length > 0;
  const hasFilters = Boolean(companyQuery || positionQuery);
  els.historySearch.hidden = !hasHistory;
  els.clearHistory.hidden = !hasHistory;

  if (!hasHistory) {
    els.historyEmpty.textContent =
      "No tailor sessions yet. Tailor a resume on the Application tab.";
    els.historyEmpty.hidden = false;
    return;
  }

  if (filtered.length === 0) {
    els.historyEmpty.textContent = hasFilters
      ? "No matching tailor sessions."
      : "No tailor sessions yet. Tailor a resume on the Application tab.";
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

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "link-btn";
    editBtn.dataset.action = "edit";
    editBtn.textContent = "Edit";

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

    actions.append(editBtn, openBtn, deleteBtn);

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

function onFillProfile() {
  els.profileFile.click();
}

function hasResumeContent(structured) {
  return Boolean(serializeResume(structured).trim());
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
  setProfileStatus("Sending to ChatGPT — waiting for JSON response…");

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
    const localStructured = trimmedSource ? parseResumeText(trimmedSource) : null;
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

  setTailorBusy(true);
  if (!els.autoSend.checked) {
    setStatus("Opening ChatGPT and inserting prompt…");
  } else {
    setStatus("");
  }

  try {
    const response = await sendBackgroundMessage({
      type: "TAILOR_RESUME",
      payload: {
        resume,
        jobDescription,
        autoSend: els.autoSend.checked,
        jobWindowId: browserTab.windowId,
        options: {
          tone: els.tone.value,
          outputFormat: els.outputFormat.value,
          emphasize: ["keywords", "achievements", "ats", "skills", "summary"],
          extraInstructions: els.extraInstructions.value.trim(),
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
      const { structured, changes, atsScore } = parseTailorResponse(
        response.responseText
      );
      if (!hasResumeContent(structured)) {
        throw new Error(
          "ChatGPT finished but no usable resume JSON was captured. Check the ChatGPT tab and try again."
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

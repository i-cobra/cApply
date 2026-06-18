export const LEGACY_JOB_CONTEXTS_KEY = "capply_job_contexts";
export const SHARED_CONTEXT_KEY = "shared";
const SHARED_STORAGE_KEY = "capply_application_shared";

/**
 * @typedef {{
 *   jobDescription: string,
 *   companyName: string,
 *   jobUrl: string,
 *   resumeText: string,
 *   structured: import("./resume-structure.js").ResumeStructure | null,
 *   changes: string[],
 *   atsScore: import("./tailor-response.js").AtsScoreResult | null,
 *   updatedAt: string
 * }} JobContextState
 */

/**
 * Single shared application state for the side panel on all pages.
 * @param {string | undefined} _url
 * @param {number | undefined} _tabId
 * @returns {string}
 */
export function getJobContextKey(_url, _tabId) {
  return SHARED_CONTEXT_KEY;
}

/**
 * @param {JobContextState} state
 * @returns {JobContextState}
 */
function normalizeJobContextState(state) {
  return {
    jobDescription: state.jobDescription ?? "",
    companyName: state.companyName ?? "",
    jobUrl: state.jobUrl ?? "",
    resumeText: state.resumeText ?? "",
    structured: state.structured ?? null,
    changes: Array.isArray(state.changes) ? state.changes : [],
    atsScore: state.atsScore ?? null,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * @param {string} contextKey
 * @returns {Promise<JobContextState | null>}
 */
export async function loadJobContext(contextKey) {
  if (contextKey !== SHARED_CONTEXT_KEY) return null;

  const stored = await chrome.storage.local.get([
    SHARED_STORAGE_KEY,
    LEGACY_JOB_CONTEXTS_KEY,
  ]);
  const direct = stored[SHARED_STORAGE_KEY];
  if (direct) return normalizeJobContextState(direct);

  const migratedFromTab = await migrateNewestTabContextToShared();
  if (migratedFromTab) return migratedFromTab;

  const legacy = stored[LEGACY_JOB_CONTEXTS_KEY];
  if (legacy && typeof legacy === "object" && legacy[SHARED_CONTEXT_KEY]) {
    const migrated = normalizeJobContextState(legacy[SHARED_CONTEXT_KEY]);
    await chrome.storage.local.set({ [SHARED_STORAGE_KEY]: migrated });
    return migrated;
  }

  return null;
}

/**
 * @returns {Promise<JobContextState | null>}
 */
async function migrateNewestTabContextToShared() {
  const all = await chrome.storage.local.get(null);
  /** @type {JobContextState | null} */
  let best = null;
  let bestTime = "";

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("capply_job_tab_")) continue;
    if (!value || typeof value !== "object") continue;
    const updatedAt = /** @type {{ updatedAt?: string }} */ (value).updatedAt || "";
    if (!best || updatedAt > bestTime) {
      best = normalizeJobContextState(/** @type {JobContextState} */ (value));
      bestTime = updatedAt;
    }
  }

  if (!best) return null;

  await chrome.storage.local.set({ [SHARED_STORAGE_KEY]: best });
  return best;
}

/**
 * @param {string} contextKey
 * @param {Partial<JobContextState>} state
 */
export async function saveJobContext(contextKey, state) {
  if (contextKey !== SHARED_CONTEXT_KEY) return;

  const existing = await loadJobContext(contextKey);

  await chrome.storage.local.set({
    [SHARED_STORAGE_KEY]: normalizeJobContextState({
      jobDescription: state.jobDescription ?? existing?.jobDescription ?? "",
      companyName: state.companyName ?? existing?.companyName ?? "",
      jobUrl: state.jobUrl ?? existing?.jobUrl ?? "",
      resumeText: state.resumeText ?? existing?.resumeText ?? "",
      structured:
        state.structured !== undefined ? state.structured : existing?.structured ?? null,
      changes: state.changes ?? existing?.changes ?? [],
      atsScore: state.atsScore !== undefined ? state.atsScore : existing?.atsScore ?? null,
      updatedAt: new Date().toISOString(),
    }),
  });
}

/**
 * @returns {Promise<{ tabId: number, url: string } | null>}
 */
export async function getActiveBrowserTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return { tabId: tab.id, url: tab.url || "" };
}

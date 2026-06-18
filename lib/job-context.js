export const LEGACY_JOB_CONTEXTS_KEY = "capply_job_contexts";

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
 * Persist application state per browser tab.
 * @param {string | undefined} _url
 * @param {number} tabId
 * @returns {string}
 */
export function getJobContextKey(_url, tabId) {
  return `tab:${tabId}`;
}

/**
 * @param {number | string} tabId
 */
function storageKeyForTab(tabId) {
  return `capply_job_tab_${tabId}`;
}

/**
 * @param {string} contextKey
 * @returns {string | null}
 */
function tabIdFromContextKey(contextKey) {
  const match = /^tab:(\d+)$/.exec(contextKey);
  return match ? match[1] : null;
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
  const tabId = tabIdFromContextKey(contextKey);
  if (!tabId) return null;

  const storageKey = storageKeyForTab(tabId);
  const stored = await chrome.storage.local.get([storageKey, LEGACY_JOB_CONTEXTS_KEY]);
  const direct = stored[storageKey];
  if (direct) return normalizeJobContextState(direct);

  const legacy = stored[LEGACY_JOB_CONTEXTS_KEY];
  if (legacy && typeof legacy === "object" && legacy[contextKey]) {
    const migrated = normalizeJobContextState(legacy[contextKey]);
    await chrome.storage.local.set({ [storageKey]: migrated });
    return migrated;
  }

  return null;
}

/**
 * @param {string} contextKey
 * @param {Partial<JobContextState>} state
 */
export async function saveJobContext(contextKey, state) {
  const tabId = tabIdFromContextKey(contextKey);
  if (!tabId) return;

  const storageKey = storageKeyForTab(tabId);
  const existing = await loadJobContext(contextKey);

  await chrome.storage.local.set({
    [storageKey]: normalizeJobContextState({
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

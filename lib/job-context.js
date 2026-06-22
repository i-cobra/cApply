export const LEGACY_JOB_CONTEXTS_KEY = "capply_job_contexts";
export const SHARED_CONTEXT_KEY = "shared";
export const ACTIVE_CONTEXT_KEY = "capply_active_context_key";
const SHARED_STORAGE_KEY = "capply_application_shared";

/**
 * @typedef {{
 *   jobDescription: string,
 *   companyName: string,
 *   position: string,
 *   jobUrl: string,
 *   resumeText: string,
 *   structured: import("./resume-structure.js").ResumeStructure | null,
 *   changes: string[],
 *   atsScore: import("./tailor-response.js").AtsScoreResult | null,
 *   coverLetter: string,
 *   updatedAt: string
 * }} JobContextState
 */

/**
 * @param {string | undefined} url
 */
export function normalizeJobUrl(url) {
  if (!url?.trim()) return "";
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    if (parsed.search) {
      const params = new URLSearchParams(parsed.search);
      for (const key of [...params.keys()]) {
        if (/^utm_/i.test(key)) params.delete(key);
      }
      parsed.search = params.toString() ? `?${params.toString()}` : "";
    }
    let path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}`.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {string | undefined} url
 * @param {number | undefined} tabId
 * @returns {string}
 */
export function getJobContextKey(url, tabId) {
  const normalized = normalizeJobUrl(url);
  if (normalized) return `url:${normalized}`;
  if (tabId) return `tab:${tabId}`;
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
    position: state.position ?? "",
    jobUrl: state.jobUrl ?? "",
    resumeText: state.resumeText ?? "",
    structured: state.structured ?? null,
    changes: Array.isArray(state.changes) ? state.changes : [],
    atsScore: state.atsScore ?? null,
    coverLetter: state.coverLetter ?? "",
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * @returns {Promise<Record<string, JobContextState>>}
 */
async function loadAllJobContexts() {
  const stored = await chrome.storage.local.get([
    LEGACY_JOB_CONTEXTS_KEY,
    SHARED_STORAGE_KEY,
  ]);

  /** @type {Record<string, JobContextState>} */
  const map = {};

  const legacy = stored[LEGACY_JOB_CONTEXTS_KEY];
  if (legacy && typeof legacy === "object") {
    for (const [key, value] of Object.entries(legacy)) {
      if (value && typeof value === "object") {
        map[key] = normalizeJobContextState(/** @type {JobContextState} */ (value));
      }
    }
  }

  const shared = stored[SHARED_STORAGE_KEY];
  if (shared && typeof shared === "object" && !map[SHARED_CONTEXT_KEY]) {
    map[SHARED_CONTEXT_KEY] = normalizeJobContextState(/** @type {JobContextState} */ (shared));
  }

  return map;
}

/**
 * @param {Record<string, JobContextState>} map
 */
async function saveAllJobContexts(map) {
  await chrome.storage.local.set({ [LEGACY_JOB_CONTEXTS_KEY]: map });
  if (map[SHARED_CONTEXT_KEY]) {
    await chrome.storage.local.set({ [SHARED_STORAGE_KEY]: map[SHARED_CONTEXT_KEY] });
  }
}

/**
 * @param {string} contextKey
 * @returns {Promise<JobContextState | null>}
 */
export async function loadJobContext(contextKey) {
  const map = await loadAllJobContexts();
  if (map[contextKey]) return map[contextKey];

  if (contextKey === SHARED_CONTEXT_KEY) {
    const migrated = await migrateNewestTabContextToShared();
    if (migrated) return migrated;
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

  const map = await loadAllJobContexts();
  map[SHARED_CONTEXT_KEY] = best;
  await saveAllJobContexts(map);
  return best;
}

/**
 * @param {string} contextKey
 * @param {Partial<JobContextState>} state
 */
export async function saveJobContext(contextKey, state) {
  const map = await loadAllJobContexts();
  const existing = map[contextKey] || null;

  map[contextKey] = normalizeJobContextState({
    jobDescription: state.jobDescription ?? existing?.jobDescription ?? "",
    companyName: state.companyName ?? existing?.companyName ?? "",
    position: state.position ?? existing?.position ?? "",
    jobUrl: state.jobUrl ?? existing?.jobUrl ?? "",
    resumeText: state.resumeText ?? existing?.resumeText ?? "",
    structured:
      state.structured !== undefined ? state.structured : existing?.structured ?? null,
    changes: state.changes ?? existing?.changes ?? [],
    atsScore: state.atsScore !== undefined ? state.atsScore : existing?.atsScore ?? null,
    coverLetter: state.coverLetter ?? existing?.coverLetter ?? "",
    updatedAt: new Date().toISOString(),
  });

  await saveAllJobContexts(map);
  await chrome.storage.local.set({ [ACTIVE_CONTEXT_KEY]: contextKey });
}

/**
 * @returns {Promise<{ tabId: number, url: string } | null>}
 */
export async function getActiveBrowserTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return { tabId: tab.id, url: tab.url || "" };
}

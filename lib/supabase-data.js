import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";
import {
  forceRefreshSession,
  getSession,
  isRecoverableAuthError,
} from "./supabase-auth.js";
import {
  HISTORY_KEY,
  JOB_STATUSES,
  getEntryStatus,
  normalizeHistoryEntry,
} from "./tailor-history.js";

const REST_BASE = `${SUPABASE_URL}/rest/v1`;
const PROFILE_KEY = "capply_profile_resume";
const PROFILE_STRUCTURED_KEY = "capply_profile_resume_structured";

/**
 * @typedef {import("./tailor-history.js").TailorHistoryEntry} TailorHistoryEntry
 * @typedef {import("./resume-structure.js").ResumeStructure} ResumeStructure
 */

/**
 * @returns {Promise<{ accessToken: string, userId: string } | null>}
 */
async function getAuthContext() {
  const session = await getSession();
  const userId = typeof session?.user?.id === "string" ? session.user.id : "";
  if (!session?.access_token || !userId) return null;
  return { accessToken: session.access_token, userId };
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @param {string} [prefer]
 * @param {boolean} [allowRetry]
 * @returns {Promise<Response>}
 */
async function restFetch(path, init = {}, prefer = "", allowRetry = true) {
  const auth = await getAuthContext();
  if (!auth) throw new Error("Not signed in");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${auth.accessToken}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (prefer) headers.set("Prefer", prefer);

  const response = await fetch(`${REST_BASE}${path}`, { ...init, headers });
  if (response.ok || !allowRetry) return response;

  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    message = body.message || body.msg || body.error || body.details || message;
  } catch {
    // ignore parse errors
  }

  if (!isRecoverableAuthError(message, response.status)) {
    return response;
  }

  const refreshed = await forceRefreshSession();
  if (!refreshed?.access_token) return response;

  headers.set("Authorization", `Bearer ${refreshed.access_token}`);
  return fetch(`${REST_BASE}${path}`, { ...init, headers });
}

/**
 * @param {Response} response
 * @returns {Promise<never>}
 */
async function throwRestError(response) {
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json();
    message = body.message || body.error || body.details || message;
  } catch {
    // ignore parse errors
  }
  throw new Error(String(message));
}

/**
 * @param {Record<string, unknown>} row
 * @returns {TailorHistoryEntry}
 */
function rowToHistoryEntry(row) {
  /** @type {TailorHistoryEntry} */
  const entry = {
    id: String(row.id || ""),
    createdAt: String(row.created_at || new Date().toISOString()),
    title: String(row.title || ""),
    companyName: String(row.company_name || ""),
    position: String(row.position || ""),
    jobUrl: String(row.job_url || ""),
    jobDescription: String(row.job_description || ""),
    resumeText: String(row.resume_text || ""),
    structured: /** @type {ResumeStructure} */ (row.structured || {}),
    changes: Array.isArray(row.changes) ? row.changes.map(String) : [],
    atsScore: row.ats_score && typeof row.ats_score === "object" ? row.ats_score : null,
    coverLetter: String(row.cover_letter || ""),
    notes: String(row.notes || ""),
    appliedAt: row.applied_at ? String(row.applied_at) : "",
    status:
      typeof row.status === "string" && JOB_STATUSES.includes(row.status)
        ? row.status
        : "saved",
    applied: false,
  };
  return normalizeHistoryEntry(entry);
}

/**
 * @param {TailorHistoryEntry} entry
 * @param {string} userId
 */
function historyEntryToRow(entry, userId) {
  const status = getEntryStatus(entry);
  return {
    id: entry.id,
    user_id: userId,
    created_at: entry.createdAt,
    title: entry.title || "",
    company_name: entry.companyName || "",
    position: entry.position || "",
    job_url: entry.jobUrl || "",
    job_description: entry.jobDescription || "",
    resume_text: entry.resumeText || "",
    structured: entry.structured || {},
    changes: entry.changes || [],
    ats_score: entry.atsScore ?? null,
    cover_letter: entry.coverLetter || "",
    notes: entry.notes || "",
    applied_at: entry.appliedAt || null,
    status,
    updated_at: new Date().toISOString(),
  };
}

/**
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function fetchRemoteJobHistory() {
  const auth = await getAuthContext();
  if (!auth) return [];

  const response = await restFetch(
    `/job_history?user_id=eq.${encodeURIComponent(auth.userId)}&order=created_at.desc&limit=50`
  );
  if (!response.ok) await throwRestError(response);

  const rows = await response.json();
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => rowToHistoryEntry(row));
}

/**
 * @param {TailorHistoryEntry[]} entries
 */
export async function upsertRemoteJobHistory(entries) {
  const auth = await getAuthContext();
  if (!auth || !entries.length) return;

  const rows = entries.map((entry) => historyEntryToRow(entry, auth.userId));
  const response = await restFetch("/job_history", {
    method: "POST",
    body: JSON.stringify(rows),
  }, "resolution=merge-duplicates,return=minimal");

  if (!response.ok) await throwRestError(response);
}

/**
 * @param {string} id
 */
export async function deleteRemoteJobHistoryEntry(id) {
  const auth = await getAuthContext();
  if (!auth) return;

  const response = await restFetch(
    `/job_history?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
    { method: "DELETE" }
  );
  if (!response.ok) await throwRestError(response);
}

/**
 * @returns {Promise<void>}
 */
export async function clearRemoteJobHistory() {
  const auth = await getAuthContext();
  if (!auth) return;

  const response = await restFetch(
    `/job_history?user_id=eq.${encodeURIComponent(auth.userId)}`,
    { method: "DELETE" }
  );
  if (!response.ok) await throwRestError(response);
}

/**
 * @returns {Promise<{ resumeText: string, resumeStructured: ResumeStructure | null } | null>}
 */
export async function fetchRemoteProfile() {
  const auth = await getAuthContext();
  if (!auth) return null;

  const response = await restFetch(
    `/profiles?user_id=eq.${encodeURIComponent(auth.userId)}&select=resume_text,resume_structured,updated_at&limit=1`
  );
  if (!response.ok) await throwRestError(response);

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) return null;

  const row = rows[0];
  return {
    resumeText: String(row.resume_text || ""),
    resumeStructured:
      row.resume_structured && typeof row.resume_structured === "object"
        ? /** @type {ResumeStructure} */ (row.resume_structured)
        : null,
  };
}

/**
 * @param {string} resumeText
 * @param {ResumeStructure | null | undefined} resumeStructured
 */
export async function upsertRemoteProfile(resumeText, resumeStructured) {
  const auth = await getAuthContext();
  if (!auth) return;

  const response = await restFetch("/profiles", {
    method: "POST",
    body: JSON.stringify({
      user_id: auth.userId,
      resume_text: resumeText || "",
      resume_structured: resumeStructured || {},
      updated_at: new Date().toISOString(),
    }),
  }, "resolution=merge-duplicates,return=minimal");

  if (!response.ok) await throwRestError(response);
}

/**
 * @param {TailorHistoryEntry} local
 * @param {TailorHistoryEntry} remote
 */
function pickNewerHistoryEntry(local, remote) {
  const localTime = Date.parse(local.createdAt) || 0;
  const remoteTime = Date.parse(remote.createdAt) || 0;
  return remoteTime >= localTime ? remote : local;
}

/**
 * @param {TailorHistoryEntry[]} local
 * @param {TailorHistoryEntry[]} remote
 */
function mergeHistory(local, remote) {
  const byId = new Map();

  for (const entry of local) {
    byId.set(entry.id, entry);
  }
  for (const entry of remote) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? pickNewerHistoryEntry(existing, entry) : entry);
  }

  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 50);
}

/**
 * Sync profile and job history between local storage and Supabase.
 * @returns {Promise<{ profileChanged: boolean, historyChanged: boolean }>}
 */
export async function syncUserDataFromCloud() {
  const auth = await getAuthContext();
  if (!auth) return { profileChanged: false, historyChanged: false };

  const [remoteProfile, remoteHistory, localStored] = await Promise.all([
    fetchRemoteProfile(),
    fetchRemoteJobHistory(),
    chrome.storage.local.get([PROFILE_KEY, PROFILE_STRUCTURED_KEY, HISTORY_KEY]),
  ]);

  let profileChanged = false;
  let historyChanged = false;

  const localResumeText = String(localStored[PROFILE_KEY] || "");
  const localStructured = localStored[PROFILE_STRUCTURED_KEY] || null;
  const localHistory = Array.isArray(localStored[HISTORY_KEY])
    ? localStored[HISTORY_KEY].map((entry) => normalizeHistoryEntry(entry))
    : [];

  const hasLocalProfile = Boolean(localResumeText.trim() || localStructured);
  const hasRemoteProfile = Boolean(
    remoteProfile?.resumeText?.trim() || remoteProfile?.resumeStructured
  );

  if (hasRemoteProfile && remoteProfile) {
    await chrome.storage.local.set({
      [PROFILE_KEY]: remoteProfile.resumeText || "",
      [PROFILE_STRUCTURED_KEY]: remoteProfile.resumeStructured || {},
    });
    profileChanged = true;
  } else if (hasLocalProfile) {
    await upsertRemoteProfile(localResumeText, localStructured);
  }

  const mergedHistory = mergeHistory(localHistory, remoteHistory);

  if (remoteHistory.length || localHistory.length) {
    await chrome.storage.local.set({ [HISTORY_KEY]: mergedHistory });
    historyChanged =
      mergedHistory.length !== localHistory.length ||
      mergedHistory.some((entry, index) => entry.id !== localHistory[index]?.id);

    await upsertRemoteJobHistory(mergedHistory);
  }

  return { profileChanged, historyChanged };
}

/**
 * @param {string} resumeText
 * @param {ResumeStructure | null | undefined} resumeStructured
 */
export async function syncProfileToCloud(resumeText, resumeStructured) {
  try {
    await upsertRemoteProfile(resumeText, resumeStructured);
  } catch (err) {
    console.warn("Failed to sync profile to Supabase", err);
  }
}

/**
 * @param {TailorHistoryEntry[]} entries
 */
export async function syncHistoryToCloud(entries) {
  try {
    await upsertRemoteJobHistory(entries);
  } catch (err) {
    console.warn("Failed to sync job history to Supabase", err);
  }
}

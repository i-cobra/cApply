/** @typedef {import("./resume-structure.js").ResumeStructure} ResumeStructure */
/** @typedef {import("./tailor-response.js").AtsScoreResult} AtsScoreResult */

/**
 * @typedef {{
 *   id: string,
 *   createdAt: string,
 *   title: string,
 *   companyName: string,
 *   jobUrl: string,
 *   jobDescription: string,
 *   resumeText: string,
 *   structured: ResumeStructure,
 *   changes: string[],
 *   atsScore: AtsScoreResult | null
 * }} TailorHistoryEntry
 */

export const HISTORY_KEY = "capply_tailor_history";
const MAX_HISTORY = 50;

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * @param {string} jobDescription
 * @param {string} [companyName]
 */
export function inferHistoryTitle(jobDescription, companyName = "") {
  const company = companyName.trim();
  let role = "";

  const lines = jobDescription
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const roleMatch = line.match(
      /\b(?:senior|staff|principal|lead|junior|mid(?:level)?)\s+[\w\s/-]{2,60}/i
    );
    if (roleMatch) {
      role = truncate(roleMatch[0], 72);
      break;
    }
  }

  if (!role) {
    role = lines[0] ? truncate(lines[0], 72) : "Tailored application";
  }

  if (company) {
    return truncate(`${company} · ${role}`, 80);
  }

  return role;
}

/**
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function loadTailorHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const items = stored[HISTORY_KEY];
  return Array.isArray(items) ? items : [];
}

/**
 * @param {TailorHistoryEntry[]} entries
 */
export async function saveTailorHistory(entries) {
  await chrome.storage.local.set({ [HISTORY_KEY]: entries });
}

/**
 * @param {Omit<TailorHistoryEntry, "id" | "createdAt" | "title"> & { title?: string }}
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function addTailorHistoryEntry(entry) {
  const history = await loadTailorHistory();
  /** @type {TailorHistoryEntry} */
  const record = {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    title:
      entry.title ||
      inferHistoryTitle(entry.jobDescription, entry.companyName || ""),
    companyName: entry.companyName || "",
    jobUrl: entry.jobUrl || "",
    jobDescription: entry.jobDescription,
    resumeText: entry.resumeText,
    structured: entry.structured,
    changes: entry.changes,
    atsScore: entry.atsScore,
  };

  history.unshift(record);
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }

  await saveTailorHistory(history);
  return history;
}

/**
 * @param {string} id
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function removeTailorHistoryEntry(id) {
  const history = (await loadTailorHistory()).filter((item) => item.id !== id);
  await saveTailorHistory(history);
  return history;
}

/**
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function clearTailorHistory() {
  await saveTailorHistory([]);
  return [];
}

/**
 * @param {string} iso
 */
export function formatHistoryDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @typedef {import("./resume-structure.js").ResumeStructure} ResumeStructure */
/** @typedef {import("./tailor-response.js").AtsScoreResult} AtsScoreResult */

/**
 * @typedef {{
 *   id: string,
 *   createdAt: string,
 *   title: string,
 *   companyName: string,
 *   position: string,
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

const STANDARD_ROLE_PATTERN =
  /\b((?:senior|staff|principal|lead|junior|mid[- ]?level|sr\.?)\s+[\w\s/.+-]{0,40}?\s*(?:full\s+stack|software|java|python|frontend|backend|web|cloud|data|devops|platform|mobile|ml|ai)?\s*(?:developer|engineer|architect|manager|analyst|specialist|consultant)s?)\b/i;

const ROLE_INTRO_PATTERN =
  /\b(?:seeking|hiring|looking for|join us as|position of|role of|opening for)\s+(?:an?\s+)?(?:[\w-]+\s+){0,4}(senior|staff|principal|lead|junior|mid[- ]?level|sr\.?)\s+([\w\s/.+-]{2,48}?\s*(?:developer|engineer|architect|manager|analyst|specialist|consultant)s?)\b/i;

/**
 * @param {string} role
 */
export function normalizeJobRoleTitle(role) {
  if (!role?.trim()) return "";

  let title = role.trim().replace(/\s+/g, " ");
  title = title.replace(/\bSr\.?\b/gi, "Senior");
  title = title.replace(/\bJr\.?\b/gi, "Junior");
  title = title.replace(
    /\b(Developers|Engineers|Architects|Managers|Analysts|Specialists|Consultants)\b/gi,
    (word) => word.charAt(0).toUpperCase() + word.slice(1, -1)
  );
  title = title.replace(/\s*[.,;:!].*$/, "");
  title = title.replace(
    /\s+\b(?:to|who|we|you|will|role|position|opening|job)\b.*$/i,
    ""
  );
  title = title.replace(/\b(?:developer|engineer|architect|manager|analyst|specialist|consultant)\b/gi, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
  title = title.replace(/\b(?:java|python|node\.?js|react|vue|angular|full stack|software|web|cloud|data|devops|platform|mobile)\b/gi, (word) => {
    const lower = word.toLowerCase();
    const map = {
      java: "Java",
      python: "Python",
      "node.js": "Node.js",
      nodejs: "Node.js",
      react: "React",
      vue: "Vue",
      angular: "Angular",
      "full stack": "Full Stack",
      software: "Software",
      web: "Web",
      cloud: "Cloud",
      data: "Data",
      devops: "DevOps",
      platform: "Platform",
      mobile: "Mobile",
    };
    return map[lower] || word;
  });
  title = title.replace(/\b(Senior|Staff|Principal|Lead|Junior)\b/g, (word) => word);

  return truncate(title.replace(/\s+/g, " ").trim(), 72);
}

/**
 * @param {string} jobDescription
 */
export function inferJobRole(jobDescription) {
  const text = jobDescription.trim();
  if (!text) return "";

  const introMatch = text.match(ROLE_INTRO_PATTERN);
  if (introMatch) {
    return normalizeJobRoleTitle(`${introMatch[1]} ${introMatch[2]}`);
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 12)) {
    const standardMatch = line.match(STANDARD_ROLE_PATTERN);
    if (standardMatch) {
      return normalizeJobRoleTitle(standardMatch[1]);
    }
  }

  const bodyMatch = text.match(STANDARD_ROLE_PATTERN);
  if (bodyMatch) {
    return normalizeJobRoleTitle(bodyMatch[1]);
  }

  const firstLine = lines[0] || "";
  const lineMatch = firstLine.match(
    /\b((?:senior|staff|principal|lead|junior|mid)\s+[\w\s/.+-]{2,50})/i
  );
  if (lineMatch) {
    return normalizeJobRoleTitle(lineMatch[1]);
  }

  return normalizeJobRoleTitle(firstLine);
}

/**
 * @param {string} jobDescription
 * @param {string} [companyName]
 * @param {string} [position]
 */
export function inferHistoryTitle(jobDescription, companyName = "", position = "") {
  const company = companyName.trim();
  const role = position.trim() || inferJobRole(jobDescription) || "Tailored application";

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
      inferHistoryTitle(
        entry.jobDescription,
        entry.companyName || "",
        entry.position || ""
      ),
    companyName: entry.companyName || "",
    position: entry.position || "",
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

/** @typedef {import("./resume-structure.js").ResumeStructure} ResumeStructure */
/** @typedef {import("./tailor-response.js").AtsScoreResult} AtsScoreResult */

/** @typedef {"saved" | "applied" | "interview" | "archived"} JobStatus */

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
 *   atsScore: AtsScoreResult | null,
 *   coverLetter?: string,
 *   notes?: string,
 *   appliedAt?: string,
 *   applied: boolean,
 *   status?: JobStatus
 * }} TailorHistoryEntry
 */

/** @type {JobStatus[]} */
export const JOB_STATUSES = ["saved", "applied", "interview", "archived"];

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

const SENIORITY_PREFIX =
  /^(senior|staff|principal|lead|junior|mid[- ]?level|sr\.?|jr\.?)\s+/i;

const ROLE_SUFFIX =
  /\b(developer|engineer|architect|analyst|consultant|manager|specialist|programmer|administrator)s?\b/i;

const TRAILING_LEVEL_SUFFIX = /\s+(?:I{1,3}|IV|VI{0,3}|IX|X{1,3}|\d+)\s*$/i;

const LANGUAGE_SYMBOLS_IN_TITLE = /(?:\bc#|\bc\+\+|\.net\b|node\.?js\b)/i;

const STACK_MODIFIER_IN_TITLE =
  /\b(back[\s-]?end|front[\s-]?end|full[\s-]?stack|software|web|cloud|data|devops|mobile|platform|api|distributed|microservices|embedded|infrastructure)\b/i;

const CLEAN_SINGLE_LANGUAGE_TITLE =
  /^(Senior|Staff|Principal|Lead|Junior|Mid-Level)\s+(Java|Python|JavaScript|TypeScript|Go|Golang|Rust|Kotlin|Ruby|PHP|Scala|Swift|C\+\+)\s+(Developer|Engineer)$/i;

/**
 * @param {string} word
 */
function capitalizeRoleWord(word) {
  const lower = word.toLowerCase().replace(/s$/, "");
  const map = {
    developer: "Developer",
    engineer: "Engineer",
    architect: "Architect",
    analyst: "Analyst",
    consultant: "Consultant",
    manager: "Manager",
    specialist: "Specialist",
    programmer: "Programmer",
    administrator: "Administrator",
  };
  return map[lower] || word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * @param {string} title
 */
function collapseToStandardRoleTitle(title) {
  let result = title.replace(TRAILING_LEVEL_SUFFIX, "").trim();
  if (!result) return title.trim();

  if (CLEAN_SINGLE_LANGUAGE_TITLE.test(result)) return result;

  const hasLanguageName =
    /\b(java|python|javascript|typescript|go|golang|rust|kotlin|ruby|php|scala|swift)\b/i.test(
      result
    );
  const needsCollapse =
    LANGUAGE_SYMBOLS_IN_TITLE.test(result) ||
    (hasLanguageName && STACK_MODIFIER_IN_TITLE.test(result));

  if (!needsCollapse) return result;

  const seniorityMatch = result.match(SENIORITY_PREFIX);
  const seniority = seniorityMatch
    ? seniorityMatch[0].trim().replace(/^sr\.?$/i, "Senior").replace(/^jr\.?$/i, "Junior")
    : "";
  const endingMatch = result.match(ROLE_SUFFIX);
  const ending = capitalizeRoleWord(endingMatch?.[0] || "Developer");

  let modifier = "Software";
  if (/\bfull[\s-]?stack\b/i.test(result)) modifier = "Full Stack";
  else if (/\bback[\s-]?end\b/i.test(result) && /\bfront[\s-]?end\b/i.test(result)) {
    modifier = "Full Stack";
  } else if (/\bback[\s-]?end\b/i.test(result)) modifier = "Backend";
  else if (/\bfront[\s-]?end\b/i.test(result)) modifier = "Frontend";
  else if (/\bweb\b/i.test(result)) modifier = "Web";
  else if (/\bcloud\b/i.test(result)) modifier = "Cloud";
  else if (/\bdata\b/i.test(result)) modifier = "Data";
  else if (/\bdevops\b/i.test(result)) modifier = "DevOps";
  else if (/\bmobile\b/i.test(result)) modifier = "Mobile";
  else if (/\bplatform\b/i.test(result)) modifier = "Platform";

  return [seniority, modifier, ending].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} role
 */
export function normalizeJobRoleTitle(role) {
  if (!role?.trim()) return "";

  let title = role.trim().replace(/\s+/g, " ");
  // Drop parenthetical or bracketed qualifiers — keep the standard role only.
  title = title.replace(/\s*[\(\[{][^\)\]}]*[\)\]}]\s*/g, " ").replace(/\s+/g, " ").trim();
  title = title.replace(TRAILING_LEVEL_SUFFIX, "").trim();
  title = title.replace(/\bSr\.?\s*/gi, "Senior ");
  title = title.replace(/\bJr\.?\s*/gi, "Junior ");
  title = title.replace(/\bSenior\.\s*/gi, "Senior ");
  title = title.replace(
    /\b(Developers|Engineers|Architects|Managers|Analysts|Specialists|Consultants)\b/gi,
    (word) => word.charAt(0).toUpperCase() + word.slice(1, -1)
  );
  // Strip trailing sentence punctuation — commas etc. and a final period only (not ".NET").
  title = title.replace(/\s*[,;:!].*$/, "");
  title = title.replace(/\.\s*$/, "");
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

  title = collapseToStandardRoleTitle(title);

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
 * @param {TailorHistoryEntry} entry
 * @returns {JobStatus}
 */
export function getEntryStatus(entry) {
  if (entry.status && JOB_STATUSES.includes(entry.status)) {
    return entry.status;
  }
  return entry.applied ? "applied" : "saved";
}

/**
 * @param {TailorHistoryEntry} entry
 * @returns {TailorHistoryEntry}
 */
export function normalizeHistoryEntry(entry) {
  const status = getEntryStatus(entry);
  entry.status = status;
  entry.applied = status === "applied" || status === "interview";
  return entry;
}

/**
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function loadTailorHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const items = stored[HISTORY_KEY];
  if (!Array.isArray(items)) return [];
  return items.map((entry) => normalizeHistoryEntry(entry));
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
    coverLetter: entry.coverLetter || "",
    notes: entry.notes || "",
    appliedAt: entry.appliedAt || "",
    status: entry.status && JOB_STATUSES.includes(entry.status) ? entry.status : "saved",
    applied: false,
  };
  normalizeHistoryEntry(record);

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
 * @param {string} id
 * @param {JobStatus} status
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function setTailorHistoryStatus(id, status) {
  if (!JOB_STATUSES.includes(status)) return loadTailorHistory();

  const history = await loadTailorHistory();
  for (const entry of history) {
    if (entry.id === id) {
      entry.status = status;
      entry.applied = status === "applied" || status === "interview";
      if (status === "applied" || status === "interview") {
        entry.appliedAt = entry.appliedAt || new Date().toISOString();
      }
      break;
    }
  }
  await saveTailorHistory(history);
  return history;
}

/**
 * @param {string} id
 * @param {boolean} [applied] explicit value; toggles when omitted
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function setTailorHistoryApplied(id, applied) {
  const history = await loadTailorHistory();
  const entry = history.find((item) => item.id === id);
  if (!entry) return history;

  const nextApplied = applied ?? !entry.applied;
  return setTailorHistoryStatus(id, nextApplied ? "applied" : "saved");
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

/**
 * @param {string} id
 * @param {string} notes
 * @returns {Promise<TailorHistoryEntry[]>}
 */
export async function setTailorHistoryNotes(id, notes) {
  const history = await loadTailorHistory();
  for (const entry of history) {
    if (entry.id === id) {
      entry.notes = notes.slice(0, 2000);
      break;
    }
  }
  await saveTailorHistory(history);
  return history;
}

/**
 * @returns {Promise<{ total: number, saved: number, applied: number, interview: number, archived: number, avgScore: number | null }>}
 */
export async function getHistoryStats() {
  const history = await loadTailorHistory();
  const stats = {
    total: history.length,
    saved: 0,
    applied: 0,
    interview: 0,
    archived: 0,
    avgScore: null,
  };

  let scoreSum = 0;
  let scoreCount = 0;

  for (const entry of history) {
    const status = getEntryStatus(entry);
    stats[status] += 1;
    if (entry.atsScore?.score != null) {
      scoreSum += entry.atsScore.score;
      scoreCount += 1;
    }
  }

  if (scoreCount) stats.avgScore = Math.round(scoreSum / scoreCount);
  return stats;
}

/**
 * @param {TailorHistoryEntry[]} [entries]
 * @returns {string}
 */
export function exportHistoryCsv(entries) {
  const rows = entries || [];
  const header = [
    "id",
    "createdAt",
    "status",
    "companyName",
    "position",
    "jobUrl",
    "atsScore",
    "appliedAt",
    "notes",
  ];

  const escape = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines = [header.join(",")];
  for (const entry of rows) {
    lines.push(
      [
        entry.id,
        entry.createdAt,
        getEntryStatus(entry),
        entry.companyName,
        entry.position || inferJobRole(entry.jobDescription),
        entry.jobUrl,
        entry.atsScore?.score ?? "",
        entry.appliedAt || "",
        entry.notes || "",
      ]
        .map(escape)
        .join(",")
    );
  }

  return lines.join("\n");
}

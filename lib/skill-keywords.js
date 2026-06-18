import { extractTechTermsFromText, normalizeTechTerm } from "./tech-similarity.js";

/** Words that must never appear alone as resume skills. */
const GENERIC_SKILL_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "as",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
  "does", "did", "will", "would", "could", "should", "may", "might", "must", "can",
  "you", "your", "we", "our", "they", "their", "this", "that", "these", "those",
  "with", "from", "by", "about", "into", "through", "during", "before", "after",
  "all", "each", "every", "both", "few", "more", "most", "other", "some", "any",
  "no", "not", "only", "own", "same", "so", "too", "very", "just", "also",
  "able", "work", "working", "experience", "years", "year", "role", "position",
  "job", "company", "team", "including", "within", "across", "using", "used",
  "use", "well", "strong", "ability", "skills", "skill", "required", "preferred",
  "plus", "minimum", "least", "etc", "via", "per", "looking", "join", "help",
  "make", "build", "new", "one", "two", "three", "first", "second", "third",
  "compliance", "tools", "tool", "software", "code", "engineer", "engineering",
  "developer", "development", "platform", "senior", "junior", "mid", "lead", "staff",
  "principal", "architect", "manager", "director", "time", "workflows", "workflow",
  "automated", "automation", "reports", "report", "tests", "test", "testing",
  "security", "services", "service", "cloud", "reports", "assisted", "assist",
  "solutions", "solution", "systems", "system", "applications", "application",
  "business", "internal", "external", "management", "responsibilities", "requirements",
  "knowledge", "understanding", "familiarity", "proficiency", "proficient",
  "environment", "environments", "production", "modern", "various", "multiple",
  "practices", "standards", "processes", "process", "performance", "quality",
  "scalable", "reliable", "efficient", "effective", "excellent", "good", "best",
  "full", "stack", "end",   "technical", "technology", "technologies", "related",
  "hands", "hand", "remote", "hybrid",
  "onsite", "based", "driven", "oriented", "focused", "level", "levels", "type",
  "types", "methods", "method", "methodologies", "methodology", "approach",
  "approaches", "strategies", "strategy", "tasks", "task", "issues", "issue",
  "problems", "problem", "features", "feature", "functions", "function", "functional",
  "operations", "operation", "operational", "maintenance", "support", "supported",
  "collaboration", "communication", "interpersonal", "leadership", "mentoring",
  "documentation", "analysis", "analytical", "design", "designs", "implementation",
  "integrations", "integration", "deployment", "deployments", "delivery", "deliver",
  "monitoring", "logging", "debugging", "troubleshooting", "optimization",
  "improvement", "improvements", "enhancement", "enhancements", "initiatives",
  "initiative", "projects", "project", "products", "product", "customers", "customer",
  "clients", "client", "users", "user", "stakeholders", "stakeholder", "partners",
  "partner", "cross", "functional", "fast", "paced", "dynamic", "innovative",
  "creative", "detail", "details", "oriented", "self", "motivated", "motivation",
  "independent", "dependently", "dependable", "flexible", "adaptable", "agile",
  "lean", "startup", "enterprise", "global", "international", "domestic",
  "verbal", "written", "spoken", "language", "languages", "english", "spanish",
  "degree", "bachelor", "master", "masters", "phd", "education", "certified",
  "certification", "certifications", "license", "licensed", "compliant",
  "nice", "have",
]);

/** Multi-word phrases that are job prose, not skills. */
const GENERIC_SKILL_PHRASES = new Set([
  "cloud services",
  "ai assisted workflows",
  "ai-assisted workflows",
  "full stack",
  "full stack development",
  "best practices",
  "cross functional",
  "cross-functional teams",
  "time management",
  "problem solving",
  "work closely",
  "fast paced",
  "fast-paced environment",
  "end to end",
  "hands on",
  "hands-on experience",
  "software development",
  "web development",
  "application development",
  "code reviews",
  "unit tests",
  "integration tests",
  "test driven",
  "test-driven development",
  "ai-assisted",
  "ai-enhanced",
  "ai-driven",
  "ai-powered",
  "ai assisted",
  "ai enhanced",
  "ai driven",
  "ai powered",
  "front-end",
  "front end",
  "back-end",
  "back end",
  "full-stack",
  "full stack",
  "frontend",
  "backend",
  "fullstack",
  "prompt engineering",
  "sql optimization",
  "advanced sql",
  "ai prompt engineering",
]);

const PROSE_SKILL_PREFIX =
  /^(?:including|or|and|with|such as|like|e\.g\.|advanced|strong|proficient in|experience with|knowledge of|familiarity with|working with|hands-on with)\s+/i;

const VAGUE_SKILL_PATTERN =
  /^(?:ai[-\s])?(?:assisted|enhanced|driven|powered|enabled)\b/i;

/** @type {Set<string>} */
const ALLOWED_MULTI_WORD_SKILLS = new Set([
  "rest apis",
  "restful apis",
  "graphql apis",
  "ci/cd",
  "ci/cd pipelines",
  "prompt engineering",
  "machine learning",
  "deep learning",
  "objective c",
  "visual studio",
  "visual studio code",
  "sql server",
  "amazon web services",
  "google cloud platform",
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractCommaPhrases(text) {
  const phrases = [];
  for (const part of text.split(/[,;•|]/)) {
    const trimmed = part
      .trim()
      .replace(/^[\s\-–—*]+/, "")
      .replace(/[.!?:]+$/g, "")
      .trim();
    if (trimmed.length < 2 || trimmed.length > 40 || !/\w/.test(trimmed)) continue;
    phrases.push(trimmed);
  }
  return phrases;
}

/**
 * @param {string} term
 */
function looksLikeTechShape(term) {
  const trimmed = term.trim();
  const lower = trimmed.toLowerCase();

  if (/\.(js|ts|tsx|jsx|py|go|rb|net|vue)\b/i.test(trimmed)) return true;
  if (/\b(c#|c\+\+|f#)\b/i.test(trimmed)) return true;
  if (/\bci\s*\/\s*cd\b/i.test(trimmed)) return true;
  if (/\b(rest|restful|graphql|grpc|soap)\s+api(s)?\b/i.test(trimmed)) return true;
  if (/\b(api|sdk)s?\b/i.test(trimmed) && lower.split(/\s+/).length <= 4) return true;
  if (/[0-9]/.test(trimmed) && /[a-z]/i.test(trimmed)) return true;
  if (/^[A-Z0-9][a-zA-Z0-9+.#/-]{1,}$/.test(trimmed)) return true;

  return false;
}

/**
 * @param {string} term
 */
function looksLikeProseSkillFragment(term) {
  const lower = normalizeTechTerm(term);
  if (!lower) return true;

  if (PROSE_SKILL_PREFIX.test(term.trim())) return true;
  if (VAGUE_SKILL_PATTERN.test(lower)) return true;
  if (/^ai\s+(prompt|enhanced|assisted|driven|powered)\b/i.test(term.trim())) return true;
  if (GENERIC_SKILL_PHRASES.has(lower)) return true;

  if (/\b(including|optimization)\b/.test(lower)) return true;
  if (/\benvironments?\b/.test(lower) && lower.split(/\s+/).length > 1) return true;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 4 && !ALLOWED_MULTI_WORD_SKILLS.has(lower)) return true;

  if (words.length >= 2 && words.every((word) => GENERIC_SKILL_STOP_WORDS.has(word))) {
    return true;
  }

  return false;
}

/**
 * @param {string} raw
 */
function normalizeSkillFragment(raw) {
  let term = raw
    .trim()
    .replace(/^[\s\-–—*"']+/, "")
    .replace(/[.!?:]+$/g, "")
    .trim();

  for (let i = 0; i < 4; i++) {
    const next = term.replace(PROSE_SKILL_PREFIX, "").trim();
    if (next === term) break;
    term = next;
  }

  term = term.replace(/\s+(?:environments?|environment)$/i, "").trim();
  term = term.replace(/\s+optimization$/i, "").trim();
  term = term.replace(/^advanced\s+/i, "").trim();

  return term;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function expandSkillFragment(raw) {
  const normalized = normalizeSkillFragment(raw);
  if (!normalized) return [];

  if (looksLikeProseSkillFragment(normalized)) {
    return filterSkillTerms(extractTechTermsFromText(normalized));
  }

  if (ALLOWED_MULTI_WORD_SKILLS.has(normalizeTechTerm(normalized))) {
    return [normalized];
  }

  if (isLikelySkillTerm(normalized)) {
    return [normalized];
  }

  const extracted = extractTechTermsFromText(normalized);
  if (extracted.length) return filterSkillTerms(extracted);

  return [];
}

/**
 * @param {string} term
 * @returns {boolean}
 */
export function isLikelySkillTerm(term) {
  const trimmed = term.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 40) return false;

  const lower = normalizeTechTerm(trimmed);
  if (lower === "ai" || lower === "ml") return false;
  if (GENERIC_SKILL_PHRASES.has(lower)) return false;
  if (GENERIC_SKILL_STOP_WORDS.has(lower)) return false;
  if (looksLikeProseSkillFragment(trimmed)) return false;

  if (ALLOWED_MULTI_WORD_SKILLS.has(lower)) return true;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 1 && GENERIC_SKILL_STOP_WORDS.has(words[0])) return false;
  if (words.length > 1 && words.every((word) => GENERIC_SKILL_STOP_WORDS.has(word))) {
    return false;
  }

  if (extractTechTermsFromText(trimmed).length > 0) return true;
  if (looksLikeTechShape(trimmed)) return true;

  if (words.length >= 2) {
    const significant = words.filter(
      (word) => word.length >= 3 && !GENERIC_SKILL_STOP_WORDS.has(word)
    );
    if (significant.length >= 2 && !GENERIC_SKILL_PHRASES.has(lower)) {
      return significant.some((word) => extractTechTermsFromText(word).length > 0);
    }
  }

  return false;
}

/**
 * @param {string[]} terms
 * @returns {string[]}
 */
export function filterSkillTerms(terms) {
  const seen = new Set();
  const results = [];

  for (const term of terms) {
    const trimmed = term.trim();
    if (!isLikelySkillTerm(trimmed)) continue;
    const key = normalizeTechTerm(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(trimmed);
  }

  return results;
}

/**
 * @param {string} skills
 * @returns {string}
 */
export function sanitizeSkillsString(skills) {
  if (!skills?.trim()) return "";

  const parts = skills
    .split(/[,;•|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const expanded = parts.flatMap((part) => expandSkillFragment(part));
  return filterSkillTerms(expanded).join(", ");
}

/**
 * Prefer longer skill phrases when one term is a substring of another.
 * @param {string[]} skills
 * @returns {string[]}
 */
export function preferDistinctCoreSkills(skills) {
  const filtered = filterSkillTerms(skills);
  filtered.sort((a, b) => b.length - a.length);
  /** @type {string[]} */
  const result = [];

  for (const skill of filtered) {
    const key = normalizeTechTerm(skill);
    const dominatedByExisting = result.some((existing) => {
      const existingKey = normalizeTechTerm(existing);
      return (
        existingKey !== key &&
        existing.length > skill.length &&
        (existingKey.includes(key) || key.includes(existingKey))
      );
    });
    if (dominatedByExisting) continue;

    const withoutShorter = result.filter((existing) => {
      const existingKey = normalizeTechTerm(existing);
      return !(
        existingKey !== key &&
        skill.length > existing.length &&
        (existingKey.includes(key) || key.includes(existingKey))
      );
    });

    result.length = 0;
    result.push(...withoutShorter, skill);
  }

  return result;
}

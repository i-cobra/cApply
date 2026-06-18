import { parseJsonFromText } from "./json-extract.js";
import { normalizeResume, serializeResume } from "./resume-structure.js";
import { resumeSupportsKeyword } from "./tech-similarity.js";

/**
 * @typedef {{ score: number, summary: string, missingKeywords: string[] }} AtsScoreResult
 */

/**
 * @param {unknown} parsed
 * @returns {import("./resume-structure.js").ResumeStructure | null}
 */
function extractResumeData(parsed) {
  if (!parsed || typeof parsed !== "object") return null;

  const record = /** @type {Record<string, unknown>} */ (parsed);

  if (record.tailoredResume && typeof record.tailoredResume === "object") {
    return normalizeResume(record.tailoredResume);
  }
  if (record.resume && typeof record.resume === "object") {
    return normalizeResume(record.resume);
  }
  if (record.tailored_resume && typeof record.tailored_resume === "object") {
    return normalizeResume(record.tailored_resume);
  }
  if (
    record.contact ||
    record.experience ||
    record.summary ||
    record.education ||
    record.skills
  ) {
    return normalizeResume(parsed);
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {AtsScoreResult | null}
 */
function extractAtsScore(value) {
  if (!value || typeof value !== "object") return null;

  const record = /** @type {Record<string, unknown>} */ (value);
  let score = record.score ?? record.value ?? record.percent;

  if (typeof score === "string") {
    const parsed = Number.parseInt(score.replace(/[^\d]/g, ""), 10);
    score = Number.isNaN(parsed) ? null : parsed;
  }

  if (typeof score !== "number" || Number.isNaN(score)) return null;

  const summary =
    typeof record.summary === "string"
      ? record.summary.trim()
      : typeof record.explanation === "string"
        ? record.explanation.trim()
        : "";

  const missingRaw =
    record.missingKeywords ?? record.missing_keywords ?? record.missing ?? [];
  const missingKeywords = Array.isArray(missingRaw)
    ? missingRaw
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    : [];

  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    summary,
    missingKeywords,
  };
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} structured
 * @param {AtsScoreResult | null} atsScore
 * @returns {AtsScoreResult | null}
 */
function reconcileAtsScore(structured, atsScore) {
  if (!atsScore) return null;

  const resumeText = serializeResume(structured);
  const missingKeywords = atsScore.missingKeywords.filter(
    (keyword) => !resumeSupportsKeyword(resumeText, keyword)
  );

  return {
    ...atsScore,
    missingKeywords,
  };
}

/**
 * @param {string} text
 * @returns {{
 *   structured: import("./resume-structure.js").ResumeStructure,
 *   changes: string[],
 *   atsScore: AtsScoreResult | null
 * }}
 */
export function parseTailorResponse(text) {
  const parsed = parseJsonFromText(text);
  const structured = extractResumeData(parsed);

  if (!structured) {
    throw new Error("ChatGPT JSON did not include a recognizable resume object.");
  }

  const record =
    parsed && typeof parsed === "object"
      ? /** @type {Record<string, unknown>} */ (parsed)
      : {};

  const changes = Array.isArray(record.changes)
    ? record.changes.filter((item) => typeof item === "string" && item.trim())
    : [];

  const atsScore = reconcileAtsScore(
    structured,
    extractAtsScore(record.atsScore ?? record.ats_score ?? record.ats)
  );

  return { structured, changes, atsScore };
}

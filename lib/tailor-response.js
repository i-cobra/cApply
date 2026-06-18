import { assembleTailorJsonFromText, extractJsonProperty, parseJsonFromText } from "./json-extract.js";
import { normalizeResume } from "./resume-structure.js";

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
 * @returns {number | null}
 */
function normalizeScoreValue(value) {
  if (typeof value === "number" && !Number.isNaN(value)) {
    const score = value > 0 && value <= 1 ? Math.round(value * 100) : Math.round(value);
    return Math.min(100, Math.max(0, score));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(parsed)) return null;
    return Math.min(100, Math.max(0, parsed));
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {AtsScoreResult | null}
 */
function extractAtsScore(value) {
  const directScore = normalizeScoreValue(value);
  if (directScore != null) {
    return { score: directScore, summary: "", missingKeywords: [] };
  }

  if (!value || typeof value !== "object") return null;

  const record = /** @type {Record<string, unknown>} */ (value);
  const score = normalizeScoreValue(
    record.score ??
      record.value ??
      record.percent ??
      record.percentage ??
      record.matchScore ??
      record.match_score ??
      record.rating ??
      record.estimatedScore ??
      record.estimated_score
  );

  if (score == null) return null;

  const summary =
    typeof record.summary === "string"
      ? record.summary.trim()
      : typeof record.explanation === "string"
        ? record.explanation.trim()
        : typeof record.assessment === "string"
          ? record.assessment.trim()
          : "";

  const missingRaw =
    record.missingKeywords ??
    record.missing_keywords ??
    record.missing ??
    record.gaps ??
    [];
  const missingKeywords = Array.isArray(missingRaw)
    ? missingRaw
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
    : [];

  return { score, summary, missingKeywords };
}

/**
 * @param {unknown} value
 * @returns {AtsScoreResult | null}
 */
export function normalizeAtsScoreResult(value) {
  const direct = extractAtsScore(value);
  if (direct) return direct;

  if (!value || typeof value !== "object") return null;

  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.atsScore != null) {
    return extractAtsScore(record.atsScore);
  }

  return null;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} rawText
 * @returns {AtsScoreResult | null}
 */
function findAtsScore(record, rawText) {
  const atsFromTextOptions = { last: true };
  /** @type {unknown[]} */
  const candidates = [
    record.atsScore,
    record.ats_score,
    record.atsscore,
    record.ATSScore,
    record.ats,
    extractJsonProperty(rawText, "atsScore", atsFromTextOptions),
    extractJsonProperty(rawText, "ats_score", atsFromTextOptions),
    extractJsonProperty(rawText, "atsscore", atsFromTextOptions),
    extractJsonProperty(rawText, "ats", atsFromTextOptions),
  ];

  const tailored = record.tailoredResume;
  if (tailored && typeof tailored === "object" && !Array.isArray(tailored)) {
    const nested = /** @type {Record<string, unknown>} */ (tailored).atsScore;
    if (nested != null) candidates.unshift(nested);
  }

  for (const candidate of candidates) {
    const parsed = normalizeAtsScoreResult(candidate);
    if (parsed?.score != null) return parsed;
  }

  if (record.score !== undefined) {
    const parsed = normalizeAtsScoreResult({
      score: record.score,
      summary: "",
      missingKeywords: record.missingKeywords ?? record.missing_keywords,
    });
    if (parsed?.score != null) return parsed;
  }

  const scoreMatch = rawText.match(
    /"(?:atsScore|ats_score|atsscore|ats)"\s*:\s*\{[\s\S]*?"score"\s*:\s*(\d+(?:\.\d+)?)/i
  );
  if (scoreMatch) {
    const score = normalizeScoreValue(Number(scoreMatch[1]));
    if (score != null) {
      const summaryMatch = rawText.match(
        /"(?:atsScore|ats_score|atsscore|ats)"\s*:\s*\{[\s\S]*?"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/i
      );
      return {
        score,
        summary: summaryMatch?.[1]?.replace(/\\"/g, '"').trim() ?? "",
        missingKeywords: [],
      };
    }
  }

  return null;
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

  let atsScore = findAtsScore(record, text);
  if (!atsScore) {
    const assembled = assembleTailorJsonFromText(text);
    if (assembled) {
      atsScore = findAtsScore(
        /** @type {Record<string, unknown>} */ (assembled),
        text
      );
    }
  }

  return { structured, changes, atsScore };
}

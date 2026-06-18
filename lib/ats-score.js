import { resumeSupportsKeyword } from "./tech-similarity.js";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "as",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do",
  "does", "did", "will", "would", "could", "should", "may", "might", "must", "can",
  "you", "your", "we", "our", "they", "their", "this", "that", "these", "those",
  "with", "from", "by", "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "under", "over", "such", "than", "then", "them",
  "it", "its", "who", "whom", "which", "what", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some", "any",
  "no", "not", "only", "own", "same", "so", "too", "very", "just", "also",
  "able", "work", "working", "experience", "years", "year", "role", "position",
  "job", "company", "team", "including", "within", "across", "using", "used",
  "use", "well", "strong", "ability", "skills", "skill", "required", "preferred",
  "plus", "minimum", "least", "etc", "via", "per", "looking", "join", "help",
  "make", "build", "new", "one", "two", "three", "first", "second", "third",
]);

const MAX_KEYWORDS = 45;

/**
 * @param {string} text
 */
function normalizeForMatch(text) {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractTokens(text) {
  const tokens = [];
  const pattern = /\b[a-z0-9]+(?:[.+#/-][a-z0-9]+)*\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push(match[0].toLowerCase());
  }
  return tokens;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractPhrases(text) {
  const phrases = [];
  for (const part of text.split(/[,;•|]/)) {
    const trimmed = part
      .trim()
      .replace(/^[\s\-–—*]+/, "")
      .replace(/[.!?:]+$/g, "")
      .trim();
    if (trimmed.length < 2 || trimmed.length > 40 || !/\w/.test(trimmed)) continue;
    phrases.push(trimmed.toLowerCase());
  }
  return phrases;
}

/**
 * @param {string} jobDescription
 * @returns {string[]}
 */
export function extractJobKeywords(jobDescription) {
  const text = jobDescription.trim();
  if (!text) return [];

  /** @type {Map<string, number>} */
  const freq = new Map();

  for (const token of extractTokens(text)) {
    if (token.length < 2 || STOP_WORDS.has(token)) continue;
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  for (const phrase of extractPhrases(text)) {
    const words = phrase.split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
    if (words.length >= 2 && words.length <= 4) {
      const key = words.join(" ");
      freq.set(key, (freq.get(key) || 0) + 2);
    } else if (words.length === 1 && words[0].length >= 3) {
      freq.set(words[0], (freq.get(words[0]) || 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, MAX_KEYWORDS)
    .map(([word]) => word);
}

/**
 * @param {number} score
 * @returns {"good" | "fair" | "poor"}
 */
export function scoreTier(score) {
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  return "poor";
}

/**
 * @param {string} resumeText
 * @param {string} jobDescription
 * @returns {{ score: number, matched: string[], missing: string[], total: number }}
 */
export function computeAtsScore(resumeText, jobDescription) {
  const keywords = extractJobKeywords(jobDescription);
  if (!keywords.length) {
    return { score: 0, matched: [], missing: [], total: 0 };
  }

  const matched = [];
  const missing = [];

  for (const kw of keywords) {
    if (resumeSupportsKeyword(resumeText, kw)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const score = Math.round((matched.length / keywords.length) * 100);
  return { score, matched, missing, total: keywords.length };
}

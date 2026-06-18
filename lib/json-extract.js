/**
 * Extract and parse JSON from ChatGPT responses (markdown, fences, prose).
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonFromText(text) {
  if (!text?.trim()) {
    throw new Error("Empty response from ChatGPT.");
  }

  const candidates = collectJsonCandidates(text.trim());
  let lastError = null;

  for (const candidate of candidates) {
    try {
      return tryParseJson(candidate);
    } catch (err) {
      lastError = err;
      const balanced = extractBalancedJson(repairJson(candidate));
      if (balanced && balanced !== candidate) {
        try {
          return tryParseJson(balanced);
        } catch (innerErr) {
          lastError = innerErr;
        }
      }
    }
  }

  const partial = tryAssemblePartialObject(text.trim());
  if (partial) return partial;

  throw new Error(
    lastError instanceof Error
      ? `Could not parse JSON from ChatGPT response: ${lastError.message}`
      : "Could not parse JSON from ChatGPT response."
  );
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function collectJsonCandidates(text) {
  const seen = new Set();
  /** @type {string[]} */
  const candidates = [];

  const add = (value) => {
    const trimmed = value?.trim();
    if (!trimmed || !trimmed.includes("{") || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    add(match[1]);
  }

  add(text);

  const balanced = extractBalancedJson(text);
  if (balanced) add(balanced);

  const objects = text.match(/\{[\s\S]*\}/g) || [];
  for (const obj of objects) add(obj);

  return candidates.sort((a, b) => scoreJsonCandidate(b) - scoreJsonCandidate(a));
}

/**
 * @param {string} text
 * @returns {number}
 */
function scoreJsonCandidate(text) {
  let score = 0;
  if (text.includes('"resume"')) score += 4;
  if (text.includes('"tailoredResume"')) score += 4;
  if (text.includes('"contact"')) score += 3;
  if (text.includes('"experience"')) score += 2;
  if (text.startsWith("{")) score += 1;
  return score;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function extractBalancedJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function extractBalancedArray(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * @param {string} text
 * @param {string} propertyName
 * @returns {string | null}
 */
function extractPropertyValueSlice(text, propertyName) {
  const keyPattern = new RegExp(`"${propertyName}"\\s*:`);
  const match = keyPattern.exec(text);
  if (!match) return null;

  const rest = text.slice(match.index + match[0].length).trimStart();
  if (rest.startsWith("{")) return extractBalancedJson(rest);
  if (rest.startsWith("[")) return extractBalancedArray(rest);

  const stringMatch = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
  if (stringMatch) return `"${stringMatch[1]}"`;

  const literalMatch = /^(true|false|null|-?\d+(?:\.\d+)?)/.exec(rest);
  if (literalMatch) return literalMatch[1];

  return null;
}

/**
 * @param {string} text
 * @param {string} propertyName
 * @returns {unknown}
 */
function parsePropertyValue(text, propertyName) {
  const slice = extractPropertyValueSlice(text, propertyName);
  if (!slice) return undefined;
  try {
    return tryParseJson(slice);
  } catch {
    return undefined;
  }
}

/**
 * Assemble tailor envelope from individually parsed properties.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function tryAssemblePartialObject(text) {
  const tailoredResume =
    parsePropertyValue(text, "tailoredResume") ??
    parsePropertyValue(text, "tailored_resume") ??
    parsePropertyValue(text, "resume");

  const hasResumeObject =
    tailoredResume &&
    typeof tailoredResume === "object" &&
    !Array.isArray(tailoredResume);

  const hasResumeFields =
    parsePropertyValue(text, "contact") ||
    parsePropertyValue(text, "experience") ||
    parsePropertyValue(text, "summary");

  if (!hasResumeObject && !hasResumeFields) return null;

  /** @type {Record<string, unknown>} */
  const assembled = {};

  if (hasResumeObject) {
    assembled.tailoredResume = tailoredResume;
  } else if (hasResumeFields) {
    assembled.tailoredResume = {
      contact: parsePropertyValue(text, "contact") ?? {},
      summary: parsePropertyValue(text, "summary") ?? "",
      experience: parsePropertyValue(text, "experience") ?? [],
      education: parsePropertyValue(text, "education") ?? [],
      skills: parsePropertyValue(text, "skills") ?? "",
      other: parsePropertyValue(text, "other") ?? "",
    };
  }

  const changes = parsePropertyValue(text, "changes");
  if (Array.isArray(changes)) assembled.changes = changes;

  const atsScore =
    parsePropertyValue(text, "atsScore") ??
    parsePropertyValue(text, "ats_score") ??
    parsePropertyValue(text, "ats");
  if (atsScore && typeof atsScore === "object") assembled.atsScore = atsScore;

  return assembled;
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function tryParseJson(text) {
  const seen = new Set();
  /** @type {string[]} */
  const attempts = [];

  const addAttempt = (value) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    attempts.push(trimmed);
  };

  const pipelines = [
    [repairJson],
    [repairJson, insertMissingCommas],
    [repairJson, escapeControlCharsInJsonStrings, insertMissingCommas],
    [repairJson, escapeInteriorQuotesInStrings, insertMissingCommas],
    [
      repairJson,
      removeJsonComments,
      escapeInteriorQuotesInStrings,
      escapeControlCharsInJsonStrings,
      insertMissingCommas,
    ],
    [
      repairJson,
      escapeInteriorQuotesInStrings,
      escapeControlCharsInJsonStrings,
      insertMissingCommas,
      removeInvalidJsonLiterals,
    ],
  ];

  for (const pipeline of pipelines) {
    let current = text;
    for (const step of pipeline) {
      current = step(current);
    }
    addAttempt(current);
  }

  const queue = [text];
  const transforms = [
    repairJson,
    removeJsonComments,
    escapeControlCharsInJsonStrings,
    escapeInteriorQuotesInStrings,
    insertMissingCommas,
    removeInvalidJsonLiterals,
  ];

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;

    addAttempt(current);

    for (const transform of transforms) {
      const next = transform(current);
      if (next !== current) {
        queue.push(next);
        addAttempt(next);
      }
    }
  }

  let lastError = null;
  for (const attempt of attempts) {
    let current = attempt;
    for (let round = 0; round < 20; round++) {
      try {
        return JSON.parse(current);
      } catch (err) {
        lastError = err;
        const repaired = repairUsingParseError(current, err);
        if (!repaired || repaired === current) break;
        current = repaired;
      }
    }
  }

  throw lastError ?? new Error("Invalid JSON");
}

/**
 * @param {Error} err
 * @returns {number | null}
 */
function getParseErrorPosition(err) {
  if (!(err instanceof SyntaxError)) return null;
  const match = err.message.match(/position (\d+)/i);
  return match ? Number(match[1]) : null;
}

/**
 * @param {string} text
 * @param {Error} err
 * @returns {string | null}
 */
function repairUsingParseError(text, err) {
  const position = getParseErrorPosition(err);
  if (position == null || position < 0 || position > text.length) return null;

  const fixes = [
    () => insertCommaBeforeIndex(text, position),
    () => insertCommaBeforeIndex(text, Math.max(0, position - 1)),
    () => insertCommaBeforeIndex(text, Math.max(0, position - 2)),
    () => insertMissingCommas(text),
    () => escapeInteriorQuotesInStrings(text),
    () => escapeControlCharsInJsonStrings(text),
    () => removeStrayCharactersAt(text, position),
  ];

  for (const fix of fixes) {
    const next = fix();
    if (next && next !== text) return next;
  }

  return null;
}

/**
 * @param {string} text
 * @param {number} position
 * @returns {string | null}
 */
function removeStrayCharactersAt(text, position) {
  const ch = text[position];
  if (!ch || /[\s,}\]]/.test(ch)) return null;
  return `${text.slice(0, position)}${text.slice(position + 1)}`;
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {string | null}
 */
function insertCommaBeforeIndex(text, index) {
  let i = index;
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
  if (i <= 0) return null;

  const valueEnd = findValueEndBefore(text, i);
  if (valueEnd == null) return null;

  let j = valueEnd;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  if (j < text.length && text[j] === ",") return null;

  let k = j;
  while (k < text.length && /\s/.test(text[k])) k += 1;
  if (k >= text.length) return null;

  const next = text[k];
  if (next !== '"' && next !== "{" && next !== "[") return null;

  return `${text.slice(0, j)},${text.slice(j)}`;
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {number | null}
 */
function findValueEndBefore(text, index) {
  let i = index;
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
  if (i <= 0) return null;

  const ch = text[i - 1];
  if (ch === "}" || ch === "]" || /[0-9]/.test(ch)) return i;
  if (text.startsWith("true", i - 4) && (i - 4 === 0 || /[^\w]/.test(text[i - 5]))) return i;
  if (text.startsWith("false", i - 5) && (i - 5 === 0 || /[^\w]/.test(text[i - 6]))) return i;
  if (text.startsWith("null", i - 4) && (i - 4 === 0 || /[^\w]/.test(text[i - 5]))) return i;

  if (ch === '"') {
    let inString = false;
    let escaped = false;
    let stringEnd = -1;

    for (let pos = 0; pos < i; pos += 1) {
      const current = text[pos];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (current === '"') {
        inString = !inString;
        if (!inString) stringEnd = pos + 1;
      }
    }

    return stringEnd === i ? i : null;
  }

  return null;
}

/**
 * @param {string} text
 * @param {number} quoteIndex
 */
function isLikelyStringEnd(text, quoteIndex) {
  let i = quoteIndex + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return true;
  const ch = text[i];
  return ch === "," || ch === "}" || ch === "]" || ch === ":";
}

/**
 * Escape quotes that appear inside JSON string values.
 * @param {string} text
 * @returns {string}
 */
function escapeInteriorQuotesInStrings(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
        continue;
      }

      if (isLikelyStringEnd(text, i)) {
        inString = false;
        result += ch;
      } else {
        result += '\\"';
      }
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Escape raw newlines/tabs/control chars inside JSON string literals.
 * @param {string} text
 * @returns {string}
 */
function escapeControlCharsInJsonStrings(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      const code = ch.charCodeAt(0);
      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      if (ch === "\t") {
        result += "\\t";
        continue;
      }
      if (code < 32) {
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/**
 * Insert commas missing between adjacent JSON values.
 * @param {string} text
 * @returns {string}
 */
function insertMissingCommas(text) {
  let result = text;

  result = result.replace(
    /"((?:[^"\\]|\\.)*)"\s*\n\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g,
    '"$1",\n"$2":'
  );
  result = result.replace(
    /(\})\s*\n\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g,
    '$1,\n"$2":'
  );
  result = result.replace(
    /(\])\s*\n\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g,
    '$1,\n"$2":'
  );
  result = result.replace(/"((?:[^"\\]|\\.)*)"\s+(?=")/g, '"$1", ');
  result = result.replace(/"((?:[^"\\]|\\.)*)"\s+(?=\{)/g, '"$1", ');
  result = result.replace(/"((?:[^"\\]|\\.)*)"\s+(?=\[)/g, '"$1", ');
  result = result.replace(/(\})\s+(?=")/g, "$1, ");
  result = result.replace(/(\})\s+(?=\{)/g, "$1, ");
  result = result.replace(/(\})\s+(?=\[)/g, "$1, ");
  result = result.replace(/(\])\s+(?=")/g, "$1, ");
  result = result.replace(/(\])\s+(?=\{)/g, "$1, ");
  result = result.replace(/(\])\s+(?=\[)/g, "$1, ");
  result = result.replace(/(\d)\s+(?=")/g, "$1, ");
  result = result.replace(/(true|false|null)\s+(?=")/g, "$1, ");
  result = result.replace(/(true|false|null)\s+(?=\{)/g, "$1, ");
  result = result.replace(/(true|false|null)\s+(?=\[)/g, "$1, ");

  result = result.replace(/(\d)\s*\n\s*(?=")/g, "$1,\n");
  result = result.replace(/(true|false|null)\s*\n\s*(?=")/g, "$1,\n");
  result = result.replace(/(\})\s*\n\s*(?=")/g, "$1,\n");
  result = result.replace(/(\])\s*\n\s*(?=")/g, "$1,\n");
  result = result.replace(/"((?:[^"\\]|\\.)*)"\s*\n\s*(?=")/g, '"$1",\n');

  return result;
}

/**
 * @param {string} text
 * @returns {string}
 */
function removeInvalidJsonLiterals(text) {
  return text
    .replace(/\bundefined\b/g, "null")
    .replace(/\bNaN\b/g, "null")
    .replace(/\bInfinity\b/g, "null");
}

/**
 * @param {string} text
 * @returns {string}
 */
function removeJsonComments(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (!inString && ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }

    if (!inString && ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * @param {string} text
 * @returns {string}
 */
function repairJson(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/^\s*json\s*\n/i, "")
    .replace(/\nCopy code\s*$/i, "")
    .trim();
}

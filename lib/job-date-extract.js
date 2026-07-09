/**
 * @typedef {{ jobPosted: string, jobCreated: string, jobModified: string }} JobDates
 */

/**
 * @returns {JobDates}
 */
export function emptyJobDates() {
  return { jobPosted: "", jobCreated: "", jobModified: "" };
}

/**
 * @param {...(Partial<JobDates> | null | undefined)} sources
 * @returns {JobDates}
 */
export function mergeJobDates(...sources) {
  const out = emptyJobDates();
  for (const src of sources) {
    if (!src) continue;
    if (!out.jobPosted && src.jobPosted) out.jobPosted = src.jobPosted;
    if (!out.jobCreated && src.jobCreated) out.jobCreated = src.jobCreated;
    if (!out.jobModified && src.jobModified) out.jobModified = src.jobModified;
  }
  return out;
}

/**
 * @param {unknown} data
 * @returns {Record<string, unknown>[]}
 */
function flattenJsonLd(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(flattenJsonLd);
  if (typeof data === "object" && data !== null && "@graph" in data) {
    return flattenJsonLd(/** @type {{ "@graph": unknown }} */ (data)["@graph"]);
  }
  return [/** @type {Record<string, unknown>} */ (data)];
}

/**
 * @param {Record<string, unknown>} item
 */
function isJobPosting(item) {
  const type = item["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  return types.some((entry) => /JobPosting/i.test(String(entry)));
}

/**
 * @param {string} jsonText
 * @returns {JobDates}
 */
export function parseJsonLdJobDates(jsonText) {
  const out = emptyJobDates();
  try {
    const data = JSON.parse(jsonText);
    for (const item of flattenJsonLd(data)) {
      if (!isJobPosting(item)) continue;
      if (item.datePosted && !out.jobPosted) out.jobPosted = String(item.datePosted);
      if (item.dateCreated && !out.jobCreated) out.jobCreated = String(item.dateCreated);
      if (item.dateModified && !out.jobModified) out.jobModified = String(item.dateModified);
    }
  } catch {
    // ignore invalid JSON-LD blocks
  }
  return out;
}

/**
 * @param {string} text
 * @returns {JobDates}
 */
export function extractEmbeddedJsonJobDates(text) {
  const out = emptyJobDates();
  if (!text) return out;

  const published =
    text.match(/"published_at"\s*:\s*"([^"]+)"/) ||
    text.match(/"first_published_at"\s*:\s*"([^"]+)"/) ||
    text.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (published) out.jobPosted = published[1];

  const created = text.match(/"created_at"\s*:\s*"([^"]+)"/);
  if (created) out.jobCreated = created[1];

  const modified =
    text.match(/"updated_at"\s*:\s*"([^"]+)"/) ||
    text.match(/"last_updated_at"\s*:\s*"([^"]+)"/);
  if (modified) out.jobModified = modified[1];

  return out;
}

/**
 * @param {string} text
 * @returns {JobDates}
 */
export function extractDatesFromText(text) {
  const out = mergeJobDates(extractEmbeddedJsonJobDates(text));
  const sample = text.slice(0, 4000);

  for (const line of sample.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 140) continue;

    if (!out.jobPosted) {
      const posted =
        trimmed.match(/\b(?:date\s+)?(?:posted|published|reposted)\s*(?:on\s+)?[:\-]?\s*(.+)$/i) ||
        trimmed.match(/^(?:posted|published|reposted)\s*[:\-]?\s*(.+)$/i);
      if (posted) out.jobPosted = posted[1].trim();
    }

    if (!out.jobModified) {
      const modified = trimmed.match(/\b(?:last\s+)?(?:updated|modified)\s*(?:on\s+)?[:\-]?\s*(.+)$/i);
      if (modified) out.jobModified = modified[1].trim();
    }

    if (!out.jobCreated) {
      const created = trimmed.match(/\b(?:date\s+)?created\s*(?:on\s+)?[:\-]?\s*(.+)$/i);
      if (created) out.jobCreated = created[1].trim();
    }
  }

  return out;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function formatJobDateDisplay(raw) {
  if (!raw?.trim()) return "";
  const trimmed = raw.trim();
  const parsed = Date.parse(trimmed);
  if (
    !Number.isNaN(parsed) &&
    (/\d{4}/.test(trimmed) || /^\d{4}-\d{2}-\d{2}/.test(trimmed))
  ) {
    return new Date(parsed).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return trimmed.slice(0, 80);
}

/**
 * @param {Partial<JobDates> | null | undefined} dates
 * @returns {JobDates}
 */
export function formatJobDates(dates) {
  return {
    jobPosted: formatJobDateDisplay(dates?.jobPosted || ""),
    jobCreated: formatJobDateDisplay(dates?.jobCreated || ""),
    jobModified: formatJobDateDisplay(dates?.jobModified || ""),
  };
}

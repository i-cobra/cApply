/** @typedef {import("../auto-apply-response.js").AutoApplyStep} AutoApplyStep */

/**
 * @param {string} url
 */
export function matches(url) {
  return url.includes("jobs.lever.co") || url.includes(".lever.co/");
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {AutoApplyStep[]}
 */
export function buildHybridSteps(snapshot) {
  /** @type {AutoApplyStep[]} */
  const steps = [];
  const elements = /** @type {Array<Record<string, unknown>> | undefined} */ (snapshot.elements);

  if (!Array.isArray(elements)) return steps;

  for (const el of elements) {
    const name = String(el.name || el.label || "").toLowerCase();
    if (el.isFileInput && /resume|cv/.test(name)) {
      steps.push({ action: "upload", targetId: String(el.id), file: "resume" });
      break;
    }
  }

  for (const el of elements) {
    const text = String(el.text || el.label || "").toLowerCase();
    if (text.includes("submit application")) {
      steps.push({ action: "scroll", targetId: String(el.id) });
      break;
    }
  }

  return steps.slice(0, 4);
}

export const platformNotes = "Lever: resume upload on posting apply form; submit after required fields.";

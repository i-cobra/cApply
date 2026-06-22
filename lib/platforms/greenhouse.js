/** @typedef {import("../auto-apply-response.js").AutoApplyStep} AutoApplyStep */

/**
 * @param {string} url
 */
export function matches(url) {
  return url.includes("greenhouse.io") || url.includes("boards.greenhouse.io");
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
    const label = String(el.label || el.placeholder || "").toLowerCase();
    const tag = String(el.tag || "").toLowerCase();
    if (tag === "input" && /resume|cv/.test(label) && el.isFileInput) {
      steps.push({ action: "upload", targetId: String(el.id), file: "resume" });
      break;
    }
  }

  for (const el of elements) {
    const label = String(el.label || el.text || "").toLowerCase();
    if (/^submit application$|^submit$/.test(label.trim())) {
      steps.push({ action: "scroll", targetId: String(el.id) });
      break;
    }
  }

  return steps.slice(0, 4);
}

export const platformNotes = "Greenhouse: autofill visible fields; upload resume on file input labeled Resume/CV.";

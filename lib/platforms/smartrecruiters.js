/** @typedef {import("../auto-apply-response.js").AutoApplyStep} AutoApplyStep */

/**
 * @param {string} url
 */
export function matches(url) {
  return url.includes("smartrecruiters.com");
}

/**
 * @param {string} pageUrl
 */
export function resolveApplyUrl(pageUrl) {
  if (!matches(pageUrl)) return pageUrl;
  if (pageUrl.includes("/oneclick-ui/")) return pageUrl;
  if (pageUrl.endsWith("/apply")) return pageUrl;
  return pageUrl.replace(/\/?$/, "/apply");
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {AutoApplyStep[]}
 */
export function buildHybridSteps(snapshot) {
  /** @type {AutoApplyStep[]} */
  const steps = [];

  const suggestedNext = /** @type {string[] | undefined} */ (snapshot.suggestedNextTargetIds);
  const suggestedUpload = /** @type {string[] | undefined} */ (
    snapshot.suggestedResumeUploadTargetIds
  );

  if (Array.isArray(suggestedUpload) && suggestedUpload[0]) {
    steps.push({ action: "upload", targetId: suggestedUpload[0], file: "resume" });
  }

  if (Array.isArray(suggestedNext) && suggestedNext[0]) {
    steps.push({ action: "click", targetId: suggestedNext[0] });
    steps.push({ action: "wait", ms: 2000 });
  }

  return steps.slice(0, 5);
}

export const platformNotes =
  "SmartRecruiters: use OneClick UI footer Next/Continue; upload via resume trigger then hidden file input.";

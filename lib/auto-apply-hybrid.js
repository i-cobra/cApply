import { detectPlatform, getPlatformAdapter } from "./platforms/index.js";

/** @typedef {import("./auto-apply-response.js").AutoApplyStep} AutoApplyStep */

/**
 * @param {string} pageUrl
 * @param {Record<string, unknown>} snapshot
 * @returns {AutoApplyStep[]}
 */
export function getHybridAutoApplySteps(pageUrl, snapshot) {
  const platform = detectPlatform(pageUrl, snapshot);
  const adapter = getPlatformAdapter(platform);
  if (!adapter) return [];

  try {
    return adapter.buildHybridSteps(snapshot);
  } catch {
    return [];
  }
}

/**
 * @param {string} pageUrl
 * @param {Record<string, unknown>} snapshot
 */
export function getPlatformHint(pageUrl, snapshot) {
  const platform = detectPlatform(pageUrl, snapshot);
  const adapter = getPlatformAdapter(platform);
  return adapter?.platformNotes || "";
}

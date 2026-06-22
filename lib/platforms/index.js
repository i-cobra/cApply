/** @typedef {import("../auto-apply-response.js").AutoApplyStep} AutoApplyStep */

import * as smartrecruiters from "./smartrecruiters.js";
import * as greenhouse from "./greenhouse.js";
import * as lever from "./lever.js";

/** @typedef {{ id: string, matches: (url: string) => boolean, buildHybridSteps: (snapshot: Record<string, unknown>) => AutoApplyStep[], platformNotes?: string }} PlatformAdapter */

/** @type {PlatformAdapter[]} */
const ADAPTERS = [
  { id: "smartrecruiters", ...smartrecruiters },
  { id: "greenhouse", ...greenhouse },
  { id: "lever", ...lever },
];

/**
 * @param {string} url
 * @param {Record<string, unknown>} [snapshot]
 */
export function detectPlatform(url, snapshot) {
  if (snapshot?.platform && typeof snapshot.platform === "string") {
    return snapshot.platform;
  }

  for (const adapter of ADAPTERS) {
    if (adapter.matches(url)) return adapter.id;
  }

  return "generic";
}

/**
 * @param {string} platformId
 * @returns {PlatformAdapter | null}
 */
export function getPlatformAdapter(platformId) {
  return ADAPTERS.find((adapter) => adapter.id === platformId) || null;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function resolveApplyUrl(url) {
  if (smartrecruiters.matches(url)) return smartrecruiters.resolveApplyUrl(url);
  return null;
}

export { ADAPTERS };

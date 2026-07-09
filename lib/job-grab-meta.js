/**
 * @typedef {{
 *   companyName: string,
 *   position: string,
 *   location: string,
 *   applyUrl: string,
 *   jobPosted: string,
 *   jobCreated: string,
 *   jobModified: string
 * }} JobGrabMeta
 */

import { inferJobRole, normalizeJobRoleTitle } from "./tailor-history.js";
import { extractDatesFromText, formatJobDates } from "./job-date-extract.js";

/**
 * @param {string} url
 */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {string} text
 * @param {string} pageUrl
 * @returns {JobGrabMeta}
 */
export function extractJobGrabMeta(text, pageUrl = "") {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  let companyName = "";
  let position = "";
  let location = "";
  let applyUrl = pageUrl;
  const host = hostOf(pageUrl);

  if (host.includes("smartrecruiters.com")) {
    if (pageUrl.includes("/oneclick-ui/")) {
      applyUrl = pageUrl;
    } else if (pageUrl && !pageUrl.endsWith("/apply")) {
      applyUrl = pageUrl.replace(/\/?$/, "/apply");
    }
  }

  if (host.includes("greenhouse.io") || host.includes("boards.greenhouse.io")) {
    applyUrl = pageUrl;
  }

  if (host.includes("lever.co")) {
    const subdomain = host.split(".")[0];
    if (subdomain && subdomain !== "jobs") {
      companyName = subdomain.replace(/-/g, " ");
    }
  }

  position = normalizeJobRoleTitle(inferJobRole(text) || lines[0]?.slice(0, 80) || "");

  for (const line of lines.slice(0, 25)) {
    if (!location && /\b(remote|hybrid|on-site|onsite)\b/i.test(line) && line.length < 80) {
      location = line;
    }
    if (!companyName && /^at\s+[A-Z]/i.test(line)) {
      companyName = line.replace(/^at\s+/i, "").trim();
    }
    if (!companyName && /^\|\s*.+\s*\|/.test(line) && line.length < 60) {
      companyName = line.replace(/^\|\s*|\s*\|$/g, "").trim();
    }
  }

  const dates = formatJobDates(extractDatesFromText(text));

  return {
    companyName: companyName.slice(0, 80),
    position: position.slice(0, 80),
    location: location.slice(0, 80),
    applyUrl: applyUrl || pageUrl,
    ...dates,
  };
}

const JOB_TITLE_HINT =
  /\b(?:senior|staff|principal|lead|junior|sr\.?|head of)\b|[(/]|(?:engineer|developer|designer|manager|analyst|architect|consultant|specialist|director|intern|coordinator|scientist|administrator|technician|associate|representative|executive|recruiter)s?\b/i;

/**
 * @param {string} text
 */
export function looksLikeJobTitle(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.length > 90) return true;
  return JOB_TITLE_HINT.test(value);
}

/**
 * @param {string} slug
 */
export function formatCompanySlug(slug) {
  return String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * @param {string} url
 */
export function companyFromLeverUrl(url) {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/^\/([^/]+)/);
    return match ? formatCompanySlug(match[1]) : "";
  } catch {
    return "";
  }
}

/**
 * Parse "Job - Company" or "Company - Job" document titles.
 * @param {string} title
 */
export function parsePageTitle(title) {
  const cleaned = String(title || "").trim();
  const match = cleaned.match(/^(.+?)\s*[-–|]\s*(.+)$/);
  if (!match) return { companyName: "", position: "" };

  const partA = match[1].trim();
  const partB = match[2].replace(/\s*\|.*$/, "").trim();
  const aLooksLikeRole = looksLikeJobTitle(partA);
  const bLooksLikeRole = looksLikeJobTitle(partB);

  if (aLooksLikeRole && !bLooksLikeRole) {
    return { position: partA, companyName: partB };
  }
  if (bLooksLikeRole && !aLooksLikeRole) {
    return { position: partB, companyName: partA };
  }

  return { position: partA, companyName: partB };
}

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
 * @param {{
 *   companyName?: string,
 *   position?: string,
 *   location?: string,
 *   applyUrl?: string,
 *   jobPosted?: string,
 *   jobCreated?: string,
 *   jobModified?: string
 * } | null | undefined} meta
 * @param {string} [pageUrl]
 * @param {string} [pageText]
 * @param {string} [pageTitle]
 */
export function normalizeGrabMeta(meta, pageUrl = "", pageText = "", pageTitle = "") {
  if (!meta) return meta;

  let companyName = String(meta.companyName || "").trim();
  let position = String(meta.position || "").trim();
  const host = hostOf(pageUrl);

  if (
    companyName &&
    position &&
    looksLikeJobTitle(companyName) &&
    !looksLikeJobTitle(position)
  ) {
    [companyName, position] = [position, companyName];
  }

  if (host.includes("lever.co")) {
    if (!companyName) {
      companyName = companyFromLeverUrl(pageUrl);
    }
    if (!position) {
      const firstLine = pageText
        .split(/\n+/)
        .map((line) => line.trim())
        .find(Boolean);
      if (firstLine && looksLikeJobTitle(firstLine)) {
        position = firstLine;
      }
    }
  }

  if ((!position || !companyName) && pageTitle) {
    const fromTitle = parsePageTitle(pageTitle);
    if (!position && fromTitle.position) position = fromTitle.position;
    if (!companyName && fromTitle.companyName) companyName = fromTitle.companyName;
  }

  if (
    companyName &&
    position &&
    looksLikeJobTitle(companyName) &&
    !looksLikeJobTitle(position)
  ) {
    [companyName, position] = [position, companyName];
  }

  return {
    ...meta,
    companyName: companyName.slice(0, 80),
    position: position.slice(0, 80),
  };
}

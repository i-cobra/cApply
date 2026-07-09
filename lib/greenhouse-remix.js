/**
 * Parse Greenhouse job-boards (Remix SSR) embedded `window.__remixContext` data.
 */

/**
 * @param {string} text
 * @returns {string | null}
 */
export function extractRemixContextJson(text) {
  const marker = "window.__remixContext";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  const eq = text.indexOf("=", idx);
  if (eq === -1) return null;

  let i = eq + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }

  return null;
}

/**
 * @param {string} html
 * @returns {string}
 */
export function htmlToPlainText(html) {
  if (!html?.trim()) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body?.textContent || "").replace(/\s+\n/g, "\n").trim();
  } catch {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
}

/**
 * @param {unknown} loaderData
 */
function findGreenhouseJobPost(loaderData) {
  if (!loaderData || typeof loaderData !== "object") return null;
  for (const value of Object.values(loaderData)) {
    if (value && typeof value === "object" && "jobPost" in value && value.jobPost) {
      return /** @type {{ jobPost: Record<string, unknown> }} */ (value).jobPost;
    }
  }
  return null;
}

/**
 * @param {string} pageText
 * @returns {{
 *   companyName: string,
 *   position: string,
 *   jobPosted: string,
 *   jobCreated: string,
 *   jobModified: string,
 *   descriptionText: string
 * } | null}
 */
export function parseGreenhouseRemixJob(pageText) {
  const jsonText = extractRemixContextJson(pageText);
  if (!jsonText) return null;

  try {
    const ctx = JSON.parse(jsonText);
    const jobPost = findGreenhouseJobPost(ctx?.state?.loaderData);
    if (!jobPost) return null;

    const htmlParts = [jobPost.content, jobPost.introduction].filter(
      (part) => typeof part === "string" && part.trim()
    );

    return {
      companyName: String(jobPost.company_name || "").trim(),
      position: String(jobPost.title || "").trim(),
      jobPosted: String(jobPost.published_at || "").trim(),
      jobCreated: String(jobPost.created_at || "").trim(),
      jobModified: String(jobPost.updated_at || "").trim(),
      descriptionText: htmlToPlainText(htmlParts.join("\n\n")),
    };
  } catch {
    return null;
  }
}

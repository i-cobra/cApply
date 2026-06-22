import { parseJsonFromText } from "./json-extract.js";

/**
 * @typedef {{
 *   jobDescription: string,
 *   position: string,
 *   companyName: string
 * }} RestructuredJob
 */

/**
 * @param {string} text
 * @returns {RestructuredJob}
 */
export function parseRestructureJobResponse(text) {
  const raw = text?.trim();
  if (!raw) {
    throw new Error("Empty response while restructuring job description.");
  }

  try {
    const parsed = parseJsonFromText(raw);
    if (parsed && typeof parsed === "object") {
      const record = /** @type {Record<string, unknown>} */ (parsed);
      const jobDescription =
        typeof record.jobDescription === "string"
          ? record.jobDescription.trim()
          : typeof record.job_description === "string"
            ? record.job_description.trim()
            : typeof record.description === "string"
              ? record.description.trim()
              : "";

      if (jobDescription) {
        return {
          jobDescription,
          position:
            typeof record.position === "string"
              ? record.position.trim()
              : typeof record.role === "string"
                ? record.role.trim()
                : "",
          companyName:
            typeof record.companyName === "string"
              ? record.companyName.trim()
              : typeof record.company_name === "string"
                ? record.company_name.trim()
                : typeof record.company === "string"
                  ? record.company.trim()
                  : "",
        };
      }
    }
  } catch {
    // fall through to plain-text parsing
  }

  const stripped = raw
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!stripped) {
    throw new Error("Could not parse restructured job description from ChatGPT.");
  }

  return {
    jobDescription: stripped,
    position: "",
    companyName: "",
  };
}

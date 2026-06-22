import { parseJsonFromText } from "./json-extract.js";

/** @typedef {"click" | "fill" | "select" | "check" | "upload" | "wait" | "scroll"} AutoApplyActionType */
/** @typedef {"continue" | "done" | "blocked"} AutoApplyStatus */

/**
 * @typedef {{
 *   action: AutoApplyActionType,
 *   targetId?: string,
 *   value?: string,
 *   checked?: boolean,
 *   file?: string,
 *   ms?: number
 * }} AutoApplyStep
 */

/**
 * @typedef {{
 *   status: AutoApplyStatus,
 *   summary: string,
 *   steps: AutoApplyStep[],
 *   blocker?: string
 * }} AutoApplyPlan
 */

const ALLOWED_ACTIONS = new Set([
  "click",
  "fill",
  "select",
  "check",
  "upload",
  "wait",
  "scroll",
  "navigate",
]);
const ALLOWED_STATUS = new Set(["continue", "done", "blocked"]);

/**
 * @param {unknown} raw
 * @returns {AutoApplyStep}
 */
function normalizeStep(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid auto-apply step.");
  }

  const step = /** @type {Record<string, unknown>} */ (raw);
  const action = String(step.action || "").trim().toLowerCase();

  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`Unsupported auto-apply action: ${action || "(missing)"}`);
  }

  /** @type {AutoApplyStep} */
  const normalized = { action: /** @type {AutoApplyActionType} */ (action) };

  if (step.targetId != null) {
    normalized.targetId = String(step.targetId).trim();
  }

  if (step.value != null) {
    normalized.value = String(step.value);
  }

  if (typeof step.checked === "boolean") {
    normalized.checked = step.checked;
  }

  if (step.file != null) {
    normalized.file = String(step.file).trim();
  }

  if (step.ms != null) {
    const ms = Number(step.ms);
    if (Number.isFinite(ms) && ms >= 0) {
      normalized.ms = Math.min(Math.round(ms), 10000);
    }
  }

  if (action !== "wait" && action !== "navigate" && !normalized.targetId) {
    throw new Error(`Step "${action}" requires targetId.`);
  }

  if (action === "wait" && normalized.ms == null) {
    normalized.ms = 1000;
  }

  if (action === "navigate") {
    const url = String(step.url ?? step.value ?? "").trim();
    if (!url) throw new Error('Navigate step requires "url".');
    normalized.url = url;
  }

  if (action === "upload" && normalized.file !== "resume") {
    normalized.file = "resume";
  }

  return normalized;
}

/**
 * @param {string} text
 * @returns {AutoApplyPlan}
 */
export function parseAutoApplyResponse(text) {
  const parsed = parseJsonFromText(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Auto-apply response must be a JSON object.");
  }

  const data = /** @type {Record<string, unknown>} */ (parsed);
  const status = String(data.status || "continue").trim().toLowerCase();

  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid auto-apply status: ${status}`);
  }

  if (!Array.isArray(data.steps)) {
    throw new Error('Auto-apply response must include a "steps" array.');
  }

  const steps = data.steps.slice(0, 20).map(normalizeStep);
  const summary = String(data.summary || "").trim() || "Running auto-apply steps.";
  const blocker = data.blocker != null ? String(data.blocker).trim() : "";

  return {
    status: /** @type {AutoApplyStatus} */ (status),
    summary,
    steps,
    blocker: blocker || undefined,
  };
}

/**
 * @param {string} text
 */
export function hasAutoApplyMarkers(text) {
  return Boolean(text?.includes('"steps"') && text.includes("{"));
}

/**
 * @param {string} text
 */
export function isUsableAutoApplyResponse(text) {
  if (!hasAutoApplyMarkers(text) || text.length <= 40) return false;
  try {
    parseAutoApplyResponse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} text
 */
export function autoApplyResponseLooksComplete(text) {
  if (!text?.trim()) return false;
  return text.includes('"status"') && (text.includes('"done"') || text.includes('"blocked"'));
}

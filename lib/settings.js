export const SETTINGS_KEY = "capply_settings";

/** @typedef {import("./llm-provider.js").LlmProviderId} LlmProviderId */

/** @typedef {{
 *   defaultTone: string,
 *   defaultOutputFormat: string,
 *   autoSend: boolean,
 *   llmProvider: LlmProviderId,
 *   useOpenAiApi: boolean,
 *   openAiApiKey: string,
 *   openAiModel: string,
 *   onboardingComplete: boolean,
 *   extraInstructions: string,
 *   promptModifyTailor: string,
 *   promptModifyFillProfile: string,
 *   promptModifyRestructure: string
 * }} AppSettings */

/** @returns {AppSettings} */
export function defaultSettings() {
  return {
    defaultTone: "professional",
    defaultOutputFormat: "full resume",
    autoSend: true,
    llmProvider: "chatgpt",
    useOpenAiApi: false,
    openAiApiKey: "",
    openAiModel: "gpt-4o-mini",
    onboardingComplete: false,
    extraInstructions: "",
    promptModifyTailor: "",
    promptModifyFillProfile: "",
    promptModifyRestructure: "",
  };
}

/**
 * @param {...(string | undefined | null)} parts
 * @returns {string}
 */
export function mergePromptInstructions(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @returns {Promise<AppSettings>}
 */
export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY];
  if (!raw || typeof raw !== "object") return defaultSettings();
  return { ...defaultSettings(), ...raw };
}

/**
 * @param {Partial<AppSettings>} patch
 * @returns {Promise<AppSettings>}
 */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

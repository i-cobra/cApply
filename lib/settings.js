export const SETTINGS_KEY = "capply_settings";

/** @typedef {{
 *   defaultTone: string,
 *   defaultOutputFormat: string,
 *   autoSend: boolean,
 *   useOpenAiApi: boolean,
 *   openAiApiKey: string,
 *   openAiModel: string,
 *   onboardingComplete: boolean,
 *   hybridAutoApply: boolean
 * }} AppSettings */

/** @returns {AppSettings} */
export function defaultSettings() {
  return {
    defaultTone: "professional",
    defaultOutputFormat: "full resume",
    autoSend: true,
    useOpenAiApi: false,
    openAiApiKey: "",
    openAiModel: "gpt-4o-mini",
    onboardingComplete: false,
    hybridAutoApply: true,
  };
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

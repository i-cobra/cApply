import { loadSettings, saveSettings } from "./settings.js";

/**
 * @returns {Promise<boolean>}
 */
export async function shouldShowOnboarding() {
  const settings = await loadSettings();
  return !settings.onboardingComplete;
}

/**
 * @returns {Promise<void>}
 */
export async function completeOnboarding() {
  await saveSettings({ onboardingComplete: true });
}

export const ONBOARDING_STEPS = [
  {
    title: "Import your profile",
    body: "Add your master resume in Profile. Tailoring always starts from this copy.",
  },
  {
    title: "Grab a job posting",
    body: "Paste a job URL and description, or use Grab from page on the Application tab.",
  },
  {
    title: "Tailor and apply",
    body: "Tailor with ChatGPT, review the ATS score, then download or Auto Apply on supported sites.",
  },
];

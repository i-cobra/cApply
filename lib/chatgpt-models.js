/** @typedef {"instant" | "high"} ChatGptModelTier */

export const CHATGPT_MODEL_INSTANT = "instant";
export const CHATGPT_MODEL_HIGH = "high";

/** @type {Record<ChatGptModelTier, { label: string, conversationModel: string, reasoningEffort?: string }>} */
export const CHATGPT_MODEL_CONFIG = {
  instant: {
    label: "Instant",
    conversationModel: "auto",
    reasoningEffort: "minimal",
  },
  high: {
    label: "High",
    conversationModel: "auto",
    reasoningEffort: "high",
  },
};

/**
 * @param {string | undefined} tier
 * @returns {ChatGptModelTier}
 */
export function normalizeChatGptModelTier(tier) {
  return tier === CHATGPT_MODEL_INSTANT ? CHATGPT_MODEL_INSTANT : CHATGPT_MODEL_HIGH;
}

/**
 * @param {string | undefined} tier
 */
export function getChatGptModelConfig(tier) {
  return CHATGPT_MODEL_CONFIG[normalizeChatGptModelTier(tier)];
}

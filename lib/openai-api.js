/**
 * Optional OpenAI API path for tailoring (alternative to ChatGPT web).
 */

/**
 * @param {{ apiKey: string, model: string, prompt: string }} params
 * @returns {Promise<string>}
 */
export async function callOpenAiChat({ apiKey, model, prompt }) {
  if (!apiKey?.trim()) {
    throw new Error("OpenAI API key not configured. Add it in Settings.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("OpenAI returned an empty response.");
  return content.trim();
}

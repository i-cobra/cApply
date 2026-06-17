/**
 * Builds the tailoring prompt sent to ChatGPT.
 */

export function buildTailorPrompt({ resume, jobDescription, options = {} }) {
  const {
    tone = "professional",
    emphasize = ["keywords", "achievements", "ats"],
    outputFormat = "full resume",
    extraInstructions = "",
  } = options;

  const emphasisList = emphasize
    .map((e) => {
      const labels = {
        keywords: "mirror important keywords from the job posting (naturally, no keyword stuffing)",
        achievements: "highlight quantified achievements relevant to the role",
        ats: "optimize for ATS scanning while keeping human-readable prose",
        skills: "reorder and emphasize the most relevant technical skills",
        summary: "rewrite the professional summary for this specific role",
      };
      return labels[e] || e;
    })
    .join("\n- ");

  return `You are an expert resume writer and career coach. Tailor my resume for the job below.

## Instructions
- Tone: ${tone}
- Output: ${outputFormat}
- Focus on:
- ${emphasisList}
- Keep all facts truthful — do not invent employers, dates, degrees, or metrics.
- Preserve my voice; improve clarity and impact.
- Use strong action verbs and concise bullet points.
${extraInstructions ? `- Additional notes: ${extraInstructions}` : ""}

## Job description
${jobDescription.trim()}

## My current resume
${resume.trim()}

---

Please provide the tailored resume. After the resume, add a short "Changes made" section (3–5 bullets) explaining what you adjusted and why.`;
}

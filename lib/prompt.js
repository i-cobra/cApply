/**
 * Builds prompts sent to ChatGPT.
 */

const RESUME_JSON_SCHEMA = `{
  "contact": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "links": ""
  },
  "summary": "",
  "experience": [
    {
      "title": "",
      "company": "",
      "dates": "",
      "bullets": [""]
    }
  ],
  "education": [
    {
      "school": "",
      "degree": "",
      "dates": ""
    }
  ],
  "skills": "",
  "other": ""
}`;

const TAILOR_JSON_RESPONSE_SCHEMA = `{
  "tailoredResume": ${RESUME_JSON_SCHEMA},
  "changes": [
    "Short bullet explaining an adjustment"
  ],
  "atsScore": {
    "score": 0,
    "summary": "One sentence on how well the tailored resume matches the job for ATS",
    "missingKeywords": ["important job keyword not in the resume"]
  }
}`;

const FILL_PROFILE_JSON_RESPONSE_SCHEMA = `{
  "resume": ${RESUME_JSON_SCHEMA}
}`;

const SKILLS_FIELD_RULES = `## Skills field rules (strict — tailoredResume.skills)
- Format: comma-separated technology names ONLY. Example: "JavaScript, TypeScript, React.js, Node.js, AWS, Docker, Jest"
- Each entry = ONE concrete technology: language, framework, library, database, cloud platform, DevOps tool, or testing tool.
- 1–3 words per entry maximum. Prefer product names over descriptions.
- NEVER include sentence fragments or JD prose: no "including…", "or…", "advanced X optimization", "X environments", "strong knowledge of…".
- NEVER include vague modifiers as skills: AI-assisted, AI-enhanced, AI-driven, AI-powered, front-end, back-end, full-stack (use specific frameworks instead, e.g. React.js, Vue.js).
- NEVER include soft skills, job duties, or generic nouns (software, tools, code, platform, workflows, reports, tests).
- Use "REST APIs" or "RESTful APIs" — not a sentence about APIs. Use "Azure" — not "Azure environments".
- List 15–25 technologies max. Front-load the core stack from the job posting.`;

import {
  buildCoreSkillCoveragePlan,
  extractJobSkillKeywords,
  formatCoreSkillSetForPrompt,
} from "./job-core-skills.js";
import { parseResumeText, resumeToLlmShape } from "./resume-structure.js";
import { normalizeTechTerm, planTailorKeywords } from "./tech-similarity.js";

/**
 * @param {string} jobDescription
 * @param {string} resume
 * @returns {string}
 */
function formatTailorKeywordPlan(jobDescription, resume) {
  const { coreSkills } = buildCoreSkillCoveragePlan(jobDescription, resume);
  const jdKeywords = coreSkills.length ? coreSkills : extractJobSkillKeywords(jobDescription);
  const plan = planTailorKeywords(jdKeywords, resume);

  const includeLines = plan.include.map((item) => {
    const closeList = item.closeTerms
      .filter((term) => normalizeTechTerm(term) !== normalizeTechTerm(item.jdTerm))
      .slice(0, 4);

    if (item.distance === 0) {
      return closeList.length
        ? `- ${item.jdTerm} (already in resume; also keep close terms: ${closeList.join(", ")})`
        : `- ${item.jdTerm} (already in resume)`;
    }

    const from = item.resumeTerms.length
      ? `resume evidence: ${item.resumeTerms.join(", ")}`
      : "close stack match";
    const closeSuffix = closeList.length ? `; close terms: ${closeList.join(", ")}` : "";
    return `- ${item.jdTerm} (${from}${closeSuffix})`;
  });

  const excludeLines = plan.exclude.map((item) => {
    const closest =
      item.closestResumeTerm && item.distance < 99
        ? `nearest resume term: ${item.closestResumeTerm} (distance ${item.distance})`
        : "no close match in resume";
    return `- ${item.jdTerm} (${closest})`;
  });

  const rewriteLines = plan.rewrites.map(
    (item) =>
      `- Rephrase "${item.from}" using exact JD term "${item.jdTerm}" when truthful (close meaning, distance ${item.distance})`
  );

  const sections = [];

  if (includeLines.length) {
    sections.push(
      "INCLUDE — close to my background; add exact JD spelling plus close related terms:",
      ...includeLines
    );
  }

  if (rewriteLines.length) {
    sections.push("", "CLOSE-MEANING REWRITES:", ...rewriteLines);
  }

  if (excludeLines.length) {
    sections.push(
      "",
      "EXCLUDE — far from my background; do not add, emphasize, or fabricate:",
      ...excludeLines
    );
  }

  if (!sections.length) {
    return "- (No technology keyword plan could be built — use the job description stack when supported by my resume.)";
  }

  return sections.join("\n");
}

export function buildFillProfilePrompt({
  sourceText,
  existingResume = "",
  extraInstructions = "",
}) {
  const existingSection =
    !sourceText.trim() && existingResume.trim()
      ? `\n## Existing profile fields (structure and improve; keep facts accurate)\n${existingResume.trim()}\n`
      : "";

  let parsedHintSection = "";
  if (sourceText.trim()) {
    const hint = resumeToLlmShape(parseResumeText(sourceText));
    parsedHintSection = `\n## Suggested structure (verify, correct, and complete using the source material)
Use this as a starting point. Fix any mistakes, split combined title/company/dates fields, and include every role and education entry from the source.

\`\`\`json
${JSON.stringify({ resume: hint }, null, 2)}
\`\`\`
`;
  }

  return `You are an expert resume parser. Convert the source material into a structured resume JSON.

## Instructions
- Extract every job, school, skill, and contact detail from the source.
- Do not invent employers, dates, degrees, or metrics.
- Keep wording close to the source; only fix grammar and clarity when needed.
- Use strong action verbs in experience bullets.

## Field rules (strict)
- contact.name: person's full name only
- contact.email / phone / location / links: separate fields
- experience[].title: job title only (example: "Senior Full Stack Engineer")
- experience[].company: employer only (example: "Acme Inc")
- experience[].dates: employment dates exactly as written in source
- experience[].bullets: array of bullet strings, one achievement per item, without leading bullet symbols
- education[].school, degree, dates: separate fields
- skills: comma-separated string
- Include ALL roles and education entries from the source. Do not omit or merge jobs.
${extraInstructions ? `- Additional notes: ${extraInstructions}` : ""}

## Source material
${sourceText.trim()}
${existingSection}${parsedHintSection}

---

## Response format
Reply with ONLY valid JSON. No markdown fences, no commentary before or after the JSON.

Use this exact shape:
${FILL_PROFILE_JSON_RESPONSE_SCHEMA}

Put the structured resume in "resume".`;
}

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
        keywords:
          "mirror exact job-posting terms for core stack, languages, frameworks, and tools (naturally, no stuffing)",
        achievements: "highlight quantified achievements relevant to the role",
        ats: "maximize ATS keyword overlap while keeping human-readable prose",
        skills:
          "comma-separated technology names only — languages, frameworks, databases, cloud, DevOps, testing tools; no prose or vague modifiers",
        summary:
          "rewrite the professional summary for this role using the job title and top JD technologies upfront",
      };
      return labels[e] || e;
    })
    .join("\n- ");

  const keywordPlan = formatTailorKeywordPlan(jobDescription, resume);
  const coreSkillSection = formatCoreSkillSetForPrompt(jobDescription, resume);

  return `You are an expert resume writer and ATS specialist. Tailor my resume for the job below.

## Instructions
- Tone: ${tone}
- Output: ${outputFormat}
- Focus on:
- ${emphasisList}
- Keep all facts truthful — do not invent employers, dates, degrees, projects, or tools never used.
- Preserve my voice; improve clarity and impact.
- Use strong action verbs and concise bullet points.

${coreSkillSection}

${SKILLS_FIELD_RULES}

## Keyword coverage (critical)
Use technology meaning distance — only include close matches; never add far-away tools.

Tailor keyword plan (derived from the job description vs my resume):
${keywordPlan}

Placement rules:
1. summary: align to the target role title and name the top core skills (from the mandatory core skill set) in the first two sentences.
2. skills: follow the Skills field rules above. Front-load MUST INCLUDE core skills using exact JD spelling for technology names only.
3. experience: rewrite recent/relevant bullets to name MUST INCLUDE core skills where my work supports them.
4. For CLOSE-MEANING REWRITES, upgrade resume wording to the JD's exact term when accurate — do not leave close skills implicit.
5. Never add unsupported GAP skills or far-away technologies not in my resume.
6. Do not drop important technical terms from my source resume when they are in the core skill set or close to the job stack.
${extraInstructions ? `\n## Additional notes\n${extraInstructions}` : ""}

## Job description
${jobDescription.trim()}

## My current resume
${resume.trim()}

---

## Response format
Reply with ONLY valid JSON. No markdown fences, no commentary before or after the JSON.

Use this exact shape:
${TAILOR_JSON_RESPONSE_SCHEMA}

Put the full tailored resume in "tailoredResume", 3–5 concise adjustment notes in "changes", and an ATS assessment in "atsScore".

For "atsScore":
- score: integer 0–100 estimating ATS match of tailoredResume against the job description after your edits
- summary: one concise sentence explaining the score based on the final tailoredResume text
- missingKeywords: only 0–5 genuine gaps — core JD skills with far meaning distance from my source resume AND not present (or close equivalent) in tailoredResume. Prioritize missing core stack terms. Never list a keyword that already appears or has a close technology match in tailoredResume.`;
}

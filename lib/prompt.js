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
      "location": "",
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

const TAILOR_RESUME_PROMPT = `Tailor the existing resume to perfectly match the jobdescription provided. This task involves analyzing the job description in detail to understand the specific skills, experiences, and qualifications the employer is seeking. Then, meticulously revise the existing resume to highlight the most relevant aspects of the candidate's background. This includes rephrasing bullet points to emphasize transferable skills, prioritizing experiences that directly relate to the job requirements, and ensuring the resume format and design are professional and it should give non ai generated feeling. Incorporate keywords from the job description to ensure the resume passes through Applicant Tracking Systems (ATS) effectively.   use strong power action verbs but not repeated more than once. Add metrics and match all the exact keywords from the job to my summary, experience, soft and hard skills and education. The summary should include my relevant professional experience like my job title and experience in the field and mention my areas of expertise, specializations and skill and one or two impressive achievements to show what I can do and how I can contribute to the company. The summary should be no more than 5 sentences. In the work experience, each experience must include more than 5 lists in details and the right key words that match the job description. It should not be too small. Skills must include more than 8 lists with bullet points that match the job description and others that is relevant. adjust the job titles to best fit the job. It should not be too small. Use words (Adaptability/flexibility, creativity, problem solving, Curiosity, Emotional intelligence, Persistence, Relationship-building, Resourcefulness, sophisticated knowledge, mastery, realized, transformed, augmented.) in the resume. These words (experience, expertise, achieved, influenced, increased) are not recommended in the resume.`;

import { extractJobKeywords, TARGET_ATS_MATCH } from "./ats-score.js";
import { buildCoreSkillCoveragePlan } from "./job-core-skills.js";
import { parseResumeText, resumeToLlmShape } from "./resume-structure.js";

/**
 * @param {string} jobDescription
 * @param {string} resume
 * @returns {string}
 */
function formatMatchTargetSection(jobDescription, resume) {
  const keywords = extractJobKeywords(jobDescription).slice(0, 30);
  const { coreSkills, mustInclude } = buildCoreSkillCoveragePlan(jobDescription, resume);
  const priorityKeywords = mustInclude.map((item) => item.jdTerm).slice(0, 15);

  const lines = [
    `## Match target: at least ${TARGET_ATS_MATCH}%`,
    `Revise the resume until at least ${TARGET_ATS_MATCH}% of the job description's important keywords are present in summary, skills, experience, and education. Re-check coverage before responding and set atsScore.score to your estimated match percentage (target ${TARGET_ATS_MATCH}+).`,
  ];

  if (coreSkills.length) {
    lines.push(
      "",
      "Core stack (feature prominently when my resume supports it):",
      ...coreSkills.slice(0, 12).map((skill) => `- ${skill}`)
    );
  }

  if (priorityKeywords.length) {
    lines.push(
      "",
      "Priority keywords (use exact JD spelling):",
      ...priorityKeywords.map((skill) => `- ${skill}`)
    );
  }

  if (keywords.length) {
    lines.push("", "Important job keywords:", ...keywords.map((skill) => `- ${skill}`));
  }

  return lines.join("\n");
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
Use this as a starting point. Fix any mistakes, split combined title/company/location/dates fields, and include every role and education entry from the source.

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
- experience[].location: job location if listed in source (example: "San Francisco, CA" or "Remote"); empty string if not listed
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
  const { extraInstructions = "" } = options;
  const matchTargetSection = formatMatchTargetSection(jobDescription, resume);

  return `${TAILOR_RESUME_PROMPT}
${extraInstructions ? `\n${extraInstructions}` : ""}

${matchTargetSection}

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

Field notes:
- tailoredResume.skills: bullet points (•), one per line
- tailoredResume.experience[].bullets: array of strings without leading bullet symbols
- Use **double asterisks** around bold words in summary, skills, and experience bullets
- atsScore.score: integer 0–100; target ${TARGET_ATS_MATCH}+ keyword match with the job description`;
}

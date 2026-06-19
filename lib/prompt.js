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

const TAILOR_RESUME_PROMPT = `
Tailor the existing resume to perfectly match the jobdescription provided. 
This task involves analyzing the job description in detail to understand the specific skills, experiences, and qualifications the employer is seeking. 
Then, meticulously revise the existing resume to highlight the most relevant aspects of the candidate's background. 
This includes rephrasing bullet points to emphasize transferable skills, prioritizing experiences that directly relate to the job requirements, and ensuring the resume format and design are professional and it should give non ai generated feeling. 

# Skills section : 
- including all skill sets that are required in this job description
- Skills format: Use one line categories for "Languages", "Backend", "Frontend", "Databases", "Cloud/DevOps", "Architecture", "Tools". Display like "Languages: Python, JavaScript, Java".

# Working experience format
- Use verbs like "designed, led, built, optimizd, mentored, introduced, Collaborated, Wrote, Fixed"
- Avoids generic “responsible for…”

# Generate Summary
- Use "I/I am " for summary writing
- Make strong passion with core skills of job description

Incorporate keywords from the job description to ensure the resume passes through Applicant Tracking Systems (ATS) effectively. 
Use strong power action verbs but not repeated more than once. 
Add metrics and match all the exact keywords from the job to my summary, experience, soft and hard skills and education. 
The summary should include my relevant professional experience like my job title and experience in the field and mention my areas of expertise, specializations and skill and one or two impressive achievements to show what I can do and how I can contribute to the company. 
The summary should be no more than 5 sentences. 
In the work experience, each experience must include more than 5 lists in details and the right key words that match the job description. 
It should not be too small. Skills must include more than 8 lists with bullet points that match the job description and others that is relevant. 
adjust the job titles to best fit the job — use standard role names only (see Role title rules below).
It should not be too small. 
Make truth-safe 95% match with the job description.
Use words (Adaptability/flexibility, creativity, problem solving, Curiosity, Emotional intelligence, Persistence, Relationship-building, Resourcefulness, sophisticated knowledge, mastery, realized, transformed, augmented.) in the resume. These words (experience, expertise, achieved, influenced, increased) are not recommended in the resume.`;

const ROLE_TITLE_RULES = `## Role title rules (mandatory)
- Use the standard target role from this job posting everywhere a role title is needed.
- Write plain, conventional ATS-friendly titles — singular form, correct capitalization.
- NEVER add parenthetical or bracketed qualifiers to any role title.

Bad (forbidden):
- "Senior Full Stack Engineer (Distributed Systems & Microservices)"
- "Senior Software Engineer (Cloud & Data Systems)"
- "Full Stack Developer (Backend & API Systems)"

Good:
- "Senior Java Developer"
- "Senior Full Stack Engineer"
- "Senior Software Engineer"

Where to apply the standard target role:
- Open tailoredResume.summary with the target role in a complete sentence — weave stack and achievements after the title, not inside parentheses.
- You may lightly adapt experience[].title toward the target role's wording while staying truthful to seniority and field — but keep each title a short standard name with no parentheses.
- Do not invent employers, dates, or roles I did not hold.`;

import { inferJobRole, normalizeJobRoleTitle } from "./tailor-history.js";
import { extractJobKeywords, TARGET_ATS_MATCH } from "./ats-score.js";
import { buildCoreSkillCoveragePlan, getSupportableJobKeywords } from "./job-core-skills.js";
import { isLikelySkillTerm } from "./job-core-skills.js";
import { parseResumeText, resumeToLlmShape } from "./resume-structure.js";
import { normalizeTechTerm, extractTechTermsFromText, resumeSupportsKeyword } from "./tech-similarity.js";

const ROLE_TITLE_PATTERN =
  /\b(?:senior|staff|lead|principal|junior|mid[- ]?level)?\s*[\w\s/+.-]*\b(?:developer|engineer|architect|manager|analyst|consultant)s?\b/i;

const PRIMARY_LANGUAGE_PATTERN =
  /\b(?:java|python|javascript|typescript|c#|c\+\+|go\b|golang|rust|ruby|php|kotlin|scala|node\.?js|react|angular|vue)\b/i;

/**
 * @param {string[]} coreSkills
 * @param {{ jdTerm: string }[]} mustInclude
 * @param {string} jobDescription
 */
function pickPrimaryStack(coreSkills, mustInclude, jobDescription) {
  const jdTerms = extractTechTermsFromText(jobDescription);
  const languageFromJd = jdTerms.find((term) => PRIMARY_LANGUAGE_PATTERN.test(term));
  if (languageFromJd) return languageFromJd;

  const candidates = [...mustInclude.map((item) => item.jdTerm), ...coreSkills].filter(
    (skill) => skill && !ROLE_TITLE_PATTERN.test(skill) && isLikelySkillTerm(skill)
  );

  const language = candidates.find((skill) => PRIMARY_LANGUAGE_PATTERN.test(skill));
  if (language) return language;

  return candidates[0] || "";
}

const GAP_FIX_RULES = `## Major gap fixes (mandatory before output)
The gap analysis below lists the biggest mismatches between my resume and this job. Close these first.

Rules:
- Fix every FIXABLE gap — add the exact JD keyword to skills (front-loaded), summary, and at least one recent experience bullet.
- For TERMINOLOGY items, replace my resume wording with the JD term wherever truthful.
- If PRIMARY STACK is listed, make that technology unmistakable across skills, summary, and recent experience — not a single mention.
- Never invent UNSUPPORTED GAPS — list only those in atsScore.missingKeywords.
- Before responding, re-check the tailored resume against every FIXABLE gap; revise until each is covered.
- A gap counts as fixed only when the JD keyword is in skills AND in summary OR a recent experience bullet.`;

/**
 * @param {string} jobDescription
 * @param {string} resume
 * @returns {string}
 */
function formatMajorGapFixSection(jobDescription, resume) {
  const { coreSkills, mustInclude, rewrites, unsupported } = buildCoreSkillCoveragePlan(
    jobDescription,
    resume
  );
  const supportableKeywords = getSupportableJobKeywords(jobDescription, resume);
  const missingSupportable = supportableKeywords.filter(
    (keyword) => !resumeSupportsKeyword(resume, keyword)
  );

  /** @type {string[]} */
  const fixLines = [];
  /** @type {Set<string>} */
  const seen = new Set();

  const addFix = (line, key) => {
    const dedupeKey = normalizeTechTerm(key);
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    fixLines.push(line);
  };

  const primaryStack = pickPrimaryStack(coreSkills, mustInclude, jobDescription);
  if (primaryStack && resumeSupportsKeyword(resume, primaryStack)) {
    addFix(
      `- PRIMARY STACK: Feature "${primaryStack}" strongly — front-load in skills, open the summary around it, and cite it in multiple recent experience bullets.`,
      primaryStack
    );
  }

  for (const item of mustInclude) {
    const evidence = item.resumeTerms.length
      ? `my resume shows "${item.resumeTerms.join('", "')}"`
      : "close stack match in my resume";

    if (item.distance === 0) {
      if (!resumeSupportsKeyword(resume, item.jdTerm)) continue;
      addFix(
        `- FIXABLE GAP: Add exact JD term "${item.jdTerm}" to skills, summary, and recent experience (${evidence}).`,
        item.jdTerm
      );
      continue;
    }

    addFix(
      `- FIXABLE GAP: Upgrade to JD term "${item.jdTerm}" — ${evidence}; weave into skills, summary, and a recent experience bullet.`,
      item.jdTerm
    );
  }

  for (const item of rewrites.slice(0, 10)) {
    addFix(
      `- TERMINOLOGY: Replace "${item.from}" with JD term "${item.jdTerm}" in skills, summary, and experience.`,
      item.jdTerm
    );
  }

  for (const keyword of missingSupportable.slice(0, 15)) {
    addFix(
      `- FIXABLE GAP: Weave "${keyword}" into skills, summary, and experience (supported by my background).`,
      keyword
    );
  }

  const unsupportedLines = unsupported.slice(0, 8).map(
    (item) =>
      `- UNSUPPORTED GAP (do not invent): "${item.jdTerm}"${
        item.closestResumeTerm ? ` — nearest in my resume: ${item.closestResumeTerm}` : ""
      }`
  );

  if (!fixLines.length && !unsupportedLines.length) {
    return `${GAP_FIX_RULES}

No major fixable gaps detected — still verify ${TARGET_ATS_MATCH}% keyword coverage before responding.`;
  }

  const sections = [GAP_FIX_RULES, "", "Gap analysis for this application:"];

  if (fixLines.length) {
    sections.push("", "Fix these major gaps in the tailored resume:", ...fixLines);
  }

  if (unsupportedLines.length) {
    sections.push("", "Honest gaps — never fabricate:", ...unsupportedLines);
  }

  return sections.join("\n");
}

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
  const { extraInstructions = "", targetRole = "" } = options;
  const gapFixSection = formatMajorGapFixSection(jobDescription, resume);
  const matchTargetSection = formatMatchTargetSection(jobDescription, resume);

  const normalizedTargetRole = normalizeJobRoleTitle(
    targetRole.trim() || inferJobRole(jobDescription)
  );

  const targetRoleSection = normalizedTargetRole
    ? `\n## Target role (standard title for this application)\n${normalizedTargetRole}\nUse exactly this standard role title in the summary opening and as the model for experience title wording. Never append parenthetical specializations to any title.`
    : "";

  return `${TAILOR_RESUME_PROMPT}
${extraInstructions ? `\n${extraInstructions}` : ""}

${ROLE_TITLE_RULES}
${targetRoleSection}

${gapFixSection}

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
- tailoredResume.skills: bullet points (•), one per line; category format like "Languages: Java, TypeScript"
- tailoredResume.experience[].title: standard role name only — no parentheses (good: "Senior Java Developer"; bad: "Senior Java Developer (Microservices)")
- tailoredResume.experience[].bullets: array of strings without leading bullet symbols
- tailoredResume.other: always leave this as an empty string "" — do not add an Additional section; fold soft skills into skills instead
- Do not use bold formatting or ** markdown markers anywhere in tailoredResume text — plain text only
- atsScore.score: integer 0–100; target ${TARGET_ATS_MATCH}+ keyword match with the job description
- atsScore.missingKeywords: only UNSUPPORTED GAPS that cannot be truthfully added — every FIXABLE gap must be fixed in the resume, not listed here`;
}

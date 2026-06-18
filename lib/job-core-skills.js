import { serializeResume } from "./resume-structure.js";
import {
  extractCommaPhrases,
  filterSkillTerms,
  isLikelySkillTerm,
  preferDistinctCoreSkills,
  sanitizeSkillsString,
} from "./skill-keywords.js";
import {
  extractTechTermsFromText,
  normalizeTechTerm,
  planTailorKeywords,
  resumeSupportsKeyword,
} from "./tech-similarity.js";

/** @typedef {{ term: string, score: number }} ScoredSkill */

const REQUIRED_SECTION =
  /^(requirements|qualifications|must[\s-]?haves?|required skills?|what you(?:'ll| will) need|what we(?:'re| are) looking for|you have|you bring|technical requirements|tech stack|technologies|skills required|minimum qualifications|essential skills?)/i;

const PREFERRED_SECTION =
  /^(preferred|nice to have|bonus|pluses?|desired skills?)/i;

const SKILL_INTRO_PATTERN =
  /(?:experience with|proficient in|proficiency in|knowledge of|familiarity with|expertise in|strong(?:\s+\w+){0,2}\s+skills in|skilled in|working with|using|hands-on with|expert in)\s+([^.;\n]{2,80})/gi;

const GENERIC_TITLE_WORDS = new Set([
  "nice",
  "have",
  "senior",
  "junior",
  "lead",
  "staff",
  "requirements",
  "qualifications",
  "experience",
  "responsibilities",
]);

/**
 * @param {string} chunk
 * @param {number} weight
 * @param {Map<string, ScoredSkill>} scored
 */
function scoreChunk(chunk, weight, scored) {
  const trimmed = chunk.trim().replace(/[.!?:]+$/g, "");
  if (!trimmed || trimmed.length > 50) return;

  if (/\s|\/|-/.test(trimmed) && isLikelySkillTerm(trimmed)) {
    addScore(trimmed, weight + 10, scored, trimmed);
    return;
  }

  const techTerms = extractTechTermsFromText(trimmed);
  if (techTerms.length) {
    for (const term of techTerms) {
      addScore(term, weight + 6, scored, term);
    }
    return;
  }

  if (isLikelySkillTerm(trimmed)) {
    addScore(trimmed, weight, scored, trimmed);
  }
}

/**
 * @param {string} term
 * @param {number} weight
 * @param {Map<string, ScoredSkill>} scored
 * @param {string} display
 */
function addScore(term, weight, scored, display) {
  const key = normalizeTechTerm(term);
  if (!key || key.length < 2) return;

  const existing = scored.get(key);
  if (existing) {
    existing.score += weight;
    if (display.length > existing.term.length) existing.term = display;
  } else {
    scored.set(key, { term: display, score: weight });
  }
}

/**
 * @param {string} jobDescription
 * @returns {{ coreSkills: string[], scored: ScoredSkill[] }}
 */
export function analyzeJobCoreSkills(jobDescription) {
  const text = jobDescription.trim();
  /** @type {Map<string, ScoredSkill>} */
  const scored = new Map();

  if (!text) {
    return { coreSkills: [], scored: [] };
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let section = "body";
  const lineCount = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.length < 80) {
      if (PREFERRED_SECTION.test(line)) {
        section = "preferred";
        continue;
      }
      if (REQUIRED_SECTION.test(line)) {
        section = "required";
        continue;
      }
    }

    const sectionWeight =
      section === "required" ? 14 : section === "preferred" ? 7 : 4;
    const positionBonus = i < lineCount / 3 ? 4 : i < (lineCount * 2) / 3 ? 2 : 0;
    const weight = sectionWeight + positionBonus;

    for (const phrase of extractCommaPhrases(line)) {
      scoreChunk(phrase, weight + 8, scored);
    }

    for (const term of extractTechTermsFromText(line)) {
      addScore(term, weight + 5, scored, term);
    }

    for (const match of line.matchAll(SKILL_INTRO_PATTERN)) {
      for (const part of match[1].split(/\band\b|,|\/|\||\+/i)) {
        scoreChunk(part, weight + 6, scored);
      }
    }

    if (/^[•\-*–—]\s+/.test(line)) {
      const bullet = line.replace(/^[•\-*–—]\s+/, "");
      for (const phrase of extractCommaPhrases(bullet)) {
        scoreChunk(phrase, weight + 3, scored);
      }
      for (const term of extractTechTermsFromText(bullet)) {
        addScore(term, weight + 4, scored, term);
      }
    }
  }

  for (const term of extractTechTermsFromText(text)) {
    const key = normalizeTechTerm(term);
    const freq = (
      text.toLowerCase().match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) ||
      []
    ).length;
    addScore(term, 6 + freq * 3, scored, term);
  }

  for (const match of text.matchAll(
    /\b[A-Z][a-zA-Z0-9+.#/-]{2,}(?:\s+[A-Z][a-zA-Z0-9+.#/-]{1,}){0,2}\b/g
  )) {
    if (!GENERIC_TITLE_WORDS.has(match[0].toLowerCase())) {
      scoreChunk(match[0], 5, scored);
    }
  }

  const ranked = [...scored.values()]
    .filter((item) => isLikelySkillTerm(item.term))
    .sort((a, b) => b.score - a.score);

  const coreSkills = preferDistinctCoreSkills(ranked.map((item) => item.term)).slice(0, 20);

  return { coreSkills, scored: ranked };
}

/**
 * @param {string} jobDescription
 * @returns {string[]}
 */
export function extractJobSkillKeywords(jobDescription) {
  return analyzeJobCoreSkills(jobDescription).coreSkills.slice(0, 30);
}

/**
 * @param {string} jobDescription
 * @param {string} resume
 */
export function buildCoreSkillCoveragePlan(jobDescription, resume) {
  const { coreSkills } = analyzeJobCoreSkills(jobDescription);
  const plan = planTailorKeywords(coreSkills, resume);

  return {
    coreSkills,
    mustInclude: plan.include,
    rewrites: plan.rewrites,
    unsupported: plan.exclude.filter((item) =>
      coreSkills.some((skill) => normalizeTechTerm(skill) === normalizeTechTerm(item.jdTerm))
    ),
  };
}

/**
 * @param {string} jobDescription
 * @param {string} resume
 * @returns {string}
 */
export function formatCoreSkillSetForPrompt(jobDescription, resume) {
  const { coreSkills, mustInclude, rewrites, unsupported } = buildCoreSkillCoveragePlan(
    jobDescription,
    resume
  );

  if (!coreSkills.length) {
    return `## Core skill set for this role (mandatory)
Extract the core technology stack from the job description. Every language, framework, database, cloud platform, and tool the posting requires must appear in tailoredResume.skills (front-loaded) and in summary or recent experience when my source resume supports it.`;
  }

  const headline = coreSkills.slice(0, 12).join(", ");
  const mustLines = mustInclude.map((item) => {
    if (item.distance === 0) {
      return `- MUST INCLUDE: ${item.jdTerm} — exact JD spelling in skills AND in summary or experience`;
    }
    const evidence = item.resumeTerms.length
      ? `rewrite from resume term "${item.resumeTerms.join('", "')}"`
      : "close stack match in my resume";
    return `- MUST INCLUDE: ${item.jdTerm} — ${evidence}; use exact JD spelling in skills AND mention in summary or experience`;
  });

  const rewriteOnly = rewrites.filter(
    (item) => !mustInclude.some((m) => normalizeTechTerm(m.jdTerm) === normalizeTechTerm(item.jdTerm))
  );
  const rewriteLines = rewriteOnly.map(
    (item) =>
      `- REWRITE: use "${item.jdTerm}" instead of "${item.from}" wherever my background supports it`
  );

  const gapLines = unsupported.slice(0, 4).map(
    (item) =>
      `- GAP (do not fabricate): ${item.jdTerm}${
        item.closestResumeTerm ? ` — nearest resume term: ${item.closestResumeTerm}` : ""
      }`
  );

  const sections = [
    `## Core skill set for this role (mandatory)`,
    `Core skills identified from the job description: ${headline}`,
    ``,
    `These are non-negotiable when my source resume supports them:`,
    ...(mustLines.length ? mustLines : [`- Include every core skill above that appears in my source resume.`]),
  ];

  if (rewriteLines.length) {
    sections.push("", "Terminology upgrades:", ...rewriteLines);
  }

  if (gapLines.length) {
    sections.push("", "Unsupported gaps (never invent):", ...gapLines);
  }

  sections.push(
    "",
    "Coverage rules:",
    "- Every MUST INCLUDE skill must appear in tailoredResume.skills as a technology name only (see Skills field rules — no prose fragments).",
    "- Every MUST INCLUDE skill must also appear at least once in summary OR a recent/relevant experience bullet.",
    "- Do not drop a core skill that is already in my source resume.",
    "- Do not replace core JD technologies with vague synonyms — use the posting's exact terms.",
    "- Prioritize the core skill set over generic soft skills or filler keywords."
  );

  return sections.join("\n");
}

/**
 * @param {string} skillsCsv
 * @param {string} skill
 */
function skillListedInField(skillsCsv, skill) {
  const parts = skillsCsv
    .split(/[,;•|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.some(
    (part) =>
      normalizeTechTerm(part) === normalizeTechTerm(skill) || resumeSupportsKeyword(part, skill)
  );
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 * @param {string[]} coreSkills
 * @param {string} sourceResumeText
 * @returns {import("./resume-structure.js").ResumeStructure}
 */
export function ensureCoreSkillsInTailoredResume(tailored, coreSkills, sourceResumeText) {
  if (!coreSkills.length || !sourceResumeText.trim()) return tailored;

  const tailoredText = serializeResume(tailored);
  const skillsToPrepend = [];

  for (const skill of coreSkills) {
    if (!resumeSupportsKeyword(sourceResumeText, skill)) continue;

    const inTailoredText = resumeSupportsKeyword(tailoredText, skill);
    const inSkillsField = skillListedInField(tailored.skills || "", skill);

    if (!inSkillsField && (inTailoredText || resumeSupportsKeyword(sourceResumeText, skill))) {
      skillsToPrepend.push(skill);
    }
  }

  if (!skillsToPrepend.length) return tailored;

  const existing = (tailored.skills || "")
    .split(/[,;•|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const merged = sanitizeSkillsString(
    [...skillsToPrepend, ...existing].join(", ")
  );

  return {
    ...tailored,
    skills: merged,
  };
}

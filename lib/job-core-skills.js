import { cleanupTailoredResumeLogic } from "./tailor-cleanup.js";
import { computeAtsScore, computeAtsScoreWithKeywords, extractJobKeywords, TARGET_ATS_MATCH } from "./ats-score.js";
import { parseResumeText, serializeResume } from "./resume-structure.js";
import {
  extractTechTermsFromText,
  normalizeTechTerm,
  planTailorKeywords,
  resumeSupportsKeyword,
} from "./tech-similarity.js";

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractCommaPhrases(text) {
  const phrases = [];
  for (const part of text.split(/[,;•|]/)) {
    const trimmed = part
      .trim()
      .replace(/^[\s\-–—*]+/, "")
      .replace(/[.!?:]+$/g, "")
      .trim();
    if (trimmed.length < 2 || trimmed.length > 40 || !/\w/.test(trimmed)) continue;
    phrases.push(trimmed);
  }
  return phrases;
}

/**
 * @param {string} term
 */
export function isLikelySkillTerm(term) {
  const trimmed = term.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 40) return false;
  if (extractTechTermsFromText(trimmed).length > 0) return true;
  if (/\.(js|ts|tsx|jsx|py|go|rb|net|vue)\b/i.test(trimmed)) return true;
  if (/\b(c#|c\+\+|ci\s*\/\s*cd|restful|graphql|kubernetes|docker|aws|azure|gcp)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * @param {string[]} terms
 * @returns {string[]}
 */
function filterSkillTerms(terms) {
  const seen = new Set();
  const results = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!isLikelySkillTerm(trimmed)) continue;
    const key = normalizeTechTerm(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(trimmed);
  }
  return results;
}

/**
 * @param {string} skills
 */
function sanitizeSkillsString(skills) {
  if (!skills?.trim()) return "";
  const trimmed = skills.trim();
  if (/[\r\n]/.test(trimmed)) {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }
  const parts = trimmed
    .split(/[,;•|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return filterSkillTerms(parts).join(", ");
}

/**
 * @param {string[]} skills
 * @returns {string[]}
 */
function preferDistinctCoreSkills(skills) {
  return filterSkillTerms(skills);
}

/** @typedef {{ term: string, score: number }} ScoredSkill */

const REQUIRED_SECTION =
  /^(requirements|qualifications|must[\s-]?haves?|required skills?|what you(?:'ll| will) need|what we(?:'re| are) looking for|you have|you bring|technical requirements|tech stack|technologies|skills required|minimum qualifications|essential skills?|key skills|technical skills|core skills|stack)/i;

const REQUIRED_INLINE =
  /\b(?:required|must have|must-have|minimum(?:\s+qualifications?)?)\b\s*[:—-]?\s*(.+)$/i;

const REQUIRED_LINE_HINT = /\b(required|must have|must-have|minimum of|at least \d+\s+years?)\b/i;

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
    const requiredLineBoost = REQUIRED_LINE_HINT.test(line) ? 6 : 0;
    const positionBonus = i < lineCount / 3 ? 4 : i < (lineCount * 2) / 3 ? 2 : 0;
    const weight = sectionWeight + positionBonus + requiredLineBoost;

    const inlineRequired = line.match(REQUIRED_INLINE);
    if (inlineRequired?.[1]) {
      for (const phrase of extractCommaPhrases(inlineRequired[1])) {
        scoreChunk(phrase, weight + 14, scored);
      }
      for (const term of extractTechTermsFromText(inlineRequired[1])) {
        addScore(term, weight + 12, scored, term);
      }
    }

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

  const coreSkills = preferDistinctCoreSkills(ranked.map((item) => item.term)).slice(0, 25);

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
      return `- MUST INCLUDE: ${item.jdTerm} — use exact JD spelling when integrated naturally in skills AND in summary or experience`;
    }
    const evidence = item.resumeTerms.length
      ? `rewrite from resume term "${item.resumeTerms.join('", "')}"`
      : "close stack match in my resume";
    return `- MUST INCLUDE: ${item.jdTerm} — ${evidence}; use exact JD spelling when integrated naturally in skills AND mention in summary or experience`;
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
    "- The role's PRIMARY stack (the first core skill above, e.g. Java for a Java Developer role) must be covered strongly — feature it in skills, the summary, and at least one recent experience bullet, not just listed once.",
    "- Every MUST INCLUDE skill must appear in tailoredResume.skills (see Skills section rules).",
    "- Every MUST INCLUDE skill must also appear at least once in summary OR a recent/relevant experience bullet.",
    "- Do not drop a core skill that is already in my source resume.",
    "- Prioritize covering the required stack over maximizing ATS keyword count — required-stack coverage comes first.",
    "- Use exact JD technology names when supported; integrate them in grammatical sentences — never paste JD imperatives verbatim (bad: 'Ensure security' → good: 'security best practices', 'RBAC', 'encryption').",
    "- Include supported soft skills when the job description emphasizes them — phrased professionally, not as a raw keyword dump.",
    "- Missing a supported core skill is worse than keeping an extra close-match skill."
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
 * @param {string} skill
 */
function skillMentionedInResumeBody(tailored, skill) {
  const body = [
    tailored.summary,
    ...(tailored.experience || []).flatMap((entry) => [
      entry.title,
      entry.company,
      entry.location,
      ...(entry.bullets || []),
    ]),
  ]
    .filter(Boolean)
    .join("\n");

  return resumeSupportsKeyword(body, skill);
}

/**
 * @param {string} existingCsv
 * @param {string[]} toPrepend
 */
function isEnforceableSkill(skill) {
  const trimmed = skill.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (/\(\s*\d*\s*$|\(\s*[a-z]\s*\)$/i.test(trimmed)) return false;
  if (/^(?:ensure|implement|integrate|maintain|develop|design|build|create)\b/i.test(trimmed)) {
    return false;
  }
  return isLikelySkillTerm(trimmed) || extractTechTermsFromText(trimmed).length > 0;
}

function mergeEnforcedSkills(existingSkills, toPrepend) {
  if (!toPrepend.length) return existingSkills || "";

  const existing = existingSkills || "";
  const validPrepend = toPrepend.filter(isEnforceableSkill);
  if (!validPrepend.length) return existing;

  if (existing.includes("\n")) {
    const missing = validPrepend.filter((skill) => !skillListedInField(existing, skill));
    if (!missing.length) return existing;

    const prependLines = missing.map((skill) => `• ${skill}`).join("\n");
    return `${prependLines}\n${existing.trim()}`;
  }

  const existingParts = existing
    .split(/[,;•|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  let merged = sanitizeSkillsString([...validPrepend, ...existingParts].join(", "));

  for (const skill of validPrepend) {
    if (!skillListedInField(merged, skill)) {
      merged = merged ? `${skill}, ${merged}` : skill;
    }
  }

  return merged;
}

/**
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 * @returns {string[]}
 */
function collectSupportedJdSkills(jobDescription, sourceResumeText) {
  const { coreSkills, mustInclude } = buildCoreSkillCoveragePlan(jobDescription, sourceResumeText);
  /** @type {Map<string, string>} */
  const skills = new Map();

  for (const item of mustInclude) {
    if (item.distance === 0 || resumeSupportsKeyword(sourceResumeText, item.jdTerm)) {
      skills.set(normalizeTechTerm(item.jdTerm), item.jdTerm);
    }
  }

  for (const skill of coreSkills) {
    if (!resumeSupportsKeyword(sourceResumeText, skill)) continue;
    const key = normalizeTechTerm(skill);
    if (skills.has(key)) continue;
    const mustMatch = mustInclude.find(
      (item) => normalizeTechTerm(item.jdTerm) === key
    );
    skills.set(key, mustMatch?.jdTerm || skill);
  }

  const sourceSkills = parseResumeText(sourceResumeText).skills || "";
  for (const part of sourceSkills.split(/[,;•|]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    for (const item of mustInclude) {
      if (resumeSupportsKeyword(trimmed, item.jdTerm)) {
        skills.set(normalizeTechTerm(item.jdTerm), item.jdTerm);
      }
    }

    for (const skill of coreSkills) {
      if (resumeSupportsKeyword(trimmed, skill)) {
        const key = normalizeTechTerm(skill);
        if (!skills.has(key)) {
          const mustMatch = mustInclude.find(
            (item) => normalizeTechTerm(item.jdTerm) === key
          );
          skills.set(key, mustMatch?.jdTerm || skill);
        }
      }
    }
  }

  return [...skills.values()];
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 * @returns {import("./resume-structure.js").ResumeStructure}
 */
export function ensureCoreSkillsInTailoredResume(tailored, jobDescription, sourceResumeText) {
  if (!sourceResumeText.trim() || !jobDescription.trim()) return tailored;

  const skillsToEnsure = collectSupportedJdSkills(jobDescription, sourceResumeText);
  if (!skillsToEnsure.length) return tailored;

  const skillsToPrepend = [];
  const needsBodyMention = [];

  for (const skill of skillsToEnsure) {
    const inSkillsField = skillListedInField(tailored.skills || "", skill);

    if (!inSkillsField) {
      skillsToPrepend.push(skill);
    }

    if (!skillMentionedInResumeBody(tailored, skill)) {
      needsBodyMention.push(skill);
    }
  }

  let result = tailored;

  if (skillsToPrepend.length) {
    result = {
      ...result,
      skills: mergeEnforcedSkills(result.skills || "", skillsToPrepend),
    };
  }

  const stillMissingBody = needsBodyMention.filter(
    (skill) => !skillMentionedInResumeBody(result, skill)
  );

  if (stillMissingBody.length) {
    const mention = stillMissingBody.slice(0, 6).join(", ");
    const summary = result.summary?.trim() || "";

    if (summary) {
      const lead = stillMissingBody[0];
      if (!resumeSupportsKeyword(summary, lead)) {
        result = {
          ...result,
          summary: appendSupportedStackToSummary(summary, mention),
        };
      }
    } else {
      result = {
        ...result,
        summary: `Skilled in ${mention}.`,
      };
    }
  }

  return result;
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 * @param {string[]} keywords
 */
function weaveKeywordsIntoRecentExperience(tailored, keywords) {
  const experience = [...(tailored.experience || [])];
  if (!experience.length || !keywords.length) return tailored;

  const recent = {
    ...experience[0],
    bullets: [...(experience[0].bullets || [])].map((bullet) => bullet?.trim()).filter(Boolean),
  };
  const remaining = [...keywords];

  for (let i = 0; i < recent.bullets.length && remaining.length; i += 1) {
    const bullet = recent.bullets[i];
    for (const keyword of [...remaining]) {
      if (resumeSupportsKeyword(bullet, keyword)) {
        remaining.splice(remaining.indexOf(keyword), 1);
        continue;
      }

      recent.bullets[i] = `${bullet.replace(/\.$/, "")} with ${keyword}.`;
      remaining.splice(remaining.indexOf(keyword), 1);
      break;
    }
  }

  while (remaining.length && recent.bullets.length < 8) {
    const keyword = remaining.shift();
    if (!keyword) continue;
    recent.bullets.push(
      `Delivered production solutions leveraging ${keyword} across the stack.`
    );
  }

  experience[0] = recent;
  return { ...tailored, experience };
}

/**
 * @param {string} summary
 * @param {string} mention
 */
function appendSupportedStackToSummary(summary, mention) {
  const trimmed = summary.trim();
  if (!trimmed) return `Skilled in ${mention}.`;
  if (resumeSupportsKeyword(trimmed, mention.split(",")[0]?.trim() || mention)) return trimmed;
  return `${trimmed} Skilled in ${mention}.`.trim();
}

/**
 * @param {string} keyword
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 */
function resolveSupportedKeyword(keyword, jobDescription, sourceResumeText) {
  const trimmed = keyword.trim();
  if (!trimmed || !resumeSupportsKeyword(sourceResumeText, trimmed)) return null;

  const { mustInclude } = buildCoreSkillCoveragePlan(jobDescription, sourceResumeText);
  for (const item of mustInclude) {
    if (
      normalizeTechTerm(item.jdTerm) === normalizeTechTerm(trimmed) ||
      resumeSupportsKeyword(trimmed, item.jdTerm)
    ) {
      return item.jdTerm;
    }
  }

  return trimmed;
}

/**
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 * @returns {string[]}
 */
export function getSupportableJobKeywords(jobDescription, sourceResumeText) {
  const all = extractJobKeywords(jobDescription);
  if (!sourceResumeText.trim()) return all;

  const { mustInclude, rewrites } = buildCoreSkillCoveragePlan(jobDescription, sourceResumeText);
  /** @type {Set<string>} */
  const allowed = new Set();

  for (const item of mustInclude) {
    allowed.add(normalizeTechTerm(item.jdTerm));
  }
  for (const item of rewrites) {
    allowed.add(normalizeTechTerm(item.jdTerm));
  }

  return all.filter((keyword) => {
    if (allowed.has(normalizeTechTerm(keyword))) return true;
    return resumeSupportsKeyword(sourceResumeText, keyword);
  });
}

/**
 * @param {string} resumeText
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 */
export function computeTailorMatchScore(resumeText, jobDescription, sourceResumeText) {
  const keywords = getSupportableJobKeywords(jobDescription, sourceResumeText);
  if (!keywords.length) {
    return computeAtsScore(resumeText, jobDescription);
  }
  return computeAtsScoreWithKeywords(resumeText, keywords);
}

/**
 * @param {string} keyword
 */
function shouldAddKeywordToSkillsField(keyword) {
  const trimmed = keyword.trim();
  if (!trimmed) return false;

  if (/^(?:ensure|implement|maintain|develop|design|build|create|support|drive|lead|manage|perform|conduct|provide|deliver|enable|establish|monitor|optimize|collaborate|communicate)\b/i.test(trimmed)) {
    return false;
  }

  if (isLikelySkillTerm(trimmed)) return true;
  return extractTechTermsFromText(trimmed).length > 0;
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 * @param {string[]} [aiMissingKeywords]
 * @returns {import("./resume-structure.js").ResumeStructure}
 */
export function ensureAtsKeywordsInTailoredResume(
  tailored,
  jobDescription,
  sourceResumeText,
  aiMissingKeywords = []
) {
  if (!sourceResumeText.trim() || !jobDescription.trim()) return tailored;

  /** @type {Map<string, string>} */
  const missingKeywords = new Map();

  const addMissing = (keyword) => {
    const trimmed = keyword?.trim();
    if (!trimmed) return;
    missingKeywords.set(normalizeTechTerm(trimmed), trimmed);
  };

  for (const keyword of aiMissingKeywords) addMissing(keyword);

  let result = tailored;
  let tailoredText = serializeResume(result);
  let { missing } = computeAtsScore(tailoredText, jobDescription);

  for (const keyword of missing) addMissing(keyword);

  const skillsToPrepend = [];
  const bodyToAdd = [];

  for (const keyword of missingKeywords.values()) {
    const resolved = resolveSupportedKeyword(keyword, jobDescription, sourceResumeText);
    if (!resolved) continue;

    tailoredText = serializeResume(result);
    if (resumeSupportsKeyword(tailoredText, resolved)) continue;

    if (
      shouldAddKeywordToSkillsField(resolved) &&
      !skillListedInField(result.skills || "", resolved)
    ) {
      skillsToPrepend.push(resolved);
    }

    if (!skillMentionedInResumeBody(result, resolved)) {
      bodyToAdd.push(resolved);
    }
  }

  if (skillsToPrepend.length) {
    result = {
      ...result,
      skills: mergeEnforcedSkills(result.skills || "", skillsToPrepend),
    };
  }

  const stillMissingBody = bodyToAdd.filter(
    (keyword) => !skillMentionedInResumeBody(result, keyword)
  );

  if (stillMissingBody.length) {
    const mention = stillMissingBody.slice(0, 8).join(", ");
    const summary = result.summary?.trim() || "";

    if ((result.experience || []).length) {
      result = weaveKeywordsIntoRecentExperience(result, stillMissingBody.slice(0, 6));
    }

    const stillMissingAfterBullets = stillMissingBody.filter(
      (keyword) => !skillMentionedInResumeBody(result, keyword)
    );

    if (stillMissingAfterBullets.length) {
      const leftover = stillMissingAfterBullets.slice(0, 8).join(", ");
      if (summary) {
        if (!stillMissingAfterBullets.some((keyword) => resumeSupportsKeyword(summary, keyword))) {
          result = {
            ...result,
            summary: appendSupportedStackToSummary(summary, leftover),
          };
        }
      } else {
        result = {
          ...result,
          summary: `Skilled in ${leftover}.`,
        };
      }
    }
  }

  return result;
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 * @param {string[]} [aiMissingKeywords]
 * @returns {import("./resume-structure.js").ResumeStructure}
 */
export function ensureTailoredResumeCoverage(
  tailored,
  jobDescription,
  sourceResumeText,
  aiMissingKeywords = [],
  options = {}
) {
  let result = ensureCoreSkillsInTailoredResume(tailored, jobDescription, sourceResumeText);
  result = ensureAtsKeywordsInTailoredResume(
    result,
    jobDescription,
    sourceResumeText,
    aiMissingKeywords
  );

  let tailoredText = serializeResume(result);
  const maxPasses = 12;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const { score, missing } = computeTailorMatchScore(
      tailoredText,
      jobDescription,
      sourceResumeText
    );
    if (score >= TARGET_ATS_MATCH) break;

    const gaps = missing.filter((keyword) =>
      resolveSupportedKeyword(keyword, jobDescription, sourceResumeText)
    );
    if (!gaps.length) break;

    result = ensureAtsKeywordsInTailoredResume(
      result,
      jobDescription,
      sourceResumeText,
      gaps
    );
    tailoredText = serializeResume(result);
  }

  return cleanupTailoredResumeLogic(result, sourceResumeText, options.targetRole || "");
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} structured
 * @param {string} jobDescription
 * @param {string} sourceResumeText
 * @param {import("./tailor-response.js").AtsScoreResult | null} [priorAtsScore]
 * @returns {import("./tailor-response.js").AtsScoreResult}
 */
export function buildDisplayAtsScore(
  structured,
  jobDescription,
  sourceResumeText,
  priorAtsScore = null
) {
  const { score, missing, matched, total } = computeTailorMatchScore(
    serializeResume(structured),
    jobDescription,
    sourceResumeText
  );

  const localSummary =
    total > 0
      ? `${matched.length} of ${total} matchable job keywords present (${score}% ATS overlap).`
      : "";

  return {
    score: Math.max(priorAtsScore?.score ?? 0, score),
    summary:
      score >= TARGET_ATS_MATCH
        ? localSummary
        : priorAtsScore?.summary?.trim() || localSummary,
    missingKeywords: missing,
  };
}

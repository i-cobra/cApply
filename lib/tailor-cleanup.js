import { normalizeJobRoleTitle } from "./tailor-history.js";
import { extractTechTermsFromText, normalizeTechTerm, resumeSupportsKeyword } from "./tech-similarity.js";
const JD_VERB_SKILL =
  /^(?:ensure|implement|maintain|develop|design|build|create|support|drive|lead|manage|perform|conduct|provide|deliver|enable|establish|monitor|optimize|collaborate|communicate|integrate)\b/i;

const JD_VERB_IN_PARENS = /\((?:Integrate|Ensure|Implement|Maintain|Develop|Design|Build)\)/i;

const TRUNCATED_PAREN =
  /\(\s*[a-z]\s*\)|\(\s*\d+\s*$|\(\s*[a-z]\s*$|\(\s*e\s+and\b/i;

const SOFT_SKILL_WORDS = [
  "problem solving",
  "adaptability",
  "flexibility",
  "creativity",
  "curiosity",
  "emotional intelligence",
  "persistence",
  "relationship-building",
  "relationship building",
  "resourcefulness",
  "sophisticated knowledge",
  "mastery",
  "communication",
  "collaboration",
  "leadership",
  "mentoring",
  "analytical",
  "attention to detail",
  "time management",
];

/**
 * Remove ** bold markers for matching/labeling (display keeps them).
 * @param {string} text
 */
function stripMarks(text) {
  return String(text).replace(/\*\*/g, "");
}

/**
 * @param {string} line
 */
function isSoftSkillLine(line) {
  const lower = stripMarks(line).toLowerCase();
  return SOFT_SKILL_WORDS.some((word) => lower.includes(word));
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 */
function fallbackTitleFromExperience(tailored) {
  return tailored.experience?.[0]?.title?.trim() || "";
}

/**
 * @param {string} summary
 */
function needsCommaSpliceFix(summary) {
  const match = summary.match(
    /^(?:(?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s/+-]+(?:\s*[\(\[{][^\)\]}]*[\)\]}])?),\s+/i
  );
  if (!match) return false;
  return !/\bwith\b/i.test(match[1]);
}

/**
 * @param {string} title
 */
function normalizeExperienceTitle(title) {
  return normalizeJobRoleTitle(title?.trim() || "");
}

/**
 * @param {string} summary
 * @param {string} title
 */
function fixSummaryCommaSplice(summary, title) {
  const trimmed = summary.trim();
  const commaMatch = trimmed.match(
    /^(?:(?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s/+-]+(?:\s*[\(\[{][^\)\]}]*[\)\]}])?),\s+(.+)$/i
  );
  if (!commaMatch) return trimmed;

  const rest = commaMatch[2].trim();
  if (/^(with|proven|experienced|having|demonstrated|skilled|known|a|I\b|am\b)\b/i.test(rest)) {
    return trimmed;
  }

  const normalizedRest = rest.charAt(0).toLowerCase() + rest.slice(1);
  return `${title} specializing in ${normalizedRest}`.replace(/,\s+and\s+/gi, " and ");
}

/**
 * @param {string} summary
 * @param {string} role
 */
function applyStandardRoleToSummary(summary, role) {
  if (!role?.trim()) return summary.trim();

  let result = summary.trim();

  // Replace embellished opener — title with optional parenthetical — before the first clause.
  result = result.replace(
    /^(?:(?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s#.+/-]+(?:\s*[\(\[{][^\)\]}]*[\)\]}])?)(?=\s+(?:with|who|specializing|I\b|am\b|,))/i,
    role
  );

  // Strip a parenthetical glued directly after the title at the start.
  result = result.replace(
    /^((?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s#.+/-]+)\s*[\(\[{][^\)\]}]*[\)\]}]\s*/i,
    `${role} `
  );

  // If summary still opens with a non-standard embellished title, force the target role.
  if (
    /^(?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s#.+/-]+\s*[\(\[{]/i.test(result)
  ) {
    result = result.replace(
      /^(?:(?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s#.+/-]+(?:\s*[\(\[{][^\)\]}]*[\)\]}])?)\s*/i,
      `${role} `
    );
  }

  // Normalize non-standard openers (language symbols, stack mashups, trailing I/II/III).
  const openerMatch = result.match(
    /^(?:(?:Senior|Staff|Principal|Lead|Junior|Mid[- ]?Level)\s+[\w\s#.+/-]+?)(?=\s+(?:with|who|specializing|I\b|am\b|,)|$)/i
  );
  if (openerMatch) {
    const rawTitle = openerMatch[0].trim();
    const normalized = normalizeJobRoleTitle(rawTitle);
    if (normalized && normalized.toLowerCase() !== rawTitle.toLowerCase()) {
      result = result.replace(rawTitle, role);
    }
  }

  return result.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} summary
 * @param {string} sourceResumeText
 * @param {string} targetRole
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 */
function applySummaryTitle(summary, sourceResumeText, targetRole, tailored) {
  let result = summary.trim();
  const role = normalizeJobRoleTitle(targetRole);
  const fallbackTitle = fallbackTitleFromExperience(tailored);

  if (needsCommaSpliceFix(result)) {
    return fixSummaryCommaSplice(result, role || fallbackTitle || "Senior Engineer");
  }

  if (role) {
    result = applyStandardRoleToSummary(result, role);
  }

  return result;
}

/**
 * @param {string} label
 * @param {string} sourceResumeText
 */
function skillFragmentSupported(label, sourceResumeText) {
  // Evaluate the whole bullet. Bullets can be a single skill ("Kotlin"), a grouped
  // list ("Docker, Kubernetes, CI/CD"), or a category ("Languages: Java, SQL"), so
  // we check every skill in the line — the leading category word is not the skill.
  const content = stripMarks(label.replace(/^•\s*/, "")).trim();
  if (!content) return false;

  if (isSoftSkillLine(content)) return true;

  const sourceTerms = new Set(extractTechTermsFromText(sourceResumeText));
  const haystack = sourceResumeText.toLowerCase();

  // Treat a leading "Category:" the same as a list separator so the items after it
  // become individual fragments; keep hyphenated skills (e.g. "cloud-native") intact.
  const fragments = content
    .split(/\s*(?::|&|\/|,|;|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!fragments.length) fragments.push(content);

  for (const fragment of fragments) {
    const needle = normalizeTechTerm(fragment);
    if (needle && haystack.includes(needle)) return true;

    const partTerms = extractTechTermsFromText(fragment);
    if (partTerms.some((term) => sourceTerms.has(normalizeTechTerm(term)))) return true;
  }

  // Keep the bullet when at least one skill in it is supported, so one weak fragment
  // (or a non-technical category label) never discards a line full of valid skills.
  return false;
}

/**
 * @param {string} skills
 */
function expandSkillsToLines(skills) {
  const trimmed = skills.trim();
  if (!trimmed) return [];

  if (/[\r\n]/.test(trimmed)) {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (trimmed.split(",").length >= 6) {
    return trimmed
      .split(/[,;•|]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (part.startsWith("•") ? part : `• ${part}`));
  }

  return [trimmed];
}
/**
 * @param {string} line
 */
function capitalizeSkillBullet(line) {
  return line.replace(/^(•\s*)([a-z])/, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

/**
 * @param {string} text
 */
function cleanProseFragment(text) {
  if (!text?.trim()) return text || "";

  let cleaned = text
    .replace(/\*\*/g, "")
    .replace(/\bAI coding assistants\s*\(\s*e\s+and\b/gi, "AI coding assistants and")
    .replace(/\(\s*e\s+and\b/gi, "and")
    .replace(/\(\s*[a-z]\s*\)/gi, "")
    .replace(/\(\s*(?:evidenced|optional|partial|not\s+directly)[^)]*$/gi, "")
    .replace(TRUNCATED_PAREN, "")
    .replace(JD_VERB_IN_PARENS, "")
    .replace(/\bSystem Integration\s*\(Integrate\)\s*:/gi, "System integration:")
    .replace(/\bsupporting\s+Ensure\s+security\s+requirements\b/gi, "supporting security requirements")
    .replace(/\bEnsure\s+security\b/gi, "security best practices")
    .replace(/\bto Integrate\b/g, "to integrate")
    .replace(/\bability to Integrate\b/gi, "ability to integrate")
    .replace(/\bStrong ability to Integrate\b/gi, "Strong ability to integrate")
    .replace(/\bEnsure\s+/g, "Ensuring ")
    .replace(/\bcontainerization\s*\(Docker\)/gi, "Docker")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();

  cleaned = cleaned
    .replace(/,\s*and\s+and\b/gi, " and")
    .replace(/\band\s+and\b/gi, "and")
    .replace(/\bplatforms,\s*microservices architecture,\s*and\b/gi, "platforms using microservices architecture and")
    .replace(/\bcontainerized services with Docker,\s*and Kubernetes\b/gi, "containerized services with Docker, Kubernetes")
    .replace(/\bwith Docker,\s*and Kubernetes and CI\/CD pipelines\b/gi, "with Docker, Kubernetes, and CI/CD pipelines")
    .replace(/\bcontainerized Docker deployments\b/gi, "Docker deployments")
    .replace(/\bDocker containerization and Kubernetes\b/gi, "Docker and Kubernetes")
    .replace(/\bmicroservices architecture systems\b/gi, "microservices architecture")
    .replace(/\bcontainerized services using containerization \(Docker\)/gi, "containerized services with Docker")
    .replace(/\busing Docker and Kubernetes and CI\/CD pipelines\b/gi, "using Docker, Kubernetes, and CI/CD pipelines")
    .replace(/\bKubernetes and CI\/CD\b(?!\s+pipelines)/gi, "Kubernetes and CI/CD pipelines")
    .replace(/\busing containerization \(Docker\)/gi, "using Docker")
    .replace(/\bAutomated Kubernetes and CI\/CD using Docker\b/gi, "Automated Kubernetes and CI/CD using Docker")
    .trim();

  return cleaned;
}

/**
 * @param {string} line
 */
function skillDedupeKey(line) {
  const label = stripMarks(line.replace(/^•\s*/, "").split(/[:—-]/)[0] || "").trim().toLowerCase();
  if (!label) return "";

  if (/\bci\s*\/?\s*cd\b/.test(label) || /\bkubernetes\b/.test(label)) return "cicd-k8s";
  if (/\bcontaineri[sz]ation\b|\bdocker\b/.test(label)) return "docker";
  if (/\brestful\b|\bapi integration\b|\bsystem integration\b|\bsystem and api\b/.test(label)) {
    return "api-integration";
  }
  if (/\bmicroservices\b/.test(label)) return "microservices";

  return normalizeTechTerm(label);
}

/**
 * @param {string} line
 */
function isBrokenSkillLine(line) {
  const trimmed = stripMarks(line.replace(/^•\s*/, "")).trim();
  if (!trimmed) return true;
  if (TRUNCATED_PAREN.test(trimmed)) return true;
  if (/\(\s*\d+\s*$/.test(trimmed)) return true;
  if (JD_VERB_IN_PARENS.test(trimmed)) return true;
  if (/^Integrate\b/i.test(trimmed)) return true;
  if (/^\([^)]+\)\s*:/.test(trimmed)) return true;
  if (JD_VERB_SKILL.test(trimmed.split(/[:—-]/)[0]?.trim() || "")) return true;
  if (/not directly evidenced|partial exposure/i.test(trimmed)) return true;
  return false;
}

/**
 * @param {string} a
 * @param {string} b
 */
function skillLinesEquivalent(a, b) {
  const leftKey = skillDedupeKey(a);
  const rightKey = skillDedupeKey(b);
  if (leftKey && rightKey && leftKey === rightKey) return true;

  const left = normalizeTechTerm(stripMarks(a.replace(/^•\s*/, "").split(/[:—-]/)[0] || ""));
  const right = normalizeTechTerm(stripMarks(b.replace(/^•\s*/, "").split(/[:—-]/)[0] || ""));
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const springLeft = /\bspring\b/.test(left) && /\bboot\b/.test(left);
  const springRight = /\bspring\b/.test(right) && /\bboot\b/.test(right);
  if (springLeft && springRight) return true;

  return false;
}

/**
 * @param {string} skills
 * @param {string} sourceResumeText
 */
function dedupeAndFilterSkills(skills, sourceResumeText) {
  if (!skills?.trim()) return skills || "";

  const lines = expandSkillsToLines(skills);
  if (!lines.length) return skills.trim();

  /** @type {string[]} */
  const kept = [];

  for (let line of lines) {
    line = cleanProseFragment(line.startsWith("•") ? line : `• ${line}`);
    if (isBrokenSkillLine(line)) continue;

    const label = line.replace(/^•\s*/, "").split(/[:—-]/)[0]?.trim() || "";
    if (
      label &&
      extractTechTermsFromText(label).length === 0 &&
      !/\b(node|react|vue|aws|docker|kubernetes|redis|graphql|mongodb|mysql|express|ci\/cd|microservices|restful|typescript|javascript|agile|integration)\b/i.test(
        label
      )
    ) {
      if (JD_VERB_SKILL.test(label)) continue;
    }

    if (kept.some((existing) => skillLinesEquivalent(existing, line))) continue;
    kept.push(capitalizeSkillBullet(line.startsWith("•") ? line : `• ${line}`));
  }

  const filtered = kept.filter((line) => {
    const content = stripMarks(line.replace(/^•\s*/, "")).trim();
    if (!content) return false;
    if (!skillFragmentSupported(line, sourceResumeText)) return false;

    // Drop a Spring/Java claim only for a single-skill bullet the source can't back —
    // never discard a multi-skill group over an incidental mention.
    const isGrouped = /[,&/]|\band\b/i.test(content);
    if (!isGrouped) {
      if (/\bspring\b/i.test(content) && !resumeSupportsKeyword(sourceResumeText, "spring boot")) {
        return false;
      }
      if (
        /\bjava\b/i.test(content) &&
        !extractTechTermsFromText(sourceResumeText).includes("java")
      ) {
        return false;
      }
    }

    return true;
  });

  return filtered.join("\n");
}

/**
 * @param {import("./resume-structure.js").ResumeStructure} tailored
 * @param {string} sourceResumeText
 * @param {string} [targetRole]
 */
export function cleanupTailoredResumeLogic(tailored, sourceResumeText, targetRole = "") {
  if (!tailored) return tailored;

  const normalizedRole = normalizeJobRoleTitle(targetRole);

  let summary = cleanProseFragment(tailored.summary || "");
  summary = applySummaryTitle(summary, sourceResumeText, normalizedRole, tailored);  summary = cleanProseFragment(summary);

  const experience = (tailored.experience || []).map((entry) => ({
    ...entry,
    title: normalizeExperienceTitle(entry.title),
    bullets: (entry.bullets || []).map((bullet) => cleanProseFragment(bullet)).filter(Boolean),
  }));

  const skills = dedupeAndFilterSkills(tailored.skills || "", sourceResumeText);

  return {
    ...tailored,
    summary,
    experience,
    skills,
    other: "",
  };
}

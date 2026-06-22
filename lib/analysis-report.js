import { computeAtsScore, scoreTier, TARGET_ATS_MATCH } from "./ats-score.js";
import { buildCoreSkillCoveragePlan, getSupportableJobKeywords } from "./job-core-skills.js";
import { resumeSupportsKeyword } from "./tech-similarity.js";

/**
 * @typedef {{
 *   score: number,
 *   target: number,
 *   tier: string,
 *   summary: string,
 *   fixableGaps: string[],
 *   unsupportedGaps: string[],
 *   coreSkills: string[],
 *   priorityKeywords: string[],
 *   recommendations: string[]
 * }} AnalysisReport
 */

/**
 * @param {string} tier
 */
function tierLabel(tier) {
  if (tier === "good") return "Strong match";
  if (tier === "fair") return "Moderate match";
  return "Needs work";
}

/**
 * @param {string} jobDescription
 * @param {string} resumeText
 * @returns {AnalysisReport}
 */
export function buildAnalysisReport(jobDescription, resumeText) {
  const job = jobDescription.trim();
  const resume = resumeText.trim();

  if (!job || !resume) {
    return {
      score: 0,
      target: TARGET_ATS_MATCH,
      tier: "poor",
      summary: "Add a job description and profile resume to run analysis.",
      fixableGaps: [],
      unsupportedGaps: [],
      coreSkills: [],
      priorityKeywords: [],
      recommendations: ["Import your resume in Profile.", "Paste or grab a job description."],
    };
  }

  const scored = computeAtsScore(resume, job);
  const tier = scoreTier(scored.score);
  const { coreSkills, mustInclude, rewrites, unsupported } = buildCoreSkillCoveragePlan(job, resume);
  const supportable = getSupportableJobKeywords(job, resume);

  /** @type {string[]} */
  const fixableGaps = [];
  /** @type {Set<string>} */
  const seen = new Set();

  const addFix = (line, key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    fixableGaps.push(line);
  };

  for (const item of mustInclude) {
    if (resumeSupportsKeyword(resume, item.jdTerm)) continue;
    addFix(`Add "${item.jdTerm}" to skills and recent experience.`, item.jdTerm.toLowerCase());
  }

  for (const item of rewrites.slice(0, 8)) {
    addFix(`Use JD term "${item.jdTerm}" instead of "${item.from}".`, item.jdTerm.toLowerCase());
  }

  for (const keyword of supportable.slice(0, 12)) {
    if (resumeSupportsKeyword(resume, keyword)) continue;
    addFix(`Weave "${keyword}" into skills or experience.`, keyword.toLowerCase());
  }

  const unsupportedGaps = unsupported.slice(0, 8).map((item) => item.jdTerm);
  const priorityKeywords = mustInclude.map((item) => item.jdTerm).slice(0, 12);

  /** @type {string[]} */
  const recommendations = [];
  if (scored.score < TARGET_ATS_MATCH) {
    recommendations.push(`Tailor your resume to reach ${TARGET_ATS_MATCH}%+ ATS match (currently ${scored.score}%).`);
  }
  if (fixableGaps.length) {
    recommendations.push(`Close ${Math.min(fixableGaps.length, 5)} fixable keyword gaps before applying.`);
  }
  if (unsupportedGaps.length) {
    recommendations.push("Do not invent unsupported skills listed as honest gaps.");
  }
  if (scored.score >= TARGET_ATS_MATCH) {
    recommendations.push("Good keyword coverage — tailor for role-specific phrasing before submitting.");
  }

  return {
    score: scored.score,
    target: TARGET_ATS_MATCH,
    tier,
    summary: `${tierLabel(tier)} — ${scored.score}% keyword overlap (target ${TARGET_ATS_MATCH}%).`,
    fixableGaps: fixableGaps.slice(0, 15),
    unsupportedGaps,
    coreSkills: coreSkills.slice(0, 12),
    priorityKeywords,
    recommendations,
  };
}

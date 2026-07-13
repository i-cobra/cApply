import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonFromText } from "../lib/json-extract.js";
import { buildAnalysisReport } from "../lib/analysis-report.js";
import { computeAtsScore } from "../lib/ats-score.js";
import { parseResumeText } from "../lib/resume-structure.js";
import { cleanupTailoredResumeLogic } from "../lib/tailor-cleanup.js";
import { parseTailorResponse } from "../lib/tailor-response.js";
import { ensureTailoredResumeCoverage } from "../lib/job-core-skills.js";
import { serializeResume } from "../lib/resume-structure.js";
import {
  extractDatesFromText,
  extractEmbeddedJsonJobDates,
  formatJobDateDisplay,
  mergeJobDates,
  parseJsonLdJobDates,
} from "../lib/job-date-extract.js";

test("parseJsonFromText extracts fenced JSON", () => {
  const parsed = parseJsonFromText('Here you go:\n```json\n{"ok":true,"score":90}\n```');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.score, 90);
});

test("computeAtsScore returns score for matching keywords", () => {
  const resume = "Senior Java Developer with Spring Boot, REST APIs, and AWS experience.";
  const job = "Looking for a Senior Java Developer with Spring Boot and AWS.";
  const result = computeAtsScore(resume, job);
  assert.ok(result.score >= 50);
  assert.ok(result.matched.length > 0);
});

test("buildAnalysisReport handles missing inputs", () => {
  const report = buildAnalysisReport("", "");
  assert.equal(report.score, 0);
  assert.match(report.summary, /Add a job description/i);
});

test("parseResumeText extracts skills from Core Skills header", () => {
  const resume = parseResumeText(`Jane Doe
jane@example.com

SUMMARY
Senior engineer with cloud experience.

CORE SKILLS
Languages & Front End: JavaScript, TypeScript
Back End & APIs: Node.js

EXPERIENCE
Engineer | Acme | 2020-Present
• Built APIs`);

  assert.match(resume.skills, /Languages & Front End: JavaScript/);
  assert.match(resume.skills, /Back End & APIs: Node.js/);
  assert.doesNotMatch(resume.summary, /Languages & Front End/);
});

test("parseResumeText extracts skills from category lines without header", () => {
  const resume = parseResumeText(`Jane Doe

SUMMARY
Senior engineer with cloud experience.

Languages & Front End: JavaScript, TypeScript
Back End & APIs: Node.js

EXPERIENCE
Engineer | Acme | 2020-Present
• Built APIs`);

  assert.match(resume.skills, /Languages & Front End: JavaScript/);
  assert.match(resume.skills, /Back End & APIs: Node.js/);
  assert.doesNotMatch(resume.summary, /Languages & Front End/);
});

test("parseResumeText recognizes technical skills section headers", () => {
  const resume = parseResumeText(`Jane Doe

TECHNICAL SKILLS & TOOLS
Languages: Python, Java

EXPERIENCE
Engineer | Acme | 2020-Present`);

  assert.match(resume.skills, /Languages: Python/);
});

test("cleanupTailoredResumeLogic preserves categorized tailor skills", () => {
  const skills = [
    "Languages: JavaScript, TypeScript, Ruby, HTML5, CSS3, SQL",
    "Frontend: React, reusable UI components, responsive design, accessibility, WCAG, Section 508",
    "Backend: Ruby on Rails, Node.js, Express.js, REST APIs, business logic, secure backend services",
    "Cloud & DevOps: AWS, Docker, Kubernetes, CI/CD, DevSecOps, GitHub Actions, GitLab CI, Git workflows",
  ].join("\n");

  const result = cleanupTailoredResumeLogic(
    {
      contact: { name: "", email: "", phone: "", location: "", links: "" },
      summary: "Full Stack Engineer with React and Rails experience.",
      experience: [],
      education: [],
      skills,
      other: "",
    },
    "JavaScript React Ruby on Rails Node.js AWS Docker Kubernetes"
  );

  assert.doesNotMatch(result.skills, /^• /m);
  assert.match(result.skills, /Languages: JavaScript, TypeScript/);
  assert.match(result.skills, /Frontend: React/);
  assert.doesNotMatch(result.skills, /And security/i);
});

test("parseTailorResponse keeps categorized skills from tailor JSON", () => {
  const json = JSON.stringify({
    tailoredResume: {
      summary: "Full Stack Engineer with React experience.",
      skills: "Languages: JavaScript, TypeScript\nFrontend: React, WCAG, Section 508",
      experience: [{ bullets: ["Built React apps."] }],
    },
  });

  const { structured } = parseTailorResponse(json);
  assert.match(structured.skills, /Languages: JavaScript/);
  assert.doesNotMatch(structured.skills, /^• /m);
});

test("parseTailorResponse scopes resume summary away from atsScore.summary", () => {
  const resumeSummary =
    "Full Stack Engineer with 4 years of professional software development experience and GoHighLevel platform development.";
  const atsSummary =
    "The tailored resume achieves near-complete keyword alignment with the job description.";

  const json = `{
    "atsScore": {
      "score": 95,
      "summary": "${atsSummary}",
      "missingKeywords": []
    },
    "tailoredResume": {
      "summary": "${resumeSummary}",
      "skills": "Languages: JavaScript",
      "experience": [{ "bullets": ["Built GoHighLevel automations."] }],
      INVALID
    }
  }`;

  const { structured } = parseTailorResponse(json);
  assert.equal(structured.summary, resumeSummary);
  assert.doesNotMatch(structured.summary, /keyword alignment/i);
});

test("ensureTailoredResumeCoverage does not prepend junk into categorized skills", () => {
  const skills = [
    "Languages: JavaScript, TypeScript, Ruby, HTML5, CSS3, SQL",
    "Frontend: React, reusable UI components, responsive design, accessibility, WCAG, Section 508",
    "Backend: Ruby on Rails, Node.js, Express.js, REST APIs, business logic, secure backend services",
    "Cloud & DevOps: AWS, Docker, Kubernetes, CI/CD, DevSecOps, GitHub Actions, GitLab CI, Git workflows",
    "Databases: PostgreSQL, MySQL, MongoDB, Redis",
    "Testing & Quality: Jest, Cypress, Playwright, Mocha, automated testing, unit testing, integration testing",
    "Tools & Process: Git, Jira, Postman, Swagger, Agile, Scrum, code reviews",
  ].join("\n");

  const tailored = {
    contact: { name: "Jane Doe", email: "", phone: "", location: "", links: "" },
    summary:
      "Full Stack Engineer with 8+ years of experience designing, developing, testing, and maintaining modern web applications.",
    experience: [
      {
        id: "1",
        title: "Engineer",
        company: "Acme",
        location: "",
        dates: "2020-Present",
        bullets: ["Built React and Rails applications with AWS and CI/CD."],
      },
    ],
    education: [],
    skills,
    other: "",
  };

  const sourceResume = serializeResume(tailored);
  const jobDescription =
    "Full Stack Engineer with React, Ruby on Rails, REST APIs, AWS, CI/CD, Git workflows, Agile, WCAG, Section 508, security, and modern front-end frameworks.";

  const result = ensureTailoredResumeCoverage(
    tailored,
    jobDescription,
    sourceResume,
    ["VA.gov architecture"],
    { targetRole: "Full Stack Engineer" }
  );

  assert.doesNotMatch(result.skills, /^• /m);
  assert.doesNotMatch(result.skills, /And security/i);
  assert.doesNotMatch(result.skills, /Modern front-end frameworks/i);
  assert.match(result.skills, /Languages: JavaScript/);
});

test("cleanupTailoredResumeLogic handles summary commas after skills", () => {
  const summary =
    "Senior Software Engineer with 8+ years of experience developing high-performance software applications using C++, modern graphics programming techniques, and real-time simulation technologies.";

  const result = cleanupTailoredResumeLogic(
    {
      contact: { name: "", email: "", phone: "", location: "", links: "" },
      summary,
      experience: [],
      education: [],
      skills: "Languages: C++, Python",
      other: "",
    },
    "C++ Python JavaScript",
    "Senior Software Engineer"
  );

  assert.match(result.summary, /Senior Software Engineer with 8\+ years/);
  assert.doesNotMatch(result.summary, /specializing in modern graphics/i);
});

test("cleanupTailoredResumeLogic still fixes title comma splices", () => {
  const result = cleanupTailoredResumeLogic(
    {
      contact: { name: "", email: "", phone: "", location: "", links: "" },
      summary: "Senior Java Developer, microservices and cloud-native systems across production environments.",
      experience: [],
      education: [],
      skills: "Languages: Java",
      other: "",
    },
    "Java microservices",
    "Senior Java Developer"
  );

  assert.match(result.summary, /Senior Java Developer specializing in microservices/i);
});

test("serializeResume tolerates null experience bullets", () => {
  const text = serializeResume({
    contact: { name: "Jane Doe", email: "", phone: "", location: "", links: "" },
    summary: "Engineer",
    skills: "Languages: JavaScript",
    experience: [
      {
        id: "1",
        title: "Engineer",
        company: "Acme",
        location: "",
        dates: "2020",
        bullets: ["Built APIs", null, undefined],
      },
    ],
    education: [],
    other: "",
  });

  assert.match(text, /Built APIs/);
  assert.doesNotMatch(text, /null/);
});

test("extractEmbeddedJsonJobDates reads Greenhouse published_at", () => {
  const snippet = `"published_at":"2026-07-06T16:36:00-04:00","employment":"hidden"`;
  const dates = extractEmbeddedJsonJobDates(snippet);
  assert.equal(dates.jobPosted, "2026-07-06T16:36:00-04:00");
});

test("formatJobDateDisplay formats Greenhouse ISO timestamps", () => {
  const formatted = formatJobDateDisplay("2026-07-06T16:36:00-04:00");
  assert.match(formatted, /2026/);
  assert.match(formatted, /Jul|July/i);
  assert.match(formatted, /6/);
});

test("parseJsonLdJobDates reads JobPosting schema dates", () => {
  const json = JSON.stringify({
    "@type": "JobPosting",
    datePosted: "2024-03-15",
    dateCreated: "2024-03-10",
    dateModified: "2024-03-20",
  });
  const dates = parseJsonLdJobDates(json);
  assert.equal(dates.jobPosted, "2024-03-15");
  assert.equal(dates.jobCreated, "2024-03-10");
  assert.equal(dates.jobModified, "2024-03-20");
});

test("extractDatesFromText finds posted and modified lines", () => {
  const text = `Senior Engineer
Posted 3 days ago
Last updated yesterday`;
  const dates = extractDatesFromText(text);
  assert.equal(dates.jobPosted, "3 days ago");
  assert.equal(dates.jobModified, "yesterday");
});

test("mergeJobDates keeps first non-empty value per field", () => {
  const merged = mergeJobDates(
    { jobPosted: "Mar 1", jobCreated: "", jobModified: "" },
    { jobPosted: "Apr 1", jobCreated: "Feb 1", jobModified: "May 1" }
  );
  assert.equal(merged.jobPosted, "Mar 1");
  assert.equal(merged.jobCreated, "Feb 1");
  assert.equal(merged.jobModified, "May 1");
});

test("formatJobDateDisplay formats ISO dates", () => {
  const formatted = formatJobDateDisplay("2024-03-15");
  assert.match(formatted, /2024/);
  assert.match(formatted, /Mar|March/i);
});

test("formatRelativeHistoryDate prefers relative labels for recent entries", async () => {
  const { formatRelativeHistoryDate } = await import("../lib/tailor-history.js");
  const now = new Date();
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000).toISOString();
  const todayEarlier = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    9,
    41
  ).toISOString();

  assert.match(formatRelativeHistoryDate(twoMinutesAgo), /min ago/);
  assert.match(formatRelativeHistoryDate(todayEarlier), /^Today,/);
});

test("parsePageTitle handles company-first Lever titles", async () => {
  const { parsePageTitle, normalizeGrabMeta } = await import("../lib/job-page-meta.js");
  const parsed = parsePageTitle(
    "Aera Technology - Senior Software Engineer (CALC engine) (copy)"
  );
  assert.equal(parsed.companyName, "Aera Technology");
  assert.equal(parsed.position, "Senior Software Engineer (CALC engine) (copy)");

  const fixed = normalizeGrabMeta(
    {
      companyName: "Senior Software Engineer (CALC engine) (copy)",
      position: "Aera Technology",
    },
    "https://jobs.lever.co/aeratechnology/76a9171c-6d56-4229-bc16-236e3b",
    "Senior Software Engineer (CALC engine) (copy)\nAera Technology is a pioneer..."
  );
  assert.equal(fixed.companyName, "Aera Technology");
  assert.match(fixed.position, /Senior Software Engineer/i);
});

test("parsePageTitle keeps job-first Indeed-style titles", async () => {
  const { parsePageTitle } = await import("../lib/job-page-meta.js");
  const parsed = parsePageTitle("Senior Software Engineer - Acme Inc");
  assert.equal(parsed.position, "Senior Software Engineer");
  assert.equal(parsed.companyName, "Acme Inc");
});

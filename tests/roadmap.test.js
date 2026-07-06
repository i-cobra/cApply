import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonFromText } from "../lib/json-extract.js";
import { buildAnalysisReport } from "../lib/analysis-report.js";
import { computeAtsScore } from "../lib/ats-score.js";
import { parseAutoApplyResponse } from "../lib/auto-apply-response.js";
import { parseResumeText } from "../lib/resume-structure.js";
import { cleanupTailoredResumeLogic } from "../lib/tailor-cleanup.js";
import { parseTailorResponse } from "../lib/tailor-response.js";
import { ensureTailoredResumeCoverage } from "../lib/job-core-skills.js";
import { serializeResume } from "../lib/resume-structure.js";

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

test("parseAutoApplyResponse normalizes continue plan", () => {
  const plan = parseAutoApplyResponse(
    JSON.stringify({
      status: "continue",
      summary: "Fill profile fields",
      steps: [{ action: "fill", targetId: "el-1", value: "Jane Doe" }],
    })
  );
  assert.equal(plan.status, "continue");
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, "fill");
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

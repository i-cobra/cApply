import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonFromText } from "../lib/json-extract.js";
import { buildAnalysisReport } from "../lib/analysis-report.js";
import { computeAtsScore } from "../lib/ats-score.js";
import { parseAutoApplyResponse } from "../lib/auto-apply-response.js";

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

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEmbeddedJsonJobDates,
  formatJobDates,
} from "../lib/job-date-extract.js";
import { parseGreenhouseRemixJob } from "../lib/greenhouse-remix.js";

test("extractEmbeddedJsonJobDates parses Greenhouse published_at snippet", () => {
  const snippet =
    '"pay_ranges":[],"published_at":"2026-07-06T16:36:00-04:00","employment":"hidden"';
  const dates = extractEmbeddedJsonJobDates(snippet);
  assert.equal(dates.jobPosted, "2026-07-06T16:36:00-04:00");
  assert.match(formatJobDates(dates).jobPosted, /Jul|July/i);
});

test("parseGreenhouseRemixJob parses live Greenhouse HTML when available", async () => {
  let html = "";
  try {
    const response = await fetch("https://job-boards.greenhouse.io/ujet/jobs/4710463005");
    html = await response.text();
  } catch {
    return;
  }

  const job = parseGreenhouseRemixJob(html);
  assert.ok(job, "expected remix job data");
  assert.equal(job.companyName, "UJET");
  assert.equal(job.position, "Data-Focused Full Stack Engineer");
  assert.equal(job.jobPosted, "2026-07-06T16:36:00-04:00");
  assert.match(formatJobDates(job).jobPosted, /Jul|July/i);
  assert.ok(job.descriptionText.length > 500);
  assert.doesNotMatch(job.descriptionText, /^Back to jobs/i);
});

test("extractEmbeddedJsonJobDates parses live Greenhouse HTML when available", async () => {
  let html = "";
  try {
    const response = await fetch("https://job-boards.greenhouse.io/ujet/jobs/4710463005");
    html = await response.text();
  } catch {
    return;
  }

  const idx = html.indexOf("published_at");
  const before = html.lastIndexOf("<script", idx);
  const after = html.indexOf("</script>", idx);
  assert.ok(before < idx && idx < after, "published_at should live inside a script tag");

  const scriptChunks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1]
  );
  const embedded = scriptChunks.join("\n");
  const dates = extractEmbeddedJsonJobDates(embedded);
  assert.equal(dates.jobPosted, "2026-07-06T16:36:00-04:00");

  const domParserDates = extractEmbeddedJsonJobDates(html);
  assert.equal(domParserDates.jobPosted, "2026-07-06T16:36:00-04:00");
});

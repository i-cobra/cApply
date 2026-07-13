import { parseJsonFromText, assembleTailorJsonFromText } from "./lib/json-extract.js";
import { parseTailorResponse } from "./lib/tailor-response.js";

const resumeSummary = "Full Stack Engineer with 4 years of professional software development experience.";
const atsSummary = "The tailored resume achieves near-complete keyword alignment with the job description.";

// atsScore before tailoredResume, with broken experience array (trailing comma issue)
const broken = `{
  "atsScore": {
    "score": 95,
    "summary": "${atsSummary}",
    "missingKeywords": []
  },
  "tailoredResume": {
    "summary": "${resumeSummary}",
    "skills": "Languages: JavaScript",
    "experience": [
      { "bullets": ["Built apps.",] }
    ]
  }
}`;

console.log("=== Broken JSON with atsScore first ===");
try {
  parseJsonFromText(broken);
  console.log("Full parse: OK (unexpected)");
} catch (e) {
  console.log("Full parse: FAIL", e.message);
}

const assembled = assembleTailorJsonFromText(broken);
console.log("Assembled summary:", assembled?.tailoredResume?.summary?.slice(0, 80));
console.log("Is ATS summary?", assembled?.tailoredResume?.summary === atsSummary);

try {
  const { structured } = parseTailorResponse(broken);
  console.log("parseTailorResponse summary:", structured.summary.slice(0, 80));
  console.log("Is ATS summary?", structured.summary === atsSummary);
} catch (e) {
  console.log("parseTailorResponse FAIL:", e.message);
}

// Flat structure with atsScore first
const flat = `{
  "atsScore": {
    "score": 95,
    "summary": "${atsSummary}",
    "missingKeywords": []
  },
  "summary": "${resumeSummary}",
  "skills": "Languages: JavaScript",
  "experience": [{ "bullets": ["Built apps."] }]
}`;

console.log("\n=== Flat structure atsScore first ===");
try {
  const { structured } = parseTailorResponse(flat);
  console.log("Summary:", structured.summary.slice(0, 80));
  console.log("Is ATS summary?", structured.summary === atsSummary);
} catch (e) {
  console.log("FAIL:", e.message);
  const assembled2 = assembleTailorJsonFromText(flat);
  console.log("Assembled:", assembled2?.tailoredResume?.summary?.slice(0, 80));
  console.log("Is ATS?", assembled2?.tailoredResume?.summary === atsSummary);
}

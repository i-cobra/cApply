/** @typedef {import("./resume-structure.js").ResumeStructure} ResumeStructure */

const MARGIN = 16;
const PAGE_H = 297;
const LINE = 5;
const CONTENT_W = 210 - MARGIN * 2;
const BULLET_LINE = /^\s*[•\-\*]\s*/;
const SKILL_SECTION_HEADER =
  /^(?:core\s+skills?|technical\s+skills?|skills?|core\s+competencies|technologies)$/i;

function createJsPDF() {
  const jsPDF = globalThis.jspdf?.jsPDF;
  if (!jsPDF) {
    throw new Error("PDF library not loaded. Reload the extension.");
  }
  return new jsPDF({ unit: "mm", format: "a4" });
}

/**
 * @param {jsPDF} doc
 * @param {number} y
 * @param {number} needed
 */
function ensureSpace(doc, y, needed) {
  if (y + needed <= PAGE_H - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

/**
 * @param {jsPDF} doc
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} lineHeight
 */
function writeLines(doc, text, x, y, width, lineHeight = LINE) {
  const plain = String(text).replace(/\*\*/g, "");
  const lines = doc.splitTextToSize(plain, width);
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight);
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

/**
 * @param {jsPDF} doc
 * @param {string} text
 * @param {number} y
 * @param {number} width
 * @param {number} lineHeight
 */
function writeLinesCentered(doc, text, y, width, lineHeight = LINE) {
  const plain = String(text).replace(/\*\*/g, "");
  const lines = doc.splitTextToSize(plain, width);
  const centerX = MARGIN + width / 2;
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight);
    doc.text(line, centerX, y, { align: "center" });
    y += lineHeight;
  }
  return y;
}

/**
 * @param {jsPDF} doc
 * @param {{ text: string, bold: boolean }[]} segments
 * @param {number} y
 * @param {number} width
 * @param {number} lineHeight
 * @param {number} wrapIndent
 */
function writeMixedWeightLine(doc, segments, y, width, lineHeight = LINE, wrapIndent = 0) {
  const setStyle = (bold) => doc.setFont("helvetica", bold ? "bold" : "normal");

  const tokens = [];
  for (const seg of segments) {
    for (const piece of String(seg.text).replace(/\*\*/g, "").split(/(\s+)/)) {
      if (piece === "") continue;
      tokens.push({ text: piece, bold: seg.bold, space: /^\s+$/.test(piece) });
    }
  }

  y = ensureSpace(doc, y, lineHeight);
  let cursorX = MARGIN;
  let lineStart = true;

  for (const tok of tokens) {
    setStyle(tok.bold);
    const w = doc.getTextWidth(tok.text);

    if (tok.space) {
      if (!lineStart) cursorX += w;
      continue;
    }

    if (!lineStart && cursorX + w > MARGIN + width + 0.01) {
      y += lineHeight;
      y = ensureSpace(doc, y, lineHeight);
      cursorX = MARGIN + wrapIndent;
      lineStart = true;
    }

    doc.text(tok.text, cursorX, y);
    cursorX += w;
    lineStart = false;
  }

  y += lineHeight;
  setStyle(false);
  return y;
}

/**
 * Render a bullet line whose segments may switch between bold and normal weight.
 * Wraps to CONTENT_W with a hanging indent aligned after the bullet.
 * @param {jsPDF} doc
 * @param {{ text: string, bold: boolean }[]} segments
 * @param {number} y
 */
function writeMixedWeightBullet(doc, segments, y) {
  return writeMixedWeightLine(
    doc,
    segments,
    y,
    CONTENT_W,
    LINE,
    doc.getTextWidth("• ")
  );
}

/**
 * Split "Category: skill, skill" into a bold label and a normal remainder.
 * Returns null when the line has no leading category label.
 * @param {string} text
 */
function splitSkillCategory(text) {
  const colon = text.indexOf(":");
  if (colon <= 0 || colon > 40) return null;
  const label = text.slice(0, colon).trim();
  const rest = text.slice(colon + 1).trim();
  if (!label || !rest) return null;
  return { label, rest };
}

/**
 * @param {string} school
 * @returns {{ school: string, location: string }}
 */
function splitSchoolAndLocation(school) {
  if (!school?.trim()) return { school: "", location: "" };

  const trimmed = school.trim();
  const dashMatch = trimmed.match(/^(.+?)\s*[–—-]\s*([A-Za-z .'-]+,\s*[A-Z]{2})$/);
  if (dashMatch) {
    return { school: dashMatch[1].trim(), location: dashMatch[2].trim() };
  }

  const commaMatch = trimmed.match(/^(.+?),\s*([^,]+,\s*[A-Z]{2})$/);
  if (commaMatch && commaMatch[1].length > 2 && commaMatch[2].length > 2) {
    return { school: commaMatch[1].trim(), location: commaMatch[2].trim() };
  }

  return { school: trimmed, location: "" };
}

/**
 * Remove an embedded "Core Skills" / "Skills" heading from skills body text.
 * The PDF section title already renders that header with proper styling.
 * @param {string} skillsText
 */
function stripEmbeddedSkillHeaders(skillsText) {
  const lines = skillsText.trim().split(/\r?\n/);
  while (lines.length) {
    const line = lines[0].trim();
    if (!line) {
      lines.shift();
      continue;
    }
    const plain = BULLET_LINE.test(line) ? line.replace(BULLET_LINE, "").trim() : line;
    if (SKILL_SECTION_HEADER.test(plain)) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

/**
 * @param {jsPDF} doc
 * @param {string} skillsText
 * @param {number} y
 */
function writeSkillsSection(doc, skillsText, y) {
  const body = stripEmbeddedSkillHeaders(skillsText);
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const text = BULLET_LINE.test(line) ? line.replace(BULLET_LINE, "").trim() : line;
    if (SKILL_SECTION_HEADER.test(text)) continue;
    const category = splitSkillCategory(text);

    if (category) {
      y = writeMixedWeightBullet(
        doc,
        [
          { text: "• ", bold: false },
          { text: `${category.label}:`, bold: true },
          { text: ` ${category.rest}`, bold: false },
        ],
        y
      );
    } else {
      y = writeLines(doc, `• ${text}`, MARGIN, y, CONTENT_W);
    }
    y += 1;
  }

  return y;
}

/**
 * @param {ResumeStructure} resume
 * @returns {Blob}
 */
export function generateResumePdf(resume) {
  const doc = createJsPDF();
  let y = MARGIN;

  const { contact } = resume;

  if (contact.name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    y = writeLinesCentered(doc, contact.name, y, CONTENT_W, 7);
    y += 2;
  }

  const meta = [contact.email, contact.phone, contact.location]
    .filter(Boolean)
    .join("   |   ");
  if (meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    y = writeLinesCentered(doc, meta, y, CONTENT_W);
    y += 1;
  }

  if (contact.links) {
    doc.setFontSize(10);
    doc.setTextColor(16, 163, 127);
    y = writeLinesCentered(doc, contact.links, y, CONTENT_W);
  }

  doc.setTextColor(0, 0, 0);
  y += 3;

  function sectionTitle(title) {
    y = ensureSpace(doc, y, 12);
    doc.setDrawColor(16, 163, 127);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(16, 163, 127);
    doc.text(title.toUpperCase(), MARGIN, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  if (resume.summary?.trim()) {
    sectionTitle("Summary");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeLines(doc, resume.summary.trim(), MARGIN, y, CONTENT_W);
    y += 4;
  }

  if (resume.skills?.trim()) {
    sectionTitle("Core Skills");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeSkillsSection(doc, resume.skills.trim(), y);
    y += 4;
  }

  const jobs = resume.experience.filter(
    (j) =>
      j.title?.trim() ||
      j.company?.trim() ||
      j.location?.trim() ||
      j.bullets?.some((b) => String(b ?? "").trim())
  );

  if (jobs.length) {
    sectionTitle("Experience");
    for (const job of jobs) {
      y = ensureSpace(doc, y, 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      const heading = [job.title, job.company].filter(Boolean).join(" — ");
      let datesY = y;
      if (heading) {
        datesY = y;
        y = writeLines(doc, heading, MARGIN, y, CONTENT_W - 40, 5.5);
      }

      if (job.location?.trim()) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(100, 100, 100);
        y = writeLines(doc, job.location.trim(), MARGIN, y, CONTENT_W - 40);
        doc.setTextColor(0, 0, 0);
      }

      if (job.dates?.trim()) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(100, 100, 100);
        const dateW = doc.getTextWidth(job.dates);
        doc.text(job.dates, MARGIN + CONTENT_W - dateW, datesY);
        doc.setTextColor(0, 0, 0);
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      for (const bullet of job.bullets) {
        if (!bullet?.trim()) continue;
        y = ensureSpace(doc, y, LINE);
        y = writeLines(doc, `• ${bullet.trim()}`, MARGIN, y, CONTENT_W);
        y += 1;
      }
      y += 3;
    }
  }

  const edu = resume.education.filter(
    (e) => e.school?.trim() || e.degree?.trim()
  );

  if (edu.length) {
    sectionTitle("Education");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const item of edu) {
      y = ensureSpace(doc, y, 10);
      const degree = item.degree?.trim() || "";
      const school = item.school?.trim() || "";
      const { school: schoolName, location: schoolLocation } = splitSchoolAndLocation(school);
      /** @type {{ text: string, bold: boolean }[]} */
      const segments = [];

      if (degree) {
        segments.push({ text: degree, bold: false });
        if (schoolName || schoolLocation) segments.push({ text: " — ", bold: false });
      }
      if (schoolName) {
        segments.push({ text: schoolName, bold: true });
      }
      if (schoolLocation) {
        const locIndex = school.lastIndexOf(schoolLocation);
        const sep =
          locIndex > schoolName.length ? school.slice(schoolName.length, locIndex) : "-";
        segments.push({ text: `${sep}${schoolLocation}`, bold: false });
      }

      if (segments.length) {
        const datesY = y;
        doc.setFontSize(10);
        y = writeMixedWeightLine(doc, segments, y, CONTENT_W - 35, 5.5);

        if (item.dates?.trim()) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          doc.setTextColor(100, 100, 100);
          const dateW = doc.getTextWidth(item.dates);
          doc.text(item.dates, MARGIN + CONTENT_W - dateW, datesY);
          doc.setTextColor(0, 0, 0);
        }
      }
      y += 3;
    }
  }

  if (resume.other?.trim()) {
    sectionTitle("Additional");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeLines(doc, resume.other.trim(), MARGIN, y, CONTENT_W);
  }

  return doc.output("blob");
}

/**
 * @param {string} text
 */
function slugForFilename(text) {
  return text
    .trim()
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} name
 * @param {string} [role]
 */
export function buildResumeDownloadFilename(name, role = "") {
  const namePart = slugForFilename(name) || "resume";
  const rolePart = slugForFilename(role);
  return rolePart ? `${namePart}-${rolePart}.pdf` : `${namePart}.pdf`;
}

/**
 * @param {ResumeStructure} resume
 * @param {string} filename
 */
export function downloadResumePdf(resume, filename = "resume.pdf") {
  const blob = generateResumePdf(resume);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not encode resume PDF."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not encode resume PDF."));
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {ResumeStructure} resume
 * @returns {Promise<string>}
 */
export async function encodeResumePdfBase64(resume) {
  const blob = generateResumePdf(resume);
  return blobToBase64(blob);
}

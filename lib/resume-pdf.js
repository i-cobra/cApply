/** @typedef {import("./resume-structure.js").ResumeStructure} ResumeStructure */

const MARGIN = 16;
const PAGE_H = 297;
const LINE = 5;
const CONTENT_W = 210 - MARGIN * 2;

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
  const lines = doc.splitTextToSize(text, width);
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight);
    doc.text(line, x, y);
    y += lineHeight;
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
    y = writeLines(doc, contact.name, MARGIN, y, CONTENT_W, 7);
    y += 2;
  }

  const meta = [contact.email, contact.phone, contact.location]
    .filter(Boolean)
    .join("   |   ");
  if (meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    y = writeLines(doc, meta, MARGIN, y, CONTENT_W);
    y += 1;
  }

  if (contact.links) {
    doc.setFontSize(10);
    doc.setTextColor(16, 163, 127);
    y = writeLines(doc, contact.links, MARGIN, y, CONTENT_W);
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
    sectionTitle("Skills");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y = writeLines(doc, resume.skills.trim(), MARGIN, y, CONTENT_W);
    y += 4;
  }

  const jobs = resume.experience.filter(
    (j) =>
      j.title?.trim() ||
      j.company?.trim() ||
      j.bullets?.some((b) => b.trim())
  );

  if (jobs.length) {
    sectionTitle("Experience");
    for (const job of jobs) {
      y = ensureSpace(doc, y, 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      const heading = [job.title, job.company].filter(Boolean).join(" — ");
      if (heading) y = writeLines(doc, heading, MARGIN, y, CONTENT_W - 40, 5.5);

      if (job.dates?.trim()) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(100, 100, 100);
        const dateW = doc.getTextWidth(job.dates);
        doc.text(job.dates, MARGIN + CONTENT_W - dateW, y - 5.5);
        doc.setTextColor(0, 0, 0);
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      for (const bullet of job.bullets) {
        if (!bullet?.trim()) continue;
        y = ensureSpace(doc, y, LINE);
        y = writeLines(doc, `• ${bullet.trim()}`, MARGIN + 3, y, CONTENT_W - 3);
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
      const heading = [item.degree, item.school].filter(Boolean).join(" — ");
      if (heading) {
        doc.setFont("helvetica", "bold");
        y = writeLines(doc, heading, MARGIN, y, CONTENT_W - 35, 5.5);
      }
      if (item.dates?.trim()) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(100, 100, 100);
        const dateW = doc.getTextWidth(item.dates);
        doc.text(item.dates, MARGIN + CONTENT_W - dateW, y - 5.5);
        doc.setTextColor(0, 0, 0);
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
 * @param {string} [title]
 */
export async function previewResumePdf(resume, title = "Resume") {
  const blob = generateResumePdf(resume);
  const base64 = await blobToBase64(blob);
  const response = await chrome.runtime.sendMessage({
    type: "PREVIEW_RESUME",
    base64,
    title: title.trim() || "Resume",
  });

  if (response === undefined) {
    throw new Error(
      "Lost connection to the extension background. Reload cApply in chrome://extensions and try again."
    );
  }

  if (!response?.ok) {
    throw new Error(response?.error || "Could not open resume preview.");
  }
}

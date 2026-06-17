import * as pdfjsLib from "./pdfjs/pdf.min.mjs";

let workerConfigured = false;

function ensureWorker() {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "lib/pdfjs/pdf.worker.min.mjs"
  );
  workerConfigured = true;
}

function pageItemsToText(items) {
  if (!items.length) return "";

  const lines = [];
  let line = [];
  let lastY = null;

  for (const item of items) {
    const y = item.transform?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 4) {
      lines.push(line.join(" ").trim());
      line = [];
    }
    line.push(item.str);
    if (item.hasEOL) {
      lines.push(line.join(" ").trim());
      line = [];
    }
    if (y !== undefined) lastY = y;
  }

  if (line.length) {
    lines.push(line.join(" ").trim());
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function extractTextFromPdf(file) {
  ensureWorker();

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(pageItemsToText(content.items));
  }

  const text = pages.join("\n\n").trim();
  if (!text) {
    throw new Error(
      "No text found in PDF. It may be a scanned image — try a text-based PDF or paste manually."
    );
  }

  return text;
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function readResumeFile(file) {
  const name = file.name.toLowerCase();
  const isPdf =
    file.type === "application/pdf" || name.endsWith(".pdf");

  if (isPdf) {
    return extractTextFromPdf(file);
  }

  return file.text();
}

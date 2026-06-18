import * as pdfjsLib from "./pdfjs/pdf.min.mjs";

let workerConfigured = false;

function ensureWorker() {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "lib/pdfjs/pdf.worker.min.mjs"
  );
  workerConfigured = true;
}

/**
 * @param {import("pdfjs-dist/types/src/display/api").TextItem} item
 */
function toPositionedItem(item) {
  const transform = item.transform || [];
  const height = item.height || Math.abs(transform[3] || transform[0] || 12);

  return {
    str: item.str || "",
    x: transform[4] ?? 0,
    y: transform[5] ?? 0,
    width: item.width ?? 0,
    height,
  };
}

/**
 * @param {ReturnType<typeof toPositionedItem>[]} items
 */
function groupItemsIntoLines(items) {
  if (!items.length) return [];

  const avgHeight =
    items.reduce((sum, item) => sum + item.height, 0) / items.length;
  const yTolerance = Math.max(2.5, avgHeight * 0.45);

  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTolerance) return b.y - a.y;
    return a.x - b.x;
  });

  /** @type {{ items: ReturnType<typeof toPositionedItem>[], y: number }[]} */
  const groups = [];

  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (!last || Math.abs(item.y - last.y) > yTolerance) {
      groups.push({ items: [item], y: item.y });
      continue;
    }

    last.items.push(item);
    last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
  }

  return groups.map((group) => {
    group.items.sort((a, b) => a.x - b.x);

    let text = "";
    for (let i = 0; i < group.items.length; i++) {
      const curr = group.items[i];
      if (i > 0) {
        const prev = group.items[i - 1];
        const gap = curr.x - (prev.x + prev.width);
        const threshold = Math.max(prev.height, curr.height) * 0.28;
        if (gap > threshold) text += " ";
      }
      text += curr.str;
    }

    return { text: text.trim(), y: group.y, height: avgHeight };
  }).filter((line) => line.text);
}

/**
 * @param {{ text: string, y: number, height: number }[]} lines
 */
function linesToText(lines) {
  if (!lines.length) return "";

  const avgHeight =
    lines.reduce((sum, line) => sum + line.height, 0) / lines.length;
  const paragraphGap = avgHeight * 1.55;

  /** @type {string[]} */
  const output = [];
  let lastY = null;

  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].text;
    let lineY = lines[i].y;

    while (text.endsWith("-") && i + 1 < lines.length) {
      text = text.slice(0, -1) + lines[i + 1].text.trimStart();
      lineY = lines[i + 1].y;
      i++;
    }

    if (lastY !== null && Math.abs(lastY - lineY) > paragraphGap) {
      output.push("");
    }

    output.push(text);
    lastY = lineY;
  }

  return output.join("\n");
}

/**
 * @param {import("pdfjs-dist/types/src/display/api").TextItem[]} items
 */
function pageItemsToText(items) {
  const positioned = items
    .map(toPositionedItem)
    .filter((item) => item.str && item.str.trim());

  return linesToText(groupItemsIntoLines(positioned));
}

function cleanExtractedText(text) {
  return text
    .replace(/\u00AD/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: true,
    });

    let pageText = pageItemsToText(content.items);

    // Some resume PDFs use two narrow columns; split when a large horizontal gap exists.
    pageText = reflowTwoColumnText(content.items, viewport.width, pageText);

    pages.push(pageText);
  }

  const text = cleanExtractedText(pages.join("\n\n"));
  if (!text) {
    throw new Error(
      "No text found in PDF. It may be a scanned image — try a text-based PDF or paste manually."
    );
  }

  return text;
}

/**
 * If items cluster into two columns, rebuild reading order as left column then right.
 * @param {import("pdfjs-dist/types/src/display/api").TextItem[]} items
 * @param {number} pageWidth
 * @param {string} fallback
 */
function reflowTwoColumnText(items, pageWidth, fallback) {
  const positioned = items
    .map(toPositionedItem)
    .filter((item) => item.str && item.str.trim());

  if (positioned.length < 12 || pageWidth <= 0) return fallback;

  const midpoint = pageWidth / 2;
  const left = positioned.filter((item) => item.x + item.width / 2 < midpoint - 8);
  const right = positioned.filter((item) => item.x + item.width / 2 > midpoint + 8);

  if (left.length < 4 || right.length < 4) return fallback;

  const leftWidth = Math.max(...left.map((item) => item.x + item.width));
  const rightStart = Math.min(...right.map((item) => item.x));
  if (rightStart - leftWidth < 24) return fallback;

  const leftText = linesToText(groupItemsIntoLines(left));
  const rightText = linesToText(groupItemsIntoLines(right));
  const merged = [leftText, rightText].filter(Boolean).join("\n\n");

  return merged || fallback;
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

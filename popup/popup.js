import { readResumeFile } from "../lib/pdf-extract.js";

const STORAGE_KEY = "capply_resume";

const els = {
  resume: document.getElementById("resume"),
  jobDescription: document.getElementById("jobDescription"),
  tone: document.getElementById("tone"),
  outputFormat: document.getElementById("outputFormat"),
  autoSend: document.getElementById("autoSend"),
  extraInstructions: document.getElementById("extraInstructions"),
  tailorBtn: document.getElementById("tailorBtn"),
  grabFromPage: document.getElementById("grabFromPage"),
  loadResumeFile: document.getElementById("loadResumeFile"),
  resumeFile: document.getElementById("resumeFile"),
  saveResume: document.getElementById("saveResume"),
  status: document.getElementById("status"),
};

init();

async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    els.resume.value = stored[STORAGE_KEY];
  }

  els.tailorBtn.addEventListener("click", onTailor);
  els.grabFromPage.addEventListener("click", onGrabFromPage);
  els.loadResumeFile.addEventListener("click", () => els.resumeFile.click());
  els.resumeFile.addEventListener("change", onResumeFile);
  els.saveResume.addEventListener("click", onSaveResume);
}

function setStatus(message, type = "") {
  els.status.textContent = message;
  els.status.className = `status${type ? ` ${type}` : ""}`;
}

async function onSaveResume() {
  const text = els.resume.value.trim();
  if (!text) {
    setStatus("Nothing to save.", "error");
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: text });
  setStatus("Resume saved locally.", "success");
}

async function onResumeFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  setStatus(isPdf ? "Extracting text from PDF…" : "Loading file…");
  els.loadResumeFile.disabled = true;

  try {
    const text = await readResumeFile(file);
    els.resume.value = text;
    setStatus(`Loaded ${file.name}`, "success");
  } catch (err) {
    setStatus(err.message || "Could not read file.", "error");
  } finally {
    els.loadResumeFile.disabled = false;
    event.target.value = "";
  }
}

async function onGrabFromPage() {
  setStatus("Grabbing text from page…");
  els.grabFromPage.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: "GRAB_PAGE_TEXT" });
    if (!response?.ok) throw new Error(response?.error || "Failed to grab text");
    els.jobDescription.value = response.text;
    setStatus("Job description grabbed from page.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    els.grabFromPage.disabled = false;
  }
}

async function onTailor() {
  const resume = els.resume.value.trim();
  const jobDescription = els.jobDescription.value.trim();

  if (!resume) {
    setStatus("Add your resume first.", "error");
    els.resume.focus();
    return;
  }
  if (!jobDescription) {
    setStatus("Add a job description.", "error");
    els.jobDescription.focus();
    return;
  }

  els.tailorBtn.disabled = true;
  setStatus("Opening ChatGPT and sending prompt…");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TAILOR_RESUME",
      payload: {
        resume,
        jobDescription,
        autoSend: els.autoSend.checked,
        options: {
          tone: els.tone.value,
          outputFormat: els.outputFormat.value,
          emphasize: ["keywords", "achievements", "ats", "skills", "summary"],
          extraInstructions: els.extraInstructions.value.trim(),
        },
      },
    });

    if (!response?.ok) throw new Error(response?.error || "Something went wrong");

    await chrome.storage.local.set({ [STORAGE_KEY]: resume });
    setStatus("Prompt sent! Check the ChatGPT tab.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    els.tailorBtn.disabled = false;
  }
}

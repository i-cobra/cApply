import {
  emptyResume,
  normalizeResume,
  parseResumeText,
  serializeResume,
} from "../lib/resume-structure.js";
import { generateResumePdf } from "../lib/resume-pdf.js";

/** @typedef {import("../lib/resume-structure.js").ResumeStructure} ResumeStructure */

/**
 * @param {HTMLElement} container
 * @param {{ onChange?: () => void }} options
 */
export function createResumeEditor(container, options = {}) {
  /** @type {Record<string, boolean>} */
  const openSections = {
    contact: true,
    summary: true,
    experience: true,
    education: false,
    skills: false,
    other: false,
  };

  /** @type {ResumeStructure} */
  let data = emptyResume();
  let mode = "structured";
  let previewUrl = null;

  const els = {
    toolbar: document.createElement("div"),
    structured: document.createElement("div"),
    preview: document.createElement("div"),
    previewFrame: document.createElement("iframe"),
    btnStructured: document.createElement("button"),
    btnPreview: document.createElement("button"),
  };

  container.innerHTML = "";
  container.classList.add("resume-editor-root");

  els.toolbar.className = "resume-view-toggle";
  els.btnStructured.type = "button";
  els.btnStructured.className = "view-btn active";
  els.btnStructured.textContent = "Structured";
  els.btnPreview.type = "button";
  els.btnPreview.className = "view-btn";
  els.btnPreview.textContent = "Preview as PDF";

  els.structured.className = "resume-structured";
  els.preview.className = "resume-preview";
  els.previewFrame.className = "resume-preview-frame";
  els.previewFrame.title = "Resume PDF preview";

  els.preview.append(els.previewFrame);

  els.toolbar.append(els.btnStructured, els.btnPreview);
  container.append(els.toolbar, els.structured, els.preview);
  els.preview.hidden = true;

  els.btnStructured.addEventListener("click", () => setMode("structured"));
  els.btnPreview.addEventListener("click", () => setMode("preview"));

  function notifyChange() {
    options.onChange?.();
  }

  function revokePreviewUrl() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  function refreshPreview() {
    revokePreviewUrl();
    const resume = readStructured();
    const hasContent = Boolean(serializeResume(resume).trim());

    if (!hasContent) {
      els.previewFrame.removeAttribute("src");
      return;
    }

    const blob = generateResumePdf(resume);
    previewUrl = URL.createObjectURL(blob);
    els.previewFrame.src = previewUrl;
  }

  function setMode(next) {
    if (next === mode) {
      if (next === "preview") refreshPreview();
      return;
    }

    if (next === "structured" && mode === "preview") {
      // keep structured data as source of truth
    }

    mode = next;
    els.btnStructured.classList.toggle("active", mode === "structured");
    els.btnPreview.classList.toggle("active", mode === "preview");
    els.structured.hidden = mode !== "structured";
    els.preview.hidden = mode !== "preview";
    container.classList.toggle("preview-mode", mode === "preview");

    if (mode === "preview") refreshPreview();
    notifyChange();
  }

  function field(label, value, onInput, placeholder = "") {
    const wrap = document.createElement("label");
    wrap.className = "resume-field";
    wrap.innerHTML = `<span>${label}</span>`;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onInput(input.value));
    wrap.appendChild(input);
    return wrap;
  }

  function textArea(label, value, onInput, rows = 3) {
    const wrap = document.createElement("label");
    wrap.className = "resume-field";
    wrap.innerHTML = `<span>${label}</span>`;
    const area = document.createElement("textarea");
    area.rows = rows;
    area.value = value;
    area.addEventListener("input", () => onInput(area.value));
    wrap.appendChild(area);
    return wrap;
  }

  function truncate(text, max = 52) {
    const t = (text || "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  function hasExperienceContent(job) {
    return Boolean(
      job.title?.trim() ||
        job.company?.trim() ||
        job.dates?.trim() ||
        job.bullets?.some((b) => b.trim())
    );
  }

  function hasEducationContent(edu) {
    return Boolean(
      edu.school?.trim() ||
        edu.degree?.trim() ||
        edu.dates?.trim() ||
        edu.details?.trim()
    );
  }

  function buildSectionSummary(id) {
    switch (id) {
      case "contact":
        return (
          truncate(data.contact.name) ||
          truncate(data.contact.email) ||
          "Add contact info"
        );
      case "summary":
        return truncate(data.summary) || "No summary yet";
      case "skills":
        return truncate(data.skills) || "No skills yet";
      case "experience": {
        const jobs = data.experience.filter(hasExperienceContent);
        if (!jobs.length) return "No roles yet";
        const first = entrySummary(jobs[0].title, jobs[0].company, jobs[0].dates);
        return jobs.length > 1 ? `${jobs.length} roles · ${truncate(first, 36)}` : truncate(first);
      }
      case "education": {
        const items = data.education.filter(hasEducationContent);
        if (!items.length) return "No education yet";
        return items.length > 1
          ? `${items.length} entries`
          : truncate(entrySummary(items[0].degree, items[0].school, items[0].dates));
      }
      case "other":
        return truncate(data.other) || "Projects, certs, etc.";
      default:
        return "";
    }
  }

  function collapsibleSection(id, title, bodyEl, defaultOpen = true) {
    const details = document.createElement("details");
    details.className = "resume-block collapsible";
    details.open = openSections[id] ?? defaultOpen;
    details.classList.toggle("is-open", details.open);

    const summary = document.createElement("summary");
    summary.className = "resume-block-summary";

    const titleEl = document.createElement("span");
    titleEl.className = "summary-title";
    titleEl.textContent = title;

    const metaEl = document.createElement("span");
    metaEl.className = "summary-meta";
    metaEl.textContent = buildSectionSummary(id);

    const chevron = document.createElement("span");
    chevron.className = "summary-chevron";
    chevron.setAttribute("aria-hidden", "true");

    const summaryInner = document.createElement("div");
    summaryInner.className = "resume-block-summary-inner";
    summaryInner.append(titleEl, metaEl, chevron);

    summary.appendChild(summaryInner);

    details.addEventListener("toggle", () => {
      openSections[id] = details.open;
      details.classList.toggle("is-open", details.open);
    });

    const body = document.createElement("div");
    body.className = "resume-block-body";
    body.appendChild(bodyEl);
    details.append(summary, body);
    return details;
  }

  function collapsibleEntry(id, summaryText, bodyEl, defaultOpen = false) {
    const details = document.createElement("details");
    details.className = "entry-card collapsible";
    details.open = openSections[id] ?? defaultOpen;
    details.classList.toggle("is-open", details.open);

    const summary = document.createElement("summary");
    summary.className = "entry-card-summary";

    const titleEl = document.createElement("span");
    titleEl.className = "entry-summary-title";
    titleEl.textContent = summaryText || "New entry";

    const chevron = document.createElement("span");
    chevron.className = "entry-summary-chevron";
    chevron.setAttribute("aria-hidden", "true");

    const summaryInner = document.createElement("div");
    summaryInner.className = "entry-card-summary-inner";
    summaryInner.append(titleEl, chevron);

    summary.appendChild(summaryInner);

    details.addEventListener("toggle", () => {
      openSections[id] = details.open;
      details.classList.toggle("is-open", details.open);
    });

    const body = document.createElement("div");
    body.className = "entry-card-body";
    body.appendChild(bodyEl);
    details.append(summary, body);
    return details;
  }

  function entrySummary(title, company, dates) {
    const parts = [];
    const t = title?.trim() || "";
    const c = company?.trim() || "";
    const d = dates?.trim() || "";

    if (t) parts.push(t);
    if (c && !t.toLowerCase().includes(c.toLowerCase())) parts.push(c);
    if (d && !t.includes(d)) parts.push(d);

    return parts.join(" · ") || "New entry";
  }

  function addBtn(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderStructured() {
    els.structured.innerHTML = "";

    const contactGrid = document.createElement("div");
    contactGrid.className = "contact-grid";
    contactGrid.append(
      field("Name", data.contact.name, (v) => {
        data.contact.name = v;
        notifyChange();
      }, "Jane Doe"),
      field("Email", data.contact.email, (v) => {
        data.contact.email = v;
        notifyChange();
      }, "jane@email.com"),
      field("Phone", data.contact.phone, (v) => {
        data.contact.phone = v;
        notifyChange();
      }, "+1 555 0100"),
      field("Location", data.contact.location, (v) => {
        data.contact.location = v;
        notifyChange();
      }, "City, Country"),
      field("Links", data.contact.links, (v) => {
        data.contact.links = v;
        notifyChange();
      }, "LinkedIn, GitHub, portfolio")
    );
    els.structured.appendChild(collapsibleSection("contact", "Contact", contactGrid));

    els.structured.appendChild(
      collapsibleSection(
        "summary",
        "Summary",
        textArea("", data.summary, (v) => {
          data.summary = v;
          notifyChange();
        }, 4)
      )
    );

    els.structured.appendChild(
      collapsibleSection(
        "skills",
        "Skills",
        textArea("", data.skills, (v) => {
          data.skills = v;
          notifyChange();
        }, 3),
        false
      )
    );

    const expWrap = document.createElement("div");
    expWrap.className = "entry-list";

    const renderExperience = () => {
      expWrap.innerHTML = "";
      const visibleJobs = data.experience.filter(hasExperienceContent);

      for (const job of visibleJobs) {
        const cardBody = document.createElement("div");

        const row = document.createElement("div");
        row.className = "entry-row";
        row.append(
          field("Title", job.title, (v) => {
            job.title = v;
            notifyChange();
          }, "Senior Engineer"),
          field("Company", job.company, (v) => {
            job.company = v;
            notifyChange();
          }, "Acme Inc."),
          field("Dates", job.dates, (v) => {
            job.dates = v;
            notifyChange();
          }, "2021 – Present")
        );
        cardBody.appendChild(row);

        const bulletsLabel = document.createElement("span");
        bulletsLabel.className = "bullets-label";
        bulletsLabel.textContent = "Bullets";
        cardBody.appendChild(bulletsLabel);

        const bullets = document.createElement("div");
        bullets.className = "bullets-list";
        for (let i = 0; i < job.bullets.length; i++) {
          const line = document.createElement("div");
          line.className = "bullet-row";
          const area = document.createElement("textarea");
          area.rows = 2;
          area.value = job.bullets[i];
          area.placeholder = "Achievement or responsibility…";
          area.addEventListener("input", () => {
            job.bullets[i] = area.value;
            notifyChange();
          });
          const remove = addBtn("Remove", () => {
            job.bullets.splice(i, 1);
            if (!job.bullets.length) job.bullets.push("");
            renderExperience();
            notifyChange();
          });
          line.append(area, remove);
          bullets.appendChild(line);
        }
        cardBody.appendChild(bullets);
        cardBody.appendChild(
          addBtn("+ Add bullet", () => {
            job.bullets.push("");
            renderExperience();
            notifyChange();
          })
        );
        cardBody.appendChild(
          addBtn("Remove role", () => {
            data.experience = data.experience.filter((e) => e.id !== job.id);
            renderExperience();
            notifyChange();
          })
        );

        expWrap.appendChild(
          collapsibleEntry(
            `exp-${job.id}`,
            entrySummary(job.title, job.company, job.dates),
            cardBody,
            openSections[`exp-${job.id}`] ?? visibleJobs.length === 1
          )
        );
      }
      expWrap.appendChild(
        addBtn("+ Add experience", () => {
          data.experience.push({
            id: `r-${Date.now()}`,
            title: "",
            company: "",
            dates: "",
            bullets: [""],
          });
          renderExperience();
          notifyChange();
        })
      );
    };
    renderExperience();
    els.structured.appendChild(collapsibleSection("experience", "Experience", expWrap));

    const eduWrap = document.createElement("div");
    eduWrap.className = "entry-list";
    const renderEducation = () => {
      eduWrap.innerHTML = "";
      const visibleEdu = data.education.filter(hasEducationContent);

      for (const edu of visibleEdu) {
        const cardBody = document.createElement("div");
        const row = document.createElement("div");
        row.className = "entry-row";
        row.append(
          field("Degree", edu.degree, (v) => {
            edu.degree = v;
            notifyChange();
          }, "B.S. Computer Science"),
          field("School", edu.school, (v) => {
            edu.school = v;
            notifyChange();
          }, "University"),
          field("Dates", edu.dates, (v) => {
            edu.dates = v;
            notifyChange();
          }, "2016 – 2020")
        );
        cardBody.appendChild(row);
        cardBody.appendChild(
          textArea("Details", edu.details, (v) => {
            edu.details = v;
            notifyChange();
          }, 2)
        );
        cardBody.appendChild(
          addBtn("Remove education", () => {
            data.education = data.education.filter((e) => e.id !== edu.id);
            renderEducation();
            notifyChange();
          })
        );

        eduWrap.appendChild(
          collapsibleEntry(
            `edu-${edu.id}`,
            entrySummary(edu.degree, edu.school, edu.dates),
            cardBody,
            openSections[`edu-${edu.id}`] ?? visibleEdu.length === 1
          )
        );
      }
      eduWrap.appendChild(
        addBtn("+ Add education", () => {
          data.education.push({
            id: `r-${Date.now()}`,
            school: "",
            degree: "",
            dates: "",
            details: "",
          });
          renderEducation();
          notifyChange();
        })
      );
    };
    renderEducation();
    els.structured.appendChild(collapsibleSection("education", "Education", eduWrap, false));

    els.structured.appendChild(
      collapsibleSection(
        "other",
        "Other",
        textArea("", data.other, (v) => {
          data.other = v;
          notifyChange();
        }, 3),
        false
      )
    );
  }

  function readStructured() {
    return normalizeResume(data);
  }

  return {
    setText(text, options = {}) {
      data = parseResumeText(text);
      renderStructured();
      if (mode === "preview") refreshPreview();
      if (!options.silent) notifyChange();
    },
    setStructured(structured, options = {}) {
      data = normalizeResume(structured);
      renderStructured();
      if (mode === "preview") refreshPreview();
      if (!options.silent) notifyChange();
    },
    getText() {
      return serializeResume(readStructured());
    },
    getStructured() {
      return readStructured();
    },
    getMode() {
      return mode;
    },
    destroy() {
      revokePreviewUrl();
    },
  };
}

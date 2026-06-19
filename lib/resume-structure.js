/**
 * @typedef {{ name: string, email: string, phone: string, location: string, links: string }} Contact
 * @typedef {{ id: string, title: string, company: string, location: string, dates: string, bullets: string[] }} ExperienceEntry
 * @typedef {{ id: string, school: string, degree: string, dates: string }} EducationEntry
 * @typedef {{
 *   contact: Contact,
 *   summary: string,
 *   experience: ExperienceEntry[],
 *   education: EducationEntry[],
 *   skills: string,
 *   other: string,
 * }} ResumeStructure
 */

const SECTION_TITLES = {
  summary: ["summary", "professional summary", "profile", "about me", "objective"],
  experience: [
    "experience",
    "work experience",
    "employment",
    "professional experience",
    "work history",
  ],
  education: ["education", "academic background", "academics"],
  skills: ["skills", "technical skills", "core competencies", "technologies"],
  other: ["projects", "certifications", "awards", "languages", "interests"],
};

function uid() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyContact() {
  return { name: "", email: "", phone: "", location: "", links: "" };
}

function emptyExperience() {
  return { id: uid(), title: "", company: "", location: "", dates: "", bullets: [""] };
}

function emptyEducation() {
  return { id: uid(), school: "", degree: "", dates: "" };
}

/** @returns {ResumeStructure} */
export function emptyResume() {
  return {
    contact: emptyContact(),
    summary: "",
    experience: [],
    education: [],
    skills: "",
    other: "",
  };
}

function normalizeHeader(line) {
  return line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/[:\-–—]+$/, "")
    .trim()
    .toLowerCase();
}

function matchSection(header) {
  for (const [key, titles] of Object.entries(SECTION_TITLES)) {
    if (titles.includes(header)) return key;
  }
  return null;
}

function extractContactLine(line, contact) {
  const email = line.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (email && !contact.email) contact.email = email[0];

  const phone = line.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phone && !contact.phone) contact.phone = phone[0].trim();

  const url = line.match(/https?:\/\/\S+|linkedin\.com\/\S+|github\.com\/\S+/gi);
  if (url?.length && !contact.links) contact.links = url.join(" | ");
}

function looksLikeDates(text) {
  if (!text?.trim()) return false;
  return /(\b(?:19|20)\d{2}\b|present|current|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}[/.-]\d{2,4})/i.test(
    text
  );
}

function splitCompanyAndLocation(text) {
  if (!text?.trim()) return { company: "", location: "" };

  const commaMatch = text.match(/^(.+?),\s*([A-Za-z .'-]+(?:,\s*[A-Z]{2})?)$/);
  if (commaMatch && commaMatch[1].length > 2 && commaMatch[2].length > 2) {
    return { company: commaMatch[1].trim(), location: commaMatch[2].trim() };
  }

  return { company: text.trim(), location: "" };
}

function parseTitleLine(line) {
  const trimmed = line.trim();
  const parts = trimmed.split(/\s*[|•–—]\s*|\s+at\s+/i).map((p) => p.trim()).filter(Boolean);
  const empty = { title: "", company: "", location: "", dates: "" };

  if (parts.length >= 4) {
    return {
      title: parts[0],
      company: parts[1],
      location: parts[2],
      dates: parts.slice(3).join(" | "),
    };
  }

  if (parts.length === 3) {
    if (looksLikeDates(parts[2])) {
      return { ...empty, title: parts[0], company: parts[1], dates: parts[2] };
    }
    if (looksLikeDates(parts[1])) {
      return { ...empty, title: parts[0], location: parts[2], dates: parts[1] };
    }
    return { ...empty, title: parts[0], company: parts[1], location: parts[2] };
  }

  if (parts.length === 2) {
    const datesMatch = parts[1].match(
      /(\b(?:19|20)\d{2}\b.*?(?:\b(?:19|20)\d{2}\b|present|current))/i
    );
    if (datesMatch) {
      const companyPart = parts[1].replace(datesMatch[0], "").trim().replace(/[,|•–—]+$/, "");
      const { company, location } = splitCompanyAndLocation(companyPart);
      return {
        ...empty,
        title: parts[0],
        company,
        location,
        dates: datesMatch[0].trim(),
      };
    }
    const { company, location } = splitCompanyAndLocation(parts[1]);
    return { ...empty, title: parts[0], company, location };
  }

  const trailingDates = trimmed.match(
    /^(.+?)\s+((?:\d{1,2}[/.-]\d{2,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\b(?:19|20)\d{2})\b.*?(?:\b(?:19|20)\d{2}\b|present|current))\s*$/i
  );

  if (trailingDates) {
    return {
      ...empty,
      title: trailingDates[1].trim(),
      dates: trailingDates[2].trim(),
    };
  }

  return { ...empty, title: trimmed };
}

function isBullet(line) {
  return /^[\s]*([•\-*–—]|\d+[.)])\s+/.test(line);
}

function stripBullet(line) {
  return line.replace(/^[\s]*([•\-*–—]|\d+[.)])\s+/, "").trim();
}

function parseExperienceBlock(text) {
  const chunks = text.split(/\n\s*\n/).filter((c) => c.trim());
  const entries = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const entry = emptyExperience();
    const first = lines[0];
    const parsed = parseTitleLine(first);

    if (isBullet(first)) {
      entry.bullets = lines.map(stripBullet);
    } else {
      Object.assign(entry, parsed);
      let lineIndex = 1;

      if (lines.length > 1 && !isBullet(lines[1])) {
        const second = lines[1].trim();
        if (!parsed.location && !looksLikeDates(second)) {
          entry.location = second.replace(/^[,|•–—\s]+|[,|•–—\s]+$/g, "");
          lineIndex = 2;
        } else if (!parsed.dates) {
          const meta = parseTitleLine(second);
          if (meta.company && !entry.company) entry.company = meta.company;
          if (meta.location) entry.location = meta.location;
          if (meta.dates) entry.dates = meta.dates;
          if (meta.company || meta.location || meta.dates) lineIndex = 2;
        }
      }

      const bullets = lines.slice(lineIndex).map((l) => (isBullet(l) ? stripBullet(l) : l));
      entry.bullets = bullets.length ? bullets : [""];
    }

    entries.push(entry);
  }

  return entries.length ? entries : [emptyExperience()];
}

function parseEducationBlock(text) {
  const chunks = text.split(/\n\s*\n/).filter((c) => c.trim());
  const entries = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const entry = emptyEducation();
    const parsed = parseTitleLine(lines[0]);
    entry.school = parsed.company || parsed.title;
    entry.degree = parsed.title === entry.school ? "" : parsed.title;
    entry.dates = parsed.dates;
    entries.push(entry);
  }

  return entries;
}

/** @param {string} text @returns {ResumeStructure} */
export function parseResumeText(text) {
  if (!text?.trim()) return emptyResume();

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const resume = emptyResume();
  let currentSection = null;
  let sectionLines = [];
  let headerIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const header = normalizeHeader(raw);
    const section = matchSection(header);

    if (section && raw.trim().length < 60) {
      headerIndex = Math.min(headerIndex, i);
      break;
    }
  }

  const contactLines = lines.slice(0, headerIndex).map((l) => l.trim()).filter(Boolean);
  if (contactLines.length) {
    resume.contact.name = contactLines[0];
    for (let i = 1; i < contactLines.length; i++) {
      extractContactLine(contactLines[i], resume.contact);
      if (!resume.contact.location && !contactLines[i].includes("@") && i === 1) {
        resume.contact.location = contactLines[i];
      }
    }
    if (!resume.contact.location && contactLines[1] && !contactLines[1].includes("@")) {
      resume.contact.location = contactLines[1];
    }
  }

  const flush = () => {
    const content = sectionLines.join("\n").trim();
    if (!currentSection || !content) return;

    if (currentSection === "experience") {
      resume.experience = parseExperienceBlock(content);
    } else if (currentSection === "education") {
      resume.education = parseEducationBlock(content);
    } else if (currentSection === "summary") {
      resume.summary = content;
    } else if (currentSection === "skills") {
      resume.skills = content;
    } else {
      resume.other = resume.other ? `${resume.other}\n\n${content}` : content;
    }
    sectionLines = [];
  };

  for (let i = headerIndex; i < lines.length; i++) {
    const raw = lines[i];
    const header = normalizeHeader(raw);
    const section = matchSection(header);

    if (section && raw.trim().length < 60) {
      flush();
      currentSection = section === "other" ? "other" : section;
      continue;
    }

    if (currentSection) sectionLines.push(raw);
  }
  flush();

  if (
    !resume.summary &&
    !resume.experience.length &&
    !resume.education.length &&
    !resume.skills &&
    !resume.other &&
    text.trim()
  ) {
    resume.other = text.trim();
  }

  return resume;
}

/** @param {ResumeStructure} resume @returns {string} */
export function serializeResume(resume) {
  const lines = [];
  const { contact } = resume;

  if (contact.name) lines.push(contact.name);
  const meta = [contact.email, contact.phone, contact.location].filter(Boolean);
  if (meta.length) lines.push(meta.join(" | "));
  if (contact.links) lines.push(contact.links);

  if (resume.summary.trim()) {
    lines.push("", "SUMMARY", resume.summary.trim());
  }

  if (resume.skills.trim()) {
    lines.push("", "SKILLS", resume.skills.trim());
  }

  if (resume.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const job of resume.experience) {
      if (!job.title && !job.company && !job.bullets.some(Boolean)) continue;
      const header = [job.title, job.company, job.location, job.dates]
        .filter(Boolean)
        .join(" | ");
      if (header) lines.push(header);
      for (const bullet of job.bullets) {
        if (bullet.trim()) lines.push(`• ${bullet.trim()}`);
      }
      lines.push("");
    }
  }

  if (resume.education.length) {
    lines.push("EDUCATION");
    for (const edu of resume.education) {
      if (!edu.school && !edu.degree) continue;
      const header = [edu.degree, edu.school, edu.dates].filter(Boolean).join(" | ");
      if (header) lines.push(header);
      lines.push("");
    }
  }

  if (resume.other.trim()) {
    lines.push("", resume.other.trim());
  }

  return lines
    .join("\n")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
/**
 * Strip a leading bullet glyph while preserving an opening ** bold marker.
 * @param {string} text
 */
function stripLeadingBullet(text) {
  return text
    .replace(/^[\s•\-–—]+/, "")
    .replace(/^\*(?!\*)[\s]*/, "")
    .replace(/^[\s]*\d+[.)]\s*/, "")
    .trim();
}

function coerceBullets(value) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .map((item) => stripLeadingBullet(item))
      .filter(Boolean);
    return items.length ? items : [""];
  }

  if (typeof value === "string" && value.trim()) {
    const items = value
      .split(/\n+/)
      .map((line) => stripLeadingBullet(line))
      .filter(Boolean);
    return items.length ? items : [""];
  }

  return [""];
}

/**
 * @param {unknown} entry
 * @returns {import("./resume-structure.js").ExperienceEntry}
 */
function coerceExperienceEntry(entry) {
  const base = emptyExperience();
  if (!entry || typeof entry !== "object") return base;

  const e = /** @type {Record<string, unknown>} */ (entry);
  let title = String(
    e.title || e.role || e.position || e.jobTitle || e.job_title || ""
  ).trim();
  let company = String(
    e.company || e.employer || e.organization || e.company_name || ""
  ).trim();
  let location = String(
    e.location ||
      e.company_location ||
      e.companyLocation ||
      e.work_location ||
      e.workLocation ||
      e.city ||
      ""
  ).trim();
  let dates = String(
    e.dates || e.date || e.period || e.duration || e.date_range || e.years || ""
  ).trim();

  if (title && (!company || !dates) && /[|•–—]|\s+at\s+/i.test(title)) {
    const parsed = parseTitleLine(title);
    title = parsed.title || title;
    company = company || parsed.company || "";
    location = location || parsed.location || "";
    dates = dates || parsed.dates || "";
  }

  if (!location && company.includes(",")) {
    const split = splitCompanyAndLocation(company);
    if (split.location) {
      company = split.company;
      location = split.location;
    }
  }

  const bulletSource =
    e.bullets ??
    e.highlights ??
    e.responsibilities ??
    e.achievements ??
    e.description ??
    e.details ??
    e.items;

  return {
    id: typeof e.id === "string" ? e.id : uid(),
    title,
    company,
    location,
    dates,
    bullets: coerceBullets(bulletSource),
  };
}

/**
 * @param {unknown} entry
 * @returns {import("./resume-structure.js").EducationEntry}
 */
function coerceEducationEntry(entry) {
  const base = emptyEducation();
  if (!entry || typeof entry !== "object") return base;

  const e = /** @type {Record<string, unknown>} */ (entry);
  let school = String(
    e.school || e.institution || e.university || e.college || ""
  ).trim();
  let degree = String(
    e.degree || e.qualification || e.program || e.major || ""
  ).trim();
  let dates = String(e.dates || e.date || e.period || e.year || e.years || "").trim();

  if (!school && degree && /[|•–—]/.test(degree)) {
    const parsed = parseTitleLine(degree);
    degree = parsed.title || degree;
    school = parsed.company || school;
    dates = dates || parsed.dates || "";
  }

  return {
    id: typeof e.id === "string" ? e.id : uid(),
    school,
    degree,
    dates,
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function coerceSkills(value) {
  let skills = "";
  if (typeof value === "string") skills = value.trim();
  else if (Array.isArray(value)) {
    skills = value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join(", ");
  } else if (value && typeof value === "object") {
    skills = Object.values(value)
      .flatMap((item) => (Array.isArray(item) ? item : [item]))
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join(", ");
  }

  if (/[\r\n]/.test(skills)) {
    return skills
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  return skills
    .split(/[,;•|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * @param {unknown} data
 * @returns {Partial<ResumeStructure>}
 */
function coerceResumeInput(data) {
  if (!data || typeof data !== "object") return {};

  const r = /** @type {Record<string, unknown>} */ (data);
  const contactRaw =
    r.contact && typeof r.contact === "object"
      ? /** @type {Record<string, unknown>} */ (r.contact)
      : {};

  const linkParts = [
    contactRaw.links,
    contactRaw.linkedin,
    contactRaw.github,
    contactRaw.portfolio,
    contactRaw.website,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const experienceRaw =
    r.experience || r.work_experience || r.workExperience || r.employment || r.jobs;

  const educationRaw = r.education || r.educations || r.academics;

  return {
    contact: {
      name: String(
        contactRaw.name || contactRaw.fullName || contactRaw.full_name || r.name || ""
      ).trim(),
      email: String(contactRaw.email || r.email || "").trim(),
      phone: String(contactRaw.phone || contactRaw.mobile || r.phone || "").trim(),
      location: String(
        contactRaw.location || contactRaw.address || contactRaw.city || r.location || ""
      ).trim(),
      links: linkParts.join(" | "),
    },
    summary: String(
      r.summary ||
        r.professional_summary ||
        r.professionalSummary ||
        r.profile ||
        r.objective ||
        ""
    ).trim(),
    experience: Array.isArray(experienceRaw)
      ? experienceRaw.map(coerceExperienceEntry)
      : undefined,
    education: Array.isArray(educationRaw)
      ? educationRaw.map(coerceEducationEntry)
      : undefined,
    skills: coerceSkills(r.skills || r.technical_skills || r.technicalSkills),
    other: String(r.other || r.projects || r.certifications || "").trim(),
  };
}

/** @param {ResumeStructure} resume */
export function resumeToLlmShape(resume) {
  return {
    contact: { ...resume.contact },
    summary: resume.summary,
    experience: resume.experience.map(({ title, company, location, dates, bullets }) => ({
      title,
      company,
      location,
      dates,
      bullets,
    })),
    education: resume.education.map(({ school, degree, dates }) => ({
      school,
      degree,
      dates,
    })),
    skills: resume.skills,
    other: resume.other,
  };
}

/** @param {unknown} data @returns {ResumeStructure} */
export function normalizeResume(data) {
  const coerced = coerceResumeInput(data);
  const base = emptyResume();
  if (!data || typeof data !== "object") return base;

  const r = /** @type {Partial<ResumeStructure>} */ ({ ...coerced });
  return {
    contact: { ...base.contact, ...(r.contact || {}) },
    summary: r.summary || "",
    experience: Array.isArray(r.experience) && r.experience.length
      ? r.experience.map((e) => coerceExperienceEntry(e))
      : [],
    education: Array.isArray(r.education) && r.education.length
      ? r.education.map((e) => coerceEducationEntry(e))
      : [],
    skills: r.skills || "",
    other: r.other || "",
  };
}

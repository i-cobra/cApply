/**
 * Injected into job posting pages. Sets window.__cApplyGrabbedText.
 */
(function () {
  const SELECTORS = [
    // Comeet
    ".position-description",
    ".position-info .description",
    "[class*='position-description']",
    "[class*='PositionDescription']",
    // LinkedIn
    "[data-automation='jobDescription']",
    "jobs-description__content",
    ".jobs-box__html-content",
    // SmartRecruiters
    "[class*='job-description' i]",
    "[class*='JobDescription' i]",
    "spl-job-description",
    ".job-sections",
    // Indeed
    "#job-description",
    "#jobDescriptionText",
    ".jobsearch-JobComponent-description",
    // Greenhouse (legacy + modern job-boards)
    "#content .content",
    "#app .content",
    "[data-testid='job-description']",
    ".job-post-content",
    ".job__description",
    "[class*='JobDescription']",
    // Lever
    ".posting-page",
    ".section.page-centered",
    // Workday / generic ATS
    "[data-automation-id='jobPostingDescription']",
    "[class*='jobPostingDescription']",
    // Avature
    ".sectioncontent",
    ".jobdescription",
    "#jobdetails",
    "[class*='JobDetail']",
    "[class*='jobDetail']",
    // Generic
    "#job-details",
    ".job-description",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "article",
    "main",
  ];

  function visibleText(el) {
    if (!el) return "";
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return "";
    return el.innerText?.trim() || "";
  }

  function pickBest(selectors) {
    let best = "";

    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        const text = visibleText(el);
        if (text.length > best.length && text.length > 200) {
          best = text;
        }
      }
    }

    return best;
  }

  let text = pickBest(SELECTORS);

  const greenhouseRemix = parseGreenhouseRemixJob(
    collectEmbeddedJsonText() || document.documentElement.innerHTML
  );
  if (greenhouseRemix?.descriptionText?.length > (text?.length || 0)) {
    text = greenhouseRemix.descriptionText;
  }

  if (!text) {
    const main = document.querySelector("main") || document.body;
    text = visibleText(main);
  }

  window.__cApplyGrabbedText = text.slice(0, 15000);

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function queryFirstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const datetime = el.getAttribute?.("datetime")?.trim();
      const text = el.textContent?.trim();
      if (datetime) return datetime;
      if (text) return text;
    }
    return "";
  }

  function collectEmbeddedJsonText() {
    const chunks = [];
    document.querySelectorAll("script").forEach((script) => {
      const content = script.textContent?.trim();
      if (content) chunks.push(content);
    });
    return chunks.join("\n");
  }

  function extractRemixContextJson(text) {
    const marker = "window.__remixContext";
    const idx = text.indexOf(marker);
    if (idx === -1) return null;

    const eq = text.indexOf("=", idx);
    if (eq === -1) return null;

    let i = eq + 1;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== "{") return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }

    return null;
  }

  function htmlToPlainText(html) {
    if (!html?.trim()) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.innerText || div.textContent || "").replace(/\s+\n/g, "\n").trim();
  }

  function parseGreenhouseRemixJob(pageText) {
    const jsonText = extractRemixContextJson(pageText);
    if (!jsonText) return null;

    try {
      const ctx = JSON.parse(jsonText);
      const loader = ctx?.state?.loaderData;
      if (!loader) return null;

      let jobPost = null;
      for (const value of Object.values(loader)) {
        if (value?.jobPost) {
          jobPost = value.jobPost;
          break;
        }
      }
      if (!jobPost) return null;

      const htmlParts = [jobPost.content, jobPost.introduction].filter(
        (part) => typeof part === "string" && part.trim()
      );

      return {
        companyName: String(jobPost.company_name || "").trim(),
        position: String(jobPost.title || "").trim(),
        jobPosted: String(jobPost.published_at || "").trim(),
        jobCreated: String(jobPost.created_at || "").trim(),
        jobModified: String(jobPost.updated_at || "").trim(),
        descriptionText: htmlToPlainText(htmlParts.join("\n\n")),
      };
    } catch {
      return null;
    }
  }

  function extractEmbeddedJsonJobDates(text) {
    let jobPosted = "";
    let jobCreated = "";
    let jobModified = "";
    if (!text) {
      return { jobPosted, jobCreated, jobModified };
    }

    const published =
      text.match(/"published_at"\s*:\s*"([^"]+)"/) ||
      text.match(/"first_published_at"\s*:\s*"([^"]+)"/) ||
      text.match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (published) jobPosted = published[1];

    const created = text.match(/"created_at"\s*:\s*"([^"]+)"/);
    if (created) jobCreated = created[1];

    const modified =
      text.match(/"updated_at"\s*:\s*"([^"]+)"/) ||
      text.match(/"last_updated_at"\s*:\s*"([^"]+)"/);
    if (modified) jobModified = modified[1];

    return { jobPosted, jobCreated, jobModified };
  }

  function extractJobDates(pageText, host) {
    let jobPosted = "";
    let jobCreated = "";
    let jobModified = "";

    const embeddedJson = collectEmbeddedJsonText();
    const embeddedDates = extractEmbeddedJsonJobDates(embeddedJson);
    jobPosted = embeddedDates.jobPosted;
    jobCreated = embeddedDates.jobCreated;
    jobModified = embeddedDates.jobModified;

    if (host.includes("greenhouse.io") && !jobPosted) {
      const ghDates = extractEmbeddedJsonJobDates(document.documentElement.innerHTML);
      jobPosted = ghDates.jobPosted;
      jobCreated = jobCreated || ghDates.jobCreated;
      jobModified = jobModified || ghDates.jobModified;
    }

    if (host.includes("greenhouse.io")) {
      const remix = parseGreenhouseRemixJob(
        embeddedJson || document.documentElement.innerHTML
      );
      if (remix) {
        jobPosted = jobPosted || remix.jobPosted;
        jobCreated = jobCreated || remix.jobCreated;
        jobModified = jobModified || remix.jobModified;
      }
    }

    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : data["@graph"] || [data];
        for (const item of Array.isArray(items) ? items : [items]) {
          if (!item) continue;
          const type = item["@type"];
          const types = Array.isArray(type) ? type : type ? [type] : [];
          if (!types.some((entry) => /JobPosting/i.test(String(entry)))) continue;
          if (item.datePosted && !jobPosted) jobPosted = String(item.datePosted);
          if (item.dateCreated && !jobCreated) jobCreated = String(item.dateCreated);
          if (item.dateModified && !jobModified) jobModified = String(item.dateModified);
        }
      } catch {
        // ignore invalid JSON-LD
      }
    });

    jobPosted =
      jobPosted ||
      queryFirstText([
        'time[itemprop="datePosted"]',
        'meta[itemprop="datePosted"]',
        ".jobs-unified-top-card__posted-date",
        ".job-details-jobs-unified-top-card__posted-date",
        '[class*="posted-date" i]',
        '[class*="PostedDate" i]',
        '[data-testid="job-posted-date"]',
        ".posted-date",
        ".posting-date",
        ".job-posted-date",
        "#jobDescriptionDate",
        ".jobsearch-JobMetadataFooter",
        "spl-job-posted-date",
      ]);

    jobModified =
      jobModified ||
      queryFirstText([
        'time[itemprop="dateModified"]',
        'meta[itemprop="dateModified"]',
        '[class*="updated-date" i]',
        '[class*="last-updated" i]',
        '[class*="LastUpdated" i]',
      ]);

    jobCreated =
      jobCreated ||
      queryFirstText(['time[itemprop="dateCreated"]', 'meta[itemprop="dateCreated"]']);

    if (host.includes("linkedin.com") && !jobPosted) {
      const liMeta = document.querySelector(
        ".job-details-jobs-unified-top-card__primary-description, .jobs-unified-top-card__primary-description"
      );
      const liText = liMeta?.textContent || "";
      const liPosted = liText.match(/\b(?:reposted|posted)\s+(.+?)(?:\s*·|$)/i);
      if (liPosted) jobPosted = liPosted[1].trim();
    }

    if (host.includes("greenhouse.io") && !jobPosted) {
      jobPosted = queryFirstText([
        ".posted-date",
        "#header .date",
        '[class*="published" i]',
      ]);
    }

    if (host.includes("lever.co") && !jobPosted) {
      const leverMeta = document.querySelector(".posting-categories, .sort-by-time");
      const leverText = leverMeta?.textContent || "";
      const leverPosted = leverText.match(/\bposted\s+(.+)$/i);
      if (leverPosted) jobPosted = leverPosted[1].trim();
    }

    const lines = pageText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines.slice(0, 30)) {
      if (line.length > 140) continue;

      if (!jobPosted) {
        const posted =
          line.match(/\b(?:date\s+)?(?:posted|published|reposted)\s*(?:on\s+)?[:\-]?\s*(.+)$/i) ||
          line.match(/^(?:posted|published|reposted)\s*[:\-]?\s*(.+)$/i);
        if (posted) jobPosted = posted[1].trim();
      }

      if (!jobModified) {
        const modified = line.match(/\b(?:last\s+)?(?:updated|modified)\s*(?:on\s+)?[:\-]?\s*(.+)$/i);
        if (modified) jobModified = modified[1].trim();
      }

      if (!jobCreated) {
        const created = line.match(/\b(?:date\s+)?created\s*(?:on\s+)?[:\-]?\s*(.+)$/i);
        if (created) jobCreated = created[1].trim();
      }
    }

    return {
      jobPosted: (jobPosted || "").slice(0, 80),
      jobCreated: (jobCreated || "").slice(0, 80),
      jobModified: (jobModified || "").slice(0, 80),
    };
  }

  function extractMeta(pageText, pageUrl) {
    const lines = pageText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    let companyName = "";
    let position = "";
    let location = "";
    let applyUrl = pageUrl;
    const host = hostOf(pageUrl);

    const titleMatch = document.title.match(/^(.+?)\s*[-–|]\s*(.+)$/);
    if (titleMatch) {
      position = titleMatch[1].trim();
      companyName = titleMatch[2].replace(/\|.*$/, "").trim();
    }

    const ghApplicationTitle = document.title.match(
      /^job application for\s+(.+?)\s+at\s+(.+)$/i
    );
    if (ghApplicationTitle) {
      position = ghApplicationTitle[1].trim();
      companyName = ghApplicationTitle[2].trim();
    }

    if (host.includes("smartrecruiters.com")) {
      if (pageUrl.includes("/oneclick-ui/")) applyUrl = pageUrl;
      else if (!pageUrl.endsWith("/apply")) applyUrl = pageUrl.replace(/\/?$/, "/apply");
    }

    if (host.includes("greenhouse.io")) {
      const remix = parseGreenhouseRemixJob(
        collectEmbeddedJsonText() || document.documentElement.innerHTML
      );
      if (remix) {
        if (remix.companyName) companyName = remix.companyName;
        if (remix.position) position = remix.position;
      } else {
        const ghCompany = document.querySelector(".company-name");
        if (ghCompany?.textContent?.trim()) companyName = ghCompany.textContent.trim();
        const ghTitle = document.querySelector(".app-title, h1");
        if (ghTitle?.textContent?.trim()) position = ghTitle.textContent.trim();
      }
    } else {
      const ghCompany = document.querySelector(".company-name, [class*='company']");
      if (ghCompany?.textContent?.trim()) companyName = ghCompany.textContent.trim();
      const ghTitle = document.querySelector(".app-title, h1");
      if (ghTitle?.textContent?.trim()) position = ghTitle.textContent.trim();
    }

    const liTitle = document.querySelector(
      ".job-details-jobs-unified-top-card__job-title, h1"
    );
    if (liTitle?.textContent?.trim()) position = liTitle.textContent.trim();
    const liCompany = document.querySelector(
      ".job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__primary-description"
    );
    if (liCompany?.textContent?.trim()) companyName = liCompany.textContent.trim();

    for (const line of lines.slice(0, 20)) {
      if (!location && /\b(remote|hybrid|on-site|onsite)\b/i.test(line) && line.length < 80) {
        location = line;
      }
    }

    const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    if (!companyName && ogSite) companyName = ogSite.trim();

    const dates = extractJobDates(pageText, host);

    return {
      companyName: (companyName || "").slice(0, 80),
      position: (position || "").slice(0, 80),
      location: (location || "").slice(0, 80),
      applyUrl: applyUrl || pageUrl,
      jobPosted: dates.jobPosted,
      jobCreated: dates.jobCreated,
      jobModified: dates.jobModified,
    };
  }

  window.__cApplyGrabbedMeta = extractMeta(window.__cApplyGrabbedText, location.href);
})();

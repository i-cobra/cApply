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
    // Greenhouse
    "#content .content",
    "#app .content",
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

    if (host.includes("smartrecruiters.com")) {
      if (pageUrl.includes("/oneclick-ui/")) applyUrl = pageUrl;
      else if (!pageUrl.endsWith("/apply")) applyUrl = pageUrl.replace(/\/?$/, "/apply");
    }

    const ghCompany = document.querySelector(".company-name, [class*='company']");
    if (ghCompany?.textContent?.trim()) companyName = ghCompany.textContent.trim();
    const ghTitle = document.querySelector(".app-title, h1");
    if (ghTitle?.textContent?.trim()) position = ghTitle.textContent.trim();

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

    return {
      companyName: (companyName || "").slice(0, 80),
      position: (position || "").slice(0, 80),
      location: (location || "").slice(0, 80),
      applyUrl: applyUrl || pageUrl,
    };
  }

  window.__cApplyGrabbedMeta = extractMeta(window.__cApplyGrabbedText, location.href);
})();

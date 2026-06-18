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
    ".jobs-description__content",
    ".jobs-box__html-content",
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
})();

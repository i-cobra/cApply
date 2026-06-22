/**
 * Injected into job posting pages (MAIN world).
 * Captures interactive page snapshots and executes ChatGPT action plans.
 */
(function () {
  const TARGET_ATTR = "data-capply-target";
  const MAX_ELEMENTS = 120;

  const ENTRY_PHRASES = [
    "i'm interested",
    "im interested",
    "apply now",
    "apply for this job",
    "easy apply",
    "submit application",
    "start application",
    "apply",
  ];

  const NEXT_PHRASES = [
    "next",
    "continue",
    "save and continue",
    "save & continue",
    "review",
    "review application",
    "submit application",
    "submit",
  ];

  /**
   * @returns {Document[]}
   */
  function getSearchDocuments() {
    /** @type {Document[]} */
    const docs = [document];

    for (const iframe of document.querySelectorAll("iframe")) {
      try {
        const doc = iframe.contentDocument;
        if (doc) docs.push(doc);
      } catch {
        // Cross-origin iframe — not accessible.
      }
    }

    return docs;
  }

  /**
   * @returns {Element[]}
   */
  function getApplyScopeRoots() {
    /** @type {Element[]} */
    const roots = [];

    for (const doc of getSearchDocuments()) {
      for (const el of doc.querySelectorAll(
        '[role="dialog"], [class*="application" i], [class*="apply-form" i], [class*="oneclick" i], [class*="ApplyForm" i], spl-application, spl-apply-form, form'
      )) {
        if (el instanceof HTMLElement && isVisible(el)) roots.push(el);
      }
    }

    return roots;
  }

  /**
   * @param {Document | ShadowRoot | Element} root
   * @returns {Element[]}
   */
  function queryInteractiveElements(root) {
    const selector = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='combobox']",
      "[role='textbox']",
      "[role='option']",
      "[role='listbox']",
      "[data-test]",
      "[data-automation-id]",
      "[class*='button' i]",
      "[class*='Button']",
      "[class*='apply' i]",
      "[class*='interest' i]",
      "[class*='next' i]",
      "[class*='continue' i]",
    ].join(", ");

    /** @type {Element[]} */
    const found = [];

    const visit = (node) => {
      if (!node) return;

      if (node instanceof ShadowRoot) {
        node.querySelectorAll(selector).forEach((el) => found.push(el));
        node.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) visit(el.shadowRoot);
        });
        return;
      }

      if (node instanceof Document || node instanceof DocumentFragment || node instanceof Element) {
        node.querySelectorAll(selector).forEach((el) => found.push(el));
        node.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) visit(el.shadowRoot);
        });
      }
    };

    visit(root);
    return found;
  }

  /**
   * @returns {Element[]}
   */
  function collectInteractiveElements() {
    /** @type {Element[]} */
    const found = [];
    const seen = new Set();

    const searchRoots = isOneClickUi()
      ? getSearchDocuments().map((doc) => doc.documentElement)
      : (() => {
          const scopeRoots = getApplyScopeRoots();
          return scopeRoots.length > 0
            ? scopeRoots
            : getSearchDocuments().map((doc) => doc.documentElement);
        })();

    for (const root of searchRoots) {
      queryInteractiveElements(root).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          found.push(el);
        }
      });
    }

    if (isOneClickUi()) {
      for (const doc of getSearchDocuments()) {
        for (const el of doc.querySelectorAll(
          'spl-button, oc-button, [class*="Footer" i] button, [class*="footer" i] button, [class*="footer" i] [role="button"], button[data-test], [aria-label]'
        )) {
          if (!seen.has(el)) {
            seen.add(el);
            found.push(el);
          }
        }
      }
    }

    return found;
  }

  /**
   * @param {Element} el
   */
  function isDisabled(el) {
    if (!(el instanceof HTMLElement)) return true;
    if (el.hasAttribute("disabled")) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (el.matches(":disabled")) return true;
    return false;
  }

  /**
   * @param {Element} el
   */
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * @param {Element} el
   */
  function elementText(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value?.trim() || el.placeholder?.trim() || "";
    }
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  /**
   * @param {Element} el
   */
  function elementLabel(el) {
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelText = labelledBy
        .split(/\s+/)
        .map((id) => el.ownerDocument?.getElementById(id)?.textContent?.trim() || "")
        .filter(Boolean)
        .join(" ");
      if (labelText) return labelText.slice(0, 120);
    }

    if (el.id) {
      const label = el.ownerDocument?.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim().slice(0, 120);
    }

    const parentLabel = el.closest("label");
    if (parentLabel?.textContent?.trim()) {
      return parentLabel.textContent.replace(/\s+/g, " ").trim().slice(0, 120);
    }

    return elementText(el);
  }

  /**
   * @param {Element} el
   */
  function fieldDescriptor(el) {
    return `${elementLabel(el)} ${el.getAttribute("name") || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("id") || ""}`.toLowerCase();
  }

  /**
   * @param {Element} el
   */
  function buildFingerprint(el) {
    return {
      text: elementText(el),
      label: elementLabel(el),
      tag: el.tagName.toLowerCase(),
      type:
        el instanceof HTMLInputElement
          ? el.type || "text"
          : el.getAttribute("role") || el.tagName.toLowerCase(),
      name: el.getAttribute("name") || "",
      href: el instanceof HTMLAnchorElement ? el.href : "",
      testId: el.getAttribute("data-test") || el.getAttribute("data-automation-id") || "",
    };
  }

  /**
   * @param {Element} el
   */
  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const type =
      el instanceof HTMLInputElement
        ? el.type || "text"
        : el.getAttribute("role") || tag;
    const combined = `${elementText(el)} ${elementLabel(el)} ${el.getAttribute("name") || ""} ${el.getAttribute("id") || ""}`.toLowerCase();
    const isFileInput = el instanceof HTMLInputElement && type === "file";
    const isResumeUploadTrigger =
      !isFileInput &&
      /upload|attach|browse|choose file|add resume|add cv|resume|curriculum vitae|\bcv\b/.test(combined);

    return {
      tag,
      type,
      text: elementText(el),
      label: elementLabel(el),
      name: el.getAttribute("name") || "",
      placeholder:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.placeholder || ""
          : "",
      value:
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
          ? String(el.value || "").slice(0, 120)
          : "",
      required: Boolean(el.getAttribute("required") || el.getAttribute("aria-required") === "true"),
      disabled: isDisabled(el),
      href: el instanceof HTMLAnchorElement ? el.href : "",
      testId: el.getAttribute("data-test") || el.getAttribute("data-automation-id") || "",
      isFileInput,
      isResumeUploadTrigger,
      fingerprint: buildFingerprint(el),
    };
  }

  /**
   * @param {Element} el
   */
  function scoreElement(el) {
    const text = elementText(el).toLowerCase();
    const label = elementLabel(el).toLowerCase();
    const combined = `${text} ${label} ${el.getAttribute("name") || ""}`.toLowerCase();
    let score = 0;

    if (/^next$|^continue$|save and continue|save & continue|review application|^submit$/.test(combined)) {
      score += 130;
    }
    if (/i'?m interested|apply now|^apply$|submit application|start application|easy apply/.test(combined)) {
      score += 120;
    }
    if (el instanceof HTMLInputElement && el.type === "file") score += 100;
    if (el instanceof HTMLInputElement && /email|phone|first|last|name|resume|cv|linkedin/.test(combined)) {
      score += 80;
    }
    if (/privacy|cookie|share this job|refer a friend|google chrome|mozilla firefox|apple safari|microsoft edge|internet explorer/.test(combined)) {
      score -= 80;
    }
    if (el.closest("footer, nav, [class*='cookie' i], [class*='banner' i], [class*='share' i]")) {
      score -= 40;
    }
    if (el.closest('[role="dialog"], [class*="application" i], [class*="apply-form" i], form')) {
      score += 35;
    }
    if (el.closest('[class*="sticky" i], [class*="job-actions" i], [class*="apply-bar" i], header')) {
      score += 25;
    }
    if (isDisabled(el)) score -= 100;

    return score;
  }

  function isOneClickUi() {
    return /\/oneclick-ui\//i.test(location.pathname);
  }

  function detectPlatform() {
    const host = location.hostname.toLowerCase();
    if (host.includes("smartrecruiters.com")) return "smartrecruiters";
    if (host.includes("greenhouse.io") || host.includes("boards.greenhouse.io")) return "greenhouse";
    if (host.includes("lever.co")) return "lever";
    if (host.includes("myworkdayjobs.com")) return "workday";
    if (host.includes("linkedin.com")) return "linkedin";
    return "generic";
  }

  function getSmartRecruitersApplyUrl() {
    if (!location.hostname.includes("smartrecruiters.com")) return null;

    if (isOneClickUi()) {
      return location.href;
    }

    for (const doc of getSearchDocuments()) {
      for (const anchor of doc.querySelectorAll("a[href]")) {
        if (!(anchor instanceof HTMLAnchorElement)) continue;
        if (anchor.href.includes("/oneclick-ui/")) return anchor.href;
        if (/\/apply\/?$/i.test(anchor.pathname) || anchor.href.includes("/apply")) {
          return anchor.href;
        }
      }
    }

    const path = location.pathname.replace(/\/apply\/?$/, "");
    if (path.includes("/oneclick-ui/")) {
      return location.href;
    }

    if (path.length > 1) {
      return `${location.origin}${path.replace(/\/?$/, "")}/apply`;
    }

    return null;
  }

  function hasApplicationForm() {
    for (const el of collectInteractiveElements()) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        continue;
      }
      if (!isVisible(el)) continue;
      if (el instanceof HTMLInputElement && (el.type === "hidden" || el.type === "submit")) continue;
      return true;
    }
    return false;
  }

  /**
   * @param {string[]} phrases
   */
  function findButtonByPhrases(phrases, { excludeDisabled = true } = {}) {
    /** @type {HTMLElement | null} */
    let best = null;
    let bestScore = 0;

    for (const el of collectInteractiveElements()) {
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      if (excludeDisabled && isDisabled(el)) continue;

      const text = elementText(el).toLowerCase().trim();
      const label = elementLabel(el).toLowerCase().trim();

      for (const phrase of phrases) {
        const normalized = phrase.toLowerCase();
        const exact = text === normalized || label === normalized;
        const partial = text.includes(normalized) || label.includes(normalized);
        if (!exact && !partial) continue;

        let score = normalized.length + (exact ? 80 : 20) + scoreElement(el);
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }

    return best;
  }

  function findEntryButton() {
    return findButtonByPhrases(ENTRY_PHRASES);
  }

  function findNextStepButton() {
    /** @type {HTMLElement[]} */
    const candidates = [];

    if (isOneClickUi()) {
      for (const doc of getSearchDocuments()) {
        for (const el of doc.querySelectorAll(
          [
            'button[data-test*="next" i]',
            'button[data-test*="continue" i]',
            '[data-automation-id*="next" i]',
            '[data-automation-id*="continue" i]',
            '[aria-label*="next" i]',
            '[aria-label*="continue" i]',
            'footer button',
            '[class*="Footer" i] button',
            '[class*="footer" i] button',
            '[class*="footer" i] [role="button"]',
            'form button[type="submit"]',
            "spl-button",
            "oc-button",
          ].join(", ")
        )) {
          if (el instanceof HTMLElement && isVisible(el)) candidates.push(el);
        }
      }
    }

    const phraseMatch = findButtonByPhrases(NEXT_PHRASES, { excludeDisabled: false });
    if (phraseMatch) candidates.push(phraseMatch);

    /** @type {HTMLElement | null} */
    let best = null;
    let bestScore = -999;

    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const combined = `${elementText(el)} ${elementLabel(el)} ${el.getAttribute("data-test") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      if (/privacy|cookie|back|previous|cancel|close|share/.test(combined) && !/continue|next|submit|review/.test(combined)) {
        continue;
      }

      let score = scoreElement(el);
      if (/next|continue|submit|review|proceed/.test(combined)) score += 50;
      if (isDisabled(el)) score -= 30;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  function clearTargetMarkers() {
    for (const doc of getSearchDocuments()) {
      doc.querySelectorAll(`[${TARGET_ATTR}]`).forEach((el) => {
        el.removeAttribute(TARGET_ATTR);
      });
    }
  }

  /**
   * @param {Record<string, unknown>} a
   * @param {Record<string, unknown>} b
   */
  function fingerprintsMatch(a, b) {
    if (!a || !b) return false;
    if (a.testId && b.testId && a.testId === b.testId) return true;
    if (a.href && b.href && a.href === b.href) return true;
    if (a.name && b.name && a.name === b.name && a.type === b.type) return true;

    const textA = String(a.text || a.label || "").trim().toLowerCase();
    const textB = String(b.text || b.label || "").trim().toLowerCase();
    if (textA && textB && textA === textB && a.tag === b.tag) return true;

    return false;
  }

  /**
   * @param {string} targetId
   */
  function findTarget(targetId) {
    for (const doc of getSearchDocuments()) {
      const direct = doc.querySelector(`[${TARGET_ATTR}="${CSS.escape(targetId)}"]`);
      if (direct) return direct;
    }

    const fingerprint = window.__cApplyTargetFingerprints?.[targetId];
    if (!fingerprint) return null;

    for (const el of collectInteractiveElements()) {
      if (fingerprintsMatch(fingerprint, buildFingerprint(el))) {
        return el;
      }
    }

    return null;
  }

  /**
   * @returns {Record<string, unknown>}
   */
  function capturePageSnapshot() {
    clearTargetMarkers();

    const platform = detectPlatform();
    /** @type {Record<string, unknown>[]} */
    const elements = [];
    /** @type {Record<string, Record<string, unknown>>} */
    const fingerprints = {};
    /** @type {string[]} */
    const suggestedEntryTargetIds = [];
    /** @type {string[]} */
    const suggestedNextTargetIds = [];

    /** @type {string[]} */
    const suggestedResumeUploadTargetIds = [];

    /** @type {Element[]} */
    const candidates = collectInteractiveElements().filter((el) => isVisible(el));

    for (const input of findAllFileInputs()) {
      if (!candidates.includes(input)) candidates.push(input);
    }

    candidates.sort((a, b) => scoreElement(b) - scoreElement(a));

    for (const el of candidates) {
      if (elements.length >= MAX_ELEMENTS) break;

      const id = `el-${elements.length}`;
      el.setAttribute(TARGET_ATTR, id);
      const described = describeElement(el);
      elements.push({ id, ...described });
      fingerprints[id] = described.fingerprint;

      if (described.isFileInput) {
        suggestedResumeUploadTargetIds.push(id);
      }

      const combined = `${described.text} ${described.label}`.toLowerCase();
      if (/i'?m interested|apply now|^apply$|easy apply|start application/.test(combined)) {
        suggestedEntryTargetIds.push(id);
      }
      if (/^next$|^continue$|save and continue|save & continue|review application|^submit$|proceed|go to next/.test(combined)) {
        suggestedNextTargetIds.push(id);
      }
      if (isOneClickUi() && /next|continue|submit|review|proceed/.test(`${described.testId} ${described.label}`.toLowerCase())) {
        suggestedNextTargetIds.push(id);
      }
    }

    window.__cApplyTargetFingerprints = fingerprints;

    /** @type {Record<string, unknown>} */
    const snapshot = {
      url: location.href,
      title: document.title,
      platform,
      platformVariant: isOneClickUi() ? "oneclick-ui" : "job-posting",
      hasApplicationForm: hasApplicationForm(),
      inApplyModal: getApplyScopeRoots().length > 0,
      suggestedEntryTargetIds,
      suggestedNextTargetIds: [...new Set(suggestedNextTargetIds)],
      suggestedResumeUploadTargetIds: [...new Set(suggestedResumeUploadTargetIds)],
      elements,
    };

    if (platform === "smartrecruiters") {
      snapshot.applyUrl = getSmartRecruitersApplyUrl();
      snapshot.platformNotes = isOneClickUi()
        ? "SmartRecruiters OneClick UI multi-step form. Fill visible required fields, then click Next/Continue/Submit from suggestedNextTargetIds. Footer buttons may sit outside the form element — they are included in the snapshot. Do not navigate away from this URL."
        : 'SmartRecruiters uses multi-step forms. Fill every visible required field on the current step, then click a suggestedNextTargetIds button ("Next", "Continue", or "Submit"). Use status "continue" after advancing a step. Click "I\'m interested" first if hasApplicationForm is false.';
    }

    const blockedFrame = detectCrossOriginApplyFrame();
    if (blockedFrame) {
      snapshot.crossOriginApplyFrame = blockedFrame;
      snapshot.platformNotes =
        (snapshot.platformNotes ? `${snapshot.platformNotes} ` : "") +
        "Application form appears inside a cross-origin iframe that automation cannot access. Status should be blocked.";
    }

    return snapshot;
  }

  function detectCrossOriginApplyFrame() {
    for (const iframe of document.querySelectorAll("iframe")) {
      if (!(iframe instanceof HTMLIFrameElement) || !iframe.src) continue;
      try {
        if (iframe.contentDocument) continue;
      } catch {
        if (/apply|oneclick|smartrecruiters|candidate/i.test(iframe.src)) {
          return iframe.src;
        }
      }

      if (!iframe.contentDocument && /apply|oneclick|smartrecruiters|candidate/i.test(iframe.src)) {
        return iframe.src;
      }
    }

    return null;
  }

  /**
   * @param {HTMLElement} el
   * @param {{ force?: boolean }} [options]
   */
  function robustClick(el, options = {}) {
    if (isDisabled(el) && !options.force) {
      throw new Error(`Element is disabled: ${elementLabel(el) || elementText(el)}`);
    }

    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    el.focus?.();

    const opts = { bubbles: true, cancelable: true, view: window };

    if (el instanceof HTMLAnchorElement && el.href) {
      el.click();
      return;
    }

    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.click();
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  /**
   * @param {HTMLElement} el
   * @param {string} value
   */
  function setNativeValue(el, value) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    } else if (el.isContentEditable) {
      el.textContent = value;
    } else {
      el.textContent = value;
    }

    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertText",
      })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /**
   * @param {HTMLSelectElement} el
   * @param {string} value
   */
  function setSelectValue(el, value) {
    const normalized = value.trim().toLowerCase();
    let matched = false;

    for (const option of el.options) {
      if (
        option.value === value ||
        option.text.trim() === value ||
        option.text.trim().toLowerCase() === normalized ||
        option.value.toLowerCase() === normalized
      ) {
        el.value = option.value;
        matched = true;
        break;
      }
    }

    if (!matched) {
      el.value = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  /**
   * @param {HTMLElement} el
   * @param {string} value
   */
  async function setComboboxValue(el, value) {
    robustClick(el);
    await sleep(350);

    const normalized = value.trim().toLowerCase();
    for (const option of collectInteractiveElements()) {
      if (!(option instanceof HTMLElement) || !isVisible(option)) continue;
      const role = option.getAttribute("role");
      const text = elementText(option).toLowerCase();
      if (
        (role === "option" || role === "menuitem" || option.tagName === "LI") &&
        (text === normalized || text.includes(normalized))
      ) {
        robustClick(option);
        await sleep(200);
        return;
      }
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, value);
    }
  }

  /**
   * @returns {HTMLInputElement[]}
   */
  function findAllFileInputs() {
    /** @type {HTMLInputElement[]} */
    const inputs = [];
    const seen = new Set();

    for (const doc of getSearchDocuments()) {
      for (const el of doc.querySelectorAll('input[type="file"]')) {
        if (el instanceof HTMLInputElement && !seen.has(el)) {
          seen.add(el);
          inputs.push(el);
        }
      }
    }

    return inputs;
  }

  /**
   * @param {HTMLInputElement} input
   */
  function scoreResumeFileInput(input, nearEl) {
    const descriptor = fieldDescriptor(input).toLowerCase();
    let score = 0;

    if (/resume|cv|curriculum|attachment|document/.test(descriptor)) score += 50;
    if (input.accept?.includes("pdf")) score += 20;
    if (nearEl && nearEl.closest("form, [role='dialog'], [class*='upload' i]")?.contains(input)) {
      score += 30;
    }
    if (nearEl && input.closest("label, div, section") === nearEl.closest("label, div, section")) {
      score += 25;
    }

    return score;
  }

  /**
   * @param {Element} [nearEl]
   * @returns {HTMLInputElement | null}
   */
  function findResumeFileInput(nearEl) {
    const inputs = findAllFileInputs();
    if (!inputs.length) return null;

    /** @type {HTMLInputElement | null} */
    let best = null;
    let bestScore = -1;

    for (const input of inputs) {
      const score = scoreResumeFileInput(input, nearEl);
      if (score > bestScore) {
        bestScore = score;
        best = input;
      }
    }

    return best || inputs[0];
  }

  /**
   * @param {HTMLElement} el
   */
  function isResumeUploadTrigger(el) {
    if (el instanceof HTMLInputElement && el.type === "file") return false;
    const combined = `${elementText(el)} ${elementLabel(el)} ${el.getAttribute("data-test") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
    return /upload|attach|browse|choose file|add resume|add cv|select file|resume|curriculum vitae|\bcv\b/.test(combined);
  }

  /**
   * @param {HTMLElement} el
   * @param {{ pdfBase64?: string, filename?: string }} uploadPayload
   * @param {string} targetId
   */
  async function uploadResumeToTarget(el, uploadPayload, targetId) {
    if (!uploadPayload.pdfBase64) {
      throw new Error("Resume PDF data missing for upload.");
    }

    const file = base64ToFile(
      uploadPayload.pdfBase64,
      uploadPayload.filename || "resume.pdf"
    );

    if (el instanceof HTMLInputElement && el.type === "file") {
      uploadFile(el, file);
      await sleep(400);
      return;
    }

    if (isResumeUploadTrigger(el)) {
      robustClick(el);
      await sleep(900);
    }

    const fileInput = findResumeFileInput(el) || findResumeFileInput();
    if (!fileInput) {
      throw new Error(
        `Target ${targetId} is not a file input and no hidden resume file input was found.`
      );
    }

    uploadFile(fileInput, file);
    await sleep(400);
  }

  /**
   * @param {string} base64
   * @param {string} filename
   */
  function base64ToFile(base64, filename) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: "application/pdf" });
  }

  /**
   * @param {HTMLInputElement} input
   * @param {File} file
   */
  function uploadFile(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * @param {Record<string, unknown>} profile
   */
  function localAutofillFromProfile(profile) {
    const contact = profile?.contact || profile || {};
    const fullName = String(contact.name || "").trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "";
    const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
    const email = String(contact.email || "").trim();
    const phone = String(contact.phone || "").trim();
    const location = String(contact.location || "").trim();
    const links = String(contact.links || "").trim();

    /** @type {{ match: RegExp, value: string }[]} */
    const rules = [
      { match: /first.?name|given.?name|fname/, value: firstName },
      { match: /last.?name|family.?name|surname|lname/, value: lastName },
      { match: /full.?name|^name$|candidate.?name/, value: fullName },
      { match: /email|e-mail/, value: email },
      { match: /phone|mobile|tel/, value: phone },
      { match: /location|city|address|where do you live/, value: location },
      { match: /linkedin|portfolio|website|url|link/, value: links },
    ];

    let filled = 0;

    for (const el of collectInteractiveElements()) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue;
      if (!isVisible(el) || isDisabled(el)) continue;
      if (el.type === "hidden" || el.type === "file" || el.type === "checkbox" || el.type === "radio") {
        continue;
      }
      if (String(el.value || "").trim()) continue;

      const descriptor = fieldDescriptor(el);
      for (const rule of rules) {
        if (!rule.value || !rule.match.test(descriptor)) continue;
        setNativeValue(el, rule.value);
        filled += 1;
        break;
      }
    }

    return { filled };
  }

  async function waitForApplicationForm(maxMs = 10000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (hasApplicationForm()) return true;
      await sleep(400);
    }
    return false;
  }

  function blurActiveFields() {
    for (const el of collectInteractiveElements()) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }
    document.activeElement?.blur?.();
  }

  async function prepareApplySurface() {
    const platform = detectPlatform();

    if (isOneClickUi()) {
      const opened = await waitForApplicationForm(12000);
      return {
        platform,
        variant: "oneclick-ui",
        formVisible: opened || hasApplicationForm(),
        action: "none",
      };
    }

    if (hasApplicationForm()) {
      return { platform, formVisible: true, action: "none" };
    }

    if (platform === "smartrecruiters") {
      const applyUrl = getSmartRecruitersApplyUrl();
      if (
        applyUrl &&
        !/\/apply\/?$/i.test(location.pathname) &&
        !isOneClickUi() &&
        !applyUrl.includes("/oneclick-ui/")
      ) {
        window.location.href = applyUrl;
        return { platform, action: "navigate", url: applyUrl };
      }

      const entry = findEntryButton();
      if (entry) {
        robustClick(entry);
        await sleep(1500);
        const opened = await waitForApplicationForm(8000);
        return {
          platform,
          action: "click",
          label: elementLabel(entry),
          formOpened: opened,
        };
      }
    }

    const genericEntry = findEntryButton();
    if (genericEntry) {
      robustClick(genericEntry);
      await sleep(2500);
      return { platform, action: "click", label: elementLabel(genericEntry) };
    }

    return { platform, formVisible: false, action: "none" };
  }

  async function tryAdvanceWizardStep() {
    blurActiveFields();
    await sleep(500);

    const next = findNextStepButton();
    if (next && !isDisabled(next)) {
      robustClick(next);
      await sleep(2800);
      return { advanced: true, label: elementLabel(next) || elementText(next) };
    }

    if (next && isDisabled(next)) {
      await sleep(1200);
      blurActiveFields();
      const retry = findNextStepButton();
      if (retry && !isDisabled(retry)) {
        robustClick(retry);
        await sleep(2800);
        return { advanced: true, label: elementLabel(retry) || elementText(retry) };
      }
    }

    if (next) {
      try {
        robustClick(next, { force: true });
        await sleep(2800);
        return { advanced: true, label: elementLabel(next) || elementText(next), forced: true };
      } catch {
        // fall through to form submit
      }
    }

    for (const doc of getSearchDocuments()) {
      for (const form of doc.querySelectorAll("form")) {
        if (!(form instanceof HTMLFormElement)) continue;
        const submit = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submit instanceof HTMLElement && isVisible(submit)) {
          robustClick(submit, { force: true });
          await sleep(2800);
          return { advanced: true, label: "form-submit-button", forced: true };
        }
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
          await sleep(2800);
          return { advanced: true, label: "form-requestSubmit" };
        }
      }
    }

    return { advanced: false, reason: next ? "next-disabled" : "no-next-button" };
  }

  /**
   * @param {Record<string, unknown>[]} steps
   * @param {{ pdfBase64?: string, filename?: string, autoAdvance?: boolean }} uploadPayload
   */
  async function executeAutoApplyActions(steps, uploadPayload = {}) {
    /** @type {{ ok: boolean, completed: string[], errors: string[], submitted: boolean, advanced?: boolean }} */
    const result = {
      ok: true,
      completed: [],
      errors: [],
      submitted: false,
    };

    /** @type {boolean} */
    let clickedWizardButton = false;

    for (const rawStep of steps || []) {
      const step = rawStep || {};
      const action = String(step.action || "").toLowerCase();

      try {
        if (action === "wait") {
          await sleep(Math.min(Number(step.ms) || 1000, 10000));
          result.completed.push("wait");
          continue;
        }

        if (action === "navigate") {
          const url = String(step.url || step.value || "").trim();
          if (!url) throw new Error("Navigate step requires url.");
          window.location.href = url;
          result.completed.push(`navigate:${url}`);
          await sleep(3500);
          continue;
        }

        const targetId = String(step.targetId || "").trim();
        const el = findTarget(targetId);
        if (!el || !(el instanceof HTMLElement)) {
          throw new Error(`Target not found: ${targetId}`);
        }

        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });

        if (action === "scroll") {
          result.completed.push(`scroll:${targetId}`);
          continue;
        }

        if (action === "click") {
          robustClick(el);
          await sleep(400);
          const combined = `${elementText(el)} ${elementLabel(el)}`.toLowerCase();
          if (/^next$|^continue$|save and continue|review application|^submit$/.test(combined.trim())) {
            clickedWizardButton = true;
          }
          result.completed.push(`click:${targetId}`);
          continue;
        }

        if (action === "fill") {
          setNativeValue(el, String(step.value ?? ""));
          await sleep(150);
          result.completed.push(`fill:${targetId}`);
          continue;
        }

        if (action === "select") {
          if (el instanceof HTMLSelectElement) {
            setSelectValue(el, String(step.value ?? ""));
          } else {
            await setComboboxValue(el, String(step.value ?? ""));
          }
          await sleep(200);
          result.completed.push(`select:${targetId}`);
          continue;
        }

        if (action === "check") {
          if (!(el instanceof HTMLInputElement)) {
            throw new Error(`Target ${targetId} is not a checkbox/radio input.`);
          }
          el.checked = Boolean(step.checked);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          result.completed.push(`check:${targetId}`);
          continue;
        }

        if (action === "upload") {
          await uploadResumeToTarget(el, uploadPayload, targetId);
          result.completed.push(`upload:${targetId}`);
          continue;
        }

        throw new Error(`Unsupported action: ${action}`);
      } catch (err) {
        result.ok = false;
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (
      uploadPayload.autoAdvance !== false &&
      detectPlatform() === "smartrecruiters" &&
      !clickedWizardButton
    ) {
      const advance = await tryAdvanceWizardStep();
      result.advanced = advance.advanced;
      if (advance.advanced) {
        result.completed.push(`auto-next:${advance.label}`);
      }
    }

    const bodyText = (document.body?.innerText || "").toLowerCase();
    result.submitted =
      /thank you for applying|application submitted|application received|successfully applied|we received your application|thanks for applying/.test(
        bodyText
      );

    window.__cApplyAutoApplyResult = result;
    return result;
  }

  window.__cApplyCapturePageSnapshot = capturePageSnapshot;
  window.__cApplyExecuteAutoApplyActions = executeAutoApplyActions;
  window.__cApplyPrepareApplySurface = prepareApplySurface;
  window.__cApplyLocalAutofillFromProfile = localAutofillFromProfile;
})();

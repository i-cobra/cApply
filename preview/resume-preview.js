const params = new URLSearchParams(location.search);
const previewId = params.get("id");
const previewTitle = params.get("title")?.trim();

const frame = document.getElementById("pdfFrame");
const status = document.getElementById("previewStatus");

if (previewTitle) {
  document.title = `${previewTitle} — cApply`;
}

function showError(message) {
  status.textContent = message;
  status.classList.add("error");
  frame.hidden = true;
}

async function init() {
  if (!previewId) {
    showError("Missing preview id.");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_RESUME_PREVIEW",
      id: previewId,
    });

    if (!response?.ok || !response.base64) {
      showError(response?.error || "Could not load resume preview.");
      return;
    }

    const bytes = Uint8Array.from(atob(response.base64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    frame.addEventListener(
      "load",
      () => {
        status.hidden = true;
        frame.hidden = false;
      },
      { once: true }
    );
    frame.src = url;
  } catch (err) {
    showError(err?.message || "Could not load resume preview.");
  }
}

init();

const config = window.DRESSUP_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const state = { photos: [], background: "white", processing: false };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const elements = {
  input: $("#file-input"), dropzone: $("#dropzone"), grid: $("#photo-grid"),
  count: $("#photo-count"), actionBar: $("#action-bar"), process: $("#process-button"),
  setupNote: $("#setup-note"), listingPanel: $("#listing-panel"), photosPanel: $("#photos-panel"),
  emptyListing: $("#empty-listing"), listingLayout: $("#listing-layout"), sourceStrip: $("#source-strip"),
  listingButton: $("#listing-button"), listingNote: $("#listing-note"), listingOutput: $("#listing-output"),
  outputPlaceholder: $("#output-placeholder"), listingError: $("#listing-error"), copyButton: $("#copy-button")
};

if (configured) {
  $("#connection-pill").classList.add("online");
  $("#connection-copy").textContent = "Processor connected";
  elements.setupNote.classList.add("hidden");
}

function photoId(file) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function addFiles(fileList) {
  const incoming = [...fileList].filter((file) => file.type.startsWith("image/") || /\.hei(c|f)$/i.test(file.name));
  const remaining = Math.max(0, 20 - state.photos.length);
  state.photos.push(...incoming.slice(0, remaining).map((file) => ({
    id: photoId(file), file, preview: URL.createObjectURL(file), status: "ready", resultUrl: "", error: ""
  })));
  render();
}

function removePhoto(id) {
  const photo = state.photos.find((item) => item.id === id);
  if (photo) {
    URL.revokeObjectURL(photo.preview);
    if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
  }
  state.photos = state.photos.filter((item) => item.id !== id);
  render();
}

function render() {
  const hasPhotos = state.photos.length > 0;
  elements.grid.classList.toggle("hidden", !hasPhotos);
  elements.actionBar.classList.toggle("hidden", !hasPhotos);
  elements.count.classList.toggle("hidden", !hasPhotos);
  elements.count.textContent = `${state.photos.length} PHOTO${state.photos.length === 1 ? "" : "S"}`;
  elements.process.disabled = !configured || state.processing;
  elements.process.textContent = state.processing ? "PROCESSING…" : `REMOVE BACKGROUNDS · ${state.photos.length}`;
  elements.emptyListing.classList.toggle("hidden", hasPhotos);
  elements.listingLayout.classList.toggle("hidden", !hasPhotos);
  elements.listingButton.disabled = !configured || !hasPhotos;
  elements.listingNote.classList.toggle("hidden", configured);

  elements.grid.innerHTML = state.photos.map((photo, index) => `
    <article class="photo-card">
      <div class="photo-frame ${state.background === "transparent" ? "checker" : ""}">
        <img src="${photo.resultUrl || photo.preview}" alt="Uploaded product view ${index + 1}">
        <span class="photo-status ${photo.status}">${photo.status}</span>
        <button class="remove" data-remove="${photo.id}" aria-label="Remove photo ${index + 1}">×</button>
      </div>
      <div class="photo-meta"><strong>PHOTO ${String(index + 1).padStart(2, "0")}</strong>
      ${photo.resultUrl ? `<a href="${photo.resultUrl}" download="clean-${photo.file.name.replace(/\.[^.]+$/, ".png")}">DOWNLOAD</a>` : `<span>${Math.max(1, Math.round(photo.file.size / 1024))} KB</span>`}</div>
      ${photo.error ? `<p class="error-text">Couldn’t process this photo.</p>` : ""}
    </article>`).join("") + (state.photos.length < 20 ? `<button class="add-card" id="add-more"><span>＋</span>Add more</button>` : "");

  elements.sourceStrip.innerHTML = state.photos.slice(0, 6).map((photo, index) =>
    `<img src="${photo.preview}" alt="Listing source ${index + 1}">`).join("") +
    (state.photos.length > 6 ? `<span>+${state.photos.length - 6}</span>` : "");

  $$('[data-remove]').forEach((button) => button.addEventListener("click", () => removePhoto(button.dataset.remove)));
  $("#add-more")?.addEventListener("click", () => elements.input.click());
}

async function processPhotos() {
  if (!configured || !state.photos.length || state.processing) return;
  state.processing = true;
  state.photos.forEach((photo) => { photo.status = "processing"; photo.error = ""; });
  render();
  await Promise.all(state.photos.map(async (photo) => {
    try {
      const body = new FormData();
      body.append("image", photo.file, photo.file.name);
      body.append("background", state.background);
      const response = await fetch(`${config.supabaseUrl}/functions/v1/remove-background`, {
        method: "POST",
        headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${config.supabasePublishableKey}` },
        body
      });
      if (!response.ok) throw new Error(await response.text());
      if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
      photo.resultUrl = URL.createObjectURL(await response.blob());
      photo.status = "complete";
    } catch (error) {
      photo.status = "error";
      photo.error = error instanceof Error ? error.message : "Processing failed";
    }
    render();
  }));
  state.processing = false;
  render();
}

async function createListing() {
  if (!configured || !state.photos.length) return;
  elements.listingError.classList.add("hidden");
  elements.listingButton.disabled = true;
  elements.listingButton.textContent = "WRITING LISTING…";
  const body = new FormData();
  state.photos.forEach((photo) => body.append("images", photo.file, photo.file.name));
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/create-listing`, {
      method: "POST",
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${config.supabasePublishableKey}` },
      body
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    elements.listingOutput.textContent = data.listing || "";
    elements.listingOutput.classList.remove("hidden");
    elements.outputPlaceholder.classList.add("hidden");
    elements.copyButton.disabled = !data.listing;
  } catch {
    elements.listingError.classList.remove("hidden");
  } finally {
    elements.listingButton.disabled = false;
    elements.listingButton.textContent = "CREATE TITLE + DESCRIPTION";
  }
}

elements.dropzone.addEventListener("click", () => elements.input.click());
elements.dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") elements.input.click(); });
elements.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); elements.dropzone.classList.add("dragging"); });
elements.dropzone.addEventListener("dragleave", () => elements.dropzone.classList.remove("dragging"));
elements.dropzone.addEventListener("drop", (event) => { event.preventDefault(); elements.dropzone.classList.remove("dragging"); addFiles(event.dataTransfer.files); });
elements.input.addEventListener("change", () => { addFiles(elements.input.files); elements.input.value = ""; });
elements.process.addEventListener("click", processPhotos);
elements.listingButton.addEventListener("click", createListing);
elements.emptyListing.addEventListener("click", () => { $("[data-tab='photos']").click(); elements.input.click(); });
elements.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.listingOutput.textContent);
  elements.copyButton.textContent = "COPIED";
  setTimeout(() => { elements.copyButton.textContent = "COPY ALL"; }, 1200);
});

$$('[data-tab]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-tab]').forEach((item) => item.classList.toggle("active", item === button));
  const photosActive = button.dataset.tab === "photos";
  elements.photosPanel.classList.toggle("hidden", !photosActive);
  elements.listingPanel.classList.toggle("hidden", photosActive);
}));

$$('[data-background]').forEach((button) => button.addEventListener("click", () => {
  state.background = button.dataset.background;
  $$('[data-background]').forEach((item) => item.classList.toggle("selected", item === button));
  render();
}));

render();

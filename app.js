import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { removeBackground } from "https://esm.sh/@imgly/background-removal@1.7.0?deps=onnxruntime-web@1.21.0";

const config = window.DRESSUP_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const supabase = configured ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
const state = { photos: [], background: "white", quality: "fast", processing: false, processedCount: 0, session: null };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const elements = {
  input: $("#file-input"), dropzone: $("#dropzone"), grid: $("#photo-grid"),
  count: $("#photo-count"), actionBar: $("#action-bar"), process: $("#process-button"), downloadAll: $("#download-all"),
  setupNote: $("#setup-note"), listingPanel: $("#listing-panel"), photosPanel: $("#photos-panel"),
  emptyListing: $("#empty-listing"), listingLayout: $("#listing-layout"), sourceStrip: $("#source-strip"),
  listingButton: $("#listing-button"), listingNote: $("#listing-note"), listingOutput: $("#listing-output"),
  outputPlaceholder: $("#output-placeholder"), listingError: $("#listing-error"), copyButton: $("#copy-button"),
  authButton: $("#auth-button"), authDialog: $("#auth-dialog"), authForm: $("#auth-form"),
  authEmail: $("#auth-email"), authPassword: $("#auth-password"), authMessage: $("#auth-message")
};

if (configured) {
  $("#connection-pill").classList.add("online");
  $("#connection-copy").textContent = "Listing connection ready";
}

async function refreshSession(session) {
  state.session = session;
  elements.authButton.textContent = session ? "SIGN OUT" : "SIGN IN";
  elements.authButton.classList.toggle("signed-in", Boolean(session));
  if (configured) $("#connection-copy").textContent = session ? "Studio ready" : "Sign in required";
  render();
}

if (supabase) {
  const { data } = await supabase.auth.getSession();
  await refreshSession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => refreshSession(session));
}

function photoId(file) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

function resultFileName(photo, index) {
  const originalName = photo.originalFile?.name || photo.file.name || `photo-${index + 1}`;
  const baseName = originalName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
  return `clean-${String(index + 1).padStart(2, "0")}-${baseName || "photo"}.png`;
}

function isHeicFile(file) {
  return /\.(heic|heif)$/i.test(file.name) || /^image\/hei(c|f)$/i.test(file.type);
}

async function convertHeicFile(file) {
  if (typeof window.heic2any !== "function") {
    throw new Error("The iPhone photo converter did not load.");
  }
  const converted = await window.heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.96
  });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const baseName = file.name.replace(/\.(heic|heif)$/i, "") || "iphone-photo";
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified
  });
}

async function preparePhoto(photo) {
  try {
    if (isHeicFile(photo.file)) {
      photo.status = "converting";
      photo.statusLabel = "preparing iPhone photo";
      render();
      photo.file = await convertHeicFile(photo.file);
    }
    photo.preview = URL.createObjectURL(photo.file);
    photo.status = "ready";
    photo.statusLabel = "ready";
  } catch (error) {
    photo.status = "error";
    photo.statusLabel = "try again";
    photo.error = "This iPhone photo couldn’t be converted. Please export it as JPEG and try again.";
    console.error("HEIC conversion failed", error);
  }
  render();
}

function addFiles(fileList) {
  const incoming = [...fileList].filter((file) => file.type.startsWith("image/") || /\.hei(c|f)$/i.test(file.name));
  const remaining = Math.max(0, 20 - state.photos.length);
  const additions = incoming.slice(0, remaining).map((file) => ({
    id: photoId(file),
    originalFile: file,
    file,
    preview: "",
    status: isHeicFile(file) ? "converting" : "preparing",
    statusLabel: isHeicFile(file) ? "preparing iPhone photo" : "preparing",
    resultUrl: "",
    error: ""
  }));
  state.photos.push(...additions);
  render();
  additions.forEach((photo) => { void preparePhoto(photo); });
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
  const usablePhotos = state.photos.filter((photo) => photo.preview && !photo.error);
  const isPreparing = state.photos.some((photo) => photo.status === "converting" || photo.status === "preparing");
  elements.grid.classList.toggle("hidden", !hasPhotos);
  elements.actionBar.classList.toggle("hidden", !hasPhotos);
  elements.count.classList.toggle("hidden", !hasPhotos);
  elements.count.textContent = `${state.photos.length} PHOTO${state.photos.length === 1 ? "" : "S"}`;
  const completedPhotos = state.photos.filter((photo) => photo.resultBlob);
  elements.process.disabled = !usablePhotos.length || state.processing || isPreparing;
  elements.downloadAll.disabled = !completedPhotos.length || state.processing;
  elements.downloadAll.textContent = completedPhotos.length ? `DOWNLOAD ALL · ${completedPhotos.length}` : "DOWNLOAD ALL";
  elements.process.textContent = state.processing
    ? `PROCESSING ${state.processedCount + 1} OF ${usablePhotos.length}…`
    : isPreparing
      ? "PREPARING IPHONE PHOTOS…"
      : `REMOVE BACKGROUNDS · ${usablePhotos.length}`;
  elements.emptyListing.classList.toggle("hidden", hasPhotos);
  elements.listingLayout.classList.toggle("hidden", !hasPhotos);
  elements.listingButton.disabled = !configured || !state.session || !usablePhotos.length || isPreparing;
  elements.listingNote.classList.toggle("hidden", configured && Boolean(state.session));
  elements.listingNote.textContent = configured ? "Sign in to activate listing generation." : "Connect Supabase to activate listing generation.";

  elements.grid.innerHTML = state.photos.map((photo, index) => `
    <article class="photo-card">
      <div class="photo-frame ${state.background === "transparent" ? "checker" : ""}">
        ${photo.resultUrl || photo.preview
          ? `<img src="${photo.resultUrl || photo.preview}" alt="Uploaded product view ${index + 1}">`
          : `<div class="photo-preparing">Preparing<br>iPhone photo…</div>`}
        <span class="photo-status ${photo.status}">${photo.statusLabel || photo.status}</span>
        <button class="remove" data-remove="${photo.id}" aria-label="Remove photo ${index + 1}">×</button>
      </div>
      <div class="photo-meta"><strong>PHOTO ${String(index + 1).padStart(2, "0")}</strong>
      ${photo.resultUrl ? `<a href="${photo.resultUrl}" download="${resultFileName(photo, index)}">DOWNLOAD</a>` : `<span>${Math.max(1, Math.round(photo.file.size / 1024))} KB</span>`}</div>
      ${photo.error ? `<p class="error-text">${photo.error}</p>` : ""}
    </article>`).join("") + (state.photos.length < 20 ? `<button class="add-card" id="add-more"><span>＋</span>Add more</button>` : "");

  elements.sourceStrip.innerHTML = usablePhotos.slice(0, 6).map((photo, index) =>
    `<img src="${photo.preview}" alt="Listing source ${index + 1}">`).join("") +
    (usablePhotos.length > 6 ? `<span>+${usablePhotos.length - 6}</span>` : "");

  $$('[data-remove]').forEach((button) => button.addEventListener("click", () => removePhoto(button.dataset.remove)));
  $("#add-more")?.addEventListener("click", () => elements.input.click());
}

async function cleanAlphaMask(foregroundBlob, qualityMode = "fast") {
  const image = await createImageBitmap(foregroundBlob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  image.close();

  const width = canvas.width;
  const height = canvas.height;
  const pixelCount = width * height;
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const transparentCutoff = qualityMode === "best" ? 68 : 96;
  const opaqueCutoff = qualityMode === "best" ? 216 : 224;
  const range = opaqueCutoff - transparentCutoff;

  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index];
    if (alpha <= transparentCutoff) {
      pixels[index] = 0;
    } else if (alpha >= opaqueCutoff) {
      pixels[index] = 255;
    } else {
      const normalized = (alpha - transparentCutoff) / range;
      const contrasted = normalized * normalized * (3 - (2 * normalized));
      pixels[index] = Math.round(contrasted * 255);
    }
  }

  const minimumComponentPixels = qualityMode === "best"
    ? Math.max(700, Math.floor(pixelCount * 0.00025))
    : Math.max(900, Math.floor(pixelCount * 0.00035));
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || pixels[(start * 4) + 3] === 0) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      let neighbor;

      if (x > 0) {
        neighbor = current - 1;
        if (!visited[neighbor] && pixels[(neighbor * 4) + 3] > 0) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      if (x < width - 1) {
        neighbor = current + 1;
        if (!visited[neighbor] && pixels[(neighbor * 4) + 3] > 0) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      if (current >= width) {
        neighbor = current - width;
        if (!visited[neighbor] && pixels[(neighbor * 4) + 3] > 0) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      if (current < pixelCount - width) {
        neighbor = current + width;
        if (!visited[neighbor] && pixels[(neighbor * 4) + 3] > 0) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }

    if (tail < minimumComponentPixels) {
      for (let index = 0; index < tail; index += 1) {
        pixels[(queue[index] * 4) + 3] = 0;
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not clean the product edges.")), "image/png", 1);
  });
}

async function putOnWhiteBackground(foregroundBlob) {
  const image = await createImageBitmap(foregroundBlob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  image.close();
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create the white-background image.")), "image/png", 1);
  });
}

async function withTimeout(promise, milliseconds) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("BACKGROUND_REMOVAL_TIMEOUT")), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function processPhotos() {
  const processablePhotos = state.photos.filter((photo) => photo.preview && !photo.error);
  if (!processablePhotos.length || state.processing) return;
  state.processing = true;
  state.processedCount = 0;
  processablePhotos.forEach((photo) => { photo.status = "queued"; photo.statusLabel = "queued"; photo.error = ""; });
  render();

  const qualityMode = state.quality;
  const model = qualityMode === "best" ? "isnet_fp16" : "isnet_quint8";
  const timeout = qualityMode === "best" ? 240000 : 120000;

  for (const [index, photo] of processablePhotos.entries()) {
    state.processedCount = index;
    photo.status = "processing";
    photo.statusLabel = index === 0
      ? (qualityMode === "best" ? "loading best-quality AI" : "loading AI")
      : "processing";
    render();
    try {
      const transparentBlob = await withTimeout(removeBackground(photo.file, {
        device: "cpu",
        model,
        output: { format: "image/png", quality: 1 },
        progress: (key, current, total) => {
          if (!key.startsWith("fetch:") || !total) return;
          const percent = Math.min(100, Math.round((current / total) * 100));
          photo.statusLabel = percent >= 100 ? "removing background" : `loading ${percent}%`;
          render();
        }
      }), timeout);
      photo.statusLabel = qualityMode === "best" ? "refining light edges" : "cleaning edges";
      render();
      const cleanedTransparentBlob = await cleanAlphaMask(transparentBlob, qualityMode);
      if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
      photo.resultBlob = state.background === "white"
        ? await putOnWhiteBackground(cleanedTransparentBlob)
        : cleanedTransparentBlob;
      photo.resultUrl = URL.createObjectURL(photo.resultBlob);
      photo.status = "complete";
      photo.statusLabel = "ready";
    } catch (error) {
      photo.status = "error";
      photo.statusLabel = "try again";
      photo.error = error?.message === "BACKGROUND_REMOVAL_TIMEOUT"
        ? "The local AI took too long. Refresh the page and try this photo again."
        : "Couldn’t process this photo. Please refresh and try again.";
      console.error("Local background removal failed", error);
    }
    render();
  }
  state.processing = false;
  state.processedCount = 0;
  render();
}

async function downloadAllPhotos() {
  const completed = state.photos
    .map((photo, index) => ({ photo, index }))
    .filter(({ photo }) => photo.resultBlob);
  if (!completed.length || typeof window.JSZip !== "function") return;

  elements.downloadAll.disabled = true;
  elements.downloadAll.textContent = "PACKAGING…";
  try {
    const zip = new window.JSZip();
    completed.forEach(({ photo, index }) => {
      zip.file(resultFileName(photo, index), photo.resultBlob);
    });
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dressup-sesh-clean-photos.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally {
    render();
  }
}

async function createListing() {
  if (!configured || !state.session || !state.photos.length) {
    if (!state.session) elements.authDialog.showModal();
    return;
  }
  elements.listingError.classList.add("hidden");
  elements.listingButton.disabled = true;
  elements.listingButton.textContent = "WRITING LISTING…";
  const body = new FormData();
  state.photos.filter((photo) => photo.preview && !photo.error).forEach((photo, index) => {
    const source = photo.resultBlob || photo.file;
    const name = photo.resultBlob ? `clean-photo-${index + 1}.png` : photo.file.name;
    body.append("images", source, name);
  });
  try {
      const response = await fetch(`${config.supabaseUrl}/functions/v1/create-listing`, {
        method: "POST",
        headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${state.session.access_token}` },
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
elements.downloadAll.addEventListener("click", downloadAllPhotos);
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

$$('[data-quality]').forEach((button) => button.addEventListener("click", () => {
  if (state.processing) return;
  state.quality = button.dataset.quality;
  $$('[data-quality]').forEach((item) => item.classList.toggle("selected", item === button));
}));

elements.authButton.addEventListener("click", async () => {
  if (state.session && supabase) {
    await supabase.auth.signOut();
  } else {
    elements.authMessage.textContent = "";
    elements.authDialog.showModal();
  }
});

$("#dialog-close").addEventListener("click", () => elements.authDialog.close());

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  elements.authMessage.textContent = "Signing in…";
  const { error } = await supabase.auth.signInWithPassword({
    email: elements.authEmail.value.trim(),
    password: elements.authPassword.value,
  });
  if (error) {
    elements.authMessage.textContent = error.message;
  } else {
    elements.authMessage.textContent = "Signed in.";
    setTimeout(() => elements.authDialog.close(), 450);
  }
});

$("#signup-button").addEventListener("click", async () => {
  if (!supabase) return;
  elements.authMessage.textContent = "Creating owner account…";
  const { data, error } = await supabase.auth.signUp({
    email: elements.authEmail.value.trim(),
    password: elements.authPassword.value,
  });
  if (error) {
    elements.authMessage.textContent = error.message;
  } else if (!data.session) {
    elements.authMessage.textContent = "Check your email to confirm the account, then sign in.";
  } else {
    elements.authMessage.textContent = "Owner account created.";
    setTimeout(() => elements.authDialog.close(), 650);
  }
});

render();

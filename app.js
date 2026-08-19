import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const config = window.DRESSUP_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const supabase = configured ? createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
const state = {
  photos: [],
  background: "white",
  processing: false,
  processedCount: 0,
  processingTotal: 0,
  session: null,
  creativeType: "on_body",
  creativeReference: null,
  creativeReferenceUrl: "",
  creativeResultUrl: "",
  creativeGenerating: false,
  editorPhotoId: null,
  editorImage: null,
  editorStrokes: [],
  editorDrawing: false,
  editorCurrentStroke: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const elements = {
  input: $("#file-input"), dropzone: $("#dropzone"), grid: $("#photo-grid"),
  count: $("#photo-count"), actionBar: $("#action-bar"), process: $("#process-button"), downloadAll: $("#download-all"), clearAll: $("#clear-all"),
  setupNote: $("#setup-note"), listingPanel: $("#listing-panel"), photosPanel: $("#photos-panel"), creativePanel: $("#creative-panel"),
  emptyListing: $("#empty-listing"), listingLayout: $("#listing-layout"), sourceStrip: $("#source-strip"),
  listingButton: $("#listing-button"), listingNote: $("#listing-note"), listingAdditional: $("#listing-additional-info"), listingOutput: $("#listing-output"),
  outputPlaceholder: $("#output-placeholder"), listingError: $("#listing-error"), copyButton: $("#copy-button"),
  authButton: $("#auth-button"), authDialog: $("#auth-dialog"), authForm: $("#auth-form"),
  authEmail: $("#auth-email"), authPassword: $("#auth-password"), authMessage: $("#auth-message"),
  loginGate: $("#login-gate"), gateSignIn: $("#gate-signin"), gateMessage: $("#gate-message"),
  emptyCreative: $("#empty-creative"), creativeLayout: $("#creative-layout"), creativeSourceStrip: $("#creative-source-strip"),
  creativeReference: $("#creative-reference"), referencePicker: $("#reference-picker"), referencePreview: $("#reference-preview"),
  referenceImage: $("#reference-image"), removeReference: $("#remove-reference"), creativeInstructions: $("#creative-instructions"),
  creativeGenerate: $("#creative-generate"), creativeOutput: $(".creative-output"), creativePlaceholder: $("#creative-placeholder"),
  creativeOutputImage: $("#creative-output-image"), creativeDownload: $("#creative-download"), creativeError: $("#creative-error"),
  editorDialog: $("#photo-editor-dialog"), editorCanvas: $("#photo-editor-canvas"), editorBrush: $("#editor-brush-size"),
  editorBrushOutput: $("#editor-brush-output"), editorUndo: $("#editor-undo"), editorReset: $("#editor-reset"),
  editorCancel: $("#editor-cancel"), editorApply: $("#editor-apply")
};

const creativeLabels = {
  on_body: "GENERATE ON-THE-BODY PHOTO",
  ghost: "GENERATE GHOST MANNEQUIN",
  influencer: "GENERATE INFLUENCER POST",
  editorial: "GENERATE EDITORIAL IMAGE"
};

if (configured) {
  $("#connection-pill").classList.add("online");
  $("#connection-copy").textContent = "Listing connection ready";
}

async function verifyOwnerSession(session) {
  if (!configured || !session) return false;
  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/create-listing`, {
      method: "GET",
      headers: {
        apikey: config.supabasePublishableKey,
        Authorization: `Bearer ${session.access_token}`
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function refreshSession(session) {
  document.body.classList.add("auth-pending");
  const isOwner = await verifyOwnerSession(session);
  state.session = isOwner ? session : null;
  const locked = !state.session;
  document.body.classList.toggle("studio-locked", locked);
  document.body.classList.remove("auth-pending");
  elements.authButton.textContent = state.session ? "SIGN OUT" : "SIGN IN";
  elements.authButton.classList.toggle("signed-in", Boolean(state.session));
  elements.gateMessage.textContent = session && !isOwner
    ? "This account is not authorized for the private studio."
    : "Sign in with the owner email to continue.";
  if (configured) $("#connection-copy").textContent = state.session ? "Studio ready" : "Sign in required";
  render();
}

if (supabase) {
  const { data } = await supabase.auth.getSession();
  await refreshSession(data.session);
  supabase.auth.onAuthStateChange((_event, session) => { void refreshSession(session); });
} else {
  await refreshSession(null);
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

function removeCreativeReference() {
  if (state.creativeReferenceUrl) URL.revokeObjectURL(state.creativeReferenceUrl);
  state.creativeReference = null;
  state.creativeReferenceUrl = "";
  elements.creativeReference.value = "";
  elements.referenceImage.removeAttribute("src");
  elements.referencePreview.classList.add("hidden");
  elements.referencePicker.classList.remove("hidden");
}

function resetCreativeOutput() {
  if (state.creativeResultUrl) URL.revokeObjectURL(state.creativeResultUrl);
  state.creativeResultUrl = "";
  elements.creativeOutputImage.removeAttribute("src");
  elements.creativeOutputImage.classList.add("hidden");
  elements.creativeDownload.removeAttribute("href");
  elements.creativeDownload.classList.add("hidden");
  elements.creativePlaceholder.classList.remove("hidden");
  elements.creativeError.textContent = "";
  elements.creativeError.classList.add("hidden");
}

function clearAllPhotos() {
  if (!state.photos.length || state.processing || state.creativeGenerating) return;
  if (!window.confirm("Clear this item and start a new one?")) return;
  state.photos.forEach((photo) => {
    if (photo.preview) URL.revokeObjectURL(photo.preview);
    if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
  });
  state.photos = [];
  state.processedCount = 0;
  removeCreativeReference();
  resetCreativeOutput();
  elements.creativeInstructions.value = "";
  elements.listingOutput.textContent = "";
  elements.listingAdditional.value = "";
  elements.listingOutput.classList.add("hidden");
  elements.outputPlaceholder.classList.remove("hidden");
  elements.copyButton.disabled = true;
  elements.listingError.classList.add("hidden");
  elements.input.value = "";
  $("[data-tab='photos']").click();
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function render() {
  const hasPhotos = state.photos.length > 0;
  const usablePhotos = state.photos.filter((photo) => photo.preview && !photo.error);
  const pendingCleanupPhotos = usablePhotos.filter((photo) => !photo.resultBlob);
  const isPreparing = state.photos.some((photo) => photo.status === "converting" || photo.status === "preparing");
  elements.grid.classList.toggle("hidden", !hasPhotos);
  elements.actionBar.classList.toggle("hidden", !hasPhotos);
  elements.count.classList.toggle("hidden", !hasPhotos);
  elements.count.textContent = `${state.photos.length} PHOTO${state.photos.length === 1 ? "" : "S"}`;
  const completedPhotos = state.photos.filter((photo) => photo.resultBlob);
  elements.process.disabled = !configured || !state.session || !pendingCleanupPhotos.length || state.processing || isPreparing;
  elements.downloadAll.disabled = !completedPhotos.length || state.processing;
  elements.clearAll.disabled = state.processing || state.creativeGenerating;
  elements.downloadAll.textContent = completedPhotos.length ? `DOWNLOAD ALL · ${completedPhotos.length}` : "DOWNLOAD ALL";
  elements.process.textContent = state.processing
    ? `PROCESSING ${state.processedCount + 1} OF ${state.processingTotal}…`
    : isPreparing
      ? "PREPARING IPHONE PHOTOS…"
      : pendingCleanupPhotos.length
        ? `REMOVE BACKGROUNDS · ${pendingCleanupPhotos.length}`
        : "ALL PHOTOS READY";
  elements.emptyListing.classList.toggle("hidden", hasPhotos);
  elements.listingLayout.classList.toggle("hidden", !hasPhotos);
  elements.listingButton.disabled = !configured || !state.session || !usablePhotos.length || isPreparing;
  elements.listingNote.classList.toggle("hidden", configured && Boolean(state.session));
  elements.listingNote.textContent = configured ? "Sign in to activate listing generation." : "Connect Supabase to activate listing generation.";
  elements.emptyCreative.classList.toggle("hidden", hasPhotos);
  elements.creativeLayout.classList.toggle("hidden", !hasPhotos);
  elements.creativeGenerate.disabled = !configured || !state.session || !usablePhotos.length || isPreparing || state.creativeGenerating;
  elements.creativeGenerate.textContent = state.creativeGenerating ? "GENERATING…" : creativeLabels[state.creativeType];
  elements.creativeOutput.classList.toggle("generating", state.creativeGenerating);

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
      ${photo.resultUrl ? `<span class="photo-actions"><button class="photo-edit" type="button" data-edit="${photo.id}">EDIT</button><a href="${photo.resultUrl}" download="${resultFileName(photo, index)}">DOWNLOAD</a></span>` : `<span>${Math.max(1, Math.round(photo.file.size / 1024))} KB</span>`}</div>
      ${photo.error ? `<p class="error-text">${photo.error}</p>` : ""}
    </article>`).join("") + (state.photos.length < 20 ? `<button class="add-card" id="add-more"><span>＋</span>Add more</button>` : "");

  elements.sourceStrip.innerHTML = usablePhotos.slice(0, 6).map((photo, index) =>
    `<img src="${photo.preview}" alt="Listing source ${index + 1}">`).join("") +
    (usablePhotos.length > 6 ? `<span>+${usablePhotos.length - 6}</span>` : "");

  elements.creativeSourceStrip.innerHTML = usablePhotos.slice(0, 6).map((photo, index) =>
    `<img src="${photo.preview}" alt="Creative product source ${index + 1}">`).join("") +
    (usablePhotos.length > 6 ? `<span>+${usablePhotos.length - 6}</span>` : "");

  $$('[data-remove]').forEach((button) => button.addEventListener("click", () => removePhoto(button.dataset.remove)));
  $$('[data-edit]').forEach((button) => button.addEventListener("click", () => { void openPhotoEditor(button.dataset.edit); }));
  $("#add-more")?.addEventListener("click", () => elements.input.click());
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not save this edit.")), "image/png", 1);
  });
}

function drawEditorStroke(context, stroke) {
  if (!stroke?.points?.length) return;
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
  }
  context.restore();
}

function redrawPhotoEditor() {
  if (!state.editorImage) return;
  const canvas = elements.editorCanvas;
  const context = canvas.getContext("2d");
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.editorImage, 0, 0);
  state.editorStrokes.forEach((stroke) => drawEditorStroke(context, stroke));
}

function editorPoint(event) {
  const rect = elements.editorCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(elements.editorCanvas.width, (event.clientX - rect.left) * (elements.editorCanvas.width / rect.width))),
    y: Math.max(0, Math.min(elements.editorCanvas.height, (event.clientY - rect.top) * (elements.editorCanvas.height / rect.height)))
  };
}

function beginEditorStroke(event) {
  if (!state.editorImage) return;
  event.preventDefault();
  const rect = elements.editorCanvas.getBoundingClientRect();
  const scale = elements.editorCanvas.width / rect.width;
  const stroke = {
    size: Number(elements.editorBrush.value) * scale,
    points: [editorPoint(event)]
  };
  state.editorDrawing = true;
  state.editorCurrentStroke = stroke;
  state.editorStrokes.push(stroke);
  elements.editorCanvas.setPointerCapture?.(event.pointerId);
  drawEditorStroke(elements.editorCanvas.getContext("2d"), stroke);
}

function continueEditorStroke(event) {
  if (!state.editorDrawing || !state.editorCurrentStroke) return;
  event.preventDefault();
  const previous = state.editorCurrentStroke.points.at(-1);
  const current = editorPoint(event);
  state.editorCurrentStroke.points.push(current);
  drawEditorStroke(elements.editorCanvas.getContext("2d"), {
    size: state.editorCurrentStroke.size,
    points: [previous, current]
  });
}

function endEditorStroke(event) {
  if (!state.editorDrawing) return;
  event.preventDefault();
  state.editorDrawing = false;
  state.editorCurrentStroke = null;
  elements.editorCanvas.releasePointerCapture?.(event.pointerId);
}

function releasePhotoEditor() {
  state.editorImage?.close?.();
  state.editorPhotoId = null;
  state.editorImage = null;
  state.editorStrokes = [];
  state.editorDrawing = false;
  state.editorCurrentStroke = null;
}

function closePhotoEditor() {
  if (elements.editorDialog.open) elements.editorDialog.close();
  else releasePhotoEditor();
}

async function openPhotoEditor(photoId) {
  const photo = state.photos.find((item) => item.id === photoId);
  if (!photo?.resultBlob || state.processing) return;
  releasePhotoEditor();
  state.editorPhotoId = photoId;
  state.editorImage = await createImageBitmap(photo.resultBlob);
  elements.editorCanvas.width = state.editorImage.width;
  elements.editorCanvas.height = state.editorImage.height;
  redrawPhotoEditor();
  elements.editorDialog.showModal();
}

async function applyPhotoEdit() {
  const photo = state.photos.find((item) => item.id === state.editorPhotoId);
  if (!photo || !state.editorImage) return;
  elements.editorApply.disabled = true;
  elements.editorApply.textContent = "SAVING…";
  try {
    let outputCanvas = elements.editorCanvas;
    if (state.background === "white") {
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = elements.editorCanvas.width;
      outputCanvas.height = elements.editorCanvas.height;
      const context = outputCanvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      context.drawImage(elements.editorCanvas, 0, 0);
    }
    const editedBlob = await canvasToPng(outputCanvas);
    if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
    photo.resultBlob = editedBlob;
    photo.resultUrl = URL.createObjectURL(editedBlob);
    photo.status = "complete";
    photo.statusLabel = "edited";
    closePhotoEditor();
    render();
  } finally {
    elements.editorApply.disabled = false;
    elements.editorApply.textContent = "APPLY EDIT";
  }
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare this photo.")), "image/jpeg", quality);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function prepareBackgroundImage(source) {
  const image = await createImageBitmap(source);
  let maxDimension = 1600;
  let quality = 0.84;
  let blob = null;

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await canvasToJpeg(canvas, quality);
      if (blob.size <= 900 * 1024) break;
      maxDimension = Math.round(maxDimension * 0.82);
      quality = Math.max(0.66, quality - 0.06);
    }
  } finally {
    image.close();
  }

  if (!blob) throw new Error("Could not prepare this photo.");
  return new File([blob], "product-photo.jpg", { type: "image/jpeg" });
}

async function removeBackgroundInCloud(photo) {
  if (!state.session) throw new Error("Sign in again before cleaning photos.");
  const compactImage = await prepareBackgroundImage(photo.file);
  const form = new FormData();
  form.append("image", compactImage, "product-photo.jpg");
  form.append("background", state.background);

  const response = await fetch(`${config.supabaseUrl}/functions/v1/remove-product-background`, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      Authorization: `Bearer ${state.session.access_token}`
    },
    body: form
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "The cloud cleanup could not be completed.");
  }
  return await response.blob();
}

async function processPhotos() {
  const processablePhotos = state.photos.filter((photo) => photo.preview && !photo.error && !photo.resultBlob);
  if (!processablePhotos.length || state.processing) return;
  state.processing = true;
  state.processedCount = 0;
  state.processingTotal = processablePhotos.length;
  processablePhotos.forEach((photo) => { photo.status = "queued"; photo.statusLabel = "queued"; photo.error = ""; });
  render();

  for (const [index, photo] of processablePhotos.entries()) {
    state.processedCount = index;
    photo.status = "processing";
    photo.statusLabel = "uploading securely";
    render();
    try {
      const cleanedBlob = await removeBackgroundInCloud(photo);
      if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
      photo.resultBlob = cleanedBlob;
      photo.resultUrl = URL.createObjectURL(photo.resultBlob);
      photo.status = "complete";
      photo.statusLabel = "ready";
    } catch (error) {
      photo.status = "error";
      photo.statusLabel = "try again";
      photo.error = error?.message || "Couldn’t process this photo. Please try again.";
      console.error("Cloud background removal failed", error);
    }
    render();
    if (index < processablePhotos.length - 1) {
      const nextPhoto = processablePhotos[index + 1];
      nextPhoto.statusLabel = "waiting for cloud slot";
      render();
      await wait(4000);
    }
  }
  state.processing = false;
  state.processedCount = 0;
  state.processingTotal = 0;
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

async function prepareListingImage(source) {
  const image = await createImageBitmap(source);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not prepare this photo for listing analysis.")),
      "image/jpeg",
      0.84
    );
  });
}

function selectListingPhotos(photos, maximum = 8) {
  if (photos.length <= maximum) return photos;
  const lastIndex = photos.length - 1;
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round((index * lastIndex) / (maximum - 1));
    return photos[sourceIndex];
  });
}

function cleanListingText(value = "") {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\*/g, "")
    .replace(/^[ \t]*Title[ \t]*:[ \t]*/gim, "")
    .replace(/^[ \t]*Description[ \t]*:[ \t]*/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const additionalInfo = elements.listingAdditional.value.trim();
  if (additionalInfo) body.append("additional_info", additionalInfo);
  const usablePhotos = state.photos.filter((photo) => photo.preview && !photo.error);
  const selectedPhotos = selectListingPhotos(usablePhotos);
  try {
    for (const [index, photo] of selectedPhotos.entries()) {
      elements.listingButton.textContent = `PREPARING ${index + 1} OF ${selectedPhotos.length}…`;
      const source = photo.resultBlob || photo.file;
      const compactImage = await prepareListingImage(source);
      body.append("images", compactImage, `listing-photo-${index + 1}.jpg`);
    }
    elements.listingButton.textContent = "WRITING LISTING…";
    const response = await fetch(`${config.supabaseUrl}/functions/v1/create-listing`, {
        method: "POST",
        headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${state.session.access_token}` },
      body
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.error || "The listing could not be generated. Please try again.");
    }
    const data = await response.json();
    const listing = cleanListingText(data.listing);
    elements.listingOutput.textContent = listing;
    elements.listingOutput.classList.remove("hidden");
    elements.outputPlaceholder.classList.add("hidden");
    elements.copyButton.disabled = !listing;
  } catch (error) {
    elements.listingError.textContent = error?.message || "The listing could not be generated. Please try again.";
    elements.listingError.classList.remove("hidden");
  } finally {
    elements.listingButton.disabled = false;
    elements.listingButton.textContent = "CREATE TITLE + DESCRIPTION";
  }
}

function base64ToBlob(value, mimeType = "image/jpeg") {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function generateCreativeImage() {
  if (!configured || !state.session || !state.photos.length || state.creativeGenerating) return;
  const usablePhotos = state.photos.filter((photo) => photo.preview && !photo.error);
  if (!usablePhotos.length) return;

  state.creativeGenerating = true;
  elements.creativeError.classList.add("hidden");
  render();
  const body = new FormData();
  body.append("type", state.creativeType);
  body.append("instructions", elements.creativeInstructions.value.trim());

  try {
    const selectedPhotos = selectListingPhotos(usablePhotos, 6);
    for (const [index, photo] of selectedPhotos.entries()) {
      elements.creativeGenerate.textContent = `PREPARING PRODUCT ${index + 1} OF ${selectedPhotos.length}…`;
      const compactImage = await prepareListingImage(photo.file);
      body.append("images", compactImage, `product-${index + 1}.jpg`);
    }

    if (state.creativeReference) {
      elements.creativeGenerate.textContent = "PREPARING REFERENCE…";
      const compactReference = await prepareListingImage(state.creativeReference);
      body.append("reference", compactReference, "creative-reference.jpg");
    }

    elements.creativeGenerate.textContent = "GENERATING…";
    const response = await fetch(`${config.supabaseUrl}/functions/v1/generate-product-photo`, {
      method: "POST",
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${state.session.access_token}` },
      body
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.error || "The creative image could not be generated. Please try again.");
    }

    const data = await response.json();
    if (!data.image) throw new Error("The image generator returned no image. Please try again.");
    const blob = base64ToBlob(data.image, data.mimeType || "image/jpeg");
    resetCreativeOutput();
    state.creativeResultUrl = URL.createObjectURL(blob);
    elements.creativeOutputImage.src = state.creativeResultUrl;
    elements.creativeOutputImage.classList.remove("hidden");
    elements.creativePlaceholder.classList.add("hidden");
    elements.creativeDownload.href = state.creativeResultUrl;
    elements.creativeDownload.download = `dressup-sesh-${state.creativeType.replaceAll("_", "-")}.jpg`;
    elements.creativeDownload.classList.remove("hidden");
  } catch (error) {
    elements.creativeError.textContent = error?.message || "The creative image could not be generated. Please try again.";
    elements.creativeError.classList.remove("hidden");
  } finally {
    state.creativeGenerating = false;
    render();
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
elements.clearAll.addEventListener("click", clearAllPhotos);
elements.listingButton.addEventListener("click", createListing);
elements.emptyListing.addEventListener("click", () => { $("[data-tab='photos']").click(); elements.input.click(); });
elements.emptyCreative.addEventListener("click", () => { $("[data-tab='photos']").click(); elements.input.click(); });
elements.creativeGenerate.addEventListener("click", generateCreativeImage);
elements.editorCanvas.addEventListener("pointerdown", beginEditorStroke);
elements.editorCanvas.addEventListener("pointermove", continueEditorStroke);
elements.editorCanvas.addEventListener("pointerup", endEditorStroke);
elements.editorCanvas.addEventListener("pointercancel", endEditorStroke);
elements.editorBrush.addEventListener("input", () => { elements.editorBrushOutput.textContent = elements.editorBrush.value; });
elements.editorUndo.addEventListener("click", () => {
  state.editorStrokes.pop();
  redrawPhotoEditor();
});
elements.editorReset.addEventListener("click", () => {
  state.editorStrokes = [];
  redrawPhotoEditor();
});
elements.editorCancel.addEventListener("click", closePhotoEditor);
elements.editorApply.addEventListener("click", () => {
  void applyPhotoEdit().catch((error) => window.alert(error?.message || "Could not save this edit."));
});
elements.editorDialog.addEventListener("close", releasePhotoEditor);
elements.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.listingOutput.textContent);
  elements.copyButton.textContent = "COPIED";
  setTimeout(() => { elements.copyButton.textContent = "COPY ALL"; }, 1200);
});

$$('[data-tab]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-tab]').forEach((item) => item.classList.toggle("active", item === button));
  const activeTab = button.dataset.tab;
  elements.photosPanel.classList.toggle("hidden", activeTab !== "photos");
  elements.listingPanel.classList.toggle("hidden", activeTab !== "listing");
  elements.creativePanel.classList.toggle("hidden", activeTab !== "creative");
}));

$$('[data-creative-type]').forEach((button) => button.addEventListener("click", () => {
  if (state.creativeGenerating) return;
  state.creativeType = button.dataset.creativeType;
  $$('[data-creative-type]').forEach((item) => item.classList.toggle("selected", item === button));
  resetCreativeOutput();
  render();
}));

elements.referencePicker.addEventListener("click", () => elements.creativeReference.click());
elements.removeReference.addEventListener("click", removeCreativeReference);
elements.creativeReference.addEventListener("change", async () => {
  let file = elements.creativeReference.files?.[0];
  if (!file) return;
  try {
    elements.referencePicker.innerHTML = "<strong>PREPARING REFERENCE…</strong>";
    if (isHeicFile(file)) file = await convertHeicFile(file);
    removeCreativeReference();
    state.creativeReference = file;
    state.creativeReferenceUrl = URL.createObjectURL(file);
    elements.referenceImage.src = state.creativeReferenceUrl;
    elements.referencePicker.classList.add("hidden");
    elements.referencePreview.classList.remove("hidden");
  } catch (error) {
    elements.creativeError.textContent = "That reference photo could not be prepared. Please try a JPG or PNG.";
    elements.creativeError.classList.remove("hidden");
  } finally {
    elements.referencePicker.innerHTML = "<span>＋</span><strong>Add inspiration photo</strong><small>JPG, PNG, WEBP or HEIC</small>";
  }
});

$$('[data-background]').forEach((button) => button.addEventListener("click", () => {
  if (state.processing || state.background === button.dataset.background) return;
  state.background = button.dataset.background;
  state.photos.forEach((photo) => {
    if (!photo.resultBlob) return;
    if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
    photo.resultBlob = null;
    photo.resultUrl = "";
    photo.status = "ready";
    photo.statusLabel = "ready";
  });
  $$('[data-background]').forEach((item) => item.classList.toggle("selected", item === button));
  render();
}));

elements.gateSignIn.addEventListener("click", () => {
  elements.authMessage.textContent = "";
  elements.authDialog.showModal();
});

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

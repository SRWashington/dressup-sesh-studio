import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, errorResponse, requireOwner } from "../_shared/security.ts";

const creativePrompts: Record<string, { label: string; size: string; direction: string }> = {
  on_body: {
    label: "on-the-body fit photo",
    size: "1024x1536",
    direction: "Create a photorealistic vertical on-the-body fit photo with the casual polish of a naturally captured iPhone image. Show the exact product being worn or carried appropriately. Use believable proportions, natural light, realistic fabric drape or product structure, and an uncluttered setting."
  },
  ghost: {
    label: "ghost mannequin image",
    size: "1024x1024",
    direction: "Create a clean square ghost-mannequin product image on a warm white studio background. For apparel, show the garment's true construction, fit, sleeve and hem shape with a professional invisible-mannequin effect. If the product is not apparel, create a centered product-only studio hero image instead of inventing a mannequin treatment."
  },
  influencer: {
    label: "social media influencer post",
    size: "1024x1536",
    direction: "Create a photorealistic vertical social-media influencer image that feels candid, stylish and believable rather than like a commercial render. Make the exact product the visual focus while styling it naturally in an aspirational everyday scene."
  },
  editorial: {
    label: "styled layout editorial image",
    size: "1024x1024",
    direction: "Create a square magazine-inspired styled product layout or elevated flat lay. Use tasteful complementary props, refined lighting and strong editorial composition, but never cover important product details or introduce another competing product."
  }
};

function json(data: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function validImage(file: File) {
  return /^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type) && file.size <= 12 * 1024 * 1024;
}

function buildPrompt(type: string, productCount: number, hasReference: boolean, instructions: string) {
  const creative = creativePrompts[type];
  const referenceRule = hasReference
    ? `The final input image is an inspiration reference. Use it only for pose, framing, camera angle, setting, lighting mood or layout. Do not copy its product, garment, color, pattern, branding, hardware, person identity or face.`
    : "No separate inspiration image was supplied; choose a commercially useful composition yourself.";
  const userDirection = instructions ? `Additional direction from the owner: ${instructions}` : "";

  return `Create one ${creative.label} for a resale listing and social commerce workflow.

The first ${productCount} input images show the same exact product from multiple angles and are the only source of truth for the item. Preserve its exact silhouette, proportions, color, material appearance, print, stitching, closures, hardware, heel and toe shape, straps, handles, pockets, labels and visible wear. Never add, remove, duplicate or redesign product features. Never invent a shoulder strap, accessory, logo or texture that is not clearly shown in the product photos.

${referenceRule}

${creative.direction}

${userDirection}

Keep the product recognizable and listing-accurate. No text, captions, borders, collages, watermarks or added brand marks. Return one finished photorealistic image.`;
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    const user = await requireOwner(request);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("NOT_CONFIGURED");

    const form = await request.formData();
    const type = String(form.get("type") || "");
    const creative = creativePrompts[type];
    if (!creative) return json({ error: "Choose a valid creative image format." }, 400, cors);

    const images = form.getAll("images").filter((value): value is File => value instanceof File).slice(0, 6);
    if (!images.length) return json({ error: "Add at least one product photo first." }, 400, cors);
    if (images.some((image) => !validImage(image))) {
      return json({ error: "Product references must be JPG, PNG or WEBP files no larger than 12 MB." }, 415, cors);
    }

    const referenceValue = form.get("reference");
    const reference = referenceValue instanceof File && referenceValue.size ? referenceValue : null;
    if (reference && !validImage(reference)) {
      return json({ error: "The inspiration photo must be a JPG, PNG or WEBP file no larger than 12 MB." }, 415, cors);
    }
    const instructions = String(form.get("instructions") || "").trim().slice(0, 500);

    const upstream = new FormData();
    upstream.append("model", "gpt-image-2");
    images.forEach((image, index) => upstream.append("image[]", image, `product-${index + 1}.jpg`));
    if (reference) upstream.append("image[]", reference, "inspiration-reference.jpg");
    upstream.append("prompt", buildPrompt(type, images.length, Boolean(reference), instructions));
    upstream.append("input_fidelity", "high");
    upstream.append("quality", "medium");
    upstream.append("size", creative.size);
    upstream.append("background", "opaque");
    upstream.append("output_format", "jpeg");
    upstream.append("output_compression", "90");
    upstream.append("n", "1");
    if (user?.id) upstream.append("user", String(user.id));

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error("OpenAI image error", response.status, JSON.stringify(payload).slice(0, 1200));
      const errorCode = String(payload?.error?.code || "");
      const billingCodes = new Set([
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded"
      ]);
      const message = response.status === 429 && billingCodes.has(errorCode)
        ? "OpenAI image billing needs attention. Add credits or raise the project spending limit, then try again."
        : response.status === 429
          ? "OpenAI is temporarily rate-limiting image requests. Wait a minute and try again."
          : response.status === 401
            ? "The OpenAI API key was rejected. Replace OPENAI_API_KEY in Supabase and try again."
            : response.status === 403
              ? "OpenAI image access may require organization verification in the API dashboard."
              : "The creative image could not be generated. Please try again.";
      return json({ error: message, code: errorCode || undefined }, response.status, cors);
    }

    const image = payload?.data?.[0]?.b64_json;
    if (!image) throw new Error("INVALID_IMAGE_OUTPUT");
    return json({
      image,
      mimeType: "image/jpeg",
      format: type,
      usage: payload?.usage || null
    }, 200, cors);
  } catch (error) {
    console.error("generate-product-photo error", error);
    return errorResponse(error, cors);
  }
});

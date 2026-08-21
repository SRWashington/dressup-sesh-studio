import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, errorResponse, requireOwner } from "../_shared/security.ts";

const prompt = `You are Dressup Sesh Listing Studio, a precision Poshmark listing writer.

Study every supplied photo as one product. Return ONLY a finished listing in this exact layout:

[Brand + model/style + color + material + item type + size]

[Product paragraph identifying the item, color, material, silhouette and distinctive design features.]

[Trend and styling paragraph using only visually appropriate fashion searches, eras and styling ideas.]

Size: [size]
Heel: [approximate measurement, only when applicable and visible]
Measurements: [all legible product dimensions and units shown in measurement photos; omit only when none are supplied]
[Material facts, one per plain line]
[Country of manufacture, only when visible]

[One accurate condition paragraph based only on visible wear.]

Keywords: [comma-separated search phrases]

Estimated era: [cautious estimate]
Approx. original retail: [$XX–$XX]

Rules:
- Begin with the title itself on the first line and end immediately after original retail.
- Keep the title on one line, followed by one blank line and then the description.
- Never include “Title” or “Description” labels or headings.
- Never use Markdown, asterisks or bold formatting anywhere.
- Never add introductions, explanations, notes, questions, confidence, product ID, key details, pricing advice, suggested listing price, photo recommendations, checklists, bullets, tables or READY TO POST.
- Never invent a brand, model, material, size, measurement or country.
- Treat measurement photos as high-priority evidence. Transcribe every legible product measurement and unit; do not replace dimensions with “OS.”
- Never claim a shoulder, crossbody or removable strap unless the strap itself is visibly included. Strap rings or attachment hardware alone are not proof.
- Describe leather grain or finish only when it is unmistakably visible. Do not infer pebbled, smooth, saffiano or other texture from the product category.
- Read labels and measurement photos carefully. Omit entire lines for facts that cannot be verified or reasonably inferred; never write “not visible,” “unknown” or similar placeholders.
- Use “approx.” for measurements read from photos.
- Describe only wear visible in the photographs.
- Do not call an item vintage unless its age supports the term, and never call it rare without proof.`;

function cleanListing(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\*/g, "")
    .replace(/^[ \t]*Title[ \t]*:[ \t]*/gim, "")
    .replace(/^[ \t]*Description[ \t]*:[ \t]*/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  try {
    await requireOwner(request);
    if (request.method === "GET") {
      return new Response(JSON.stringify({ owner: true }), {
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("NOT_CONFIGURED");

    const form = await request.formData();
    const additionalInfo = String(form.get("additional_info") || "").trim().slice(0, 2000);
    const images = form.getAll("images").filter((value): value is File => value instanceof File).slice(0, 10);
    if (!images.length) {
      return new Response(JSON.stringify({ error: "At least one product image is required." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const requestedReferenceCount = Number.parseInt(String(form.get("reference_count") || "0"), 10);
    const referenceCount = Number.isFinite(requestedReferenceCount)
      ? Math.max(0, Math.min(images.length, requestedReferenceCount))
      : 0;

    const additionalInfoBlock = additionalInfo
      ? `\n\nOWNER-SUPPLIED REFERENCE INFORMATION (trusted facts for this item):\n${additionalInfo}\n\nUse all relevant owner-supplied facts naturally in the exact listing layout. Treat these facts as higher priority than visual inference when they conflict. Do not mention that reference information was supplied and do not create an extra notes section.`
      : "";
    const referencePhotoBlock = referenceCount
      ? `\n\nPHOTO ROLES: The first ${referenceCount} image${referenceCount === 1 ? " is" : "s are"} REFERENCE-ONLY evidence for labels, measurements, materials, condition details or other facts. Read them carefully and give their legible factual information priority. They are not cleaned listing photos, so do not describe rulers, measuring tapes, hands, backgrounds or staging objects as product features or included accessories. The remaining images show the product for appearance and presentation.`
      : "";
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: `${prompt}${referencePhotoBlock}${additionalInfoBlock}` }];
    for (const image of images) {
      if (!/^(image\/png|image\/jpeg|image\/webp|image\/gif)$/i.test(image.type)) {
        return new Response(JSON.stringify({ error: "Process HEIC photos first so listing analysis can use the JPEG results." }), { status: 415, headers: { ...cors, "Content-Type": "application/json" } });
      }
      if (image.size > 12 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "Each image must be 12 MB or smaller." }), { status: 413, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const encoded = toBase64(new Uint8Array(await image.arrayBuffer()));
      content.push({ type: "input_image", image_url: `data:${image.type};base64,${encoded}`, detail: "high" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 1400,
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "poshmark_listing",
            strict: true,
            schema: {
              type: "object",
              properties: { listing: { type: "string" } },
              required: ["listing"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error("OpenAI error", response.status, JSON.stringify(payload).slice(0, 1000));
      const errorCode = String(payload?.error?.code || "");
      const billingCodes = new Set([
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
      ]);
      const message = response.status === 429 && billingCodes.has(errorCode)
        ? "OpenAI API billing needs attention. Add credits or raise the project spending limit, then try again."
        : response.status === 429
          ? "OpenAI is temporarily rate-limiting requests. Wait a minute and try again."
          : response.status === 401
            ? "The OpenAI API key was rejected. Replace OPENAI_API_KEY in Supabase and try again."
            : "Listing generation failed. Please try again.";
      return new Response(JSON.stringify({ error: message, code: errorCode || undefined }), {
        status: response.status,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const outputText = payload.output_text || payload.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || []).find((item: { type?: string }) => item.type === "output_text")?.text;
    const parsed = JSON.parse(outputText || "{}");
    if (!parsed.listing) throw new Error("INVALID_MODEL_OUTPUT");
    const listing = cleanListing(String(parsed.listing));
    if (!listing) throw new Error("INVALID_MODEL_OUTPUT");
    return new Response(JSON.stringify({ listing }), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("create-listing error", error);
    return errorResponse(error, cors);
  }
});

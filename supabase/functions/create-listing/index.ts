import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  completeStudioUsage,
  corsHeaders,
  errorResponse,
  getStudioAccess,
  requireUser,
  reserveStudioUsage,
  type StudioUser,
} from "../_shared/security.ts";

const listingModel = "gpt-5.6-luna";

const prompt = `You are Dressup Sesh Listing Studio, a precision Poshmark listing writer.

Study every supplied photo as one product. Return ONLY a finished listing in this exact layout:

[SEO-focused title: Brand + confirmed model/style + color + material + high-intent item type + useful size only]

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
[Original MSRP: $XX when an exact price is legible in a supplied photo or screenshot; otherwise Approx. original retail: $XX–$XX]

Rules:
- Begin with the title itself on the first line and end immediately after original retail.
- Keep the title on one line, followed by one blank line and then the description.
- Write the title in Title Case. The first letter of every title word must be capitalized, including a brand that is normally styled in lowercase.
- Make the title search-optimized: lead with the brand and confirmed model/style, then use accurate high-intent buyer terms for category, color, material, silhouette and genuinely relevant trend or aesthetic. Prefer specific searchable terms over generic filler.
- Do not put “One Size” or “OS” in the title. Keep a verified size in the Size line when useful, but do not let a generic size displace stronger searchable title terms.
- Never include “Title” or “Description” labels or headings.
- Never use Markdown, asterisks or bold formatting anywhere.
- Never add introductions, explanations, notes, questions, confidence, product ID, key details, pricing advice, suggested listing price, photo recommendations, checklists, bullets, tables or READY TO POST.
- Never invent a brand, model, material, size, measurement or country.
- Treat measurement photos as high-priority evidence. Transcribe every legible product measurement and unit; do not replace dimensions with “OS.”
- Never claim a shoulder, crossbody or removable strap unless the strap itself is visibly included. Strap rings or attachment hardware alone are not proof.
- Describe leather grain or finish only when it is unmistakably visible. Do not infer pebbled, smooth, saffiano or other texture from the product category.
- Read labels and measurement photos carefully. Omit entire lines for facts that cannot be verified or reasonably inferred; never write “not visible,” “unknown” or similar placeholders.
- Use “approx.” for measurements read from photos.
- If no flaws or wear are visible, assume good condition and write exactly “Good condition. No wear visible.” If the item is visibly new with tags, state that first and use “No wear visible,” never “no wear visible in the photographs” or similar hedging.
- If flaws or wear are visible, describe only those specific visible issues and do not add unverified flaws.
- When a supplied tag, receipt or original-retail screenshot shows one exact MSRP, write “Original MSRP: $XX” with that exact amount. Never turn one known price into a range or write a duplicate range such as “$38–$38.” Use an approximate range only when no exact documented MSRP is supplied.
- Do not call an item vintage unless its age supports the term, and never call it rare without proof.`;

function cleanListing(value: string) {
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/\*/g, "")
    .replace(/^[ \t]*Title[ \t]*:[ \t]*/gim, "")
    .replace(/^[ \t]*Description[ \t]*:[ \t]*/gim, "")
    .replace(/\bno visible wear (?:noted )?(?:in|from) (?:the )?(?:supplied )?(?:photos|photographs|images)\.?/gi, "No wear visible.")
    .replace(/\bno wear visible (?:in|from) (?:the )?(?:supplied )?(?:photos|photographs|images)\.?/gi, "No wear visible.")
    .replace(/^(?:Approx\. original retail|Original MSRP):[ \t]*\$([0-9][0-9,]*(?:\.\d{2})?)[ \t]*[–—-][ \t]*\$\1[ \t]*$/gim, (_match, amount) => `Original MSRP: $${amount}`)
    .replace(/\$([0-9][0-9,]*(?:\.\d{2})?)[ \t]*[–—-][ \t]*\$\1\b/g, (_match, amount) => `$${amount}`)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleaned.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex >= 0) {
    lines[titleIndex] = lines[titleIndex]
      .replace(/\b(?:One Size|OS)\b/gi, "")
      .replace(/(^|[\s(/&+–—-])([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return lines.join("\n").trim();
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

  let user: StudioUser | null = null;
  let reservationId = 0;
  let reservationCompleted = false;
  try {
    user = await requireUser(request);
    if (request.method === "GET") {
      const url = new URL(request.url);
      const clientItemId = url.searchParams.get("client_item_id");
      const access = await getStudioAccess(user, clientItemId);
      return new Response(JSON.stringify({ access }), {
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("NOT_CONFIGURED");

    const form = await request.formData();
    const clientItemId = String(form.get("client_item_id") || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientItemId)) {
      return new Response(JSON.stringify({ error: "Start a new item and try again." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
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

    const access = await reserveStudioUsage(user, clientItemId, "listing_copy");
    reservationId = Number(access.reservation_id || 0);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: listingModel,
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
      await completeStudioUsage(user, reservationId, {
        success: false,
        provider: "openai",
        model: listingModel,
        providerUsage: { status: response.status, code: payload?.error?.code || null },
      });
      reservationCompleted = true;
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
    await completeStudioUsage(user, reservationId, {
      success: true,
      provider: "openai",
      model: listingModel,
      providerUsage: payload?.usage || null,
    });
    reservationCompleted = true;
    return new Response(JSON.stringify({ listing, access }), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    if (user && reservationId && !reservationCompleted) {
      await completeStudioUsage(user, reservationId, {
        success: false,
        provider: "openai",
        model: listingModel,
        providerUsage: { error: error instanceof Error ? error.message : "UNKNOWN" },
      }).catch((completionError) => console.error("create-listing usage completion error", completionError));
    }
    console.error("create-listing error", error);
    return errorResponse(error, cors);
  }
});

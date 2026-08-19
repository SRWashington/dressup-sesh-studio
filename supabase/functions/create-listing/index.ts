import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, errorResponse, requireOwner } from "../_shared/security.ts";

const prompt = `You are Dressup Sesh Listing Studio, a precision Poshmark listing writer.

Study every supplied photo as one product. Return ONLY a finished listing in this exact layout:

**Title:**
[Brand + model/style + color + material + item type + size]

**Description:**
[Product paragraph identifying the item, color, material, silhouette and distinctive design features. Bold a confirmed model/style name once.]

[Trend and styling paragraph using only visually appropriate fashion searches, eras and styling ideas.]

**Size:** [size]
**Heel:** [approximate measurement, only when applicable and visible]
[Material facts, one per plain line]
[Country of manufacture, only when visible]

[One accurate condition paragraph based only on visible wear.]

**Keywords:** [comma-separated search phrases]

**Estimated era:** [cautious estimate]
**Approx. original retail:** **[$XX–$XX]**

Rules:
- Begin with **Title:** and end immediately after original retail.
- Keep the title on one line.
- Never add introductions, explanations, notes, questions, confidence, product ID, key details, pricing advice, suggested listing price, photo recommendations, checklists, bullets, tables or READY TO POST.
- Never invent a brand, model, material, size, measurement or country.
- Read labels and measurement photos carefully. Omit facts that cannot be verified or reasonably inferred.
- Use “approx.” for measurements read from photos.
- Describe only wear visible in the photographs.
- Do not call an item vintage unless its age supports the term, and never call it rare without proof.`;

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
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    await requireOwner(request);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("NOT_CONFIGURED");

    const form = await request.formData();
    const images = form.getAll("images").filter((value): value is File => value instanceof File).slice(0, 10);
    if (!images.length) {
      return new Response(JSON.stringify({ error: "At least one product image is required." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
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
        model: "gpt-5.6-terra",
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
      return new Response(JSON.stringify({ error: "Listing generation failed." }), { status: response.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const outputText = payload.output_text || payload.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || []).find((item: { type?: string }) => item.type === "output_text")?.text;
    const parsed = JSON.parse(outputText || "{}");
    if (!parsed.listing) throw new Error("INVALID_MODEL_OUTPUT");
    return new Response(JSON.stringify({ listing: parsed.listing }), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("create-listing error", error);
    return errorResponse(error, cors);
  }
});

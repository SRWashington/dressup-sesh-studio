import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, errorResponse, requireOwner } from "../_shared/security.ts";

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    await requireOwner(request);
    const apiKey = Deno.env.get("REMOVE_BG_API_KEY");
    if (!apiKey) throw new Error("NOT_CONFIGURED");

    const incoming = await request.formData();
    const image = incoming.get("image");
    const background = incoming.get("background") === "transparent" ? "transparent" : "white";
    if (!(image instanceof File)) {
      return new Response(JSON.stringify({ error: "An image file is required." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (image.size > 12 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Images must be 12 MB or smaller." }), { status: 413, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const body = new FormData();
    body.append("image_file", image, image.name);
    body.append("size", "auto");
    body.append("format", "png");
    body.append("type", "product");
    if (background === "white") body.append("bg_color", "FFFFFF");

    const result = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body,
    });
    if (!result.ok) {
      const detail = await result.text();
      console.error("remove.bg error", result.status, detail.slice(0, 500));
      return new Response(JSON.stringify({ error: "Background removal failed for this photo." }), { status: result.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(await result.arrayBuffer(), {
      headers: { ...cors, "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, cors);
  }
});

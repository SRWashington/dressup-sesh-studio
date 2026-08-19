import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, errorResponse, requireOwner } from "../_shared/security.ts";

const modelVersion = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";
const allowedOutputHosts = ["replicate.delivery", "pbxt.replicate.delivery"];

function json(data: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validImage(file: File) {
  return /^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type) && file.size <= 4 * 1024 * 1024;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeOutputUrl(value: unknown) {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object" && "url" in value
      ? String((value as { url: unknown }).url)
      : "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const allowed = url.protocol === "https:" && allowedOutputHosts.some((host) =>
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
    return allowed ? url : null;
  } catch {
    return null;
  }
}

async function predictionResult(initial: Record<string, unknown>, token: string) {
  let prediction = initial;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (prediction.output) return prediction;
    if (["failed", "canceled"].includes(String(prediction.status || ""))) return prediction;
    const getUrl = String((prediction.urls as Record<string, unknown> | undefined)?.get || "");
    if (!getUrl) return prediction;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return prediction;
    prediction = await response.json();
  }
  return prediction;
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  try {
    await requireOwner(request);
    const token = Deno.env.get("REPLICATE_API_TOKEN");
    if (!token) {
      return json({ error: "Replicate background cleanup is not configured yet." }, 503, cors);
    }

    const form = await request.formData();
    const imageValue = form.get("image");
    if (!(imageValue instanceof File) || !imageValue.size) {
      return json({ error: "Add a product photo first." }, 400, cors);
    }
    if (!validImage(imageValue)) {
      return json({ error: "Cleanup photos must be JPG, PNG or WEBP files no larger than 4 MB." }, 415, cors);
    }
    const background = String(form.get("background") || "white") === "transparent" ? "transparent" : "white";
    const bytes = new Uint8Array(await imageValue.arrayBuffer());
    const dataUri = `data:${imageValue.type};base64,${bytesToBase64(bytes)}`;

    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=45",
        "Cancel-After": "60s",
      },
      body: JSON.stringify({
        version: modelVersion,
        input: {
          image: dataUri,
          threshold: 0,
          reverse: false,
          background_type: background === "transparent" ? "rgba" : "white",
          format: "png",
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Replicate create prediction error", response.status, JSON.stringify(payload).slice(0, 1200));
      const message = response.status === 401
        ? "The Replicate token was rejected. Replace REPLICATE_API_TOKEN in Supabase."
        : response.status === 402
          ? "Replicate billing needs attention. Add credit in Replicate and try again."
          : response.status === 429
            ? "Replicate is temporarily rate-limiting requests. Wait a moment and try again."
            : "The cloud cleanup could not be started. Please try again.";
      return json({ error: message }, response.status, cors);
    }

    const prediction = await predictionResult(payload, token);
    if (["failed", "canceled"].includes(String(prediction.status || ""))) {
      console.error("Replicate prediction failed", JSON.stringify(prediction).slice(0, 1200));
      return json({ error: "The background remover could not process this photo. Try another angle or crop." }, 422, cors);
    }
    const outputUrl = safeOutputUrl(prediction.output);
    if (!outputUrl) {
      return json({ error: "The background remover is still busy. Please try this photo again." }, 504, cors);
    }

    const outputResponse = await fetch(outputUrl);
    if (!outputResponse.ok) throw new Error("OUTPUT_FETCH_FAILED");
    const outputType = outputResponse.headers.get("content-type") || "image/png";
    if (!outputType.startsWith("image/")) throw new Error("INVALID_OUTPUT_TYPE");
    const output = await outputResponse.arrayBuffer();
    if (!output.byteLength || output.byteLength > 20 * 1024 * 1024) throw new Error("INVALID_OUTPUT_SIZE");

    return new Response(output, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": outputType,
        "Cache-Control": "no-store",
        "Content-Disposition": "inline; filename=clean-product.png",
      },
    });
  } catch (error) {
    console.error("remove-product-background error", error);
    return errorResponse(error, cors);
  }
});

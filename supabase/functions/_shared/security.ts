const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://srwashington.github.io")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export async function requireOwner(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const publishableKey = publishableKeys
    ? JSON.parse(publishableKeys).default
    : Deno.env.get("SUPABASE_ANON_KEY");
  const ownerEmail = Deno.env.get("OWNER_EMAIL")?.trim().toLowerCase();
  if (!projectUrl || !publishableKey || !ownerEmail) throw new Error("NOT_CONFIGURED");

  const response = await fetch(`${projectUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: publishableKey },
  });
  if (!response.ok) throw new Error("UNAUTHORIZED");
  const user = await response.json();
  if (String(user.email || "").toLowerCase() !== ownerEmail) throw new Error("FORBIDDEN");
  return user;
}

export function errorResponse(error: unknown, headers: Record<string, string>) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "NOT_CONFIGURED" ? 503 : 500;
  const message = status === 503 ? "The studio is not fully configured yet." : status < 500 ? "You do not have access to this studio." : "The request could not be completed.";
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

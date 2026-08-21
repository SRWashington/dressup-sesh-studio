const configuredOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "https://srwashington.github.io")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export type StudioUser = { id: string; email?: string; owner: boolean };
export type StudioAccess = {
  allowed: boolean;
  reason?: string;
  reservation_id?: number;
  owner?: boolean;
  plan?: string;
  items_used?: number;
  item_limit?: number | null;
  items_remaining?: number | null;
  current_item_started?: boolean;
  operation?: string;
  operation_used?: number;
  operation_limit?: number | null;
};

export class StudioAccessError extends Error {
  access: StudioAccess;
  constructor(access: StudioAccess) {
    super(access.reason || "ACCESS_DENIED");
    this.access = access;
  }
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "X-Studio-Items-Remaining, X-Studio-Owner",
    "Vary": "Origin",
  };
}

function parseDefaultKey(value: string | undefined) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return String(parsed?.default || Object.values(parsed || {})[0] || "");
  } catch {
    return value;
  }
}

function projectConfig() {
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = parseDefaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = parseDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!projectUrl || !publishableKey || !secretKey) throw new Error("NOT_CONFIGURED");
  return { projectUrl, publishableKey, secretKey };
}

export async function requireUser(request: Request): Promise<StudioUser> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const { projectUrl, publishableKey } = projectConfig();
  const response = await fetch(`${projectUrl}/auth/v1/user`, { headers: { Authorization: authorization, apikey: publishableKey } });
  if (!response.ok) throw new Error("UNAUTHORIZED");
  const user = await response.json();
  if (!user?.id) throw new Error("UNAUTHORIZED");
  const ownerEmail = Deno.env.get("OWNER_EMAIL")?.trim().toLowerCase() || "";
  return {
    id: String(user.id),
    email: String(user.email || ""),
    owner: Boolean(ownerEmail && String(user.email || "").toLowerCase() === ownerEmail),
  };
}

export async function requireOwner(request: Request) {
  const user = await requireUser(request);
  if (!user.owner) throw new Error("FORBIDDEN");
  return user;
}

async function rpc(name: string, body: Record<string, unknown>) {
  const { projectUrl, secretKey } = projectConfig();
  const response = await fetch(`${projectUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: secretKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`Studio RPC ${name} failed`, response.status, JSON.stringify(payload).slice(0, 800));
    throw new Error("ACCESS_SERVICE_ERROR");
  }
  return payload;
}

export async function getStudioAccess(user: StudioUser, clientItemId?: string | null): Promise<StudioAccess> {
  const access = await rpc("studio_authorize_operation", {
    p_user_id: user.id,
    p_is_owner: user.owner,
    p_client_item_id: clientItemId || null,
    p_operation: null,
  }) as StudioAccess;
  if (!access?.allowed) throw new StudioAccessError(access || { allowed: false, reason: "ACCESS_SERVICE_ERROR" });
  return access;
}

export async function reserveStudioUsage(user: StudioUser, clientItemId: string, operation: string): Promise<StudioAccess> {
  const access = await rpc("studio_authorize_operation", {
    p_user_id: user.id,
    p_is_owner: user.owner,
    p_client_item_id: clientItemId,
    p_operation: operation,
  }) as StudioAccess;
  if (!access?.allowed || !access.reservation_id) throw new StudioAccessError(access || { allowed: false, reason: "ACCESS_SERVICE_ERROR" });
  return access;
}

export async function completeStudioUsage(
  user: StudioUser,
  reservationId: number,
  options: { success: boolean; provider?: string | null; model?: string | null; estimatedCostMicros?: number | null; providerUsage?: unknown },
) {
  return await rpc("studio_complete_usage", {
    p_user_id: user.id,
    p_reservation_id: reservationId,
    p_success: options.success,
    p_provider: options.provider || null,
    p_model: options.model || null,
    p_estimated_cost_micros: options.estimatedCostMicros ?? null,
    p_provider_usage: options.providerUsage ?? null,
  });
}

export function errorResponse(error: unknown, headers: Record<string, string>) {
  const access = error instanceof StudioAccessError ? error.access : undefined;
  const code = access?.reason || (error instanceof Error ? error.message : "UNKNOWN");
  const status = code === "UNAUTHORIZED" ? 401
    : ["FORBIDDEN", "ACCESS_DISABLED"].includes(code) ? 403
    : code === "TRIAL_EXHAUSTED" ? 402
    : code === "OPERATION_LIMIT" ? 429
    : ["INVALID_ITEM", "INVALID_OPERATION"].includes(code) ? 400
    : ["NOT_CONFIGURED", "ACCESS_SERVICE_ERROR"].includes(code) ? 503
    : 500;
  const message = code === "TRIAL_EXHAUSTED"
    ? "You’ve completed your three free items. Paid beta access is coming next."
    : code === "OPERATION_LIMIT"
      ? "This item has reached the included limit for that tool. Start a new item or try a different step."
      : status === 503
        ? "The studio is not fully configured yet."
        : status < 500
          ? "You do not have access to this studio."
          : "The request could not be completed.";
  return new Response(JSON.stringify({ error: message, code, access }), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

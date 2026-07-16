/**
 * Auth para Edge Functions invocadas por pg_cron / workers internos.
 *
 * Aceita (qualquer um):
 *  1. Header `x-service-secret` == env SERVICE_SHARED_SECRET
 *  2. Header `x-internal-secret` == env EMBED_INTERNAL_SECRET
 *     ou settings.embed_internal_token
 *  3. Authorization Bearer == SUPABASE_SERVICE_ROLE_KEY
 *
 * Legacy (só se NENHUM segredo estiver configurado no env):
 *  permite com warn — evita 401 em ambientes sem secrets ainda.
 *  Com ENFORCE_CRON_AUTH=true, nunca permite legacy.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqualStr } from "./webhook-auth.ts";

export type CronAuthReason =
  | "service_secret"
  | "internal_secret"
  | "service_role"
  | "legacy_unconfigured"
  | "missing"
  | "mismatch";

export interface CronAuthResult {
  ok: boolean;
  reason: CronAuthReason;
}

function bearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export async function assertCronAuth(
  req: Request,
  supabase?: SupabaseClient | null,
): Promise<CronAuthResult> {
  const enforce =
    (Deno.env.get("ENFORCE_CRON_AUTH") || "").trim().toLowerCase() === "true";

  const serviceSecret = (Deno.env.get("SERVICE_SHARED_SECRET") || "").trim();
  const headerService = (req.headers.get("x-service-secret") || "").trim();
  if (serviceSecret && headerService && timingSafeEqualStr(headerService, serviceSecret)) {
    return { ok: true, reason: "service_secret" };
  }

  let expectedInternal = (Deno.env.get("EMBED_INTERNAL_SECRET") || "").trim();
  if (!expectedInternal && supabase) {
    try {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "embed_internal_token")
        .maybeSingle();
      expectedInternal = String((data as { value?: string } | null)?.value || "")
        .replace(/^"|"$/g, "")
        .trim();
    } catch (_) {
      /* ignore */
    }
  }
  const headerInternal = (req.headers.get("x-internal-secret") || "").trim();
  if (expectedInternal && headerInternal && timingSafeEqualStr(headerInternal, expectedInternal)) {
    return { ok: true, reason: "internal_secret" };
  }

  const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const bearer = bearerToken(req);
  if (serviceRole && bearer && timingSafeEqualStr(bearer, serviceRole)) {
    return { ok: true, reason: "service_role" };
  }

  const anySecretConfigured = !!(serviceSecret || expectedInternal);
  if (!anySecretConfigured && !enforce) {
    // Não citar nomes de env de segredo em console.* (higiene REQ 5.8).
    console.warn("[cron-auth] nenhum segredo de serviço/interno configurado — allow legacy");
    return { ok: true, reason: "legacy_unconfigured" };
  }

  // Grace: secret existe mas header ainda não chegou (migration pendente).
  // Ligar ENFORCE_CRON_AUTH=true só depois de confirmar headers no pg_cron.
  if (!enforce) {
    console.warn(
      "[cron-auth] header ausente/errado — grace/log-only (ative enforce após migration dos headers)",
      { has_service_header: !!headerService, has_internal_header: !!headerInternal, has_bearer: !!bearer },
    );
    return { ok: true, reason: "legacy_unconfigured" };
  }

  if (headerService || headerInternal || bearer) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: false, reason: "missing" };
}

export function cronAuthUnauthorized(reason: CronAuthReason, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized", reason }), {
    status: 401,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

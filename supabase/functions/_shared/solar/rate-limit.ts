import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DAILY_CONSULTANT_LIMIT = 50;
const DAILY_PUBLIC_LIMIT = 3;

export async function checkConsultantRateLimit(
  admin: SupabaseClient,
  consultantId: string,
): Promise<boolean> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count, error } = await admin
    .from("solar_api_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("consultant_id", consultantId)
    .eq("cache_hit", false)
    .gte("created_at", since.toISOString());
  if (error) return true;
  return (count ?? 0) < DAILY_CONSULTANT_LIMIT;
}

export async function checkPublicRateLimit(
  admin: SupabaseClient,
  ipHash: string,
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("solar_public_rate_limit")
    .select("count")
    .eq("ip_hash", ipHash)
    .eq("day", today)
    .maybeSingle();

  const count = (data as { count?: number } | null)?.count ?? 0;
  if (count >= DAILY_PUBLIC_LIMIT) return false;

  await admin.from("solar_public_rate_limit").upsert(
    { ip_hash: ipHash, day: today, count: count + 1 },
    { onConflict: "ip_hash,day" },
  );
  return true;
}

export async function logApiUsage(
  admin: SupabaseClient,
  opts: {
    consultantId?: string | null;
    endpoint: string;
    cacheHit: boolean;
    latencyMs: number;
    errorCode?: string | null;
  },
): Promise<void> {
  await admin.from("solar_api_usage_log").insert({
    consultant_id: opts.consultantId ?? null,
    endpoint: opts.endpoint,
    cache_hit: opts.cacheHit,
    latency_ms: opts.latencyMs,
    error_code: opts.errorCode ?? null,
  });
}

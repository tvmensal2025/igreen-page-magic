// F12 — MinIO quota check + alerta super_admin.
// Roda via cron a cada 15min. Faz HEAD no MinIO health, estima uso do bucket
// listando objetos (best-effort, paginado até 5k), grava em infra_metrics e
// notifica super_admin via WhatsApp se uso >= app_settings.minio_alert_threshold_pct
// OU se o MinIO está fora do ar. Dedup: não alerta de novo se já notificou
// nos últimos 30 min para a mesma severidade.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifySuperAdminOpsAlert } from "../_shared/superadmin-alert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MINIO_URL = (Deno.env.get("MINIO_SERVER_URL") || "").replace(/\/$/, "");
const MINIO_USER = Deno.env.get("MINIO_ROOT_USER") || "";
const MINIO_PASS = Deno.env.get("MINIO_ROOT_PASSWORD") || "";
const MINIO_BUCKET = Deno.env.get("MINIO_BUCKET") || "igreen";
const MINIO_TOTAL_BYTES = Number(Deno.env.get("MINIO_TOTAL_BYTES") || "0"); // opcional: capacidade total para pct

const enc = new TextEncoder();
function toHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? (key as any) : new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
async function signingKey(secret: string, date: string, region: string, service: string) {
  const k1 = await hmac(enc.encode("AWS4" + secret), date);
  const k2 = await hmac(k1, region);
  const k3 = await hmac(k2, service);
  return await hmac(k3, "aws4_request");
}

// Lista objetos do bucket via S3 ListObjectsV2 com SigV4, paginado, soma sizes.
// Limita a 5000 objects para não estourar timeout — flag truncated=true se atingir.
async function estimateBucketUsage(): Promise<{ used: number; count: number; truncated: boolean; ok: boolean; error?: string }> {
  if (!MINIO_URL || !MINIO_USER || !MINIO_PASS) {
    return { used: 0, count: 0, truncated: false, ok: false, error: "missing_creds" };
  }
  try {
    let total = 0;
    let count = 0;
    let continuation: string | null = null;
    const MAX_PAGES = 5;
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(`${MINIO_URL}/${MINIO_BUCKET}`);
      u.searchParams.set("list-type", "2");
      u.searchParams.set("max-keys", "1000");
      if (continuation) u.searchParams.set("continuation-token", continuation);

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
      const dateStamp = amzDate.slice(0, 8);
      const region = "us-east-1";
      const service = "s3";
      const host = u.host;
      const payloadHash = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array())));
      const canonicalQuery = Array.from(u.searchParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
      const canonicalRequest = `GET\n${u.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${
        toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(canonicalRequest))))
      }`;
      const sk = await signingKey(MINIO_PASS, dateStamp, region, service);
      const signature = toHex(await hmac(sk, stringToSign));
      const auth = `AWS4-HMAC-SHA256 Credential=${MINIO_USER}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(u.toString(), {
        method: "GET",
        headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, Authorization: auth },
      });
      if (!res.ok) return { used: total, count, truncated: false, ok: false, error: `s3_list_${res.status}` };
      const xml = await res.text();
      // Parse simples (regex) — sufficient para Size + NextContinuationToken
      const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => Number(m[1]));
      for (const s of sizes) { total += s; count += 1; }
      const truncMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
      const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      const isTrunc = truncMatch?.[1] === "true";
      if (!isTrunc || !nextMatch) return { used: total, count, truncated: false, ok: true };
      continuation = nextMatch[1];
    }
    return { used: total, count, truncated: true, ok: true };
  } catch (e) {
    return { used: 0, count: 0, truncated: false, ok: false, error: (e as Error).message };
  }
}

async function pingMinio(): Promise<boolean> {
  if (!MINIO_URL) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${MINIO_URL}/minio/health/live`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

async function sendAlert(supabase: any, severity: "warn" | "critical", text: string): Promise<boolean> {
  const status = await notifySuperAdminOpsAlert(supabase, {
    key: `minio:${severity}`,
    severity,
    text,
    dedupMinutes: 30,
    metricKey: "minio_alert",
  });
  if (status === "skipped_dedup") {
    console.log(`[minio-quota-check] dedup: alerta ${severity} já enviado nos últimos 30min`);
  }
  return status === "sent";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await supabase
    .from("app_settings").select("minio_alert_threshold_pct").eq("id", "global").maybeSingle();
  const threshold = Number((settings as any)?.minio_alert_threshold_pct ?? 85);

  const alive = await pingMinio();
  const usage = alive ? await estimateBucketUsage() : { used: 0, count: 0, truncated: false, ok: false, error: "minio_down" };

  const pct = MINIO_TOTAL_BYTES > 0 ? (usage.used / MINIO_TOTAL_BYTES) * 100 : null;

  await supabase.from("infra_metrics").insert({
    metric_key: "minio_health",
    value_num: pct,
    meta: {
      alive,
      bucket: MINIO_BUCKET,
      used_bytes: usage.used,
      total_bytes: MINIO_TOTAL_BYTES || null,
      object_count: usage.count,
      truncated: usage.truncated,
      ok: usage.ok,
      error: usage.error || null,
    },
  });

  // Alertas
  if (!alive) {
    await sendAlert(supabase, "critical", `🚨 MinIO OFFLINE\n\nBucket ${MINIO_BUCKET} não respondeu ao health check.\nUploads e vídeos podem falhar.`);
  } else if (pct !== null && pct >= threshold) {
    const sev = pct >= 95 ? "critical" : "warn";
    await sendAlert(supabase, sev,
      `${sev === "critical" ? "🚨" : "⚠️"} MinIO em ${pct.toFixed(1)}%\n\n` +
      `Bucket: ${MINIO_BUCKET}\nUsado: ${(usage.used / 1e9).toFixed(2)} GB\n` +
      `Limiar: ${threshold}%\n\nVerifique o disco no Easypanel.`,
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      alive,
      used_bytes: usage.used,
      total_bytes: MINIO_TOTAL_BYTES || null,
      pct,
      object_count: usage.count,
      truncated: usage.truncated,
      threshold,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

// inbound-media-retry-cron — Task 16 do whatsapp-flow-reliability-fix.
//
// Processa lotes de até 20 entries da fila `inbound_media_retry` que estão
// com `next_attempt_at <= now()`. Para cada entry:
//   - Tenta `uploadToMinioPath(base64, mime)`.
//   - Em sucesso, marca `succeeded_at = now()` (a entry sai do índice parcial).
//   - Em falha, incrementa `attempts` e reagenda com backoff (1m / 5m / 15m).
//   - Após 3 tentativas E expires_at < now(), apenas registra log de drop;
//     a row ainda é mantida até a TTL (`expires_at`) para auditoria.
//
// Cron está agendado em `supabase/config.toml` via [edge_runtime] +
// `[crons]` ou via `pg_cron` chamando essa Edge Function.
// Schedule recomendado: a cada 30 segundos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { uploadToMinioPath, base64ToBytes } from "../_shared/minio-upload.ts";
import { jsonLog } from "../_shared/audit.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const BATCH_SIZE = 20;

// Backoff por tentativa: depois de attempts=N, próxima ocorre em ms[N].
// Cobre 0 (imediato), 1 (1m), 2 (5m), 3+ (15m).
const BACKOFF_MS: Record<number, number> = {
  0: 0,
  1: 60_000,
  2: 5 * 60_000,
  3: 15 * 60_000,
};

interface RetryRow {
  id: number;
  customer_id: string;
  consultant_id: string;
  message_id: string;
  media_kind: string;
  base64: string;
  mime_type: string | null;
  attempts: number;
  next_attempt_at: string;
  expires_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cronAuth = await assertCronAuth(req, supabase as any);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

  // Pega o lote: succeeded_at IS NULL && next_attempt_at <= now() && expires_at > now().
  const { data: batch, error: fetchErr } = await supabase
    .from("inbound_media_retry")
    .select("id, customer_id, consultant_id, message_id, media_kind, base64, mime_type, attempts, next_attempt_at, expires_at")
    .is("succeeded_at", null)
    .lte("next_attempt_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[inbound-media-retry-cron] fetch falhou:", fetchErr.message);
    return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (batch as RetryRow[]) || [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, ms: Date.now() - t0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const mime = row.mime_type || "application/octet-stream";
    const ext = inferExt(mime, row.media_kind);
    const objectKey = `whatsapp/retry/${row.consultant_id}/${row.customer_id}/${Date.now()}_${row.id}.${ext}`;

    try {
      const bytes = base64ToBytes(row.base64);
      await uploadToMinioPath(bytes, mime, objectKey);

      // Sucesso: marca succeeded_at. Limpa base64 do storage para reduzir bloat
      // (rows mantidas servem de auditoria; o conteúdo não é mais necessário).
      const { error: upErr } = await supabase
        .from("inbound_media_retry")
        .update({ succeeded_at: new Date().toISOString(), base64: "" })
        .eq("id", row.id);
      if (upErr) {
        console.warn(`[inbound-media-retry-cron] mark succeeded falhou (id=${row.id}):`, upErr.message);
      } else {
        succeeded++;
        jsonLog("info", "inbound_media_retry_succeeded", {
          retry_id: row.id,
          customer_id: row.customer_id,
          consultant_id: row.consultant_id,
          message_id: row.message_id,
          attempts: row.attempts + 1,
        });
      }
    } catch (uploadErr: any) {
      // Falha: incrementa attempts e reagenda. Nunca lança.
      const nextAttempts = row.attempts + 1;
      const backoff = BACKOFF_MS[nextAttempts] ?? BACKOFF_MS[3];
      const nextAt = new Date(Date.now() + backoff).toISOString();
      const { error: upErr } = await supabase
        .from("inbound_media_retry")
        .update({ attempts: nextAttempts, next_attempt_at: nextAt })
        .eq("id", row.id);
      if (upErr) {
        console.warn(`[inbound-media-retry-cron] update backoff falhou (id=${row.id}):`, upErr.message);
      }
      failed++;
      jsonLog("warn", "inbound_media_retry_failed", {
        retry_id: row.id,
        customer_id: row.customer_id,
        consultant_id: row.consultant_id,
        message_id: row.message_id,
        attempts: nextAttempts,
        next_attempt_at: nextAt,
        reason: uploadErr?.message ?? String(uploadErr),
      });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: rows.length,
    succeeded,
    failed,
    ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

function inferExt(mime: string, kind: string): string {
  // Mapeamento mínimo. Casos não cobertos caem para `bin` que é seguro.
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "audio/ogg" || mime === "audio/opus") return "ogg";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/mp4" || mime === "audio/x-m4a") return "m4a";
  if (mime === "video/mp4") return "mp4";
  if (mime === "application/pdf") return "pdf";
  if (kind === "image") return "jpg";
  if (kind === "audio") return "ogg";
  if (kind === "video") return "mp4";
  if (kind === "document") return "pdf";
  return "bin";
}

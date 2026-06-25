// outbound-media-flush-cron — Task 28 do whatsapp-flow-reliability-fix.
//
// Responsável pela cauda de sequências outbound longas. Lê
// `pending_outbound_media` em lotes pequenos e despacha cada item
// respeitando os `delay_before_ms` que o caller já calculou.
//
// Schedule recomendado: a cada 5 segundos.
//
// Fluxo por row:
//   1. Carrega payload (lista de items).
//   2. Para cada item, dorme `delay_before_ms` (capado em 8s para não
//      segurar o cron sozinho — tail muito longa fica para o próximo tick).
//   3. Despacha via Evolution API helpers existentes.
//   4. Marca `succeeded_at = now()` quando terminar de despachar TODOS
//      os items. Em falha intermediária, atualiza `attempts` e reagenda.
//
// Notas:
//   - O `attempts` é incrementado por DESPACHO FALHO de qualquer item,
//     não por tentativa do batch inteiro.
//   - Se conseguir enviar K dos N items e falhar no K+1, o item K+1 e
//     todos depois ficam para o próximo retry; remove os já enviados
//     do payload pra evitar duplicação.
//   - Backoff: 1m → 5m → 15m. Após `attempts >= 3`, droppa.
//
// Idempotência outbound já vem do `acquireOutboundSlot` em `evolution-api.ts`,
// então redelivery do cron é seguro.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonLog } from "../_shared/audit.ts";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import { canSendProactive, logProactiveBlock } from "../_shared/proactive-send-guard.ts";
import type { PendingOutboundItem } from "../_shared/pending-outbound-media.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const MAX_INTRA_ITEM_DELAY_MS = 8000; // cap para não segurar o cron por tempo demais
const MAX_ATTEMPTS = 3;

const BACKOFF_MS: Record<number, number> = {
  1: 60_000,
  2: 5 * 60_000,
  3: 15 * 60_000,
};

interface PendingRow {
  id: number;
  consultant_id: string;
  customer_id: string;
  payload: {
    remote_jid: string;
    instance_name: string | null;
    items: PendingOutboundItem[];
  };
  attempts: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // Task 34: libera reservas órfãs em ai_slot_dispatch_log (>30s sem confirm).
  // Best-effort: erro no sweeper não bloqueia o batch principal.
  try {
    const { data: swept } = await supabase.rpc("sweep_orphan_media_reservations", { p_max_age_seconds: 30 });
    if (typeof swept === "number" && swept > 0) {
      jsonLog("info", "media_reservations_swept", { count: swept });
    }
  } catch (e) {
    console.warn("[outbound-media-flush-cron] sweep falhou:", (e as Error)?.message || e);
  }


  // Pega lote: ainda não succeeded, scheduled_for já chegou.
  const { data: batch, error: fetchErr } = await supabase
    .from("pending_outbound_media")
    .select("id, consultant_id, customer_id, payload, attempts")
    .is("succeeded_at", null)
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[outbound-media-flush-cron] fetch falhou:", fetchErr.message);
    return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (batch as PendingRow[]) || [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, ms: Date.now() - t0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let succeededRows = 0;
  let failedRows = 0;

  for (const row of rows) {
    const ok = await processRow(supabase, row);
    if (ok) succeededRows++;
    else failedRows++;
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: rows.length,
    succeeded: succeededRows,
    failed: failedRows,
    ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

async function processRow(supabase: SupabaseClient, row: PendingRow): Promise<boolean> {
  const items = row.payload?.items || [];
  const remoteJid = row.payload?.remote_jid;
  const instanceName = row.payload?.instance_name;

  if (!remoteJid || items.length === 0) {
    // Row mal-formada — marca succeeded para tirar do índice e segue.
    await supabase.from("pending_outbound_media")
      .update({ succeeded_at: new Date().toISOString() })
      .eq("id", row.id);
    return true;
  }

  // Resolve credenciais Evolution do consultor.
  const { data: instance } = await supabase
    .from("evolution_instances")
    .select("api_url, api_key, instance_name")
    .eq("consultant_id", row.consultant_id)
    .eq("status", "connected")
    .maybeSingle();

  if (!instance?.api_url || !instance?.api_key) {
    // Não tem instância conectada — nada a fazer agora; reagenda.
    await scheduleRetry(supabase, row, "no_connected_instance");
    return false;
  }
  // 🛡️ Trava: phone do consultor precisa bater com a instância
  const proactiveGuard = await canSendProactive(supabase, {
    consultantId: row.consultant_id,
    instanceName: instance.instance_name || instanceName || null,
  });
  if (!proactiveGuard.allowed) {
    await logProactiveBlock(supabase, {
      consultantId: row.consultant_id,
      instanceName: instance.instance_name || instanceName || null,
      reason: proactiveGuard.reason,
      context: { source: "outbound-media-flush-cron", pending_row_id: row.id, detail: proactiveGuard.detail },
    });
    await scheduleRetry(supabase, row, `phone_guard_${proactiveGuard.reason}`);
    return false;
  }


  const _raw = createEvolutionSender(
    instance.api_url,
    instance.api_key,
    instance.instance_name || instanceName || "",
  );
  const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
  const sender = wrapSenderWithGuard(_raw, {
    supabase,
    instanceName: instance.instance_name || instanceName || "",
  });

  // Despacha em ordem. Se algum item falhar, atualiza payload removendo
  // os já enviados e reagenda o restante.
  const remaining = [...items];
  while (remaining.length > 0) {
    const item = remaining[0];
    const sleepMs = Math.min(MAX_INTRA_ITEM_DELAY_MS, Math.max(0, item.delay_before_ms ?? 0));
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }

    let dispatched = false;
    try {
      dispatched = await dispatchItem(sender, remoteJid, item);
    } catch (e) {
      console.warn(`[outbound-media-flush-cron] dispatch raised:`, (e as Error).message);
      dispatched = false;
    }

    if (!dispatched) {
      // Atualiza payload removendo os já enviados (i.e., os que estão antes do current).
      // Como `remaining[0]` é o atual que falhou, não removemos nada — ele continua na cabeça.
      await scheduleRetry(supabase, { ...row, payload: { ...row.payload, items: remaining } }, "item_dispatch_failed");
      return false;
    }
    remaining.shift();
  }

  // Tudo despachado — marca succeeded.
  await supabase.from("pending_outbound_media")
    .update({ succeeded_at: new Date().toISOString() })
    .eq("id", row.id);

  jsonLog("info", "pending_outbound_media_flushed", {
    pending_id: row.id,
    customer_id: row.customer_id,
    consultant_id: row.consultant_id,
    item_count: items.length,
    attempts: row.attempts + 1,
  });

  return true;
}

async function dispatchItem(
  sender: ReturnType<typeof createEvolutionSender>,
  remoteJid: string,
  item: PendingOutboundItem,
): Promise<boolean> {
  switch (item.kind) {
    case "text":
      if (!item.text) return true; // skip vazio
      return await sender.sendText(remoteJid, item.text);
    case "buttons": {
      if (!item.text || !item.buttons || item.buttons.length === 0) {
        // Sem botões válidos — degrada para texto.
        return await sender.sendText(remoteJid, item.text || "");
      }
      // sendButtons assina como (jid, body, buttons[]).
      // @ts-ignore: assinatura existe em evolution-api.ts mas não está no return type acima.
      return await sender.sendButtons(remoteJid, item.text, item.buttons);
    }
    case "audio":
      if (!item.media_url) return true;
      return await sender.sendAudio(remoteJid, item.media_url);
    case "image":
    case "video":
    case "document":
      if (!item.media_url) return true;
      return await sender.sendMedia(remoteJid, item.media_url, {
        caption: item.caption,
        mediatype: item.kind,
        mimetype: item.mime_type,
      } as any);
    default:
      return true;
  }
}

async function scheduleRetry(
  supabase: SupabaseClient,
  row: PendingRow,
  reason: string,
): Promise<void> {
  const nextAttempts = (row.attempts ?? 0) + 1;
  if (nextAttempts > MAX_ATTEMPTS) {
    // Drop — registra log mas não tenta de novo. Marca succeeded_at para
    // tirar do índice; quem precisar auditar pega `attempts >= MAX_ATTEMPTS`.
    await supabase.from("pending_outbound_media")
      .update({ succeeded_at: new Date().toISOString(), attempts: nextAttempts })
      .eq("id", row.id);
    jsonLog("error", "pending_outbound_media_dropped", {
      pending_id: row.id,
      customer_id: row.customer_id,
      consultant_id: row.consultant_id,
      attempts: nextAttempts,
      reason,
    });
    return;
  }

  const backoff = BACKOFF_MS[nextAttempts] ?? BACKOFF_MS[3];
  const nextAt = new Date(Date.now() + backoff).toISOString();
  await supabase.from("pending_outbound_media")
    .update({
      attempts: nextAttempts,
      scheduled_for: nextAt,
      payload: row.payload, // pode ter sido reduzido em processRow
    })
    .eq("id", row.id);

  jsonLog("warn", "pending_outbound_media_retry_scheduled", {
    pending_id: row.id,
    customer_id: row.customer_id,
    consultant_id: row.consultant_id,
    attempts: nextAttempts,
    next_at: nextAt,
    reason,
  });
}

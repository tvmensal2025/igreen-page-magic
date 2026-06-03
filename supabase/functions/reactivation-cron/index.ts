// reactivation-cron — Tasks 21 e 22 da spec `captacao-fluxo-d-conversao`.
//
// Responsável por:
//   1. (R15) Disparar mensagens automáticas de reaquecimento para leads
//      parados em steps cujo `reactivation_templates.auto_reactivate=true`.
//   2. (R16) Classificar `outcome` dos envios passados (responded /
//      advanced / abandoned) chamando o RPC `classify_reactivation_outcomes`.
//
// Schedule recomendado: a cada 1 hora.
//
// Regras de envio automático (R15):
//   - Janela: 09:00–20:00 no fuso do consultor (default `America/Sao_Paulo`).
//   - Pula sábado e domingo.
//   - Lead deve estar parado há ≥24h, status NOT IN (approved, cancelled),
//     com `capture_mode != 'manual'` (ou `manual_override_reactivate=true`).
//   - Máximo 3 envios automáticos por lead (lifetime, por template).
//   - Debounce: nenhum envio nas últimas 48h pro mesmo lead.
//   - Lote ≤500 por execução para não saturar a Evolution.
//   - Sleep 2s entre envios.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import { jsonLog } from "../_shared/audit.ts";
import {
  checkSendQuota,
  registerSend,
  simulateTyping,
  typingDurationMs,
  humanJitterMs,
} from "../_shared/anti-ban.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PER_RUN = 500;
const SLEEP_BETWEEN_SENDS_MS = 2000;
const MAX_AUTO_SENDS_PER_LEAD = 3;
const SEND_DEBOUNCE_HOURS = 48;
const STUCK_HOURS = 24;

// ─── Helpers puros (exportados para testes) ──────────────────────────────────

/**
 * Determina se a hora atual no fuso do consultor está dentro da janela
 * 09:00–20:00 e é dia de semana (segunda–sexta).
 * Default fuso = `America/Sao_Paulo`.
 */
export function isInsideWindow(timezone: string | null): boolean {
  const tz = timezone || "America/Sao_Paulo";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    const weekdayPart = parts.find((p) => p.type === "weekday");
    if (!hourPart || !weekdayPart) return false;
    const hour = parseInt(hourPart.value, 10);
    const weekday = weekdayPart.value; // Sun, Mon, Tue, ...
    if (weekday === "Sat" || weekday === "Sun") return false;
    return hour >= 9 && hour < 20;
  } catch {
    // Fuso inválido → conserva default seguro: permite envio.
    return true;
  }
}

/**
 * Substitui variáveis `{{nome}}`, `{{valor_conta}}`, `{{representante}}`
 * pelos dados do lead. Variáveis ausentes viram string vazia.
 * Aceita tanto `{{var}}` quanto `{var}` (formato legado).
 */
export function renderMessage(
  template: string,
  lead: {
    name: string | null;
    electricity_bill_value: number | null;
    [k: string]: unknown;
  },
  consultantName = "",
): string {
  if (!template) return "";
  const firstName = (lead.name ?? "").trim().split(/\s+/)[0] ?? "";
  const valor = lead.electricity_bill_value
    ? Number(lead.electricity_bill_value).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "";
  return template
    .replaceAll("{{nome}}", firstName)
    .replaceAll("{{valor_conta}}", valor)
    .replaceAll("{{representante}}", consultantName)
    .replaceAll("{nome}", firstName)
    .replaceAll("{valor_conta}", valor)
    .replaceAll("{representante}", consultantName)
    // Remove quaisquer variáveis não substituídas para não vazar `{{campo}}`
    .replace(/\{\{[a-zA-Z_]+\}\}/g, "")
    .replace(/\{[a-zA-Z_]+\}/g, "");
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

// Apenas registra o handler quando rodando como Edge Function — testes que
// importam `isInsideWindow`/`renderMessage` não devem subir o servidor.
if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    return await handle(req);
  });
}

async function handle(_req: Request): Promise<Response> {
  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ─── Step 1: classifica outcomes pendentes (R16) ─────────────────────────
  let outcomeRow: Record<string, number> = {};
  try {
    const { data: classified } = await supabase.rpc("classify_reactivation_outcomes");
    if (Array.isArray(classified) && classified[0]) {
      outcomeRow = classified[0] as Record<string, number>;
    }
  } catch (e: any) {
    console.warn("[reactivation-cron] classify_reactivation_outcomes falhou:", e?.message);
  }

  // ─── Step 2: envio automático (R15) ──────────────────────────────────────
  const result = await processAutoReactivation(supabase);

  jsonLog("info", "reactivation_cron_done", {
    ...result,
    outcomes_classified: outcomeRow,
    ms: Date.now() - t0,
  });

  return new Response(JSON.stringify({
    ok: true,
    outcomes_classified: outcomeRow,
    auto_reactivation: result,
    ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface ProcessResult {
  templates_processed: number;
  total_sent: number;
  total_failed: number;
  total_skipped_window: number;
  total_skipped_capture_mode: number;
}

async function processAutoReactivation(supabase: SupabaseClient): Promise<ProcessResult> {
  let templatesProcessed = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let totalSkippedWindow = 0;
  let totalSkippedCaptureMode = 0;

  // Templates ativos com auto_reactivate=true — inclui JOIN com consultants
  // para resolver timezone e nome do representante.
  const { data: templates } = await supabase
    .from("reactivation_templates")
    .select(`
      id, consultant_id, conversation_step, message_text,
      consultants:consultant_id (id, name, timezone)
    `)
    .eq("is_active", true)
    .eq("auto_reactivate", true)
    .limit(200);

  if (!templates || templates.length === 0) {
    return { templates_processed: 0, total_sent: 0, total_failed: 0, total_skipped_window: 0, total_skipped_capture_mode: 0 };
  }

  let totalSentGlobal = 0;

  outer: for (const tpl of templates as any[]) {
    if (totalSentGlobal >= MAX_PER_RUN) break;
    templatesProcessed++;

    const consultant = tpl.consultants;
    if (!consultant) continue;

    // Verifica janela horária.
    if (!isInsideWindow(consultant.timezone ?? null)) {
      totalSkippedWindow++;
      continue;
    }

    // Resolve instância WhatsApp do consultor.
    // Tenta `evolution_instances` primeiro (schema v2); fallback para
    // `whatsapp_instances` (schema legado).
    let instanceName: string | null = null;
    let apiUrl: string | null = null;
    let apiKey: string | null = null;

    const { data: evInst } = await supabase
      .from("evolution_instances")
      .select("api_url, api_key, instance_name")
      .eq("consultant_id", tpl.consultant_id)
      .eq("status", "connected")
      .maybeSingle() as { data: { api_url: string; api_key: string; instance_name: string } | null };

    if (evInst?.instance_name) {
      instanceName = evInst.instance_name;
      apiUrl = evInst.api_url;
      apiKey = evInst.api_key;
    } else {
      // Fallback: schema legado `whatsapp_instances`
      const { data: waInst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("consultant_id", tpl.consultant_id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { instance_name: string } | null };
      if (waInst?.instance_name) {
        instanceName = waInst.instance_name;
        apiUrl = Deno.env.get("EVOLUTION_API_URL") || "";
        apiKey = Deno.env.get("EVOLUTION_API_KEY") || "";
      }
    }

    if (!instanceName || !apiUrl || !apiKey) {
      jsonLog("warn", "reactivation_cron_no_instance", {
        consultant_id: tpl.consultant_id,
        template_id: tpl.id,
      });
      continue;
    }

    const sender = createEvolutionSender(apiUrl, apiKey, instanceName);
    const consultantName = String(consultant.name || "iGreen").trim().split(/\s+/)[0];

    // Leads candidatos para este template.
    const candidates = await fetchCandidates(supabase, tpl);
    if (candidates.length === 0) continue;

    for (const customer of candidates) {
      if (totalSentGlobal >= MAX_PER_RUN) break outer;

      // Respeita capture_mode='manual' (Req 17.5).
      if (customer.capture_mode === "manual" && !customer.manual_override_reactivate) {
        totalSkippedCaptureMode++;
        continue;
      }

      const finalText = renderMessage(tpl.message_text, customer, consultantName);
      const remoteJid = customer.phone_whatsapp.includes("@")
        ? customer.phone_whatsapp
        : `${customer.phone_whatsapp}@s.whatsapp.net`;

      let ok = false;
      try {
        ok = await sender.sendText(remoteJid, finalText);
      } catch (e: any) {
        console.warn("[reactivation-cron] sendText raised:", e?.message);
      }

      // Registra envio.
      try {
        await (supabase as any).from("reactivation_sends").insert({
          customer_id: customer.id,
          consultant_id: tpl.consultant_id,
          template_id: tpl.id,
          conversation_step: customer.conversation_step,
          message_text: finalText,
          trigger_type: "auto",
          status: ok ? "sent" : "failed",
          error_reason: ok ? null : "evolution_send_failed",
        });
      } catch (e: any) {
        console.warn("[reactivation-cron] insert reactivation_sends falhou:", e?.message);
      }

      // Registra em conversations para histórico (igual ao envio manual).
      if (ok) {
        try {
          await (supabase as any).from("conversations").insert({
            customer_id: customer.id,
            message_direction: "outbound",
            message_text: finalText,
            message_type: "text",
            conversation_step: customer.conversation_step,
          });
        } catch { /* não crítico */ }
        totalSent++;
        totalSentGlobal++;
        await sleep(SLEEP_BETWEEN_SENDS_MS);
      } else {
        totalFailed++;
      }
    }
  }

  return { templates_processed: templatesProcessed, total_sent: totalSent, total_failed: totalFailed, total_skipped_window: totalSkippedWindow, total_skipped_capture_mode: totalSkippedCaptureMode };
}

async function fetchCandidates(supabase: SupabaseClient, tpl: any): Promise<any[]> {
  const stuckBoundary = new Date(Date.now() - STUCK_HOURS * 3600 * 1000).toISOString();
  const debounceBoundary = new Date(Date.now() - SEND_DEBOUNCE_HOURS * 3600 * 1000).toISOString();

  // IDs com envio recente (debounce 48h).
  const { data: recentSends } = await supabase
    .from("reactivation_sends")
    .select("customer_id")
    .eq("consultant_id", tpl.consultant_id)
    .gte("sent_at", debounceBoundary);
  const debounced = new Set(((recentSends as Array<{ customer_id: string }>) || []).map((r) => r.customer_id));

  // IDs que já atingiram o limite de envios automáticos para este template.
  const { data: autoCounts } = await supabase
    .from("reactivation_sends")
    .select("customer_id")
    .eq("consultant_id", tpl.consultant_id)
    .eq("template_id", tpl.id)
    .eq("trigger_type", "auto");
  const autoCount = new Map<string, number>();
  for (const r of (autoCounts as Array<{ customer_id: string }> | null) || []) {
    autoCount.set(r.customer_id, (autoCount.get(r.customer_id) ?? 0) + 1);
  }

  const { data: candidates } = await supabase
    .from("customers")
    .select("id, consultant_id, name, phone_whatsapp, conversation_step, electricity_bill_value, capture_mode, manual_override_reactivate")
    .eq("consultant_id", tpl.consultant_id)
    .eq("conversation_step", tpl.conversation_step)
    .not("status", "in", "(approved,cancelled)")
    .lt("updated_at", stuckBoundary)
    .limit(MAX_PER_RUN);

  return ((candidates as any[]) || []).filter((c) => {
    if (debounced.has(c.id)) return false;
    if ((autoCount.get(c.id) ?? 0) >= MAX_AUTO_SENDS_PER_LEAD) return false;
    return true;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

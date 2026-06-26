// leads-to-campaign
// ─────────────────
// O consultor seleciona leads captados (captured_leads) e dispara mensagem.
// Esta função SÓ cria a campanha de Disparo PRO (bulk_campaigns) e insere os
// alvos (bulk_campaign_targets). O envio em si fica por conta do cron
// `bulk-scheduler`, que já aplica anti-ban / warmup / typing. NÃO tocamos no
// motor de envio — apenas o alimentamos.
//
// Multi-tenant: só processa leads do próprio consultor (assertOwnership por
// consultant_id + filtro consultant_id na query).
//
// Autenticado por JWT (verify_jwt=true) — é o consultor logado quem dispara.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  lead_ids?: string[];
  campaign_name?: string;
  message_text?: string;
  media_url?: string | null;
  media_type?: string | null;
  media_filename?: string | null;
  /** Config do disparo (janela, intervalo). Repassada igual ao bulk-scheduler. */
  config?: Record<string, unknown>;
  /** Se quiser agendar; ausente = roda já (status running). */
  scheduled_at?: string | null;
}

const MAX_LEADS = 5000;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Auth: precisa ser o consultor logado.
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });
  const consultantId = caller.consultantId;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const leadIds = Array.isArray(body.lead_ids) ? body.lead_ids.filter(Boolean) : [];
  if (leadIds.length === 0) return json(400, { error: "no_leads_selected" });
  if (leadIds.length > MAX_LEADS) return json(400, { error: "too_many_leads", max: MAX_LEADS });

  const msg = (body.message_text ?? "").trim();
  const hasMedia = !!(body.media_url && body.media_type && body.media_type !== "text");
  if (!msg && !hasMedia) return json(400, { error: "empty_message" });

  // Busca SÓ os leads do próprio consultor (defesa dupla: filtro + ownership).
  const { data: leads, error: leadsErr } = await admin
    .from("captured_leads")
    .select("id, full_name, phone, city")
    .eq("consultant_id", consultantId)
    .in("id", leadIds)
    .not("phone", "is", null);

  if (leadsErr) return json(500, { error: leadsErr.message });
  const validLeads = (leads ?? []).filter((l) => l.phone);
  if (validLeads.length === 0) return json(422, { error: "no_valid_leads_with_phone" });

  // Cria a campanha de Disparo PRO (mesma tabela que o painel usa).
  const scheduled = body.scheduled_at ?? null;
  const { data: campaign, error: campErr } = await admin
    .from("bulk_campaigns")
    .insert({
      consultant_id: consultantId,
      name: body.campaign_name?.trim() || "Disparo de leads captados",
      message_text: msg || null,
      media_url: body.media_url ?? null,
      media_type: body.media_type ?? null,
      media_filename: body.media_filename ?? null,
      config: body.config ?? {},
      status: scheduled ? "scheduled" : "running",
      scheduled_at: scheduled,
      started_at: scheduled ? null : new Date().toISOString(),
      total: validLeads.length,
    })
    .select("id")
    .single();

  if (campErr || !campaign?.id) {
    return json(500, { error: campErr?.message ?? "campaign_insert_failed" });
  }

  // Insere os alvos. vars carrega nome/cidade para o render do bulk-scheduler.
  const targets = validLeads.map((l) => ({
    campaign_id: campaign.id,
    phone: l.phone as string,
    name: l.full_name ?? null,
    vars: { city: l.city ?? null },
    status: "queued",
  }));

  const { error: tgtErr } = await admin.from("bulk_campaign_targets").insert(targets);
  if (tgtErr) {
    // rollback best-effort da campanha pra não deixar campanha órfã sem alvos
    await admin.from("bulk_campaigns").delete().eq("id", campaign.id);
    return json(500, { error: tgtErr.message });
  }

  return json(200, {
    ok: true,
    campaign_id: campaign.id,
    queued: validLeads.length,
    skipped: leadIds.length - validLeads.length,
    status: scheduled ? "scheduled" : "running",
  });
});

// Configura a pool de rodízio de uma campanha existente por uma RPC
// transacional. A mesma pool é preservada para manter counter, métricas e
// lead_count dos participantes que continuarem na fila.
//
// Regras:
// - Apenas o dono da campanha (consultant_id) pode alterar.
// - Requer ≥1 participante quando `enabled=true` (1 = destino exclusivo; 2+ = rodízio).
// - Todos os partner_ids devem pertencer a referral_partners do consultor.
import { adminClient, authConsultant, corsHeaders } from "../_shared/fb-graph.ts";

interface Body {
  campaign_id: string;
  enabled: boolean;
  partner_ids?: string[];
  label?: string;
}

function ok<T>(data: T, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function fail(msg: string, status = 400) {
  return ok({ error: msg }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return fail("unauthorized", 401);

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.campaign_id) return fail("campaign_id obrigatório");

    let partnerIds = Array.isArray(body.partner_ids)
      ? body.partner_ids.filter((id): id is string => typeof id === "string" && !!id.trim())
      : [];
    // Dedup preservando ordem
    {
      const seen = new Set<string>();
      partnerIds = partnerIds.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
    if (body.enabled && partnerIds.length < 1) {
      return fail("Selecione pelo menos 1 participante (você ou outra pessoa).");
    }

    const admin = adminClient();
    const { data: camp } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, name")
      .eq("id", body.campaign_id)
      .maybeSingle();
    if (!camp) return fail("Campanha não encontrada.", 404);
    if ((camp as any).consultant_id !== auth.id) return fail("Sem permissão.", 403);

    // Validação estrita: nenhum participante inválido/inativo é ignorado.
    if (partnerIds.length) {
      const { data: partners, error: partnerError } = await admin
        .from("referral_partners")
        .select("id, consultant_id, is_active")
        .in("id", partnerIds);
      if (partnerError) return fail("Erro ao validar participantes: " + partnerError.message, 500);
      const ownedActive = new Set(((partners as any[]) || [])
        .filter((p) => p.consultant_id === auth.id && p.is_active === true)
        .map((p) => p.id as string));
      const bad = partnerIds.filter((id) => !ownedActive.has(id));
      if (bad.length) {
        return fail(
          `${bad.length} participante(s) não pertence(m) a você ou está(ão) inativo(s). Corrija a seleção antes de salvar.`,
          400,
        );
      }
    }

    const label = (body.label || `Rodízio — ${(camp as any).name || "Campanha"}`).slice(0, 120);
    const { data: configured, error: configureError } = await admin.rpc(
      "configure_rodizio_pool",
      {
        p_campaign_id: body.campaign_id,
        p_enabled: body.enabled,
        p_partner_ids: body.enabled ? partnerIds : [],
        p_label: label,
      },
    );
    if (configureError) {
      console.error("[fb-update-rodizio] RPC falhou:", configureError.message);
      return fail("Não foi possível salvar o rodízio de forma segura: " + configureError.message, 500);
    }
    const result = Array.isArray(configured) ? configured[0] : configured;
    return ok({
      ok: true,
      enabled: result?.enabled === true,
      pool_id: result?.pool_id ?? null,
      members: Number(result?.members ?? 0),
    });
  } catch (e) {
    console.error("[fb-update-rodizio]", e);
    return fail((e as Error)?.message || "Erro interno", 500);
  }
});

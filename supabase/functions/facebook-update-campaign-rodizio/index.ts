// Substitui a pool de rodízio de uma campanha existente. Desativa a pool
// atual (mantém histórico e lead_count) e cria uma nova com os
// participantes na ordem recebida (position 0..n). Quando `enabled=false`
// apenas desativa e não cria nova (destino único volta a valer).
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

    // Valida ownership + ativos; mantém só válidos (fail se sobrar 0).
    if (partnerIds.length) {
      const { data: partners } = await admin
        .from("referral_partners")
        .select("id, consultant_id, is_active")
        .in("id", partnerIds);
      const ownedActive = new Set(((partners as any[]) || [])
        .filter((p) => p.consultant_id === auth.id && p.is_active !== false)
        .map((p) => p.id as string));
      const validIds = partnerIds.filter((id) => ownedActive.has(id));
      const bad = partnerIds.filter((id) => !ownedActive.has(id));
      if (validIds.length < 1) {
        return fail(
          "Nenhum participante válido/ativo. Remova inativos ou reative antes de salvar o rodízio.",
          400,
        );
      }
      if (bad.length) {
        console.warn("[fb-update-rodizio] partners ignorados:", bad.join(", "));
      }
      partnerIds = validIds;
    }

    // Desativa pool atual (mantém histórico e lead_count).
    await admin
      .from("rodizio_pools")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("campaign_id", body.campaign_id)
      .eq("is_active", true);

    if (!body.enabled) {
      return ok({ ok: true, enabled: false, pool_id: null, members: 0 });
    }

    // Cria nova pool + membros na ordem recebida.
    const label = (body.label || `Rodízio — ${(camp as any).name || "Campanha"}`).slice(0, 120);
    const { data: pool, error: ePool } = await admin
      .from("rodizio_pools")
      .insert({
        campaign_id: body.campaign_id,
        consultant_id: auth.id,
        label,
        is_active: true,
      })
      .select("id")
      .single();
    if (ePool || !pool) return fail("Erro ao criar pool: " + (ePool?.message || "sem retorno"), 500);
    const poolId = (pool as any).id as string;

    const members = partnerIds.map((partner_id, index) => ({
      pool_id: poolId,
      partner_id,
      position: index,
      lead_count: 0,
    }));
    const { error: eMem } = await admin.from("rodizio_pool_members").insert(members);
    if (eMem) {
      // rollback pool para não deixar pool sem membro
      await admin.from("rodizio_pools").update({ is_active: false }).eq("id", poolId);
      return fail("Erro ao inserir membros: " + eMem.message, 500);
    }

    return ok({ ok: true, enabled: true, pool_id: poolId, members: members.length });
  } catch (e) {
    console.error("[fb-update-rodizio]", e);
    return fail((e as Error)?.message || "Erro interno", 500);
  }
});

// Reajusta o spend_cap (lifetime cap) das campanhas ATIVAS de um consultor de acordo
// com o saldo atual da carteira. Chamado após recarga (Stripe webhook) ou quando o
// consultor escolhe aumentar o orçamento no popup.
//
// Fórmula: cap = (gasto_atual_meta) + (saldo_disponivel / (1 + fee%))
// Assim a Meta sabe exatamente o quanto pode gastar a mais do que já gastou.
//
// Reativação após recarga: SÓ campanhas auto-pausadas por saldo/teto.
// Pausa MANUAL do consultor (MANUAL_PAUSE) NUNCA é reativada aqui.
import { adminClient, authConsultant, corsHeaders, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { isManualPause, isAutoBalancePause } from "../_shared/campaign-pause.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toCents(v: unknown) {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let consultantId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isService = authHeader === `Bearer ${serviceRole}`;

    const body = await req.json().catch(() => ({}));
    if (isService) {
      consultantId = body?.consultant_id ?? null;
    } else {
      const auth = await authConsultant(req);
      if (!auth) return json({ error: "Unauthorized" }, 401);
      consultantId = auth.id;
    }
    if (!consultantId) return json({ error: "consultant_id required" }, 400);

    const reactivate = !!body?.reactivate;

    const admin = adminClient();
    const { data: ps } = await admin.from("platform_settings").select("*").eq("id", true).maybeSingle();
    const feePct = Number(ps?.platform_fee_percent ?? 20) / 100;

    const { data: wallet } = await admin.from("consultant_wallet")
      .select("balance_cents,debt_cents").eq("consultant_id", consultantId).maybeSingle();
    const balance = Number(wallet?.balance_cents ?? 0);
    const debt = Number(wallet?.debt_cents ?? 0);
    // Saldo líquido (já descontada eventual dívida)
    const liquid = Math.max(0, balance - debt);
    // Quanto a Meta pode gastar a mais (descontando nosso markup)
    const extraMetaBudgetCents = Math.floor(liquid / (1 + feePct));

    const { data: camps } = await admin
      .from("facebook_campaigns")
      .select("id, fb_campaign_id, status, lifetime_cap_cents, daily_budget_cents, rejection_reason")
      .eq("consultant_id", consultantId)
      .in("status", ["active", "paused", "pending_review"]);

    const updated: any[] = [];
    const errors: any[] = [];
    const skippedManual: string[] = [];

    // RATEIO ANTI-PREJUÍZO: divide o orçamento extra da Meta entre TODAS as campanhas
    // que vão receber cap (ativas + pausadas que serão reativadas). Sem dividir, cada
    // campanha receberia o saldo total e N campanhas poderiam gastar N × saldo.
    const eligible = (camps || []).filter((c: any) => c.fb_campaign_id);
    const denom = Math.max(1, eligible.length);
    const perCampaignExtra = Math.floor(extraMetaBudgetCents / denom);

    for (const c of eligible) {
      try {
        const conn = await loadCampaignConnection(consultantId);
        if (!conn?.token) continue;

        // Lê gasto atual da Meta para essa campanha
        let currentSpendCents = 0;
        try {
          const r = await fbFetch(`/${c.fb_campaign_id}/insights?fields=spend&date_preset=maximum&access_token=${conn.token}`);
          currentSpendCents = toCents(r?.data?.[0]?.spend || 0);
        } catch (_) {}

        const newCap = Math.max(1000, currentSpendCents + perCampaignExtra);
        // Atualiza spend_cap na Meta (campaign-level lifetime ceiling)
        try {
          await fbFetch(`/${c.fb_campaign_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              spend_cap: String(newCap),
              access_token: conn.token,
            }),
          });
        } catch (e) {
          errors.push({ id: c.id, error: `Meta spend_cap update: ${(e as Error).message}` });
        }

        // Reativa se solicitado e tem saldo — NUNCA se foi pausa MANUAL do consultor.
        // Só reativa pausas automáticas de saldo/teto (recarga).
        const updates: any = {
          lifetime_cap_cents: newCap,
          pause_pending: false,
          updated_at: new Date().toISOString(),
        };
        const canReactivate =
          reactivate &&
          c.status === "paused" &&
          balance > 0 &&
          debt === 0 &&
          !isManualPause(c.rejection_reason) &&
          isAutoBalancePause(c.rejection_reason);

        if (reactivate && c.status === "paused" && isManualPause(c.rejection_reason)) {
          skippedManual.push(c.id);
        } else if (canReactivate) {
          try {
            await fbFetch(`/${c.fb_campaign_id}?status=ACTIVE&access_token=${conn.token}`, { method: "POST" });
            updates.status = "active";
            updates.rejection_reason = null;
          } catch (e) {
            errors.push({ id: c.id, error: `reactivate: ${(e as Error).message}` });
          }
        }
        await admin.from("facebook_campaigns").update(updates).eq("id", c.id);
        updated.push({ id: c.id, new_cap_cents: newCap, current_spend_cents: currentSpendCents });
      } catch (e) {
        errors.push({ id: c.id, error: (e as Error).message });
      }
    }

    return json({
      ok: true,
      consultant_id: consultantId,
      extra_meta_budget_cents: extraMetaBudgetCents,
      updated,
      skipped_manual_pause: skippedManual,
      errors,
    });
  } catch (err) {
    console.error("[fb-realign-lifetime]", err);
    return json({ error: (err as Error).message }, 500);
  }
});

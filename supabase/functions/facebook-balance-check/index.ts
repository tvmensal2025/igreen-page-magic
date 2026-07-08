// Verificação rápida e barata de saldo: checa amount_spent vs lifetime_cap de cada
// campanha ativa e pausa imediatamente se atingiu o teto OU se a wallet do consultor
// marcou pause_pending=true. Roda via cron a cada 2 min.
//
// Diferença pro facebook-sync-metrics: aqui NÃO busca insights completos, leads, breakdown.
// Só lê 1 campo (amount_spent) por campanha → 10x mais barato em rate-limit.
import { adminClient, corsHeaders, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { notifyRodizioOnCampaignPaused } from "../_shared/rodizio-pause-notify.ts";


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toCents(v: unknown) {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();

    // 1) Pausa imediata de tudo que está pause_pending=true (trigger do banco já marcou
    //    quando o saldo zerou). Estes nem precisam ir na Meta API se já estão em paused.
    const { data: pending } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, status")
      .eq("pause_pending", true);

    const paused: string[] = [];
    const errors: any[] = [];

    for (const c of pending || []) {
      try {
        if (c.status === "active" && c.fb_campaign_id) {
          const conn = await loadCampaignConnection(c.consultant_id);
          if (conn?.token) {
            await fbFetch(`/${c.fb_campaign_id}?status=PAUSED&access_token=${conn.token}`, { method: "POST" });
          }
        }
        await admin.from("facebook_campaigns").update({
          status: "paused",
          pause_pending: false,
          rejection_reason: "Auto-pausada: saldo da carteira zerou — recarregue para reativar",
        }).eq("id", c.id);
        paused.push(c.fb_campaign_id || c.id);
      } catch (e) {
        errors.push({ id: c.id, error: (e as Error).message });
      }
    }

    // 2) Checa lifetime_cap de cada campanha ativa que tem teto definido. Se o
    //    gasto bruto da Meta já bateu no teto, pausa antes do sync pesado rodar.
    const { data: capped } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, lifetime_cap_cents")
      .eq("status", "active")
      .not("lifetime_cap_cents", "is", null)
      .gt("lifetime_cap_cents", 0);

    for (const c of capped || []) {
      try {
        const conn = await loadCampaignConnection(c.consultant_id);
        if (!conn?.token || !c.fb_campaign_id) continue;
        const url = `/${c.fb_campaign_id}/insights?fields=spend&date_preset=maximum&access_token=${conn.token}`;
        const r = await fbFetch(url);
        const spendBrl = Number(r?.data?.[0]?.spend || 0);
        const spendCents = toCents(spendBrl);
        const cap = Number(c.lifetime_cap_cents || 0);
        // Pausa quando atinge 95% do teto — margem pra latência da Meta antes do hard-stop dela.
        if (spendCents >= Math.floor(cap * 0.95)) {
          await fbFetch(`/${c.fb_campaign_id}?status=PAUSED&access_token=${conn.token}`, { method: "POST" });
          await admin.from("facebook_campaigns").update({
            status: "paused",
            pause_pending: false,
            rejection_reason: `Auto-pausada: gastou R$ ${(spendCents/100).toFixed(2)} do teto reservado de R$ ${(cap/100).toFixed(2)} — recarregue para reativar`,
          }).eq("id", c.id);
          paused.push(c.fb_campaign_id);
        }
      } catch (e) {
        errors.push({ id: c.id, error: (e as Error).message });
      }
    }

    return json({ ok: true, paused, errors, checked: (pending?.length || 0) + (capped?.length || 0) });
  } catch (err) {
    console.error("[fb-balance-check]", err);
    return json({ error: (err as Error).message }, 500);
  }
});

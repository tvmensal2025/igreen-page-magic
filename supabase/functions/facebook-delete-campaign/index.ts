// Excluir campanha — apenas SuperAdmin.
// Apaga no Meta (DELETE /{fb_campaign_id}) e só então remove do DB.
// Se a Meta falhar, NÃO apaga do banco (evita órfã gastando fora do painel).
import { adminClient, authConsultant, corsHeaders, FB_GRAPH, loadPlatformAccount } from "../_shared/fb-graph.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return j({ error: "unauthorized" }, 401);

    const admin = adminClient();
    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: auth.id });
    if (!isSuper) return j({ error: "forbidden: super admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaign_id || "");
    if (!campaignId) return j({ error: "campaign_id obrigatório" }, 400);

    const { data: row, error: rowErr } = await admin
      .from("facebook_campaigns")
      .select("id, fb_campaign_id, name, consultant_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (rowErr) return j({ error: rowErr.message }, 500);
    if (!row) return j({ error: "campanha não encontrada" }, 404);

    let metaDeleted = false;
    let metaError: string | null = null;

    if (row.fb_campaign_id) {
      try {
        const platform = await loadPlatformAccount();
        if (platform?.token) {
          const url = `${FB_GRAPH}/${row.fb_campaign_id}?access_token=${encodeURIComponent(platform.token)}`;
          const r = await fetch(url, { method: "DELETE" });
          const t = await r.text();
          if (!r.ok) {
            // Já deletada na Meta (404) → pode limpar o DB com segurança.
            const alreadyGone = r.status === 404 || /does not exist|Unsupported (get|delete) request/i.test(t);
            if (alreadyGone) {
              metaDeleted = true;
              console.warn("[fb-delete] Meta 404/gone — tratando como deletada:", t.slice(0, 200));
            } else {
              metaError = `Meta ${r.status}: ${t.slice(0, 300)}`;
              console.warn("[fb-delete] meta delete failed:", metaError);
            }
          } else {
            metaDeleted = true;
          }
        } else {
          metaError = "platform_facebook_account sem token";
        }
      } catch (e) {
        metaError = (e as Error).message;
        console.warn("[fb-delete] exception:", metaError);
      }

      if (!metaDeleted) {
        return j({
          error: "Falha ao excluir na Meta — campanha NÃO foi removida do sistema (evita órfã gastando).",
          meta_deleted: false,
          meta_error: metaError,
        }, 502);
      }
    } else {
      // Sem ID Meta: só existe no nosso banco.
      metaDeleted = true;
    }

    // Limpa filhos antes (insights/adsets/ads) se existirem.
    await admin.from("facebook_metrics_daily").delete().eq("campaign_id", row.id).then(() => {}, () => {});
    await admin.from("facebook_adsets").delete().eq("campaign_id", row.id).then(() => {}, () => {});
    await admin.from("facebook_ads").delete().eq("campaign_id", row.id).then(() => {}, () => {});

    const { error: delErr } = await admin.from("facebook_campaigns").delete().eq("id", row.id);
    if (delErr) return j({ error: `falha ao apagar do DB: ${delErr.message}`, meta_deleted: metaDeleted, meta_error: metaError }, 500);

    try {
      await admin.rpc("log_admin_action", {
        _action: "facebook_campaign_deleted",
        _target_type: "facebook_campaign",
        _target_id: row.id,
        _metadata: { name: row.name, fb_campaign_id: row.fb_campaign_id, consultant_id: row.consultant_id, meta_deleted: metaDeleted, meta_error: metaError },
      });
    } catch (_) { /* fire and forget */ }

    return j({ ok: true, meta_deleted: metaDeleted, meta_error: metaError });
  } catch (e) {
    console.error("[fb-delete] fatal:", e);
    return j({ error: (e as Error).message }, 500);
  }
});

function j(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

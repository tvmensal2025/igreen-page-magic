// One-shot cleanup: remove campanha duplicada 2026-0008 (id 42812356-df9f-4930-ad51-c5e7a1eef623)
// que foi criada 43s depois de 2026-0007 por duplo clique de publicar.
// Deleta na Meta, apaga pool, apaga do DB. Sem auth — a função é deletada após uso.
import { adminClient, corsHeaders, FB_GRAPH, loadPlatformAccount } from "../_shared/fb-graph.ts";

const CAMPAIGN_UUID = "42812356-df9f-4930-ad51-c5e7a1eef623";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const { data: row } = await admin
      .from("facebook_campaigns")
      .select("id, fb_campaign_id, name")
      .eq("id", CAMPAIGN_UUID)
      .maybeSingle();
    if (!row) return j({ ok: true, note: "already gone" });

    let metaDeleted = false;
    let metaError: string | null = null;
    if (row.fb_campaign_id) {
      const platform = await loadPlatformAccount();
      if (platform?.token) {
        const url = `${FB_GRAPH}/${row.fb_campaign_id}?access_token=${encodeURIComponent(platform.token)}`;
        const r = await fetch(url, { method: "DELETE" });
        const t = await r.text();
        if (r.ok || r.status === 404 || /does not exist/i.test(t)) metaDeleted = true;
        else metaError = `Meta ${r.status}: ${t.slice(0, 300)}`;
      } else metaError = "no platform token";
    } else metaDeleted = true;

    if (!metaDeleted) return j({ error: "meta delete failed", metaError }, 502);

    await admin.from("rodizio_pool_members").delete().in(
      "pool_id",
      (await admin.from("rodizio_pools").select("id").eq("campaign_id", row.id)).data?.map((p: any) => p.id) || [],
    ).then(() => {}, () => {});
    await admin.from("rodizio_pools").delete().eq("campaign_id", row.id).then(() => {}, () => {});
    await admin.from("facebook_metrics_daily").delete().eq("campaign_id", row.id).then(() => {}, () => {});
    await admin.from("facebook_campaigns").delete().eq("id", row.id);

    return j({ ok: true, deleted: row.name, metaDeleted, metaError });
  } catch (e) {
    return j({ error: (e as Error).message }, 500);
  }
});

function j(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

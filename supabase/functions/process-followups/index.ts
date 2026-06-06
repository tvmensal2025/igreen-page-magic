// Worker de follow-ups — roda via cron a cada 5min.
// Lê customers.next_followup_at <= now() (e bot ativo) e dispara a v1 com um
// "system nudge" para a IA decidir como reaquecer (usando followup_hook).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: aceita cron interno (x-internal-secret == embed_internal_token) ou Bearer com role admin.
    const internalSecret = req.headers.get("x-internal-secret") || "";
    let expectedInternal = Deno.env.get("EMBED_INTERNAL_SECRET") || "";
    if (!expectedInternal) {
      const { data: s } = await supabase.from("settings").select("value").eq("key", "embed_internal_token").maybeSingle();
      expectedInternal = String(s?.value || "");
    }
    const isInternal = !!expectedInternal && !!internalSecret && internalSecret === expectedInternal;

    if (!isInternal) {
      const authz = req.headers.get("authorization") || "";
      const jwt = authz.replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "unauthorized" }, 401);
      const { data: userData } = await supabase.auth.getUser(jwt);
      if (!userData?.user) return json({ error: "unauthorized" }, 401);
      const { data: roleRow } = await supabase
        .from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ error: "forbidden" }, 403);
    }

    const now = new Date().toISOString();
    const { data: due, error } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, conversation_step, consultant_id, next_followup_at, followup_hook, bot_paused, variant_id")
      .lte("next_followup_at", now)
      .eq("bot_paused", false)
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    const rows = due || [];
    if (rows.length === 0) return json({ ok: true, processed: 0 });

    let okCount = 0;
    let errCount = 0;
    const errors: any[] = [];

    for (const c of rows) {
      try {
        // Marca janela para evitar double-fire em caso de retry
        await supabase
          .from("customers")
          .update({
            next_followup_at: null,
            last_followup_at: now,
          })
          .eq("id", c.id);

        // Dispara a vendedora: trata o lead como se tivesse recebido um nudge
        // interno do sistema. A v1 lê followup_hook e decide o copy.
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-receive`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": expectedInternal,
          },
          body: JSON.stringify({
            internal_followup: true,
            customer_id: c.id,
            hook: c.followup_hook || null,
            reason: "scheduled_followup",
          }),
        });

        if (resp.ok) okCount++;
        else {
          errCount++;
          const txt = await resp.text().catch(() => "");
          errors.push({ id: c.id, status: resp.status, body: txt.slice(0, 200) });
        }
      } catch (e: any) {
        errCount++;
        errors.push({ id: c.id, error: String(e?.message || e) });
      }
    }

    return json({ ok: true, processed: rows.length, sent: okCount, failed: errCount, errors: errors.slice(0, 10) });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

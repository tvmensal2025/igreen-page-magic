// Liga customer_id em crm_deals órfãos (telefone sem vínculo).
// Progressão pós-finalizando (aprovado/30/60/90/120) foi movida para
// pos-venda-auto-progress + customers.pos_venda_stage (jun/2026).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret, x-cron-secret",
};

function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // deno-lint-ignore no-explicit-any
    const cronAuth = await assertCronAuth(req, supabase as any);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    if (isQuietHourBRT()) {
      logQuietSkip("crm-auto-progress");
      return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: unlinkedDeals } = await supabase
      .from("crm_deals")
      .select("id, remote_jid, consultant_id")
      .is("customer_id", null)
      .not("remote_jid", "is", null)
      .limit(200);

    let linkedCount = 0;
    for (const deal of unlinkedDeals || []) {
      const phone = normalizePhone(deal.remote_jid.split("@")[0]);
      if (!phone || phone.length < 10) continue;

      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("consultant_id", deal.consultant_id)
        .eq("phone_whatsapp", phone)
        .limit(1)
        .maybeSingle();

      if (customer) {
        await supabase.from("crm_deals").update({ customer_id: customer.id }).eq("id", deal.id);
        linkedCount++;
      }
    }

    if (linkedCount > 0) {
      console.log(`[crm-auto-progress] linked ${linkedCount} orphan deals`);
    }

    return new Response(
      JSON.stringify({ linked: linkedCount, checked: unlinkedDeals?.length || 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[crm-auto-progress] error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

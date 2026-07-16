// finalize-club: botão "Cadastrar no Club" da Captação.
// Valida com clubValidation (NÃO portalValidation) e despacha worker-club.
// Nunca grava portal2_* / nunca chama finalize-capture.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateForClub } from "../_shared/clubValidation.ts";
import { dispatchClubWorker, resolveClubIdconsultor } from "../_shared/club-worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jres(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jres({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const customerId = String(body?.customerId || body?.customer_id || "").trim();
    // Live só com dryRun:false explícito. Default = dry run (seguro em produção).
    const dryRun = body?.dryRun !== false;
    if (!customerId) return jres({ error: "customerId obrigatório" }, 400);

    const { data: customer, error } = await supabase
      .from("customers")
      .select(
        `id, name, cpf, rg, data_nascimento, email, cep, club_status,
         phone_whatsapp, portal2_celular_alt, phone_landline, phone_contact_confirmed,
         address_street, address_number, address_complement, address_neighborhood, address_city, address_state,
         portal_idconsultor_override, consultant_id,
         referral_partners:referral_partner_id(nome, cli, partner_igreen_id),
         consultants:consultant_id(igreen_id, name)`,
      )
      .eq("id", customerId)
      .maybeSingle();

    if (error || !customer) {
      return jres({ error: error?.message || "Cliente não encontrado" }, 404);
    }

    if (String(customer.club_status || "") === "submitted") {
      return jres({ already: true, club_status: "submitted" });
    }

    const validation = validateForClub(customer as any);
    if (!validation.ok) {
      return jres({
        error: "incomplete",
        missing: validation.pendingItems.map((p) =>
          p.kind === "invalid" && p.reason ? `${p.label}: ${p.reason}` : p.label,
        ),
      }, 400);
    }

    const idconsultor = resolveClubIdconsultor(customer);
    if (!idconsultor) {
      return jres({ error: "idconsultor ausente — preencha o ID do consultor na ficha" }, 400);
    }

    const result = await dispatchClubWorker(supabase, customerId, { dryRun });
    if (!result.ok) {
      return jres({
        error: result.error || "Falha no Worker Club",
        mode: result.mode,
        dryRun: result.dryRun,
      }, result.mode === "not_configured" ? 503 : 502);
    }

    return jres({
      ok: true,
      dryRun: result.dryRun,
      mode: result.mode,
      idconsultor,
      result: result.body,
    });
  } catch (e: any) {
    console.error("[finalize-club]", e?.message || e);
    return jres({ error: e?.message || String(e) }, 500);
  }
});

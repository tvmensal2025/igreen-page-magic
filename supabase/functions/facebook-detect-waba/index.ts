// facebook-detect-waba
// ─────────────────────
// Wrapper fino do resolvedor autoritativo compartilhado. Mantém o contrato antigo
// da UI, mas evita lógica divergente entre painel, preflight e criação de campanha.

import { authConsultant, corsHeaders, fbFetch, loadPlatformAccount } from "../_shared/fb-graph.ts";
import { resolveWabaPhone } from "../_shared/resolve-waba-phone.ts";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await authConsultant(req);
    if (!auth) return jsonRes({ ok: false, error: "missing_auth" });
    const waba = await resolveWabaPhone(auth.id, { persist: true });
    if (waba.ok && waba.chosen) {
      try {
        const platform = await loadPlatformAccount();
        if (platform?.ad_account_id && platform.page_id) {
          const params = new URLSearchParams({
            targeting_spec: JSON.stringify({
              geo_locations: { countries: ["BR"] },
              age_min: 25,
              age_max: 65,
              targeting_automation: { advantage_audience: 1 },
            }),
            optimization_goal: "CONVERSATIONS",
            destination_type: "WHATSAPP",
            promoted_object: JSON.stringify({ page_id: platform.page_id, whatsapp_phone_number: waba.chosen.digits }),
            access_token: platform.token,
          });
          await fbFetch(`/${platform.ad_account_id}/reachestimate?${params.toString()}`, undefined, 1);
        }
      } catch (e) {
        const msg = String((e as Error)?.message || "");
        const isWabaMismatch = msg.includes("1487246") || msg.includes("2446885") || /not linked to your account/i.test(msg);
        if (isWabaMismatch) {
          return jsonRes({
            ok: true,
            connected: true,
            waba_id: waba.waba_id || null,
            page_id: waba.page_id || null,
            numbers: waba.numbers,
            current_number: waba.chosen.digits,
            current_phone_number_id: waba.chosen.id,
            chosen: waba.chosen,
            matches: false,
            auto_filled: true,
            needs_pick: false,
            hint: `A Meta encontrou o número ${waba.chosen.display}, mas ele ainda não está vinculado à Página usada nos anúncios. Rode “Validar e corrigir WhatsApp automaticamente” e vincule a WABA à Página se continuar recusando.`,
            meta_message: msg,
            next_steps: [
              `Vincule a WABA ${waba.waba_id || "do número"} à Página ${waba.page_id || "da plataforma"}`,
              "Confirme o phone_number_id no WhatsApp Manager",
              "Volte em Dados e clique em Validar e corrigir automático",
            ],
            missing_permissions: waba.missing_permissions || [],
            detected_paths_tried: waba.detected_paths_tried || [],
            discovered_via: waba.discovered_via || null,
          });
        }
      }
    }
    return jsonRes({
      ok: true,
      connected: waba.ok,
      waba_id: waba.waba_id || null,
      page_id: waba.page_id || null,
      numbers: waba.numbers,
      current_number: waba.chosen?.digits || null,
      current_phone_number_id: waba.chosen?.id || null,
      chosen: waba.chosen || null,
      matches: !!waba.chosen,
      auto_filled: !!waba.chosen,
      needs_pick: !waba.chosen && waba.numbers.length > 1,
      hint: waba.hint,
      next_steps: waba.next_steps || [],
      missing_permissions: waba.missing_permissions || [],
      detected_paths_tried: waba.detected_paths_tried || [],
      discovered_via: waba.discovered_via || null,
    });
  } catch (e) {
    console.error("[detect-waba] exception", e);
    return jsonRes({ ok: false, error: (e as Error).message || "unexpected" });
  }
});


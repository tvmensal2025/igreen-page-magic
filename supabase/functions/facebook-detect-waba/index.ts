// facebook-detect-waba
// ─────────────────────
// Wrapper fino do resolvedor autoritativo compartilhado. Mantém o contrato antigo
// da UI, mas evita lógica divergente entre painel, preflight e criação de campanha.

import { authConsultant, corsHeaders } from "../_shared/fb-graph.ts";
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
      detected_paths_tried: waba.detected_paths_tried || [],
      discovered_via: waba.discovered_via || null,
    });
  } catch (e) {
    console.error("[detect-waba] exception", e);
    return jsonRes({ ok: false, error: (e as Error).message || "unexpected" });
  }
});


import { adminClient, authConsultant, corsHeaders, fbFetch, loadPlatformAccount } from "../_shared/fb-graph.ts";
import { resolveWabaPhone } from "../_shared/resolve-waba-phone.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const links = {
  whatsapp_manager: "https://business.facebook.com/wa/manage/phone-numbers/",
  whatsapp_accounts: "https://business.facebook.com/settings/whatsapp-business-accounts",
  pages: "https://business.facebook.com/settings/pages",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const auth = await authConsultant(req);
    if (!auth) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = adminClient();
    const platform = await loadPlatformAccount();
    if (!platform?.ad_account_id || !platform.page_id) {
      return json({
        ok: false,
        status: "blocked",
        error: "Conta Facebook da plataforma incompleta.",
        action_required: "Conecte Página e conta de anúncios da plataforma.",
        links,
      });
    }

    const waba = await resolveWabaPhone(auth.id, { persist: true });
    const result: Record<string, unknown> = {
      ok: false,
      status: "blocked",
      page_id: waba.page_id || platform.page_id,
      waba_id: waba.waba_id || null,
      numbers: waba.numbers,
      chosen: waba.chosen || null,
      detected_paths_tried: waba.detected_paths_tried || [],
      discovered_via: waba.discovered_via || null,
      hint: waba.hint || null,
      next_steps: waba.next_steps || [],
      missing_permissions: waba.missing_permissions || [],
      links,
    };

    if (!waba.ok || !waba.chosen) {
      result.error = waba.hint || "Não encontrei automaticamente um número WhatsApp Business válido para esta Página.";
      await admin.from("admin_audit_log").insert({
        admin_user_id: auth.id,
        action: "facebook_auto_fix_whatsapp_failed",
        target_type: "consultant_ad_settings",
        target_id: auth.id,
        metadata: result,
      });
      return json(result);
    }

    if (!/^\d+$/.test(waba.chosen.id || "")) {
      result.error = `O número ${waba.chosen.digits} está salvo, mas ainda não temos o phone_number_id numérico real da Meta.`;
      result.next_steps = [
        "Copie o phone_number_id numérico no WhatsApp Manager e salve em Dados.",
        `Vincule a WABA do número ${waba.chosen.digits} à Página ${platform.page_id}.`,
        "Reconecte a conta da plataforma aceitando WhatsApp Business Management se a permissão estiver ausente.",
      ];
      await admin.from("admin_audit_log").insert({
        admin_user_id: auth.id,
        action: "facebook_auto_fix_whatsapp_missing_real_phone_id",
        target_type: "consultant_ad_settings",
        target_id: auth.id,
        metadata: result,
      });
      return json(result);
    }

    const promotedObject = {
      page_id: platform.page_id,
      whatsapp_phone_number: waba.chosen.digits,
    };
    const targeting = {
      geo_locations: { countries: ["BR"] },
      age_min: 25,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 },
    };

    try {
      const params = new URLSearchParams({
        targeting_spec: JSON.stringify(targeting),
        optimization_goal: "CONVERSATIONS",
        destination_type: "WHATSAPP",
        promoted_object: JSON.stringify(promotedObject),
        access_token: platform.token,
      });
      await fbFetch(`/${platform.ad_account_id}/reachestimate?${params.toString()}`, undefined, 1);
      result.ok = true;
      result.status = "ready";
      result.error = null;
      result.message = /^\d+$/.test(waba.chosen.id)
        ? `WhatsApp validado e salvo automaticamente: ${waba.chosen.display} (phone_number_id ${waba.chosen.id}).`
        : `WhatsApp validado pela Meta com o número salvo: ${waba.chosen.display}.`;
      await admin.from("admin_audit_log").insert({
        admin_user_id: auth.id,
        action: "facebook_auto_fix_whatsapp_ready",
        target_type: "consultant_ad_settings",
        target_id: auth.id,
        metadata: result,
      });
      return json(result);
    } catch (e) {
      const metaMessage = (e as Error).message || String(e);
      result.ok = false;
      result.status = "meta_rejected";
      result.error = "A Meta ainda recusou este número para a Página configurada.";
      result.meta_message = metaMessage;
      result.next_steps = [
        `Vincule a WABA ${waba.waba_id || "do número"} à Página ${platform.page_id}`,
        "Confirme que a conta de anúncios tem permissão para enviar anúncios para essa Página/WABA",
        "Depois rode esta validação automática novamente",
      ];
      await admin.from("admin_audit_log").insert({
        admin_user_id: auth.id,
        action: "facebook_auto_fix_whatsapp_meta_rejected",
        target_type: "consultant_ad_settings",
        target_id: auth.id,
        metadata: result,
      });
      return json(result);
    }
  } catch (e) {
    console.error("[facebook-auto-fix-whatsapp] exception", e);
    return json({ ok: false, status: "error", error: (e as Error).message || "unexpected", links }, 500);
  }
});
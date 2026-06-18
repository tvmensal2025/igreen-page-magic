import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createWhatsAppSender } from "../_shared/whatsapp-api.ts";
import { createWhapiSender } from "../_shared/whapi-api.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";

interface Body {
  phone: string;
  mediaUrl: string;
  caption?: string;
  mediatype?: "video" | "image" | "document" | "audio";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAuth = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !userData?.user) return json({ error: "Não autenticado" }, 401);
    const consultantId = userData.user.id;

    const body: Body = await req.json();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const mediaUrl = String(body.mediaUrl || "");
    const caption = String(body.caption || "").slice(0, 500);
    const mediatype = (
      body.mediatype === "image" || body.mediatype === "document" || body.mediatype === "audio"
        ? body.mediatype
        : "video"
    ) as "video" | "image" | "document" | "audio";

    if (phone.length < 10 || phone.length > 13) return json({ error: "Telefone inválido" }, 400);
    if (!/^https?:\/\//.test(mediaUrl)) return json({ error: "URL de mídia inválida" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // ── Roteamento: Whapi (super admin) vs Evolution (demais consultores) ──
    const { data: settingsRows } = await admin.from("settings").select("key,value");
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((s: { key: string; value: string }) => { settings[s.key] = s.value; });
    const superAdminId = String(settings.superadmin_consultant_id || "").trim();
    let isSuperAdmin = !!superAdminId && superAdminId === consultantId;
    if (!isSuperAdmin) {
      const { data: isAdmin } = await admin.rpc("is_super_admin", { _user_id: consultantId });
      isSuperAdmin = isAdmin === true;
    }

    if (isSuperAdmin) {
      const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
      if (!whapiToken) {
        return json({
          error: "Token do WhatsApp (Whapi) não configurado",
          hint: "Configure whapi_token em settings ou WHAPI_TOKEN no servidor.",
        }, 500);
      }
      const sender = createWhapiSender(whapiToken);
      const ok = mediatype === "audio"
        ? await sender.sendMedia(phone, mediaUrl, caption, "audio")
        : await sender.sendMedia(phone, mediaUrl, caption, mediatype);
      if (!ok) {
        return json({
          error: "Whapi recusou o envio",
          hint: "Verifique se a mídia está acessível publicamente e se o número tem WhatsApp ativo.",
        });
      }
      return json({ success: true, channel: "whapi" });
    }

    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionUrl || !evolutionKey) {
      return json({ error: "Evolution não configurada" }, 500);
    }

    const { data: inst, error: instErr } = await admin
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (instErr || !inst?.instance_name) {
      return json({
        error: "Instância WhatsApp não encontrada — conecte primeiro",
        hint: "Acesse Admin → Conexão e escaneie o QR Code.",
      }, 400);
    }

    const quota = await checkSendQuota(admin, inst.instance_name);
    if (!quota.allowed) {
      return json({
        error: "Instância bloqueada (anti-ban)",
        reason: (quota as Record<string, unknown>).reason ?? null,
        until: (quota as Record<string, unknown>).until ?? (quota as Record<string, unknown>).next_allowed_at ?? null,
      }, 423);
    }

    const sender = createWhatsAppSender(evolutionUrl, evolutionKey, inst.instance_name);
    const result = mediatype === "audio"
      ? await sender.sendAudio(phone, mediaUrl)
      : await sender.sendMedia(phone, mediaUrl, caption, mediatype as "video" | "image" | "document");

    if (result !== true) {
      const detail = typeof result === "object" ? result.detail : "";
      const status = typeof result === "object" ? result.status : 0;
      return json({
        error: "Evolution recusou o envio",
        detail: detail || "Sem detalhes do servidor Evolution",
        upstream_status: status,
        hint: status === 500
          ? "A mídia pode estar inacessível, com tamanho/duração inválido, ou a instância desconectada. Verifique a URL e o status da instância."
          : status === 400
          ? "Payload rejeitado pela Evolution (formato/mimetype ou número inválido)."
          : "Tente reconectar a instância e reenviar.",
      });
    }

    await registerSend(admin, inst.instance_name);
    return json({ success: true, channel: "evolution" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Erro interno";
    console.error("admin-send-material error:", e);
    return json({ error: msg }, 500);
  }
});

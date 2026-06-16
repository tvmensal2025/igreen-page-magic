// ─── Aviso de novo cadastro pendente para o super admin ────────────────────
//
// Disparado por trigger no banco (pg_net) quando um consultor com approved=false
// é inserido. Envia um WhatsApp pelo Whapi para o número pessoal do super admin
// pedindo para responder "SIM" e aprovar.
//
// Custo zero: usa o mesmo número/canal Whapi que o projeto já paga.
//
// Body esperado (do trigger): { consultant_id, name, license, phone }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const consultantId: string = body.consultant_id || body.record?.id || "";
    let name: string = body.name || body.record?.name || "";
    let license: string = body.license || body.record?.license || "";
    let phone: string = body.phone || body.record?.phone || "";

    // Se o trigger só mandou o id, carrega o resto.
    if (consultantId && (!name || !license)) {
      const { data: c } = await supabase
        .from("consultants")
        .select("name, license, phone, approved")
        .eq("id", consultantId)
        .maybeSingle();
      if (c) {
        name = name || (c as any).name || "";
        license = license || (c as any).license || "";
        phone = phone || (c as any).phone || "";
        // Se já foi aprovado nesse meio tempo, não avisa.
        if ((c as any).approved === true) return json({ ok: true, msg: "already_approved" });
      }
    }

    // ─── Resolve canal Whapi + número de destino (super admin) ─────────
    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    (settingsRows as any[])?.forEach((s) => { settings[s.key] = s.value; });

    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    const whapiBaseUrl = (settings.whapi_api_url || "https://gate.whapi.cloud").replace(/\/+$/, "");
    if (!whapiToken) return json({ ok: false, error: "whapi_token_missing" }, 500);

    const superAdminConsultantId = settings.superadmin_consultant_id || "";
    let targetPhone = "";
    if (superAdminConsultantId) {
      const { data: sa } = await supabase
        .from("consultants")
        .select("phone")
        .eq("id", superAdminConsultantId)
        .maybeSingle();
      targetPhone = (sa as any)?.phone || "";
    }
    // Fallback: número de alertas configurado em app_settings.
    if (!targetPhone) {
      const { data: appSettings } = await supabase
        .from("app_settings")
        .select("super_admin_phone")
        .eq("id", "global")
        .maybeSingle();
      targetPhone = (appSettings as any)?.super_admin_phone || "";
    }
    if (!targetPhone) return json({ ok: false, error: "super_admin_phone_missing" }, 500);

    const digits = String(targetPhone).replace(/\D/g, "");
    const number = digits.startsWith("55") ? digits : `55${digits}`;
    const to = `${number}@s.whatsapp.net`;

    // Quantos pendentes existem (para orientar o SIM com ou sem nome).
    const { count } = await supabase
      .from("consultants")
      .select("id", { count: "exact", head: true })
      .eq("approved", false);
    const pendentes = count ?? 1;

    const phoneFmt = phone
      ? phone.replace(/\D/g, "").replace(/^55/, "")
      : "(sem número)";

    const instrucao = pendentes > 1
      ? `Responda *SIM ${name || license}* para aprovar este.`
      : `Responda *SIM* para aprovar.`;

    const text =
      `🆕 *NOVO CADASTRO AGUARDANDO APROVAÇÃO*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Nome:* ${name || "(sem nome)"}\n` +
      `🔖 *Licença:* ${license || "—"}\n` +
      `📱 *WhatsApp:* ${phoneFmt}\n\n` +
      `${instrucao}` +
      (pendentes > 1 ? `\n\n_Há ${pendentes} cadastros pendentes no total._` : "");

    const res = await fetch(`${whapiBaseUrl}/messages/text`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${whapiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, body: text, typing_time: 1 }),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      console.error("[notify-superadmin-signup] whapi falhou:", res.status, errText);
      return json({ ok: false, error: "whapi_send_failed", status: res.status }, 502);
    }

    console.log(`✅ [notify-superadmin-signup] aviso enviado p/ ${number} (cadastro ${consultantId})`);
    return json({ ok: true, consultant_id: consultantId, sent_to: number });
  } catch (e) {
    console.error("[notify-superadmin-signup] erro:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

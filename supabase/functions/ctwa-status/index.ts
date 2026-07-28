// ctwa-status
// ───────────
// Devolve o status consolidado do pré-voo CTWA usando a conta Facebook ÚNICA
// da plataforma (platform_facebook_account) + telefone WA do consultor
// (consultant_ad_settings). NÃO lê facebook_connections (legado) e NÃO chama
// o Meta — é leve e rápido, pra UI montar os cards de Pixel/Facebook/Número.
//
// Retorno:
// {
//   ok: true,
//   facebook: { status: "ok"|"warn"|"fail", label, hint?, detail? },
//   pixel:    { status: "ok"|"warn"|"fail", label, hint?, detail? },
//   whatsapp_number: { status: "ok"|"warn"|"fail", label, hint?, detail? }
// }

import { authConsultant, corsHeaders, loadConsultantAdSettings, loadPlatformAccount } from "../_shared/fb-graph.ts";

// Pixel oficial = o gravado em platform_facebook_account (igreen-oficial-remarketing).
const FALLBACK_PIXEL_ID = "708759256921383";

interface Check {
  status: "ok" | "warn" | "fail";
  label: string;
  hint?: string;
  detail?: string;
}

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
    if (!auth) return jsonRes({ ok: false, error: "unauthorized" }, 401);

    const platform = await loadPlatformAccount();
    const settings = await loadConsultantAdSettings(auth.id);

    let facebook: Check;
    let pixel: Check;

    if (!platform) {
      facebook = { status: "fail", label: "Facebook NÃO conectado", hint: "Conta principal da plataforma em sincronização." };
      pixel = { status: "fail", label: "Pixel ausente", hint: "Conecte o Facebook primeiro." };
    } else {
      const expired = platform.token_expires_at && new Date(platform.token_expires_at) < new Date();
      if (expired) {
        facebook = { status: "fail", label: "Token do Facebook expirado", hint: "Admin precisa reconectar a conta da plataforma." };
      } else if (!platform.page_id) {
        facebook = { status: "warn", label: "Facebook conectado, sem Página", hint: "Selecione a Página oficial." };
      } else {
        facebook = { status: "ok", label: "Facebook conectado", detail: `Página ${platform.page_id}` };
      }
      // Pixel oficial da plataforma (igreen-oficial-remarketing).
      const pixelId = platform.pixel_id || FALLBACK_PIXEL_ID;
      pixel = platform.pixel_id
        ? { status: "ok", label: "Rastreamento do Facebook ok", detail: `${platform.pixel_id}` }
        : { status: "warn", label: "Rastreamento em modo reserva", detail: pixelId, hint: "Rode Criar pixel igreen-oficial-remarketing no Super Admin." };
    }

    const phone = settings?.whatsapp_destination_number || null;
    const whatsapp_number: Check = phone
      ? { status: "ok", label: "WhatsApp conectado", detail: phone }
      : { status: "fail", label: "Número WhatsApp ausente", hint: "Cadastre o número em Central de anúncios → WhatsApp dos anúncios." };

    return jsonRes({ ok: true, facebook, pixel, whatsapp_number });
  } catch (e) {
    console.error("[ctwa-status] exception", e);
    return jsonRes({ ok: false, error: (e as Error).message || "unexpected" });
  }
});

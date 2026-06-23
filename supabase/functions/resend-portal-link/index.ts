// resend-portal-link: reenvia ao cliente, pelo MESMO canal de origem
// (Evolution/Whapi), o link oficial da iGreen para validação facial /
// assinatura do contrato. Usado pelo consultor a partir do chat ou do painel
// de captação. Não muda conversation_step nem despausa o bot — só dispara o
// texto com o link já existente em customers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { resolveChannelForCustomer, isUnavailable } from "../_shared/channel-sender.ts";
import { registerSend, checkSendQuota } from "../_shared/anti-ban.ts";

interface Body { customerId: string; consultantId: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const customerId = String(body.customerId || "").trim();
    const consultantId = String(body.consultantId || "").trim();
    if (!customerId || !consultantId) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const { data: customer, error: ce } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, link_facial, link_assinatura, portal2_contract_link, igreen_link, consultant_id")
      .eq("id", customerId)
      .maybeSingle();
    if (ce || !customer) return json({ ok: false, error: "customer_not_found" }, 404);
    if (customer.consultant_id && customer.consultant_id !== consultantId) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    const link =
      (customer as any).link_facial ||
      (customer as any).link_assinatura ||
      (customer as any).portal2_contract_link ||
      (customer as any).igreen_link;
    if (!link) return json({ ok: false, error: "no_link_yet", message: "O link do portal ainda não foi gerado para este cliente." }, 409);

    const digits = String(customer.phone_whatsapp || "").replace(/\D/g, "");
    if (!digits) return json({ ok: false, error: "no_phone" }, 400);

    const env = {
      evolutionUrl: Deno.env.get("EVOLUTION_API_URL"),
      evolutionKey: Deno.env.get("EVOLUTION_API_KEY"),
      whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
    };
    const channel = await resolveChannelForCustomer(supabase, customerId, env);
    if (isUnavailable(channel)) {
      return json({ ok: false, error: "channel_unavailable", detail: channel.reason }, 409);
    }

    const quota = await checkSendQuota(supabase, channel.instanceName);
    if (!quota.allowed) return json({ ok: false, error: "rate_limited", detail: quota.reason }, 429);

    const firstName = String(customer.name || "").trim().split(/\s+/)[0] || "";
    const text =
      `${firstName ? "Oi " + firstName + "! " : ""}🔗 Aqui está novamente o *link oficial da iGreen* para você concluir seu cadastro:\n\n${link}\n\n` +
      `É o mesmo link da *validação facial (selfie)* e da *assinatura do contrato*. Abra no celular, siga os passos e me avise por aqui quando finalizar! ✅`;

    const jid = `${digits}@s.whatsapp.net`;
    const sendCtx = {
      customerId,
      consultantId,
      stepId: "manual:resend_portal_link",
      idempotencyKey: `resend-link:${customerId}:${Date.now()}`,
      supabase,
    };
    const res = await channel.adapter.sendText(jid, text, sendCtx as any);
    if (!res.ok) {
      return json({ ok: false, error: "send_failed", detail: (res as any).detail }, 502);
    }
    await registerSend(supabase, channel.instanceName);

    await supabase.from("outbound_message_log").insert({
      customer_id: customerId,
      consultant_id: consultantId,
      channel: channel.kind,
      instance_name: channel.instanceName,
      message_type: "resend_portal_link",
      payload: { link },
    }).then(() => {}, () => {});

    await supabase.from("customers").update({
      link_facial_sent_at: new Date().toISOString(),
    }).eq("id", customerId).then(() => {}, () => {});

    return json({ ok: true, channel: channel.kind, instance: channel.instanceName });
  } catch (e) {
    return json({ ok: false, error: "exception", message: (e as Error).message }, 500);
  }
});

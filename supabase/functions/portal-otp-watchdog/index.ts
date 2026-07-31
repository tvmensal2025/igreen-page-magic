// portal-otp-watchdog: cron que garante que cadastros, OTPs e link facial
// sempre cheguem ao Portal 2. Executa 1x/min via pg_cron.
//
// Regra de ouro: cada lead vive e morre na MESMA instância de WhatsApp
// (origin_channel + origin_instance_name gravados no primeiro inbound).
// Nunca trocamos de canal — se a instância caiu, alertamos o consultor
// (via Whapi superadmin, fora do canal do cliente) e seguramos a mensagem.
//
// Buckets:
//   A) cadastro_portal/portal_submitting/worker_offline/missing_documents
//      sem portal2_idcliente há >90s → dispatchPortalWorker
//   B) otp_code presente, portal2_idcliente presente, sem portal2_otp_validated_at
//      → reenvia /confirm-otp; se worker disser "expirado" limpa otp_code,
//        pede novo código pelo canal de origem
//   C) portal2_otp_validated_at presente mas link_facial não enviado
//      → puxa contrato do worker e envia link pelo canal de origem;
//        se instância offline, gera alerta e segura até voltar

import { loadSuperadminConsultantId } from "../_shared/attendance-channel-env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchPortalWorker, resolveWorker } from "../_shared/portal-worker.ts";
import {
  resolveChannelForCustomer,
  isUnavailable,
  type UnavailableChannel,
} from "../_shared/channel-sender.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const MAX_RETRIES = 10;
const BATCH_LIMIT = 20;

function backoffOk(retryCount: number, lastAt: string | null): boolean {
  if (!lastAt) return true;
  const lastMs = new Date(lastAt).getTime();
  if (!Number.isFinite(lastMs)) return true;
  // exponencial: 30s, 60s, 120s, 240s, ... cap 10min
  const waitMs = Math.min(30_000 * Math.pow(2, Math.max(0, retryCount - 1)), 600_000);
  return Date.now() - lastMs >= waitMs;
}

function isWorkerTransient(status: number, body: string): boolean {
  const text = String(body || "").trim().toLowerCase();
  // OTP inválido/expirado NÃO é transitório — mesmo se o worker devolver 502 legado.
  if (
    /c[oó]digo inv[aá]lido ou expirado/.test(text) ||
    /otp_invalid_or_expired/.test(text) ||
    /otp.*expir/.test(text) ||
    /code.*expired/.test(text)
  ) {
    return false;
  }
  // 502/503/504 só contam como rede se a resposta for HTML de proxy/gateway
  // ou body vazio — JSON de negócio do worker NÃO é transient.
  if (text.startsWith("<!doctype") || text.startsWith("<html")) return true;
  if (!text && (status === 502 || status === 503 || status === 504)) return true;
  return status === 503 || status === 504;
}

async function resolveIds(supabase: any, customerId: string): Promise<{
  idconsultor: number | null;
  idcliente: number | null;
}> {
  const { data: c } = await supabase
    .from("customers")
    .select(`
      portal2_idcliente,
      portal_idconsultor_override,
      consultants:consultant_id(igreen_id),
      referral_partners:referral_partner_id(cli, partner_igreen_id)
    `)
    .eq("id", customerId)
    .maybeSingle();
  const overrideRaw = Number(c?.portal_idconsultor_override || 0);
  const overrideId = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : 0;
  const dono = c?.consultants?.igreen_id ? Number(c.consultants.igreen_id) : null;
  const partnerIgreenId = c?.referral_partners?.partner_igreen_id
    ? Number(c.referral_partners.partner_igreen_id) : 0;
  const partnerCli = c?.referral_partners?.cli ? Number(c.referral_partners.cli) : 0;
  const partnerAsConsultant =
    (Number.isFinite(partnerIgreenId) && partnerIgreenId > 0)
      ? partnerIgreenId
      : (Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0);
  const idconsultor = overrideId > 0
    ? overrideId
    : (partnerAsConsultant > 0 ? partnerAsConsultant : dono);
  const idcliente = c?.portal2_idcliente ? Number(c.portal2_idcliente) : null;
  return { idconsultor, idcliente };
}

/**
 * Registra alerta no painel + manda WhatsApp para o consultor (via Whapi
 * superadmin) avisando que a instância dele caiu e está bloqueando um lead.
 * Throttle: 1x a cada 30min por (consultor + instância) para não spammar.
 */
async function alertConsultantInstanceOffline(
  supabase: any,
  customerId: string,
  consultantId: string | null,
  unavailable: UnavailableChannel,
  customerLabel: string,
) {
  const alertKey = `instance_offline:${unavailable.instanceName || "?"}`;
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("bot_handoff_alerts")
    .select("id")
    .eq("consultant_id", consultantId)
    .eq("reason", alertKey)
    .gt("created_at", since)
    .limit(1);

  await supabase.from("bot_handoff_alerts").insert({
    customer_id: customerId,
    consultant_id: consultantId,
    reason: alertKey,
    severity: "high",
    details: unavailable.detail,
  }).catch((e: any) => console.warn(`[alert insert] ${e?.message || e}`));

  if (recent && recent.length > 0) return; // já avisou nos últimos 30min

  // notifica consultor via Whapi superadmin (canal fora do cliente)
  const whapiToken = Deno.env.get("WHAPI_TOKEN") || "";
  if (!whapiToken || !consultantId) return;
  const { data: consultant } = await supabase
    .from("consultants")
    .select("whatsapp_number, phone, name")
    .eq("id", consultantId)
    .maybeSingle();
  const rawPhone = (consultant as any)?.whatsapp_number || (consultant as any)?.phone;
  if (!rawPhone) return;
  const digits = String(rawPhone).replace(/\D/g, "");
  if (digits.length < 10) return;
  const to = digits.startsWith("55") ? digits : `55${digits}`;
  const text =
    `⚠️ *Atenção, ${(consultant as any)?.name?.split(" ")?.[0] || "consultor"}!*\n\n` +
    `Sua instância de WhatsApp (\`${unavailable.instanceName}\`) está fora do ar ` +
    `(${unavailable.reason}).\n\n` +
    `O lead *${customerLabel}* está aguardando mensagem e só será entregue quando você reconectar.\n\n` +
    `Por favor, reabra o app e escaneie o QR code da instância.`;
  try {
    await fetch("https://gate.whapi.cloud/messages/text", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${whapiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, body: text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    console.warn(`[alert whapi] consultor=${consultantId}: ${e?.message || e}`);
  }
}

async function bucketA(supabase: any) {
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const { data: rows } = await supabase
    .from("customers")
    .select("id, status, portal_retry_count, last_portal_dispatch_at")
    .is("portal2_idcliente", null)
    .in("status", ["cadastro_portal", "portal_submitting", "worker_offline", "missing_documents"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  let dispatched = 0;
  for (const r of rows ?? []) {
    const retries = Number(r.portal_retry_count || 0);
    if (retries >= MAX_RETRIES) continue;
    if (!backoffOk(retries, r.last_portal_dispatch_at)) continue;
    try {
      await supabase.from("customers").update({
        last_portal_dispatch_at: new Date().toISOString(),
        portal_retry_count: retries + 1,
      }).eq("id", r.id);
      const res = await dispatchPortalWorker(supabase, r.id);
      await supabase.from("customers").update({
        last_portal_dispatch_error: res.ok ? null : (res.error || res.mode).slice(0, 200),
      }).eq("id", r.id);
      dispatched++;
    } catch (e: any) {
      console.warn(`[watchdog A] customer=${r.id} erro: ${e?.message || e}`);
    }
  }
  return { scanned: rows?.length ?? 0, dispatched };
}

const OTP_EXPIRED_PATTERNS = [
  /c[oó]digo inv[aá]lido ou expirado/i,
  /otp.*expir/i,
  /code.*expired/i,
];

async function bucketB(supabase: any) {
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const { data: rows } = await supabase
    .from("customers")
    .select("id, name, otp_code, portal_retry_count, last_otp_dispatch_at, consultant_id, do_not_contact, phone_whatsapp, status, portal2_status, conversation_step")
    .not("otp_code", "is", null)
    .not("portal2_idcliente", "is", null)
    .is("portal2_otp_validated_at", null)
    .eq("do_not_contact", false)
    .lt("otp_received_at", cutoff)
    .not("status", "in", '("cadastro_concluido","complete","registered_igreen","abandoned","automation_failed")')
    .neq("conversation_step", "otp_confirmar")
    .order("otp_received_at", { ascending: true })
    .limit(BATCH_LIMIT);

  const env = {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL"),
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY"),
    whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
    superadminConsultantId: await loadSuperadminConsultantId(supabase),
  };

  let sent = 0;
  let expired = 0;
  for (const r of rows ?? []) {
    const retries = Number(r.portal_retry_count || 0);
    if (retries >= MAX_RETRIES) continue;
    if (!backoffOk(retries, r.last_otp_dispatch_at)) continue;
    const { idconsultor, idcliente } = await resolveIds(supabase, r.id);
    if (!idconsultor || !idcliente) {
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: !idcliente ? "missing_portal2_idcliente" : "missing_idconsultor",
      }).eq("id", r.id);
      continue;
    }
    const resolved = await resolveWorker(supabase, r.id).catch(() => null);
    if (!resolved) continue;
    try {
      const res = await fetch(`${resolved.url}/confirm-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resolved.secret}`,
        },
        body: JSON.stringify({ idconsultor, idcliente, code: r.otp_code, customer_id: r.id }),
        signal: AbortSignal.timeout(45_000),
      });
      const txt = await res.text().catch(() => "");
      console.log(`[watchdog B] customer=${r.id} confirm-otp=${res.status} body=${txt.slice(0, 200)}`);
      if (res.ok) {
        await supabase.from("customers").update({
          status: "validating_otp",
          conversation_step: "aguardando_facial",
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: null,
          portal_retry_count: 0,
        }).eq("id", r.id);
        sent++;
        continue;
      }

      if (isWorkerTransient(res.status, txt)) {
        await supabase.from("customers").update({
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: `worker_transient HTTP ${res.status}: ${txt.slice(0, 200)}`,
        }).eq("id", r.id);
        continue;
      }

      // Detecta OTP expirado/inválido → para de retentar e pede novo código
      const isExpired = OTP_EXPIRED_PATTERNS.some((re) => re.test(txt))
        || /otp_invalid_or_expired/i.test(txt)
        || res.status === 400;
      if (isExpired) {
        const clearedAt = new Date().toISOString();
        await supabase.from("customers").update({
          otp_code: null,
          otp_received_at: null,
          status: "awaiting_otp",
          conversation_step: "otp_falhou",
          last_otp_dispatch_at: clearedAt,
          last_otp_dispatch_error: "otp_expired_cleared",
          portal_retry_count: 0,
        }).eq("id", r.id);
        expired++;

        // Tenta gerar um NOVO código na iGreen (cliente recebe no Zap da iGreen)
        try {
          await fetch(`${resolved.url}/resend-otp`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${resolved.secret}`,
            },
            body: JSON.stringify({ customer_id: r.id, idconsultor, idcliente }),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (e: any) {
          console.warn(`[watchdog B] resend-otp falhou customer=${r.id}: ${e?.message || e}`);
        }

        // Mensagem ao cliente pelo canal de origem
        const channel = await resolveChannelForCustomer(supabase, r.id, env);
        if (isUnavailable(channel)) {
          await alertConsultantInstanceOffline(
            supabase, r.id, r.consultant_id, channel,
            r.name || r.id,
          );
        } else {
          const gate = await assertBotOutboundAllowed(supabase, {
            customerId: r.id,
            consultantId: r.consultant_id,
          });
          if (!gate.allowed) {
            continue;
          }
          const firstName = String(r.name || "").trim().split(/\s+/)[0] || "";
          const msg =
            `${firstName ? firstName + ", " : ""}o código anterior *não confirmou* (inválido ou expirado) ⏰\n\n` +
            `Acabei de pedir um *novo código* — quando chegar no WhatsApp, *digite aqui* pra eu validar.`;
          const { data: c } = await supabase
            .from("customers").select("phone_whatsapp").eq("id", r.id).maybeSingle();
          const digits = String(c?.phone_whatsapp || "").replace(/\D/g, "");
          if (digits) {
            const jid = `${digits}@s.whatsapp.net`;
            const sendCtx = {
              customerId: r.id,
              consultantId: r.consultant_id,
              stepId: "watchdog_otp_expired",
              // Estável por evento de limpeza (não Date.now → sem duplicata em retry).
              idempotencyKey: `otp-exp:${r.id}:${clearedAt}`,
              supabase,
            };
            const sendRes = await channel.adapter.sendText(jid, msg, sendCtx);
            if (sendRes.ok) await registerSend(supabase, channel.instanceName);
          }
        }
        continue;
      }

      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: `HTTP ${res.status}: ${txt.slice(0, 200)}`,
        portal_retry_count: retries + 1,
      }).eq("id", r.id);
    } catch (e: any) {
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: `worker_transient: ${(e?.message || String(e)).slice(0, 200)}`,
      }).eq("id", r.id);
    }
  }
  return { scanned: rows?.length ?? 0, sent, expired };
}

async function bucketC(supabase: any) {
  // CRÍTICO: só envia link facial DEPOIS do OTP validado.
  // Antes, link_facial era gravado no create e o watchdog mandava cedo demais.
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: rows } = await supabase
    .from("customers")
    .select("id, portal2_idcliente, consultant_id, phone_whatsapp, name, link_facial, link_facial_sent_at, updated_at, portal2_otp_validated_at, do_not_contact")
    .not("portal2_idcliente", "is", null)
    .not("portal2_otp_validated_at", "is", null)
    .eq("do_not_contact", false)
    .or("link_facial.is.null,link_facial_sent_at.is.null")
    .lt("updated_at", cutoff)
    .limit(BATCH_LIMIT);

  const env = {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL"),
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY"),
    whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
    superadminConsultantId: await loadSuperadminConsultantId(supabase),
  };

  let recovered = 0;
  let sent = 0;
  let offline = 0;

  for (const r of rows ?? []) {
    let link: string | null = r.link_facial || null;

    // 1) Sem link? Puxa do worker
    if (!link) {
      const { idconsultor, idcliente } = await resolveIds(supabase, r.id);
      if (!idconsultor || !idcliente) continue;
      const resolved = await resolveWorker(supabase, r.id).catch(() => null);
      if (!resolved) continue;
      try {
        const url = `${resolved.url}/lead/${idcliente}/status?idconsultor=${idconsultor}`;
        const res = await fetch(url, {
          headers: { "Authorization": `Bearer ${resolved.secret}` },
          signal: AbortSignal.timeout(20_000),
        });
        const json: any = await res.json().catch(() => ({}));
        const ctr = json?.contract || {};
        link = ctr.linkassinatura || ctr.link_assinatura || ctr.linkAssinatura || null;
        if (link) {
          await supabase.from("customers").update({
            link_facial: link,
            link_assinatura: link,
            portal2_contract_link: link,
            status: "awaiting_signature",
            conversation_step: "aguardando_facial",
          }).eq("id", r.id);
          recovered++;
        }
      } catch (e: any) {
        console.warn(`[watchdog C] recovery customer=${r.id}: ${e?.message || e}`);
      }
    }

    // 2) Tem link mas ainda não enviado → manda pelo canal de origem
    if (link && !r.link_facial_sent_at && r.phone_whatsapp) {
      const channel = await resolveChannelForCustomer(supabase, r.id, env);

      if (isUnavailable(channel)) {
        offline++;
        await supabase.from("customers").update({
          last_portal_dispatch_at: new Date().toISOString(),
          last_portal_dispatch_error: `instance_offline:${channel.instanceName}:${channel.reason}`,
        }).eq("id", r.id);
        await alertConsultantInstanceOffline(
          supabase, r.id, r.consultant_id, channel,
          r.name || r.phone_whatsapp,
        );
        continue;
      }

      try {
        const quota = await checkSendQuota(supabase, channel.instanceName);
        // whapi superadmin não tem linha em whatsapp_instances (é global),
        // então instance_not_found aqui é esperado e não bloqueia envio.
        const isWhapiSuperadmin = channel.kind === "whapi";
        const bypassQuota = !quota.allowed &&
          isWhapiSuperadmin &&
          (quota.reason === "instance_not_found" || quota.reason === "empty_response");
        if (!quota.allowed && !bypassQuota) {
          console.warn(`[watchdog C] quota bloqueada ${channel.instanceName}: ${quota.reason}`);
          continue;
        }
        const gate = await assertBotOutboundAllowed(supabase, {
          customerId: r.id,
          phone: r.phone_whatsapp,
          consultantId: r.consultant_id,
        });
        if (!gate.allowed) continue;
        const digits = String(r.phone_whatsapp).replace(/\D/g, "");
        if (!digits) continue;
        const jid = `${digits}@s.whatsapp.net`;
        const firstName = String(r.name || "").trim().split(/\s+/)[0] || "Cliente";
        // Alinhado ao passo 10 Grupo A (a11_facial_link) — só após código.
        const text =
          `Código confirmado, ${firstName}! ✅\n\n` +
          `Último passo: abra o *link* 👇\n\n` +
          `${link}\n\n` +
          `Clique em *Assinar documentos* — o sistema vai pedir a *validação facial* para comprovar que é você.`;
        const sendCtx = {
          customerId: r.id,
          consultantId: r.consultant_id,
          stepId: "watchdog_facial_link",
          // Chave estável por lead+link (sem bucket horário → sem spam a cada hora).
          idempotencyKey: `facial:${r.id}:${String(link).slice(-48)}`,
          supabase,
        };
        const result = await channel.adapter.sendText(jid, text, sendCtx);
        if (result.ok) {
          await registerSend(supabase, channel.instanceName);
          await supabase.from("customers").update({
            link_facial_sent_at: new Date().toISOString(),
          }).eq("id", r.id);
          await supabase.from("conversations").insert({
            customer_id: r.id,
            message_direction: "outbound",
            message_text: text,
            message_type: "text",
            conversation_step: "aguardando_facial",
          });
          sent++;
        } else {
          console.warn(`[watchdog C] send falhou customer=${r.id}`);
          // Não marca link_facial_sent_at: permite retry com a MESMA chave
          // (dedupe do adapter). Só registra erro operacional.
          await supabase.from("customers").update({
            last_portal_dispatch_error: "facial_link_send_failed",
            last_portal_dispatch_at: new Date().toISOString(),
          }).eq("id", r.id);
        }
      } catch (e: any) {
        console.warn(`[watchdog C] send erro customer=${r.id}: ${e?.message || e}`);
        try {
          await supabase.from("customers").update({
            last_portal_dispatch_error: `facial_link_exception:${String(e?.message || e).slice(0, 120)}`,
            last_portal_dispatch_at: new Date().toISOString(),
          }).eq("id", r.id);
        } catch { /* best-effort */ }
      }
    }
  }
  return { scanned: rows?.length ?? 0, recovered, sent, offline };
}

/**
 * Bucket D — sync iGreen → nosso banco.
 * Se o contrato na iGreen já está completed (ou OTP used + linkassinatura),
 * fecha o ciclo sem depender do cliente digitar "PRONTO".
 * Cobre leads que concluíram no portal / link e ficaram presos no nosso step.
 */
async function bucketD(supabase: any) {
  const { data: rows } = await supabase
    .from("customers")
    .select("id, name, portal2_idcliente, status, conversation_step, facial_confirmed_at, portal2_otp_validated_at, link_facial")
    .not("portal2_idcliente", "is", null)
    .is("facial_confirmed_at", null)
    .not("status", "in", "(cadastro_concluido,registered_igreen,complete,active,approved)")
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  let synced = 0;
  let checked = 0;

  for (const r of rows ?? []) {
    const { idconsultor, idcliente } = await resolveIds(supabase, r.id);
    if (!idconsultor || !idcliente) continue;
    const resolved = await resolveWorker(supabase, r.id).catch(() => null);
    if (!resolved) continue;
    checked++;
    try {
      const url = `${resolved.url}/lead/${idcliente}/status?idconsultor=${idconsultor}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${resolved.secret}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json: any = await res.json().catch(() => ({}));
      const otpStatus = String(json?.otp_status?.status || "").toLowerCase();
      const contractStatus = String(json?.contract?.status || "").toLowerCase();
      const link =
        json?.contract?.linkassinatura ||
        json?.contract?.link_assinatura ||
        json?.contract?.linkAssinatura ||
        r.link_facial ||
        null;

      const otpDone = otpStatus === "used" || otpStatus === "completed" || otpStatus === "validated";
      const contractDone = contractStatus === "completed" || contractStatus === "signed";

      if (!otpDone && !contractDone) continue;

      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (otpDone && !r.portal2_otp_validated_at) {
        patch.portal2_otp_validated_at = new Date().toISOString();
        patch.otp_validated_at = new Date().toISOString();
        patch.portal2_status = "otp_validated";
      }
      if (link) {
        patch.link_facial = link;
        patch.link_assinatura = link;
        patch.portal2_contract_link = link;
      }

      if (contractDone) {
        patch.facial_confirmed_at = new Date().toISOString();
        patch.status = "cadastro_concluido";
        patch.conversation_step = "cadastro_em_analise";
        patch.portal2_status = "contract_completed";
      } else if (otpDone) {
        // OTP ok, contrato ainda não — garante step de facial + link
        patch.status = "awaiting_signature";
        patch.conversation_step = "aguardando_facial";
      }

      await supabase.from("customers").update(patch).eq("id", r.id);
      synced++;
      console.log(
        `[watchdog D] sync customer=${r.id} otp=${otpStatus} contract=${contractStatus} → ${JSON.stringify(Object.keys(patch))}`,
      );
    } catch (e: any) {
      console.warn(`[watchdog D] customer=${r.id}: ${e?.message || e}`);
    }
  }
  return { scanned: rows?.length ?? 0, checked, synced };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const cronAuth = await assertCronAuth(req, supabase);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

  const started = Date.now();
  try {
    const [a, b, c, d] = await Promise.all([
      bucketA(supabase),
      bucketB(supabase),
      bucketC(supabase),
      bucketD(supabase),
    ]);
    const out = { ok: true, ms: Date.now() - started, a, b, c, d };
    console.log(`📊 watchdog ${JSON.stringify(out)}`);
    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("❌ watchdog erro:", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

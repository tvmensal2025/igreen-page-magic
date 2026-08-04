// Worker server-side de Disparo PRO
// Roda via pg_cron a cada 5 min. Processa campanhas agendadas e/ou em andamento
// que não estão sendo tocadas pelo cliente.
//
// Canal: Whapi ou Evolution via resolveConsultantOutboundChannel (mesmo da agenda).
// Estratégia: cada execução pega até MAX_CAMPAIGNS_PER_TICK campanhas elegíveis,
// dispara até MAX_MSGS_PER_TICK por campanha respeitando intervalos, e sai.
// O próximo tick retoma de onde parou (sempre lendo targets status='queued').

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkSendQuota, registerSend, typingDurationMs } from "../_shared/anti-ban.ts";
import { canSendProactive, logProactiveBlock } from "../_shared/proactive-send-guard.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import {
  isUnavailable,
  resolveConsultantOutboundChannel,
} from "../_shared/channel-sender.ts";
import { ctx } from "../_shared/channel-sender.ts";
import {
  finishOutboundEffect,
  markEffectSending,
  reserveOutboundEffect,
} from "../_shared/journey-effects.ts";

const cronCorsHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    `${corsHeaders["Access-Control-Allow-Headers"] || "authorization, x-client-info, apikey, content-type"}, x-service-secret, x-internal-secret`,
};

const MAX_CAMPAIGNS_PER_TICK = 5;
const MAX_MSGS_PER_TICK = 25; // por campanha por execução
const MAX_EXEC_MS = 50_000;   // sair antes do timeout

interface CampaignRow {
  id: string;
  consultant_id: string;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  media_filename: string | null;
  config: {
    sendSms?: boolean;
    smsText?: string;
    makeCall?: boolean;
    callAudioClipId?: string;
    mediaItems?: Array<{ url: string; kind: string; fileName?: string }>;
    [key: string]: any;
  } | null;
  status: string;
  total: number;
  sent: number;
  failed: number;
}

interface TargetRow {
  id: string;
  phone: string;
  name: string | null;
  vars: any;
}

function renderText(tpl: string, vars: { name?: string; bill?: number | null; city?: string | null }) {
  if (!tpl) return "";
  let out = tpl;
  const first = (vars.name || "").trim().split(/\s+/)[0] || "";
  const billStr = vars.bill != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(vars.bill))
    : "";
  const replacements: Record<string, string> = {
    nome: vars.name || "",
    primeiro_nome: first,
    valor_conta: billStr,
    cidade: vars.city || "",
  };
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`\\{\\s*${k}\\s*\\}`, "gi"), v);
  }
  // Spintax {a|b|c}
  out = out.replace(/\{([^{}]+)\}/g, (m, group) => {
    if (!group.includes("|")) return m;
    const opts = group.split("|");
    return opts[Math.floor(Math.random() * opts.length)];
  });
  return out;
}

function inWindow(cfg: any, at: Date = new Date()): boolean {
  if (!cfg) return true;
  // Horário oficial de Brasília via Intl (não assume offset fixo).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(at).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  if (cfg.weekdaysOnly && (parts.weekday === "Sat" || parts.weekday === "Sun")) return false;
  const start = cfg.windowStart || "00:00";
  const end = cfg.windowEnd || "23:59";
  const [sH, sM] = String(start).split(":").map(Number);
  const [eH, eM] = String(end).split(":").map(Number);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;
  const cur = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  if (endMin < startMin) return cur >= startMin || cur <= endMin;
  return cur >= startMin && cur <= endMin;
}

function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceKey);
  const cronAuth = await assertCronAuth(req, supabase);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, cronCorsHeaders);

  if (!(await isAutomationEnabled(supabase, "bulk_campaigns_runner"))) {
    await logSkipped(supabase, "bulk_campaigns_runner");
    return new Response(JSON.stringify({ skipped: "automation_disabled", key: "bulk_campaigns_runner" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const channelEnv = await loadChannelEnv(supabase);
  if (!channelEnv.whapiToken && !(channelEnv.evolutionUrl && channelEnv.evolutionKey)) {
    return new Response(
      JSON.stringify({
        error: "Nenhum canal WhatsApp configurado (Whapi ou Evolution)",
        pending: "configure_whatsapp_channel",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const report: any[] = [];

  // 0) Destrava alvos presos em 'sending' (worker anterior morreu no meio).
  const { data: reconciled, error: reconcileError } = await supabase
    .rpc("reconcile_stuck_bulk_targets");
  if (reconcileError) console.warn("[bulk] reconcile falhou:", reconcileError.message);
  else if (reconciled) console.log(`[bulk] ${reconciled} alvo(s) destravado(s) de sending`);

  // 1) Promove campanhas agendadas cujo horário já chegou
  const nowIso = new Date().toISOString();
  await supabase
    .from("bulk_campaigns")
    .update({ status: "running", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  // 2) Busca campanhas em andamento (incluindo as recém-promovidas)
  const { data: camps, error: e1 } = await supabase
    .from("bulk_campaigns")
    .select("id,consultant_id,message_text,media_url,media_type,media_filename,config,status,total,sent,failed")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(MAX_CAMPAIGNS_PER_TICK);

  if (e1) {
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const camp of (camps as CampaignRow[]) || []) {
    if (Date.now() - startedAt > MAX_EXEC_MS) break;
    const cfg = camp.config || {};

    // Janela horária
    if (!inWindow(cfg)) {
      report.push({ id: camp.id, skipped: "outside_window" });
      continue;
    }

    // Canal do consultor (Whapi preferencial se hint/superadmin; senão Evolution saudável)
    const channel = await resolveConsultantOutboundChannel(
      supabase,
      camp.consultant_id,
      channelEnv,
      null,
    );
    if (isUnavailable(channel)) {
      report.push({
        id: camp.id,
        skipped: "no_channel",
        reason: channel.reason,
        detail: channel.detail,
      });
      continue;
    }
    const instance = channel.instanceName;

    // Guard Evolution: phone do consultor vs connected_phone.
    // Whapi não tem linha em whatsapp_instances — não aplica.
    if (channel.kind === "evolution") {
      const guard = await canSendProactive(supabase, {
        consultantId: camp.consultant_id,
        instanceName: instance,
      });
      if (!guard.allowed) {
        await logProactiveBlock(supabase, {
          consultantId: camp.consultant_id,
          instanceName: instance,
          reason: guard.reason,
          context: { source: "bulk-scheduler", campaign_id: camp.id, detail: guard.detail },
        });
        await supabase.from("bulk_campaigns").update({ status: "paused" }).eq("id", camp.id);
        report.push({ id: camp.id, paused: "phone_guard", reason: guard.reason, detail: guard.detail });
        continue;
      }
    }

    // Pega próximos targets
    const { data: targets } = await supabase
      .from("bulk_campaign_targets")
      .select("id,phone,name,vars")
      .eq("campaign_id", camp.id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_MSGS_PER_TICK);

    const list = (targets as TargetRow[]) || [];
    if (list.length === 0) {
      // Acabou? Marca done.
      const { data: stats } = await supabase
        .from("bulk_campaign_targets")
        .select("status")
        .eq("campaign_id", camp.id);
      const sent = (stats || []).filter((s: any) => s.status === "sent").length;
      const failed = (stats || []).filter((s: any) => s.status === "failed").length;
      await supabase.from("bulk_campaigns").update({
        status: "done", sent, failed, finished_at: new Date().toISOString(),
      }).eq("id", camp.id);
      report.push({ id: camp.id, finalized: true, sent, failed });
      continue;
    }

    // Opt-out: não enviar para phones com do_not_contact neste consultor
    const phoneDigits = list.map((t) => t.phone.replace(/\D/g, "")).filter(Boolean);
    const suppressedPhones = new Set<string>();
    if (phoneDigits.length) {
      const { data: dncCust } = await supabase
        .from("customers")
        .select("phone_whatsapp")
        .eq("consultant_id", camp.consultant_id)
        .eq("do_not_contact", true)
        .in("phone_whatsapp", list.map((t) => t.phone));
      for (const row of dncCust || []) {
        const d = String((row as { phone_whatsapp?: string }).phone_whatsapp || "").replace(/\D/g, "");
        if (d) suppressedPhones.add(d);
      }
      const { data: dncAll } = await supabase
        .from("customers")
        .select("phone_whatsapp")
        .eq("consultant_id", camp.consultant_id)
        .eq("do_not_contact", true)
        .limit(5000);
      const dncSet = new Set(
        (dncAll || []).map((r: { phone_whatsapp?: string }) =>
          String(r.phone_whatsapp || "").replace(/\D/g, ""),
        ).filter(Boolean),
      );
      for (const d of phoneDigits) {
        if ([...dncSet].some((b) => b === d || d.endsWith(b) || b.endsWith(d))) {
          suppressedPhones.add(d);
        }
      }
    }

    const mediaOrder = String(cfg.mediaOrder || "media_first");

    let processed = 0;
    let consecutiveFailures = 0;
    let quotaBlocked = false;
    for (const t of list) {
      if (Date.now() - startedAt > MAX_EXEC_MS) break;

      const tDigits = t.phone.replace(/\D/g, "");
      if (suppressedPhones.has(tDigits) || [...suppressedPhones].some((b) => tDigits.endsWith(b) || b.endsWith(tDigits))) {
        await supabase.from("bulk_campaign_targets").update({
          status: "failed",
          error: "do_not_contact",
          sent_at: new Date().toISOString(),
        }).eq("id", t.id).eq("status", "queued");
        continue;
      }

      const gate = await assertBotOutboundAllowed(supabase, {
        phone: t.phone,
        consultantId: camp.consultant_id,
      });
      if (!gate.allowed) {
        await supabase.from("bulk_campaign_targets").update({
          status: "failed",
          error: gate.reason || "suppressed",
          sent_at: new Date().toISOString(),
        }).eq("id", t.id).eq("status", "queued");
        continue;
      }

      // Anti-ban: Whapi sem linha em whatsapp_instances → instance_not_found é esperado
      const quota = await checkSendQuota(supabase, instance);
      const bypassQuota = channel.kind === "whapi" &&
        (!quota.allowed &&
          (quota.reason === "instance_not_found" ||
            quota.reason === "empty_response" ||
            quota.reason === "rpc_error"));
      if (!quota.allowed && !bypassQuota) {
        report.push({
          id: camp.id, paused: "anti_ban_guard",
          reason: quota.reason, warmup_day: quota.warmup_day,
          cap: quota.cap, sent: quota.sent,
        });
        quotaBlocked = true;
        break;
      }

      // Claim atômico: só prossegue se ESTE worker mudou queued→sending.
      const { data: claimed, error: claimError } = await supabase
        .from("bulk_campaign_targets")
        .update({ status: "sending", claimed_at: new Date().toISOString() })
        .eq("id", t.id)
        .eq("status", "queued")
        .select("id");
      if (claimError || !claimed || claimed.length === 0) {
        continue;
      }
      const finalMsg = renderText(camp.message_text || "", {
        name: t.name || undefined,
        bill: t.vars?.bill ?? null,
        city: t.vars?.city ?? null,
      });

      const jid = toJid(t.phone);

      // F12/F16: O áudio da Sofia (ou customizado no wizard) deve ser respeitado se configurado.
      // O usuário solicitou que entrem em handoff por padrão.
      const action = cfg.afterSendAction || "handoff";

      const { data: lead } = await supabase.from("customers")
        .select("id")
        .eq("phone_whatsapp", tDigits)
        .eq("consultant_id", camp.consultant_id)
        .maybeSingle();

      if (lead?.id) {
        if (action === "grupo_a") {
          // Joga no Grupo A (IA ativa)
          await supabase.from("customers")
            .update({
              bot_paused: false,
              bot_paused_reason: null as any,
              flow_variant: "A",
              conversation_step: "a1_ask_name",
              last_outbound_at: new Date().toISOString(),
            })
            .eq("id", lead.id);
        } else {
          // Padrão: Handoff (Pausa bot, humano responde)
          await supabase.from("customers")
            .update({
              bot_paused: true,
              bot_paused_reason: "bulk_pro" as any,
              bot_paused_at: new Date().toISOString(),
              assigned_human_id: camp.consultant_id,
            })
            .eq("id", lead.id);
        }
      }

      // Efeito por target: reconcile sending→queued não reenvia se já sent/unknown.
      const bulkKey = `bulk:${t.id}`;
      const eff = await reserveOutboundEffect(supabase, {
        idempotencyKey: bulkKey,
        engineKey: "bulk_scheduler",
        channel: "whatsapp",
        consultantId: camp.consultant_id,
        actionKey: `campaign:${camp.id}`,
      });
      if (!eff.canSend) {
        if (eff.status === "sent" || eff.status === "delivered") {
          await supabase.from("bulk_campaign_targets").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
          }).eq("id", t.id).eq("status", "sending");
        } else if (eff.status === "unknown" || eff.status === "failed_final") {
          await supabase.from("bulk_campaign_targets").update({
            status: "failed",
            error: `effect_${eff.status}`.slice(0, 500),
          }).eq("id", t.id).eq("status", "sending");
        } else {
          // reserved/sending paralelo — devolve à fila no próximo reconcile
          await supabase.from("bulk_campaign_targets").update({
            status: "queued",
            claimed_at: null,
          }).eq("id", t.id).eq("status", "sending");
        }
        continue;
      }

      const sendCtx = {
        ...ctx(
          camp.consultant_id,
          camp.consultant_id,
          `bulk-scheduler:${camp.id}`,
          t.id,
        ),
        idempotencyKey: bulkKey,
        supabase,
      };

      // Humaniza: presence "digitando" (Whapi) ou delay proporcional
      if (finalMsg) {
        const waitMs = typingDurationMs(finalMsg);
        if (channel.adapter.capabilities.supportsTypingPresence) {
          await channel.adapter.sendPresence(jid, "composing", waitMs).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 2500)));
      }

      let ok = false;
      let errText: string | undefined;
      let sendThrew = false;
      try {
        await markEffectSending(supabase, eff.effectId);
        
        // Suporte a múltiplas mídias
        const mediaItems = cfg.mediaItems || [];
        // Compatibilidade com campanhas antigas se não houver mediaItems
        if (mediaItems.length === 0 && camp.media_url && camp.media_type && camp.media_type !== "text") {
          mediaItems.push({ 
            url: camp.media_url, 
            kind: camp.media_type, 
            fileName: camp.media_filename || undefined 
          });
        }

        const hasMedia = mediaItems.length > 0;
        
        if (hasMedia) {
          // Se configurado para texto primeiro
          if (mediaOrder === "text_first" && finalMsg) {
            const tr = await channel.adapter.sendText(jid, finalMsg, sendCtx as any);
            ok = tr.ok;
            if (!tr.ok) errText = (tr as { detail?: string }).detail || (tr as { reason?: string }).reason;
            await new Promise(r => setTimeout(r, 1000));
          }

          // Envia todos os anexos
          for (let mIdx = 0; mIdx < mediaItems.length; mIdx++) {
            const m = mediaItems[mIdx];
            const mediaKind = m.kind as "image" | "video" | "audio" | "document";
            
            // Legenda apenas na primeira mídia e se não foi enviado como texto separado
            const useCaption = mIdx === 0 && mediaOrder !== "text_first" && mediaKind !== "audio";
            
            const mr = await channel.adapter.sendMedia(
              jid,
              {
                kind: mediaKind,
                url: m.url,
                caption: useCaption ? (finalMsg || undefined) : undefined,
                fileName: m.fileName || undefined,
              } as any,
              { ...sendCtx, idempotencyKey: `${bulkKey}:media:${mIdx}` } as any,
            );
            
            ok = mr.ok;
            if (!mr.ok) {
              errText = (mr as { detail?: string }).detail || (mr as { reason?: string }).reason;
            }

            // Pequeno delay entre anexos do mesmo destino
            if (mIdx < mediaItems.length - 1) {
              await new Promise(r => setTimeout(r, 1200));
            }
          }

          // Se for áudio ou media_first sem caption e não enviou texto ainda
          if (ok && finalMsg && mediaOrder === "media_first" && (mediaItems[0].kind === "audio" || !["image", "video"].includes(mediaItems[0].kind))) {
             await new Promise(r => setTimeout(r, 1000));
             const tr = await channel.adapter.sendText(jid, finalMsg, { ...sendCtx, idempotencyKey: `${bulkKey}:text_after` } as any);
             ok = tr.ok;
             if (!tr.ok) errText = (tr as { detail?: string }).detail || (tr as { reason?: string }).reason;
          }
        } else {
          // Apenas texto
          if (finalMsg) {
            const tr = await channel.adapter.sendText(jid, finalMsg, sendCtx as any);
            ok = tr.ok;
            if (!tr.ok) errText = (tr as { detail?: string }).detail || (tr as { reason?: string }).reason;
          }
        }

        if (ok) {
          await registerSend(supabase, instance);
          await finishOutboundEffect(supabase, eff.effectId, "sent");
          
          // Orquestração Multicanal (SMS/Voz)
          if (cfg.sendSms && cfg.smsText) {
            const smsFinal = renderText(cfg.smsText, {
              name: t.name || undefined,
              bill: t.vars?.bill ?? null,
              city: t.vars?.city ?? null,
            });
            // Invoke server-side (sem await para não travar o loop principal)
            supabase.functions.invoke("send-velip-sms", {
              body: { to: t.phone, text: smsFinal, consultantId: camp.consultant_id }
            }).catch(e => console.error("[bulk-scheduler] SMS fail:", e));
          }

          if (cfg.makeCall || cfg.callAudioClipId) {
            // Se makeCall for true mas sem clipId, tenta usar o 'sofia-a2' padrão
            const clipId = cfg.callAudioClipId || "sofia-a2";
            supabase.functions.invoke("voice-dialer-webhook", {
              body: { 
                to: t.phone, 
                audioClipId: clipId, 
                consultantId: camp.consultant_id, 
                source: `bulk-scheduler:${camp.id}` 
              }
            }).catch(e => console.error("[bulk-scheduler] Call fail:", e));
          }

        } else {
          await finishOutboundEffect(supabase, eff.effectId, "failed_final", errText);
        }
      } catch (e: any) {
        sendThrew = true;
        errText = e?.message || "Internal Error";
        await finishOutboundEffect(supabase, eff.effectId, "failed_final", errText);
      }

      await supabase.from("bulk_campaign_targets").update({
        status: ok ? "sent" : "failed",
        sent_at: new Date().toISOString(),
        error: errText ? errText.slice(0, 500) : null,
      }).eq("id", t.id).eq("status", "sending");

      if (ok) {
        processed++;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }

      // Circuit breaker: se 5 falhas seguidas, pausa a campanha
      if (consecutiveFailures >= 5) {
        await supabase.from("bulk_campaign_campaigns").update({ status: "paused" }).eq("id", camp.id);
        break;
      }

      // Delay entre contatos (respeita config)
      const minS = Math.max(1, cfg.intervalMinS || 10);
      const maxS = Math.max(minS, cfg.intervalMaxS || 20);
      const delayMs = (minS + Math.random() * (maxS - minS)) * 1000;
      await new Promise(r => setTimeout(r, delayMs));
    }

    report.push({ id: camp.id, processed, quotaBlocked });
  }

  return new Response(JSON.stringify({ ok: true, report }), {
    headers: { ...cronCorsHeaders, "Content-Type": "application/json" },
  });
});

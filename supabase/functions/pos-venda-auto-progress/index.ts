// Engine de autoprogressão Pós-Venda iGreen.
// - Move clientes entre pv_aprovado / pv_d30…pv_d210.
// - Reprovado/devolutiva/retentativa ficam mudos por decisão do produto.
// - Dispara mídia via resolveChannelForCustomerWithFailover (Whapi primeiro; Evolution fallback).
// - NÃO usa bot_global_enabled — só toggle pos_venda_auto_messages + pos_venda_manual.
// - Janela seg–sáb 08:00–20:00 BRT (pos-venda-send-window); fora = skip até próximo slot.
// - Idempotente via customer_auto_message_log (UNIQUE customer_id+stage_key).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  isPosVendaSendWindow,
  logPosVendaWindowSkip,
  nextPosVendaSendSlot,
} from "../_shared/pos-venda-send-window.ts";
import { isConsultantAIDisabled, isPausedByPhone } from "../_shared/bot/paused.ts";
import {
  resolveChannelForCustomerWithFailover,
  isUnavailable,
  sendStageAutoMessages,
  formatSendStatus,
  isValidJid,
  toJid,
  ctx,
  type ChannelEnv,
  type SendResult,
} from "../_shared/channel-sender.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import {
  getConsultantAutomationPrefs,
  isConsultantAutoAllowed,
} from "../_shared/consultant-automation-prefs.ts";
import {
  PV_RETENTATIVA_BUTTON_ID,
  PV_RETENTATIVA_BUTTON_TITLE,
  PV_RETENTATIVA_CHOICE_PROMPT,
  PV_RETENTATIVA_DAYS,
} from "../_shared/pos-venda-retentativa.ts";
import { applyOutboundTemplateVars } from "../_shared/outbound-template-vars.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROGRESSION = [
  { days: 30,  stage_key: "pv_d30" },
  { days: 60,  stage_key: "pv_d60" },
  { days: 90,  stage_key: "pv_d90" },
  { days: 120, stage_key: "pv_d120" },
  { days: 150, stage_key: "pv_d150" },
  { days: 180, stage_key: "pv_d180" },
  { days: 210, stage_key: "pv_d210" },
];

function findBucket(daysSince: number): string | null {
  for (let i = PROGRESSION.length - 1; i >= 0; i--) {
    if (daysSince >= PROGRESSION[i].days) return PROGRESSION[i].stage_key;
  }
  return null;
}

// Mapeia o pos_venda_stage do customer para a stage_key do kanban_stages pós-venda.
const STAGE_TO_KEY: Record<string, string> = {
  espera:    "pv_espera",
  aprovado:  "pv_aprovado",
  reprovado: "pv_reprovado",
  retentativa: "pv_retentativa",
  d30:       "pv_d30",
  d60:       "pv_d60",
  d90:       "pv_d90",
  d120:      "pv_d120",
  d150:      "pv_d150",
  d180:      "pv_d180",
  d210:      "pv_d210",
};

async function processCustomer(
  supabase: any,
  env: ChannelEnv,
  customer: any,
  targetStage: string, // ex: 'aprovado' | 'reprovado' | 'd30'..
  defaults: Record<string, any>, // config-padrão global por estágio (fallback)
): Promise<{ moved: boolean; sent: boolean }> {
  const stageKey = STAGE_TO_KEY[targetStage];
  if (!stageKey) return { moved: false, sent: false };

  // Fail-closed: reprovado/devolutiva/retentativa NÃO podem disparar mensagem
  // nem aparecer como ação automática de pós-venda.
  if (targetStage === "reprovado" || targetStage === "retentativa") {
    return { moved: false, sent: false };
  }

  const prefs = await getConsultantAutomationPrefs(supabase, customer.consultant_id);
  if (!isConsultantAutoAllowed(prefs, "pos_venda")) {
    await logSkipped(supabase, "pos_venda_auto_messages", {
      reason: "consultant_pref_off",
      pack: "pos_venda",
      consultant_id: customer.consultant_id,
      customer_id: customer.id,
      stage: targetStage,
    });
    return { moved: false, sent: false };
  }

  // Mover o customer para o bucket alvo (apenas se mudou)
  if (customer.pos_venda_stage !== targetStage) {
    const movePatch: Record<string, unknown> = { pos_venda_stage: targetStage };
    // Relógio da retentativa: carimba na entrada em reprovado.
    if (targetStage === "reprovado" && !customer.pos_venda_rejected_at) {
      movePatch.pos_venda_rejected_at = new Date().toISOString();
    }
    const { error: upErr } = await supabase
      .from("customers")
      .update(movePatch)
      .eq("id", customer.id);
    if (upErr) {
      console.error("[pos-venda] erro mover customer", customer.id, upErr.message);
      return { moved: false, sent: false };
    }
  } else if (targetStage === "reprovado" && !customer.pos_venda_rejected_at) {
    await supabase
      .from("customers")
      .update({ pos_venda_rejected_at: new Date().toISOString() })
      .eq("id", customer.id);
  }

  // Checar se já enviou para este estágio (idempotência)
  const { data: existingLog } = await supabase
    .from("customer_auto_message_log")
    .select("id, status, created_at")
    .eq("customer_id", customer.id)
    .eq("stage_key", stageKey)
    .maybeSingle();
  let staleClaimId: string | null = null;
  if (existingLog) {
    // Claim órfão (worker morreu antes de finalizar): retoma após 60min via
    // CAS — somente um worker vence o UPDATE condicionado ao status.
    const isStaleClaim = existingLog.status === "claimed" &&
      existingLog.created_at &&
      Date.now() - new Date(existingLog.created_at).getTime() > 60 * 60_000;
    if (!isStaleClaim) return { moved: true, sent: false };
    const { data: retaken } = await supabase
      .from("customer_auto_message_log")
      .update({ status: "claimed_retry" })
      .eq("id", existingLog.id)
      .eq("status", "claimed")
      .select("id")
      .maybeSingle();
    if (!retaken?.id) return { moved: true, sent: false };
    staleClaimId = String(retaken.id);
  }

  // Buscar config do stage do consultor dono
  const ownerId = customer.consultant_id;
  const { data: stageData } = await supabase
    .from("kanban_stages")
    .select("*")
    .eq("consultant_id", ownerId)
    .eq("stage_key", stageKey)
    .eq("stage_scope", "pos_venda")
    .maybeSingle();

  if (stageData?.auto_message_enabled === false) {
    return { moved: true, sent: false };
  }

  // Conteúdo configurado pelo próprio consultor? (multi-msg OU legacy no kanban)
  let msgCount = 0;
  if (stageData) {
    const { count } = await supabase
      .from("stage_auto_messages")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageData.id);
    msgCount = count || 0;
  }
  const hasLegacy = !!(stageData && (stageData.auto_message_text || stageData.auto_message_media_url || stageData.auto_message_image_url));
  const consultantHasContent = msgCount > 0 || hasLegacy;

  // Fallback global: se o consultor não configurou nada para este estágio,
  // usa a config-padrão institucional (pos_venda_default_media).
  const def = defaults[targetStage];
  const useDefault = !consultantHasContent && def && def.is_active !== false;

  if (!consultantHasContent && !useDefault) return { moved: true, sent: false };

  // Validações de envio
  const phoneRaw = (customer as any).whatsapp_chat_id || customer.phone_whatsapp || "";
  if (!isValidJid(`${phoneRaw}@s.whatsapp.net`)) return { moved: true, sent: false };
  const phone = phoneRaw.replace(/\D/g, "");

  if (await isConsultantAIDisabled(supabase, ownerId)) return { moved: true, sent: false };
  if (await isPausedByPhone(supabase, phone, ownerId)) return { moved: true, sent: false };

  const channel = await resolveChannelForCustomerWithFailover(supabase, customer.id, env);
  if (isUnavailable(channel)) {
    // upsert ignoreDuplicates: corrida com outro cron não explode no UNIQUE.
    await supabase.from("customer_auto_message_log").upsert({
      customer_id: customer.id,
      consultant_id: ownerId,
      stage_key: stageKey,
      remote_jid: `${phone}@s.whatsapp.net`,
      customer_name: customer.name,
      message_preview: null,
      status: `no_channel:${channel.reason}`,
    }, { onConflict: "customer_id,stage_key", ignoreDuplicates: true });
    console.warn(`[pos-venda] canal indisponível customer=${customer.id} instance=${channel.instanceName} reason=${channel.reason}`);
    return { moved: true, sent: false };
  }

  // CLAIM-FIRST: o UNIQUE (customer_id, stage_key) é a reserva. Insere ANTES
  // de enviar; se não inseriu, outro cron simultâneo já está processando —
  // dois crons de pós-venda nunca duplicam a mensagem do estágio.
  let claimId = staleClaimId;
  if (!claimId) {
    const { data: claimRow, error: claimErr } = await supabase
      .from("customer_auto_message_log")
      .upsert({
        customer_id: customer.id,
        consultant_id: ownerId,
        stage_key: stageKey,
        remote_jid: toJid(phone),
        customer_name: customer.name,
        message_preview: null,
        status: "claimed",
      }, { onConflict: "customer_id,stage_key", ignoreDuplicates: true })
      .select("id");
    if (claimErr) {
      console.error("[pos-venda] claim falhou (fail-closed)", customer.id, claimErr.message);
      return { moved: true, sent: false };
    }
    claimId = Array.isArray(claimRow) && claimRow[0]?.id ? String(claimRow[0].id) : null;
    if (!claimId) {
      // Já claimado/enviado por outra execução.
      return { moved: true, sent: false };
    }
  }

  const jid = toJid(phone);
  const dealOrigin =
    targetStage === "reprovado" || targetStage === "retentativa" ? "reprovado" : "aprovado";

  let result: SendResult;
  if (consultantHasContent) {
    // Caminho normal: usa a config do consultor (multi-msg ou legacy do kanban).
    result = await sendStageAutoMessages(
      supabase,
      channel,
      jid,
      phone,
      stageData,
      ownerId,
      customer.id,
      customer.pos_venda_reason || null,
      dealOrigin,
      customer.name || "",
      (customer as any).name_source ?? null,
    );
  } else {
    // Fallback: config-padrão global. Monta um stageData sintético e reusa o
    // mesmo sender (sem stage_auto_messages → cai no ramo legacy).
    const syntheticStage = {
      id: `default:${targetStage}`,
      stage_key: stageKey,
      auto_message_type: def.message_type || "text",
      auto_message_text: def.message_text || null,
      auto_message_media_url: def.media_url || null,
      auto_message_image_url: def.image_url || null,
    };
    result = await sendStageAutoMessages(
      supabase,
      channel,
      jid,
      phone,
      syntheticStage,
      ownerId,
      customer.id,
      customer.pos_venda_reason || null,
      dealOrigin,
      customer.name || "",
      (customer as any).name_source ?? null,
    );
  }

  // Retentativa: após texto/áudio, manda escolha (Whapi=botão; Evolution=*1.* numerado).
  if (targetStage === "retentativa") {
    const btnBody = applyOutboundTemplateVars(PV_RETENTATIVA_CHOICE_PROMPT, {
      customerName: customer.name || "",
      nameSource: (customer as any).name_source ?? null,
      phone,
    });
    const sendCtxBtn = ctx(ownerId, customer.id, stageKey, "retentativa_button");
    try {
      const btnOk = await channel.adapter.sendChoice(
        jid,
        btnBody,
        {
          preferred: "button",
          options: [{ id: PV_RETENTATIVA_BUTTON_ID, title: PV_RETENTATIVA_BUTTON_TITLE }],
        },
        sendCtxBtn,
      );
      if (btnOk?.ok === false && (btnOk as any).reason !== "downgraded") {
        console.warn("[pos-venda] botão retentativa falhou", customer.id, (btnOk as any).detail);
        // Não derruba o pacote imagem/áudio/texto se o botão falhar; marca text se vazio.
        if (result.text_ok == null) result.text_ok = false;
      } else if (result.text_ok == null) {
        result.text_ok = true;
      }
    } catch (e) {
      console.warn("[pos-venda] botão retentativa erro", customer.id, (e as Error).message);
      if (result.text_ok == null) result.text_ok = false;
    }
  }

  const { status, tag } = formatSendStatus(result);
  const previewText = result.preview
    ? `[${channel.kind}]${tag ? ` ${tag}` : ""} ${result.preview}`.slice(0, 200)
    : `[${channel.kind}]${tag ? ` ${tag}` : ""}`;

  // Finaliza o claim com o resultado real do envio.
  await supabase.from("customer_auto_message_log").update({
    message_preview: previewText,
    status,
  }).eq("id", claimId);

  return { moved: true, sent: status === "sent" || status.startsWith("partial") };

}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Janela pós-venda: seg–sáb 08:00–20:00 BRT. Fora disso (ex.: domingo após
  // 20:00 → segunda 08:00) o cron só volta a enviar no próximo slot — o hub
  // já mostra o agendamento clampado.
  if (!isPosVendaSendWindow()) {
    const next = nextPosVendaSendSlot();
    logPosVendaWindowSkip("pos-venda-auto-progress", { next_slot: next.toISOString() });
    return new Response(JSON.stringify({
      skipped: "outside_send_window",
      next_slot: next.toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // deno-lint-ignore no-explicit-any
    const cronAuth = await assertCronAuth(req, supabase as any);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);
    if (!(await isAutomationEnabled(supabase, "pos_venda_auto_messages"))) {
      await logSkipped(supabase, "pos_venda_auto_messages");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "pos_venda_auto_messages" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

    const env: ChannelEnv = {
      evolutionUrl: Deno.env.get("EVOLUTION_API_URL") || undefined,
      evolutionKey: Deno.env.get("EVOLUTION_API_KEY") || undefined,
      whapiToken: settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "",
    };

    const now = Date.now();
    let moved = 0;
    let sent = 0;

    // Config-padrão global por estágio (fallback quando o consultor não configurou).
    const { data: defaultRows } = await supabase
      .from("pos_venda_default_media")
      .select("stage, message_type, message_text, media_url, image_url, is_active");
    const defaults: Record<string, any> = {};
    for (const d of defaultRows || []) defaults[d.stage] = d;

    // 1. Clientes já marcados como APROVADOS PELO CONSULTOR (pos_venda_manual=true).
    //    Auto-classificação nunca dispara mensagem — ela vai para
    //    pos_venda_pending_stage e o consultor confirma pelo popup
    //    "Validar novos clientes".
    //
    // ANTI-BAN: limita quantos envios acontecem POR EXECUÇÃO e POR DIA.
    //   - BATCH_LIMIT: teto de envios reais numa rodada (o cron roda a cada
    //     hora — o resto fica para a próxima).
    //   - DAILY_CAP: teto global de envios em 24h (protege contra o "aprovei
    //     500 de uma vez" disparar tudo junto).
    //   - JITTER: espera 3–8s entre disparos para o WhatsApp não ver rajada.
    //   - MOVIMENTAÇÕES DE ESTÁGIO (moved) continuam sem limite — são só
    //     UPDATE no banco, não geram mensagem.
    const BATCH_LIMIT = Number(Deno.env.get("POS_VENDA_BATCH_LIMIT") || 40);
    const DAILY_CAP = Number(Deno.env.get("POS_VENDA_DAILY_CAP") || 200);
    const JITTER_MIN_MS = 3000;
    const JITTER_MAX_MS = 8000;

    // Quantos já foram enviados nas últimas 24h (idempotência do log).
    const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { count: sentToday24h } = await supabase
      .from("customer_auto_message_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .like("status", "sent%");
    let sentCounter = sentToday24h || 0;
    let batchCounter = 0;

    const canSendMore = () => batchCounter < BATCH_LIMIT && sentCounter < DAILY_CAP;
    const sleepJitter = () =>
      new Promise((res) =>
        setTimeout(res, JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS)),
      );

    const runOne = async (c: any, target: string) => {
      // Estágio já foi enviado antes → só reconcilia sem consumir cota.
      if (!canSendMore()) {
        // Ainda deixa mover o estágio no banco (não gera mensagem), mas
        // NÃO tenta enviar — evita bater no anti-ban.
        return;
      }
      const before = sent;
      const r = await processCustomer(supabase, env, c, target, defaults);
      if (r.moved) moved++;
      if (r.sent) {
        sent++;
        sentCounter++;
        batchCounter++;
        if (canSendMore()) await sleepJitter();
      } else if (sent === before) {
        // não enviou (idempotência / bloqueio) — sem jitter, sem consumir cota
      }
    };

    const { data: approvedCustomers } = await supabase
      .from("customers")
      .select("id, name, name_source, phone_whatsapp, consultant_id, pos_venda_stage, pos_venda_manual, pos_venda_reason, status, andamento_igreen")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_stage", "aprovado")
      .eq("pos_venda_manual", true);

    for (const c of approvedCustomers || []) {
      await runOne(c, "aprovado");
    }

    // 2. REPROVADOS / RETENTATIVA / DEVOLUTIVA — DESATIVADO por decisão do produto.
    //    O foco do pós-venda automático é APENAS aprovado + progressão D30…D210.
    //    Não enviar nada para reprovado, devolutiva ou retentativa.

    // 3. Progressão aprovados → 30/60/90/120/150/180/210 (somente quem já passou por aprovado)
    //    O marco temporal é a DATA DE APROVAÇÃO (pos_venda_approved_at), não o
    //    envio ao portal. Inclui o próprio bucket atual para reprocessar envio
    //    pendente (idempotente via customer_auto_message_log).
    const { data: approvedTrack } = await supabase
      .from("customers")
      .select("id, name, name_source, phone_whatsapp, consultant_id, pos_venda_stage, pos_venda_manual, pos_venda_reason, pos_venda_approved_at, status, andamento_igreen")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_manual", true)
      .in("pos_venda_stage", ["aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210"])
      .not("pos_venda_approved_at", "is", null);

    for (const c of approvedTrack || []) {
      const ref = c.pos_venda_approved_at ? new Date(c.pos_venda_approved_at).getTime() : now;
      const days = Math.floor((now - ref) / (1000 * 60 * 60 * 24));
      const targetKey = findBucket(days);
      if (!targetKey) continue;
      const target = targetKey.replace("pv_", "");
      await runOne(c, target);
    }


    return new Response(
      JSON.stringify({
        moved,
        sent,
        batch_limit: BATCH_LIMIT,
        daily_cap: DAILY_CAP,
        sent_last_24h: sentCounter,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[pos-venda-auto-progress] erro:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
// Engine de autoprogressão Pós-Venda iGreen.
// - Move clientes entre as colunas pv_aprovado / pv_d30/60/90/120 / pv_reprovado.
// - Dispara mensagens automáticas (texto/áudio/imagem/vídeo) via Evolution
//   (instância do consultor) ou Whapi (fallback compartilhado).
// - Idempotente via customer_auto_message_log (UNIQUE customer_id+stage_key).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isConsultantAIDisabled, isPausedByPhone } from "../_shared/bot/paused.ts";
import {
  resolveChannelForCustomer,
  isUnavailable,
  sendStageAutoMessages,
  formatSendStatus,
  isValidJid,
  toJid,
  type ChannelEnv,
  type SendResult,
} from "../_shared/channel-sender.ts";



const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROGRESSION = [
  { days: 30,  stage_key: "pv_d30" },
  { days: 60,  stage_key: "pv_d60" },
  { days: 90,  stage_key: "pv_d90" },
  { days: 120, stage_key: "pv_d120" },
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
  d30:       "pv_d30",
  d60:       "pv_d60",
  d90:       "pv_d90",
  d120:      "pv_d120",
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

  // Mover o customer para o bucket alvo (apenas se mudou)
  if (customer.pos_venda_stage !== targetStage) {
    const { error: upErr } = await supabase
      .from("customers")
      .update({ pos_venda_stage: targetStage })
      .eq("id", customer.id);
    if (upErr) {
      console.error("[pos-venda] erro mover customer", customer.id, upErr.message);
      return { moved: false, sent: false };
    }
  }

  // Checar se já enviou para este estágio (idempotência)
  const { data: existingLog } = await supabase
    .from("customer_auto_message_log")
    .select("id")
    .eq("customer_id", customer.id)
    .eq("stage_key", stageKey)
    .maybeSingle();
  if (existingLog) return { moved: true, sent: false };

  // Buscar config do stage do consultor dono
  const ownerId = customer.consultant_id;
  const { data: stageData } = await supabase
    .from("kanban_stages")
    .select("*")
    .eq("consultant_id", ownerId)
    .eq("stage_key", stageKey)
    .eq("stage_scope", "pos_venda")
    .maybeSingle();

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
  const phoneRaw = customer.phone_whatsapp || "";
  if (!isValidJid(`${phoneRaw}@s.whatsapp.net`)) return { moved: true, sent: false };
  const phone = phoneRaw.replace(/\D/g, "");

  if (await isConsultantAIDisabled(supabase, ownerId)) return { moved: true, sent: false };
  if (await isPausedByPhone(supabase, phone, ownerId)) return { moved: true, sent: false };

  const channel = await resolveChannelForCustomer(supabase, customer.id, env);
  if (isUnavailable(channel)) {
    await supabase.from("customer_auto_message_log").insert({
      customer_id: customer.id,
      consultant_id: ownerId,
      stage_key: stageKey,
      remote_jid: `${phone}@s.whatsapp.net`,
      customer_name: customer.name,
      message_preview: null,
      status: `no_channel:${channel.reason}`,
    });
    console.warn(`[pos-venda] canal indisponível customer=${customer.id} instance=${channel.instanceName} reason=${channel.reason}`);
    return { moved: true, sent: false };
  }


  const jid = toJid(phone);
  const dealOrigin = targetStage === "reprovado" ? "reprovado" : "aprovado";

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
    );
  }

  const { status, tag } = formatSendStatus(result);
  const previewText = result.preview
    ? `[${channel.kind}]${tag ? ` ${tag}` : ""} ${result.preview}`.slice(0, 200)
    : `[${channel.kind}]${tag ? ` ${tag}` : ""}`;

  await supabase.from("customer_auto_message_log").insert({
    customer_id: customer.id,
    consultant_id: ownerId,
    stage_key: stageKey,
    remote_jid: jid,
    customer_name: customer.name,
    message_preview: previewText,
    status,
  });

  return { moved: true, sent: status === "sent" || status.startsWith("partial") };

}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (isQuietHourBRT()) {
    logQuietSkip("pos-venda-auto-progress");
    return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
    const { data: approvedCustomers } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, consultant_id, pos_venda_stage, pos_venda_manual, pos_venda_reason, status, andamento_igreen")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_stage", "aprovado")
      .eq("pos_venda_manual", true);

    for (const c of approvedCustomers || []) {
      const r = await processCustomer(supabase, env, c, "aprovado", defaults);
      if (r.moved) moved++;
      if (r.sent) sent++;
    }

    // 2. Clientes REPROVADOS PELO CONSULTOR (pos_venda_manual=true).
    const { data: rejectedCustomers } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, consultant_id, pos_venda_stage, pos_venda_manual, pos_venda_reason, status, andamento_igreen")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_stage", "reprovado")
      .eq("pos_venda_manual", true);

    for (const c of rejectedCustomers || []) {
      const r = await processCustomer(supabase, env, c, "reprovado", defaults);
      if (r.moved) moved++;
      if (r.sent) sent++;
    }

    // 3. Progressão aprovados → 30/60/90/120 dias (somente quem já passou por aprovado)
    //    O marco temporal é a DATA DE APROVAÇÃO (pos_venda_approved_at), não o
    //    envio ao portal.
    const { data: approvedTrack } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, consultant_id, pos_venda_stage, pos_venda_manual, pos_venda_reason, pos_venda_approved_at, status, andamento_igreen")
      .eq("customer_origin", "igreen_sync")
      .eq("pos_venda_manual", true)
      .in("pos_venda_stage", ["aprovado", "d30", "d60", "d90"])
      .not("pos_venda_approved_at", "is", null);

    for (const c of approvedTrack || []) {
      const ref = c.pos_venda_approved_at ? new Date(c.pos_venda_approved_at).getTime() : now;
      const days = Math.floor((now - ref) / (1000 * 60 * 60 * 24));
      const targetKey = findBucket(days);
      if (!targetKey) continue;
      const target = targetKey.replace("pv_", ""); // 'd30' etc.
      if (target === c.pos_venda_stage) continue;
      const r = await processCustomer(supabase, env, c, target, defaults);
      if (r.moved) moved++;
      if (r.sent) sent++;
    }

    return new Response(
      JSON.stringify({ moved, sent }),
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

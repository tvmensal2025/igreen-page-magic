import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isConsultantAIDisabled, isPausedByPhone } from "../_shared/bot/paused.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
import { getAdapter, type ChannelAdapter, type SendContext } from "../_shared/channels/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Stage progression maps
const APPROVED_PROGRESSION = [
  { days: 30, stage_key: "30_dias" },
  { days: 60, stage_key: "60_dias" },
  { days: 90, stage_key: "90_dias" },
  { days: 120, stage_key: "120_dias" },
];

const REJECTED_PROGRESSION = [
  { days: 60, stage_key: "60_dias" },
];

// ─────────────────────────────────────────────────────────────────────
// Channel resolver — escolhe Evolution (per-consultor) ou Whapi (plataforma)
// ─────────────────────────────────────────────────────────────────────

interface ResolvedChannel {
  kind: "evolution" | "whapi";
  /** Identificador usado no anti-ban (`whatsapp_send_log.instance_name`). */
  instanceName: string;
  adapter: ChannelAdapter;
}

interface ChannelEnv {
  evolutionUrl: string | undefined;
  evolutionKey: string | undefined;
  whapiToken: string;
}

async function resolveChannel(
  supabase: any,
  consultantId: string,
  env: ChannelEnv,
): Promise<ResolvedChannel | null> {
  // 1. Tenta Evolution (consultor com instância dedicada)
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("consultant_id", consultantId)
    .limit(1)
    .maybeSingle();

  if (instance?.instance_name && env.evolutionUrl && env.evolutionKey) {
    const adapter = getAdapter({
      kind: "evolution",
      input: {
        apiUrl: env.evolutionUrl,
        apiKey: env.evolutionKey,
        instanceName: instance.instance_name,
      },
    });
    return { kind: "evolution", instanceName: instance.instance_name, adapter };
  }

  // 2. Fallback Whapi (canal compartilhado da plataforma)
  if (env.whapiToken) {
    const adapter = getAdapter({
      kind: "whapi",
      input: { apiToken: env.whapiToken, instanceName: "whapi-superadmin" },
    });
    return { kind: "whapi", instanceName: "whapi-superadmin", adapter };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Send helpers (com guard anti-ban preservado)
// ─────────────────────────────────────────────────────────────────────

async function guardOk(supabase: any, instanceName: string, label: string): Promise<boolean> {
  const quota = await checkSendQuota(supabase, instanceName);
  if (!quota.allowed) {
    console.warn(`🚫 [crm-auto-progress:${label}] bloqueado instance=${instanceName} reason=${quota.reason}`);
    return false;
  }
  return true;
}

function ctx(consultantId: string, customerId: string, stage: string): SendContext {
  return {
    customerId: customerId || "auto-progress",
    consultantId,
    stepId: `crm_auto_progress:${stage}`,
    idempotencyKey: `${consultantId}:${customerId}:${stage}:${Date.now()}`,
  };
}

async function sendText(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  text: string,
  sendCtx: SendContext,
) {
  if (!(await guardOk(supabase, channel.instanceName, "text"))) return;
  const r = await channel.adapter.sendText(jid, text, sendCtx);
  if (!r.ok) console.error(`[${channel.kind}] sendText failed:`, (r as any).detail);
  else await registerSend(supabase, channel.instanceName);
}

async function sendMedia(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  url: string,
  caption: string,
  kind: "image" | "video" | "document",
  sendCtx: SendContext,
) {
  if (!(await guardOk(supabase, channel.instanceName, kind))) return;
  const media =
    kind === "document"
      ? { kind, url, filename: "arquivo", caption }
      : { kind, url, caption };
  const r = await channel.adapter.sendMedia(jid, media as any, sendCtx);
  if (!r.ok) console.error(`[${channel.kind}] sendMedia(${kind}) failed:`, (r as any).detail);
  else await registerSend(supabase, channel.instanceName);
}

async function sendAudio(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  url: string,
  sendCtx: SendContext,
) {
  if (!(await guardOk(supabase, channel.instanceName, "audio"))) return;
  const r = await channel.adapter.sendMedia(jid, { kind: "audio", url, ptt: true }, sendCtx);
  if (!r.ok) console.error(`[${channel.kind}] sendAudio failed:`, (r as any).detail);
  else await registerSend(supabase, channel.instanceName);
}

async function sendSingleMessage(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  phone: string,
  msg: { message_type: string; message_text: string | null; media_url: string | null; image_url: string | null },
  sendCtx: SendContext,
  customerName?: string,
) {
  const displayName = customerName || phone;
  const messageText = (msg.message_text || "")
    .replace(/\{\{nome\}\}/g, displayName)
    .replace(/\{\{telefone\}\}/g, phone);
  const msgType = msg.message_type || "text";

  // Imagem extra antes do conteúdo principal
  if (msg.image_url && msgType !== "image") {
    await sendMedia(supabase, channel, jid, msg.image_url, "", "image", sendCtx);
  }

  if (msgType === "audio" && msg.media_url) {
    await sendAudio(supabase, channel, jid, msg.media_url, sendCtx);
    if (messageText) await sendText(supabase, channel, jid, messageText, sendCtx);
  } else if (msgType === "image" && msg.media_url) {
    await sendMedia(supabase, channel, jid, msg.media_url, messageText, "image", sendCtx);
  } else if (msgType === "video" && msg.media_url) {
    await sendMedia(supabase, channel, jid, msg.media_url, messageText, "video", sendCtx);
  } else if (messageText) {
    await sendText(supabase, channel, jid, messageText, sendCtx);
  }

  return messageText || "[mídia]";
}

async function sendAutoMessages(
  supabase: any,
  channel: ResolvedChannel,
  jid: string,
  phone: string,
  stageData: any,
  consultantId: string,
  customerId: string,
  rejectionReason?: string | null,
  dealOrigin?: string | null,
  customerName?: string,
): Promise<string> {
  const sendCtx = ctx(consultantId, customerId, stageData.stage_key);

  // Multi-message table primeiro
  const { data: multiMsgs } = await supabase
    .from("stage_auto_messages")
    .select("*")
    .eq("stage_id", stageData.id)
    .order("position", { ascending: true });

  const filtered = multiMsgs?.filter((m: any) => {
    const reasonMatch = !m.rejection_reason || m.rejection_reason === rejectionReason;
    const originMatch = !m.deal_origin || m.deal_origin === dealOrigin;
    return reasonMatch && originMatch;
  }) || [];

  let preview = "";

  if (filtered.length > 0) {
    for (let i = 0; i < filtered.length; i++) {
      const msg = filtered[i];
      if (i > 0 && msg.delay_seconds > 0) {
        await new Promise((r) => setTimeout(r, msg.delay_seconds * 1000));
      }
      preview = await sendSingleMessage(supabase, channel, jid, phone, msg, sendCtx, customerName);
    }
    console.log(`[${channel.kind}] Multi-messages (${filtered.length}) sent to ${phone} for stage ${stageData.label}`);
  } else {
    const hasContent = stageData.auto_message_text || stageData.auto_message_media_url || stageData.auto_message_image_url;
    if (!hasContent) return "";
    preview = await sendSingleMessage(supabase, channel, jid, phone, {
      message_type: stageData.auto_message_type,
      message_text: stageData.auto_message_text,
      media_url: stageData.auto_message_media_url,
      image_url: stageData.auto_message_image_url,
    }, sendCtx, customerName);
    console.log(`[${channel.kind}] Legacy auto-message sent to ${phone} for stage ${stageData.label}`);
  }

  return preview;
}

function findTargetStage(daysSince: number, progression: typeof APPROVED_PROGRESSION): string | null {
  for (let i = progression.length - 1; i >= 0; i--) {
    if (daysSince >= progression[i].days) return progression[i].stage_key;
  }
  return null;
}

function isValidJid(jid: string): boolean {
  if (!jid) return false;
  if (jid === "status@broadcast") return false;
  if (/sem_celular/i.test(jid)) return false;
  const phone = jid.split("@")[0];
  return phone.replace(/\D/g, "").length >= 8;
}

function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits;
}

/** Garante formato canônico `5511…@s.whatsapp.net` para o adapter. */
function toJid(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("@")) return raw;
  return `${normalizePhone(raw)}@s.whatsapp.net`;
}

async function processDeal(
  supabase: any,
  env: ChannelEnv,
  deal: any,
  targetStageKey: string,
  rejectionReason: string | null,
  defaultOrigin: string,
): Promise<{ moved: boolean }> {
  const { data: stageData } = await supabase
    .from("kanban_stages")
    .select("*")
    .eq("consultant_id", deal.consultant_id)
    .eq("stage_key", targetStageKey)
    .single();
  if (!stageData) return { moved: false };

  const { error } = await supabase.from("crm_deals").update({ stage: targetStageKey }).eq("id", deal.id);
  if (error) { console.error("Failed to move deal:", deal.id, error); return { moved: false }; }

  if (!stageData.auto_message_enabled) return { moved: true };
  if (!isValidJid(deal.remote_jid)) return { moved: true };

  const phone = deal.remote_jid.split("@")[0];
  if (await isConsultantAIDisabled(supabase, deal.consultant_id)) return { moved: true };
  if (await isPausedByPhone(supabase, phone, deal.consultant_id)) return { moved: true };

  // Resolver canal (Evolution se houver instância, senão Whapi compartilhado)
  const channel = await resolveChannel(supabase, deal.consultant_id, env);
  if (!channel) {
    console.warn(`[auto_progress] sem canal disponível consultor=${deal.consultant_id} deal=${deal.id}`);
    await supabase.from("crm_auto_message_log").insert({
      deal_id: deal.id,
      consultant_id: deal.consultant_id,
      stage_key: targetStageKey,
      remote_jid: deal.remote_jid,
      message_preview: null,
      status: "no_channel",
    });
    return { moved: true };
  }

  // Resolver nome do cliente
  let customerName = "";
  let customerId = deal.customer_id || "";
  if (deal.customer_id) {
    const { data: customer } = await supabase.from("customers").select("name").eq("id", deal.customer_id).single();
    customerName = customer?.name || "";
  }
  if (!customerName) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name")
      .eq("phone_whatsapp", phone)
      .limit(1)
      .maybeSingle();
    customerName = customer?.name || "";
    if (!customerId) customerId = customer?.id || "";
  }

  const jid = toJid(deal.remote_jid);
  const preview = await sendAutoMessages(
    supabase,
    channel,
    jid,
    phone,
    stageData,
    deal.consultant_id,
    customerId,
    rejectionReason,
    deal.deal_origin || defaultOrigin,
    customerName,
  );

  await supabase.from("crm_auto_message_log").insert({
    deal_id: deal.id,
    consultant_id: deal.consultant_id,
    stage_key: targetStageKey,
    remote_jid: deal.remote_jid,
    customer_name: customerName || null,
    message_preview: preview ? `[${channel.kind}] ${preview}`.slice(0, 200) : `[${channel.kind}]`,
    status: "sent",
  });

  return { moved: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (isQuietHourBRT()) {
    logQuietSkip("crm-auto-progress");
    return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL") || undefined;
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY") || undefined;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Carrega whapi_token de settings (mesma fonte do whapi-webhook)
    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });
    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";

    const env: ChannelEnv = { evolutionUrl, evolutionKey, whapiToken };

    if (!evolutionUrl && !whapiToken) {
      console.warn("[auto_progress] nenhum canal configurado — só vai mover stages");
    }

    const now = Date.now();
    let movedCount = 0;

    // ── 0. Linkar customer_id em deals órfãos ──
    const { data: unlinkedDeals } = await supabase
      .from("crm_deals")
      .select("id, remote_jid, consultant_id")
      .is("customer_id", null)
      .not("remote_jid", "is", null)
      .limit(200);

    let linkedCount = 0;
    for (const deal of unlinkedDeals || []) {
      const phone = normalizePhone(deal.remote_jid.split("@")[0]);
      if (!phone || phone.length < 10) continue;

      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("consultant_id", deal.consultant_id)
        .eq("phone_whatsapp", phone)
        .limit(1)
        .maybeSingle();

      if (customer) {
        await supabase.from("crm_deals").update({ customer_id: customer.id }).eq("id", deal.id);
        linkedCount++;
      }
    }
    if (linkedCount > 0) console.log(`Linked ${linkedCount} deals to customers`);

    // ── 1. Aprovados ──
    const { data: approvedDeals } = await supabase
      .from("crm_deals")
      .select("*")
      .in("stage", ["aprovado", "30_dias", "60_dias", "90_dias"])
      .not("approved_at", "is", null);

    for (const deal of approvedDeals || []) {
      const daysSince = Math.floor((now - new Date(deal.approved_at).getTime()) / (1000 * 60 * 60 * 24));
      const targetStageKey = findTargetStage(daysSince, APPROVED_PROGRESSION);
      if (!targetStageKey || targetStageKey === deal.stage) continue;

      const r = await processDeal(supabase, env, deal, targetStageKey, null, "aprovado");
      if (r.moved) movedCount++;
    }

    // ── 2. Reprovados ──
    const { data: rejectedDeals } = await supabase
      .from("crm_deals")
      .select("*")
      .eq("stage", "reprovado")
      .not("rejected_at", "is", null);

    for (const deal of rejectedDeals || []) {
      const daysSince = Math.floor((now - new Date(deal.rejected_at).getTime()) / (1000 * 60 * 60 * 24));
      const targetStageKey = findTargetStage(daysSince, REJECTED_PROGRESSION);
      if (!targetStageKey || targetStageKey === deal.stage) continue;

      const r = await processDeal(supabase, env, deal, targetStageKey, deal.rejection_reason, "reprovado");
      if (r.moved) movedCount++;
    }

    const totalChecked = (approvedDeals?.length || 0) + (rejectedDeals?.length || 0);
    return new Response(
      JSON.stringify({ moved: movedCount, checked: totalChecked, linked: linkedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

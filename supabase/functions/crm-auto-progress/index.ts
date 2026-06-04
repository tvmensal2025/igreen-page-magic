import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isConsultantAIDisabled, isPausedByPhone } from "../_shared/bot/paused.ts";

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

import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";

async function guardOk(supabase: any, instanceName: string, label: string): Promise<boolean> {
  const quota = await checkSendQuota(supabase, instanceName);
  if (!quota.allowed) {
    console.warn(`🚫 [crm-auto-progress:${label}] bloqueado instance=${instanceName} reason=${quota.reason}`);
    return false;
  }
  return true;
}

async function sendEvolutionText(supabase: any, instanceName: string, phone: string, text: string, apiUrl: string, apiKey: string) {
  if (!(await guardOk(supabase, instanceName, "text"))) return;
  const res = await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: phone, text }),
  });
  if (!res.ok) console.error("Evolution sendText error:", await res.text());
  else await registerSend(supabase, instanceName);
}

async function sendEvolutionMedia(supabase: any, instanceName: string, phone: string, mediaUrl: string, caption: string, mediatype: "image" | "video" | "document", apiUrl: string, apiKey: string) {
  if (!(await guardOk(supabase, instanceName, "media"))) return;
  const res = await fetch(`${apiUrl}/message/sendMedia/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: phone, mediatype, media: mediaUrl, caption }),
  });
  if (!res.ok) console.error("Evolution sendMedia error:", await res.text());
  else await registerSend(supabase, instanceName);
}

async function sendEvolutionAudio(supabase: any, instanceName: string, phone: string, audioUrl: string, apiUrl: string, apiKey: string) {
  if (!(await guardOk(supabase, instanceName, "audio"))) return;
  const res = await fetch(`${apiUrl}/message/sendWhatsAppAudio/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: phone, audio: audioUrl }),
  });
  if (!res.ok) console.error("Evolution sendAudio error:", await res.text());
  else await registerSend(supabase, instanceName);
}

async function sendSingleMessage(
  supabase: any,
  instanceName: string,
  phone: string,
  msg: { message_type: string; message_text: string | null; media_url: string | null; image_url: string | null },
  apiUrl: string,
  apiKey: string,
  customerName?: string
) {
  const displayName = customerName || phone;
  const messageText = (msg.message_text || "")
    .replace(/\{\{nome\}\}/g, displayName)
    .replace(/\{\{telefone\}\}/g, phone);
  const msgType = msg.message_type || "text";

  // Send optional image first
  if (msg.image_url && msgType !== "image") {
    await sendEvolutionMedia(supabase, instanceName, phone, msg.image_url, "", "image", apiUrl, apiKey);
  }

  if (msgType === "audio" && msg.media_url) {
    await sendEvolutionAudio(supabase, instanceName, phone, msg.media_url, apiUrl, apiKey);
    if (messageText) await sendEvolutionText(supabase, instanceName, phone, messageText, apiUrl, apiKey);
  } else if (msgType === "image" && msg.media_url) {
    await sendEvolutionMedia(supabase, instanceName, phone, msg.media_url, messageText, "image", apiUrl, apiKey);
  } else if (msgType === "video" && msg.media_url) {
    await sendEvolutionMedia(supabase, instanceName, phone, msg.media_url, messageText, "video", apiUrl, apiKey);
  } else if (messageText) {
    await sendEvolutionText(supabase, instanceName, phone, messageText, apiUrl, apiKey);
  }

  return messageText || "[mídia]";
}

async function sendAutoMessages(
  supabase: any,
  instanceName: string,
  phone: string,
  stageData: any,
  apiUrl: string,
  apiKey: string,
  rejectionReason?: string | null,
  dealOrigin?: string | null,
  customerName?: string
): Promise<string> {
  // Try multi-message table first
  const { data: multiMsgs } = await supabase
    .from("stage_auto_messages")
    .select("*")
    .eq("stage_id", stageData.id)
    .order("position", { ascending: true });

  // Filter by rejection_reason and deal_origin
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
      preview = await sendSingleMessage(supabase, instanceName, phone, msg, apiUrl, apiKey, customerName);
    }
    console.log(`Multi-messages (${filtered.length}) sent to ${phone} for stage ${stageData.label}`);
  } else {
    // Legacy single message
    const hasContent = stageData.auto_message_text || stageData.auto_message_media_url || stageData.auto_message_image_url;
    if (!hasContent) return "";
    preview = await sendSingleMessage(supabase, instanceName, phone, {
      message_type: stageData.auto_message_type,
      message_text: stageData.auto_message_text,
      media_url: stageData.auto_message_media_url,
      image_url: stageData.auto_message_image_url,
    }, apiUrl, apiKey, customerName);
    console.log(`Legacy auto-message sent to ${phone} for stage ${stageData.label}`);
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
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);
    const now = Date.now();
    let movedCount = 0;

    // ── 0. Link customer_id on deals that are missing it ──
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

      // Try exact match first, then partial
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

    // ── 1. Approved deals progression ──
    const { data: approvedDeals } = await supabase
      .from("crm_deals")
      .select("*")
      .in("stage", ["aprovado", "30_dias", "60_dias", "90_dias"])
      .not("approved_at", "is", null);

    for (const deal of approvedDeals || []) {
      const daysSince = Math.floor((now - new Date(deal.approved_at).getTime()) / (1000 * 60 * 60 * 24));
      const targetStageKey = findTargetStage(daysSince, APPROVED_PROGRESSION);
      if (!targetStageKey || targetStageKey === deal.stage) continue;

      const { data: stageData } = await supabase
        .from("kanban_stages")
        .select("*")
        .eq("consultant_id", deal.consultant_id)
        .eq("stage_key", targetStageKey)
        .single();
      if (!stageData) continue;

      const { error } = await supabase.from("crm_deals").update({ stage: targetStageKey }).eq("id", deal.id);
      if (error) { console.error("Failed to move deal:", deal.id, error); continue; }
      movedCount++;

      if (stageData.auto_message_enabled && isValidJid(deal.remote_jid) && evolutionUrl && evolutionKey
        && !(await isConsultantAIDisabled(supabase, deal.consultant_id))
        && !(await isPausedByPhone(supabase, deal.remote_jid.split("@")[0], deal.consultant_id))) {
        let customerName = "";
        if (deal.customer_id) {
          const { data: customer } = await supabase.from("customers").select("name").eq("id", deal.customer_id).single();
          customerName = customer?.name || "";
        }
        if (!customerName) {
          const phone = deal.remote_jid.split("@")[0];
          const { data: customer } = await supabase.from("customers").select("name").eq("phone_whatsapp", phone).limit(1).maybeSingle();
          customerName = customer?.name || "";
        }

        const { data: instance } = await supabase
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("consultant_id", deal.consultant_id)
          .limit(1)
          .single();
        if (instance) {
          const preview = await sendAutoMessages(supabase, instance.instance_name, deal.remote_jid.split("@")[0], stageData, evolutionUrl, evolutionKey, null, deal.deal_origin || "aprovado", customerName);

          // Log the auto-message
          await supabase.from("crm_auto_message_log").insert({
            deal_id: deal.id,
            consultant_id: deal.consultant_id,
            stage_key: targetStageKey,
            remote_jid: deal.remote_jid,
            customer_name: customerName || null,
            message_preview: preview ? preview.slice(0, 200) : null,
            status: "sent",
          });
        }
      }
    }

    // ── 2. Rejected deals progression ──
    const { data: rejectedDeals } = await supabase
      .from("crm_deals")
      .select("*")
      .eq("stage", "reprovado")
      .not("rejected_at", "is", null);

    for (const deal of rejectedDeals || []) {
      const daysSince = Math.floor((now - new Date(deal.rejected_at).getTime()) / (1000 * 60 * 60 * 24));
      const targetStageKey = findTargetStage(daysSince, REJECTED_PROGRESSION);
      if (!targetStageKey || targetStageKey === deal.stage) continue;

      const { data: stageData } = await supabase
        .from("kanban_stages")
        .select("*")
        .eq("consultant_id", deal.consultant_id)
        .eq("stage_key", targetStageKey)
        .single();
      if (!stageData) continue;

      const { error } = await supabase.from("crm_deals").update({ stage: targetStageKey }).eq("id", deal.id);
      if (error) { console.error("Failed to move rejected deal:", deal.id, error); continue; }
      movedCount++;

      if (stageData.auto_message_enabled && isValidJid(deal.remote_jid) && evolutionUrl && evolutionKey
        && !(await isConsultantAIDisabled(supabase, deal.consultant_id))
        && !(await isPausedByPhone(supabase, deal.remote_jid.split("@")[0], deal.consultant_id))) {
        let customerName = "";
        if (deal.customer_id) {
          const { data: customer } = await supabase.from("customers").select("name").eq("id", deal.customer_id).single();
          customerName = customer?.name || "";
        }
        if (!customerName) {
          const phone = deal.remote_jid.split("@")[0];
          const { data: customer } = await supabase.from("customers").select("name").eq("phone_whatsapp", phone).limit(1).maybeSingle();
          customerName = customer?.name || "";
        }

        const { data: instance } = await supabase
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("consultant_id", deal.consultant_id)
          .limit(1)
          .single();
        if (instance) {
          const preview = await sendAutoMessages(supabase, instance.instance_name, deal.remote_jid.split("@")[0], stageData, evolutionUrl, evolutionKey, deal.rejection_reason, deal.deal_origin || "reprovado", customerName);

          // Log the auto-message
          await supabase.from("crm_auto_message_log").insert({
            deal_id: deal.id,
            consultant_id: deal.consultant_id,
            stage_key: targetStageKey,
            remote_jid: deal.remote_jid,
            customer_name: customerName || null,
            message_preview: preview ? preview.slice(0, 200) : null,
            status: "sent",
          });
        }
      }
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

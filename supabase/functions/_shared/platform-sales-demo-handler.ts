/**
 * Handler inbound — demo pós-venda para alvos platform_sales.
 * Clique 1–8: mesmo pacote do pós-venda real (imagem + áudio TTS), sem bolha de texto.
 * Retorna handled=true → webhook deve return cedo (não vira lead).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type PsDemoFlowState,
  type PsDemoOutbound,
  PS_DEMO_TTS_CONSULTANT_ID,
  buildPsDemoOutbounds,
  composePsDemoClientMessage,
  parsePsDemoIntent,
  psDemoPhoneDigits,
  resolvePsDemoAction,
} from "./platform-sales-demo.ts";
import { renderPersonalizedTtsAudio } from "./pos-venda-tts.ts";

export type PsDemoSender = {
  sendText: (jid: string, text: string) => Promise<boolean>;
  sendButtons: (
    jid: string,
    message: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<boolean>;
  /** Whapi: image | audio | voice */
  sendMedia: (
    jid: string,
    mediaUrl: string,
    caption: string,
    mediatype: "image" | "audio" | "voice",
  ) => Promise<boolean>;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function deliverOutbounds(
  sender: PsDemoSender,
  remoteJid: string,
  outs: PsDemoOutbound[],
): Promise<{ image_ok: boolean | null; audio_ok: boolean | null }> {
  let image_ok: boolean | null = null;
  let audio_ok: boolean | null = null;

  for (let i = 0; i < outs.length; i++) {
    const o = outs[i];
    if (o.type === "image") {
      image_ok = await sender.sendMedia(remoteJid, o.url, "", "image");
      if (image_ok) await sleep(900);
      continue;
    }
    if (o.type === "audio") {
      // PTT (voice) — mesmo padrão do pós-venda Whapi.
      audio_ok = await sender.sendMedia(remoteJid, o.url, "", "voice");
      if (!audio_ok) {
        audio_ok = await sender.sendMedia(remoteJid, o.url, "", "audio");
      }
      // Garante ordem: áudio chega antes do menu.
      if (audio_ok) await sleep(1200);
      continue;
    }
    if (o.type === "text") {
      await sender.sendText(remoteJid, o.text);
      if (i < outs.length - 1) await sleep(500);
      continue;
    }
    // Botões: nunca misturar com menu numerado 1–8 na mesma rajada.
    const ok = await sender.sendButtons(remoteJid, o.text, o.buttons);
    if (!ok) {
      const fallback =
        `${o.text}\n\n` +
        o.buttons.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n") +
        `\n\n_Digite a opção por extenso (ex.: *menu* ou *sair*)._`;
      await sender.sendText(remoteJid, fallback);
    }
  }

  return { image_ok, audio_ok };
}

async function findActiveDemoTarget(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<{
  id: string;
  campaign_id: string;
  demo_flow_state: PsDemoFlowState;
  name: string | null;
} | null> {
  const local = phoneDigits.startsWith("55") ? phoneDigits.slice(2) : phoneDigits;
  const variants = Array.from(new Set([phoneDigits, local, `55${local}`]));

  const { data } = await supabase
    .from("platform_sales_targets")
    .select("id, campaign_id, demo_flow_state, phone, name")
    .in("demo_flow_state", ["cta_sent", "menu", "done"])
    .order("updated_at", { ascending: false })
    .limit(40);

  const rows = (data || []) as Array<{
    id: string;
    campaign_id: string;
    demo_flow_state: PsDemoFlowState;
    phone: string;
    name: string | null;
  }>;

  for (const row of rows) {
    const p = psDemoPhoneDigits(row.phone);
    if (variants.includes(p) || variants.includes(p.replace(/^55/, ""))) {
      return {
        id: row.id,
        campaign_id: row.campaign_id,
        demo_flow_state: row.demo_flow_state,
        name: row.name,
      };
    }
  }
  return null;
}

/** Resolve imagem + áudio TTS a partir de pos_venda_default_media (paridade pós-venda). */
async function resolveStageMediaPack(
  supabase: SupabaseClient,
  stage: string,
  consultantName: string | null | undefined,
): Promise<{
  stageText: string;
  imageUrl: string | null;
  audioUrl: string | null;
  mediaPackOk: boolean;
}> {
  const { data: media } = await supabase
    .from("pos_venda_default_media")
    .select("message_text, media_url, image_url, message_type, is_active")
    .eq("stage", stage)
    .maybeSingle();

  const stageText = composePsDemoClientMessage(String(media?.message_text || ""), {
    customerName: consultantName,
  });
  const imageUrl = String(media?.image_url || "").trim() || null;
  let audioUrl = String(media?.media_url || "").trim() || null;

  const msgType = String(media?.message_type || "audio");
  // Roteiro com {{nome}}/{{saudacao}} → TTS (media_url estático foi limpo de propósito).
  if (msgType === "audio" && stageText) {
    const ttsUrl = await renderPersonalizedTtsAudio(
      supabase,
      PS_DEMO_TTS_CONSULTANT_ID,
      stageText,
    );
    if (ttsUrl) audioUrl = ttsUrl;
  }

  const mediaPackOk = !!(imageUrl || audioUrl);
  return { stageText, imageUrl, audioUrl, mediaPackOk };
}

export async function handlePlatformSalesDemoInbound(opts: {
  supabase: SupabaseClient;
  remoteJid: string;
  phone: string;
  messageText: string | null;
  buttonId: string | null;
  sender: PsDemoSender;
}): Promise<{ handled: boolean; reason?: string }> {
  const digits = psDemoPhoneDigits(opts.phone);
  if (!digits) return { handled: false };

  const target = await findActiveDemoTarget(opts.supabase, digits);
  if (!target) return { handled: false };

  const intent = parsePsDemoIntent(opts.messageText, opts.buttonId);
  const resolved = resolvePsDemoAction(target.demo_flow_state, intent);
  if (resolved.action === "ignore") {
    return { handled: false, reason: "idle_or_done_ignore" };
  }

  let pack: {
    stageText: string;
    imageUrl: string | null;
    audioUrl: string | null;
    mediaPackOk: boolean;
  } | null = null;

  if (resolved.action === "send_stage") {
    pack = await resolveStageMediaPack(opts.supabase, resolved.stage, target.name);
  }

  const outs = buildPsDemoOutbounds(resolved, pack
    ? {
      stageText: pack.stageText,
      imageUrl: pack.imageUrl,
      audioUrl: pack.audioUrl,
      mediaPackOk: pack.mediaPackOk,
    }
    : undefined);

  const sendRes = await deliverOutbounds(opts.sender, opts.remoteJid, outs);

  const patch: Record<string, unknown> = {
    demo_flow_state: resolved.nextState,
  };
  if (resolved.action === "send_stage") {
    patch.demo_last_stage = resolved.stage;
  }
  await opts.supabase.from("platform_sales_targets").update(patch).eq("id", target.id);

  const mediaTag =
    resolved.action === "send_stage"
      ? `[img:${sendRes.image_ok === null ? "-" : sendRes.image_ok ? "ok" : "fail"}|audio:${
        sendRes.audio_ok === null ? "-" : sendRes.audio_ok ? "ok" : "fail"
      }] `
      : "";

  await opts.supabase.from("platform_sales_dispatch_log").insert({
    campaign_id: target.campaign_id,
    target_id: target.id,
    day_key: "d0",
    channel: "whatsapp",
    dry_run: false,
    rendered_text: `${mediaTag}${
      outs
        .map((o) => {
          if (o.type === "image") return `[IMAGE] ${o.url}`;
          if (o.type === "audio") return `[AUDIO] ${o.url}`;
          return o.text;
        })
        .join("\n---\n")
        .slice(0, 8000)
    }`,
    status: "ok",
  });

  return { handled: true, reason: resolved.action };
}

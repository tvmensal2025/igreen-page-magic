/**
 * Handler inbound — demo pós-venda para alvos platform_sales.
 * Retorna handled=true → webhook deve return cedo (não vira lead).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  type PsDemoFlowState,
  type PsDemoOutbound,
  buildPsDemoOutbounds,
  composePsDemoClientMessage,
  parsePsDemoIntent,
  psDemoPhoneDigits,
  resolvePsDemoAction,
} from "./platform-sales-demo.ts";

export type PsDemoSender = {
  sendText: (jid: string, text: string) => Promise<boolean>;
  sendButtons: (
    jid: string,
    message: string,
    buttons: Array<{ id: string; title: string }>,
  ) => Promise<boolean>;
};

async function deliverOutbounds(
  sender: PsDemoSender,
  remoteJid: string,
  outs: PsDemoOutbound[],
): Promise<void> {
  for (const o of outs) {
    if (o.type === "text") {
      await sender.sendText(remoteJid, o.text);
    } else {
      const ok = await sender.sendButtons(remoteJid, o.text, o.buttons);
      if (!ok) {
        const fallback =
          `${o.text}\n\n` +
          o.buttons.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n") +
          `\n\n_Digite o número da opção desejada._`;
        await sender.sendText(remoteJid, fallback);
      }
    }
  }
}

async function findActiveDemoTarget(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<{
  id: string;
  campaign_id: string;
  demo_flow_state: PsDemoFlowState;
} | null> {
  const local = phoneDigits.startsWith("55") ? phoneDigits.slice(2) : phoneDigits;
  const variants = Array.from(new Set([phoneDigits, local, `55${local}`]));

  const { data } = await supabase
    .from("platform_sales_targets")
    .select("id, campaign_id, demo_flow_state, phone")
    .in("demo_flow_state", ["cta_sent", "menu", "done"])
    .order("updated_at", { ascending: false })
    .limit(40);

  const rows = (data || []) as Array<{
    id: string;
    campaign_id: string;
    demo_flow_state: PsDemoFlowState;
    phone: string;
  }>;

  for (const row of rows) {
    const p = psDemoPhoneDigits(row.phone);
    if (variants.includes(p) || variants.includes(p.replace(/^55/, ""))) {
      return {
        id: row.id,
        campaign_id: row.campaign_id,
        demo_flow_state: row.demo_flow_state,
      };
    }
  }
  return null;
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

  let stageText: string | null = null;
  if (resolved.action === "send_stage") {
    const { data: media } = await opts.supabase
      .from("pos_venda_default_media")
      .select("message_text")
      .eq("stage", resolved.stage)
      .maybeSingle();
    stageText = composePsDemoClientMessage(String(media?.message_text || ""));
  }

  const outs = buildPsDemoOutbounds(resolved, stageText);
  await deliverOutbounds(opts.sender, opts.remoteJid, outs);

  const patch: Record<string, unknown> = {
    demo_flow_state: resolved.nextState,
  };
  if (resolved.action === "send_stage") {
    patch.demo_last_stage = resolved.stage;
  }
  await opts.supabase.from("platform_sales_targets").update(patch).eq("id", target.id);

  await opts.supabase.from("platform_sales_dispatch_log").insert({
    campaign_id: target.campaign_id,
    target_id: target.id,
    day_key: "d0",
    channel: "whatsapp",
    dry_run: false,
    rendered_text: outs.map((o) => (o.type === "text" ? o.text : o.text)).join("\n---\n").slice(0, 8000),
    status: "ok",
  });

  return { handled: true, reason: resolved.action };
}

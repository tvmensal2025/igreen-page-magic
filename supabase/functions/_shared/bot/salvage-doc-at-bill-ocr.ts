/**
 * Quando o cliente está em aguardando_conta mas envia RG/CNH, o OCR de conta
 * falha (qualidade 0%). Em vez de loop de erro, salva o documento e pede a
 * conta de luz com o texto oficial do passo a6 (se existir no fluxo).
 *
 * Caso real: lead 5511971254913 (Lucas) — roteamento pulou a6 e pediu doc;
 * ao enviar doc no passo errado, OCR conta rejeitou.
 */

import { detectDocumentTypeDetailed } from "../detect-doc-type.ts";
import { resolveFlowId } from "../resolve-flow.ts";

const DOC_TYPES = new Set(["cnh", "rg_novo", "rg_antigo"]);
const MIN_CONF = 0.35;

export async function fetchBillCaptureMessageFromFlow(
  supabase: any,
  customer: { consultant_id?: string | null; flow_variant?: string | null },
): Promise<string | null> {
  try {
    const consultantId = customer.consultant_id;
    if (!consultantId) return null;
    const variant = String(customer.flow_variant || "A");
    const flow = await resolveFlowId(supabase, consultantId, variant);
    if (!flow?.id) return null;
    const { data } = await supabase
      .from("bot_flow_steps")
      .select("step_key, message_text, position")
      .eq("flow_id", flow.id)
      .eq("is_active", true)
      .eq("step_type", "capture_conta")
      .order("position", { ascending: true });
    const rows = Array.isArray(data) ? data : [];
    const a6 = rows.find((r: { step_key?: string }) => /^a6_|ask_bill_photo/i.test(String(r.step_key || "")));
    const pick = a6 || rows[0];
    const txt = String(pick?.message_text || "").trim();
    return txt || null;
  } catch (e) {
    console.warn("[salvage-doc-at-bill] fetchBillCaptureMessage:", (e as Error).message);
    return null;
  }
}

export async function maybeSalvageDocumentSentAsBill(opts: {
  supabase: any;
  customer: {
    id?: string;
    name?: string | null;
    consultant_id?: string | null;
    flow_variant?: string | null;
    electricity_bill_photo_url?: string | null;
  };
  fileBase64?: string;
  mimeType: string;
  fileUrl?: string;
  geminiApiKey: string | undefined;
  messageId?: string | null;
}): Promise<{ salvaged: boolean; updates: Record<string, unknown>; reply?: string }> {
  const empty = { salvaged: false, updates: {} as Record<string, unknown> };
  if (!opts.fileBase64 && !(opts.fileUrl && /^https?:\/\//i.test(opts.fileUrl))) return empty;

  try {
    const det = await detectDocumentTypeDetailed({
      base64: opts.fileBase64,
      mimeType: opts.mimeType,
      imageUrl: opts.fileUrl?.startsWith("http") ? opts.fileUrl : undefined,
      geminiApiKey: opts.geminiApiKey,
    });
    if (!DOC_TYPES.has(det.tipo) || det.confianca < MIN_CONF) return empty;

    const billAsk =
      (await fetchBillCaptureMessageFromFlow(opts.supabase, opts.customer)) ||
      "📸 Agora me envie a *foto da sua conta de luz* (última fatura), por favor.";
    const first = String(opts.customer.name || "tudo bem").split(/\s+/)[0] || "tudo bem";
    const tipoLabel = det.tipo === "cnh" ? "CNH" : "documento";

    const mistakenUrl =
      String(opts.customer.electricity_bill_photo_url || "").trim() ||
      (opts.fileBase64 ? `data:${opts.mimeType};base64,${opts.fileBase64}` : "");

    const updates: Record<string, unknown> = {
      conversation_step: "aguardando_conta",
      electricity_bill_photo_url: null,
      bill_base64: null,
      doc_auto_detected_type: det.tipo,
      ocr_conta_attempts: 0,
    };
    if (mistakenUrl) {
      updates.document_front_url = mistakenUrl;
      if (opts.fileBase64) updates.document_front_base64 = opts.fileBase64;
    }
    if (opts.messageId) updates.media_message_id = opts.messageId;

    console.log(
      `[salvage-doc-at-bill] customer=${opts.customer.id} tipo=${det.tipo} conf=${det.confianca.toFixed(2)} — doc salvo, pedindo conta`,
    );

    return {
      salvaged: true,
      updates,
      reply: `Recebi seu ${tipoLabel}, ${first}! ✅ Salvei aqui.\n\n${billAsk}`,
    };
  } catch (e) {
    console.warn("[salvage-doc-at-bill] detect failed:", (e as Error).message);
    return empty;
  }
}

/** Retorna reply se salvou documento enviado por engano no passo da conta; senão null. */
export async function salvageIfDocumentMisroutedAtBillOcr(ctx: {
  supabase: any;
  customer: {
    id?: string;
    name?: string | null;
    consultant_id?: string | null;
    flow_variant?: string | null;
    electricity_bill_photo_url?: string | null;
  };
  updates: Record<string, unknown>;
  ocrBase64?: string;
  mediaMsg?: { mimetype?: string };
  fileUrl?: string;
  geminiApiKey: string | undefined;
  messageId?: string | null;
}): Promise<string | null> {
  const mergedCustomer = { ...ctx.customer, ...ctx.updates };
  const salv = await maybeSalvageDocumentSentAsBill({
    supabase: ctx.supabase,
    customer: mergedCustomer,
    fileBase64: ctx.ocrBase64,
    mimeType: ctx.mediaMsg?.mimetype || "image/jpeg",
    fileUrl: ctx.fileUrl,
    geminiApiKey: ctx.geminiApiKey,
    messageId: ctx.messageId,
  });
  if (!salv.salvaged || !salv.reply) return null;
  Object.assign(ctx.updates, salv.updates);
  return salv.reply;
}

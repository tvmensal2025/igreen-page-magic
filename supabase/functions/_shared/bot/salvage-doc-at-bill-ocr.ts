/**
 * Quando o cliente está em aguardando_conta mas envia RG/CNH, o OCR de conta
 * falha. Em vez de loop de erro:
 *   1) detecta que é documento
 *   2) salva a foto + roda OCR do doc (silencioso — sem confirmar ainda)
 *   3) mantém o funil: CONTA PRIMEIRO → pede a foto da conta de luz
 *
 * Após o cliente confirmar a conta, o bot usa o documento já salvo
 * (resolveResumeStep / tryAdvanceEarlyDocumentAfterBill) sem pedir de novo.
 *
 * Caso real: lead 5511971254913 — doc enviado no passo da conta.
 */

import { detectDocumentTypeDetailed } from "../detect-doc-type.ts";
import { resolveFlowId } from "../resolve-flow.ts";
import { renderTemplateVars } from "../render-vars.ts";
import { ocrDocumentoFrenteVerso } from "../ocr.ts";
import { shouldSkipAsk } from "../conversation-helpers.ts";

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

function applyDocOcrToUpdates(
  updates: Record<string, unknown>,
  d: Record<string, unknown>,
  treatAsCnh: boolean,
): void {
  if (d.nome) updates.doc_holder_name = String(d.nome).trim();
  if (d.cpf) {
    const cpf = String(d.cpf).replace(/\D/g, "");
    if (cpf.length === 11) updates.cpf = cpf;
  }
  if (d.rg) {
    const rgDigits = String(d.rg).replace(/\D/g, "");
    const cpfDigits = String(d.cpf || updates.cpf || "").replace(/\D/g, "");
    if (rgDigits && rgDigits !== cpfDigits) updates.rg = d.rg;
  }
  const dataConf = String(d.dataNascimentoConfianca || "").toLowerCase();
  if (d.dataNascimento) {
    // CNH: aceita alta/média no salvage silencioso (confirmação vem depois da conta)
    if (!treatAsCnh || dataConf === "alta" || dataConf === "media" || !dataConf) {
      updates.data_nascimento = d.dataNascimento;
    }
  }
  if (d.nomePai) updates.nome_pai = d.nomePai;
  if (d.nomeMae) updates.nome_mae = d.nomeMae;
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
  fileUrl?: string | null;
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

    const billAskRaw =
      (await fetchBillCaptureMessageFromFlow(opts.supabase, opts.customer)) ||
      "📸 Agora me envie a *foto da sua conta de luz* (última fatura), por favor.";
    const first = String(opts.customer.name || "tudo bem").split(/\s+/)[0] || "tudo bem";
    const billAsk = renderTemplateVars(billAskRaw, { name: first });
    const tipoLabel = det.tipo === "cnh" ? "CNH" : "documento";
    const treatAsCnh = det.tipo === "cnh" && det.confianca >= 0.55;

    const mistakenUrl =
      String(opts.customer.electricity_bill_photo_url || "").trim() ||
      (opts.fileBase64 ? `data:${opts.mimeType};base64,${opts.fileBase64}` : "");

    // Funil: CONTA PRIMEIRO — nunca avança para confirmando_dados_doc aqui.
    const updates: Record<string, unknown> = {
      conversation_step: "aguardando_conta",
      electricity_bill_photo_url: null,
      bill_base64: null,
      doc_auto_detected_type: det.tipo,
      document_type: treatAsCnh ? "cnh" : (det.tipo === "rg_novo" ? "rg_novo" : "rg_antigo"),
      ocr_conta_attempts: 0,
      early_document_saved_at: new Date().toISOString(),
    };
    if (mistakenUrl) {
      updates.document_front_url = mistakenUrl;
      if (opts.fileBase64) updates.document_front_base64 = opts.fileBase64;
    }
    if (treatAsCnh) updates.document_back_url = "nao_aplicavel";
    if (opts.messageId) updates.media_message_id = opts.messageId;

    // OCR silencioso do doc — dados ficam prontos; confirmação só DEPOIS da conta.
    if (opts.fileBase64 && opts.geminiApiKey) {
      try {
        const ocrData = await ocrDocumentoFrenteVerso(
          opts.fileUrl || mistakenUrl || null,
          treatAsCnh ? "nao_aplicavel" : "",
          treatAsCnh ? "CNH" : (det.tipo === "rg_novo" ? "RG_NOVO" : "RG_ANTIGO"),
          opts.geminiApiKey,
          opts.fileBase64,
          { mimetype: opts.mimeType },
          undefined,
        );
        if (ocrData.sucesso && ocrData.dados) {
          applyDocOcrToUpdates(updates, ocrData.dados, treatAsCnh);
          console.log(
            `[salvage-doc-at-bill] OCR doc OK customer=${opts.customer.id} cpf=${!!updates.cpf} rg=${!!updates.rg}`,
          );
        }
      } catch (e) {
        console.warn("[salvage-doc-at-bill] OCR doc silencioso falhou:", (e as Error).message);
      }
    }

    console.log(
      `[salvage-doc-at-bill] customer=${opts.customer.id} tipo=${det.tipo} conf=${det.confianca.toFixed(2)} — doc guardado, CONTA PRIMEIRO`,
    );

    return {
      salvaged: true,
      updates,
      reply:
        `Recebi seu ${tipoLabel}, ${first}! ✅ Já guardei aqui.\n\n` +
        `Pra seguir o cadastro, preciso da *conta de luz primeiro*.\n\n${billAsk}`,
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
  fileUrl?: string | null;
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

/**
 * Após SIM na conta: se o cliente já enviou o documento cedo (salvage),
 * pula o "envie o documento" e vai direto para verso/confirmação.
 * Retorna o step destino ou null se não houver doc precoce.
 */
export function resolveEarlyDocumentStepAfterBill(customer: Record<string, unknown>): string | null {
  if (!shouldSkipAsk("document_front", customer)) return null;
  if (customer.doc_data_confirmed_at) return null;
  if (!shouldSkipAsk("document_back", customer)) return "aguardando_doc_verso";
  // Frente (e verso se necessário) já existem → confirmar dados do OCR
  return "confirmando_dados_doc";
}

export function buildEarlyDocConfirmMessage(merged: Record<string, unknown>): string {
  const tipo = /cnh/i.test(String(merged.document_type || "")) ? "CNH" : "documento";
  return (
    `📋 *Dados do seu ${tipo}* (já recebi antes):\n\n` +
    `👤 Nome: *${merged.doc_holder_name || merged.name || "—"}*\n` +
    `🆔 CPF: *${merged.cpf || "—"}*\n` +
    `🪪 RG: *${merged.rg || "—"}*\n` +
    `🎂 Nascimento: *${merged.data_nascimento || "—"}*\n\n` +
    "Está tudo correto?"
  );
}

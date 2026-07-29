/**
 * Sofia Multicanal (Grupo A): após OCR da conta → documento direto.
 * Sem re-explicar economia (a3) nem pedir cadastrar de novo.
 * Sem confirmação SIM/NÃO/EDITAR no caminho feliz (OCR bom).
 */

import { isSofiaMulticanalCustomer } from "./cadastro-fixes.ts";
import { safeFirstNameForAddress } from "../customer-display-name.ts";

export const SOFIA_DOC_STEP_KEY = "a7_ask_document";

/** Texto curto pedindo de novo a foto da conta (baixa confiança / OCR fraco). */
export const OCR_RETRY_CONTA_SHORT =
  "⚠️ Não consegui ler bem a conta. Envie de novo a *foto da conta de luz*, bem nítida e sem reflexo 📸";

/** Texto curto pedindo de novo a foto do documento. */
export const OCR_RETRY_DOC_SHORT =
  "⚠️ Não consegui ler bem o documento. Envie de novo a *foto*, bem nítida e sem reflexo 📸";

export type FlowStepRow = {
  id?: string;
  step_key?: string | null;
  step_type?: string | null;
  is_active?: boolean | null;
};

/** Lead no funil Sofia A/C (passos a1_, a2_, …). */
export function isSofiaPostBillCadastro(
  customer: { flow_variant?: string | null; conversation_step?: string | null } | null | undefined,
): boolean {
  return isSofiaMulticanalCustomer(customer);
}

/** Passo capture_documento do Grupo A (a7). */
export function pickSofiaDocumentCaptureStep(steps: FlowStepRow[]): FlowStepRow | null {
  const list = (steps || []).filter((s) => s && s.is_active !== false);
  const a7 = list.find((s) => /^a7_|ask_document/i.test(String(s.step_key || "")));
  if (a7) return a7;
  return list.find((s) => String(s.step_type || "") === "capture_documento") || null;
}

export function buildSofiaDispatchNameVars(
  customer: { name?: string | null; name_source?: string | null },
): Record<string, string> {
  // Vazio se inválido ou só push-name do Zap — NUNCA fallback "Cliente".
  const first = safeFirstNameForAddress(customer.name, customer.name_source);
  return {
    "{nome}": first,
    "{{nome}}": first,
    name: first,
  };
}

/** Marca conta como confirmada pelo sistema (OCR ok — sem SIM do lead). */
export function markBillAutoConfirmed(updates: Record<string, unknown>): void {
  if (!updates.bill_data_confirmed_at) {
    updates.bill_data_confirmed_at = new Date().toISOString();
  }
  updates.bill_data_confirmation_by = "auto_ocr";
}

/** Marca documento como confirmado pelo sistema (OCR ok — sem SIM do lead). */
export function markDocAutoConfirmed(updates: Record<string, unknown>): void {
  if (!updates.doc_data_confirmed_at) {
    updates.doc_data_confirmed_at = new Date().toISOString();
  }
  updates.doc_data_confirmation_by = "auto_ocr";
}

/**
 * Conta OCR ok → confirma automaticamente e despacha a7 (documento).
 * Retorna true se aplicou (Sofia A/C); false = caller segue fallback sem botões.
 */
export async function advanceSofiaToDocumentAfterBill(opts: {
  customer: {
    flow_variant?: string | null;
    conversation_step?: string | null;
    name?: string | null;
    name_source?: string | null;
  };
  updates: Record<string, unknown>;
  dispatchStep: (stepKey: string, vars: Record<string, string>) => Promise<unknown>;
  logPrefix?: string;
}): Promise<boolean> {
  const merged = { ...opts.customer, ...opts.updates };
  if (!isSofiaPostBillCadastro(merged)) return false;

  markBillAutoConfirmed(opts.updates);
  opts.updates.conversation_step = "aguardando_doc_auto";

  const vars = buildSofiaDispatchNameVars(merged as {
    name?: string | null;
    name_source?: string | null;
  });
  try {
    await opts.dispatchStep(SOFIA_DOC_STEP_KEY, vars);
    opts.updates.__inline_sent = true;
    console.log(
      `[${opts.logPrefix || "sofia-post-bill"}] conta→documento direto (sem confirmação SIM) name=${vars["{{nome}}"]}`,
    );
    return true;
  } catch (e) {
    console.warn(`[sofia-post-bill] dispatch ${SOFIA_DOC_STEP_KEY} falhou:`, (e as Error).message);
    return false;
  }
}

/** Fallback não-Sofia: conta OCR ok → pede documento sem SIM/NÃO/EDITAR. */
export function advanceGenericToDocumentAfterBill(updates: Record<string, unknown>): string {
  markBillAutoConfirmed(updates);
  updates.conversation_step = "aguardando_doc_auto";
  return "📄 Conta recebida! Agora me envie a foto do seu *documento com foto*:\n\n🪪 *CNH* → só a *frente*\n🆔 *RG* → *frente e verso*\n\nFotos *nítidas*, por favor ✅";
}

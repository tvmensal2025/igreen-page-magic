/**
 * Sofia Multicanal (Grupo A): após OCR da conta → documento direto.
 * Sem re-explicar economia (a3) nem pedir cadastrar de novo.
 */

import { isSofiaMulticanalCustomer } from "./cadastro-fixes.ts";

export const SOFIA_DOC_STEP_KEY = "a7_ask_document";

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
  customer: { name?: string | null },
): Record<string, string> {
  const first = String(customer.name || "").trim().split(/\s+/)[0] || "Cliente";
  return {
    "{nome}": first,
    "{{nome}}": first,
    name: first,
  };
}

/**
 * Conta OCR ok → confirma automaticamente e despacha a7 (documento).
 * Retorna true se aplicou (Sofia A/C); false = caller segue fluxo legado.
 */
export async function advanceSofiaToDocumentAfterBill(opts: {
  customer: { flow_variant?: string | null; conversation_step?: string | null; name?: string | null };
  updates: Record<string, unknown>;
  dispatchStep: (stepKey: string, vars: Record<string, string>) => Promise<unknown>;
  logPrefix?: string;
}): Promise<boolean> {
  const merged = { ...opts.customer, ...opts.updates };
  if (!isSofiaPostBillCadastro(merged)) return false;

  if (!opts.updates.bill_data_confirmed_at) {
    opts.updates.bill_data_confirmed_at = new Date().toISOString();
  }
  opts.updates.bill_data_confirmation_by = "auto_sofia";
  opts.updates.conversation_step = "aguardando_doc_auto";

  const vars = buildSofiaDispatchNameVars(merged);
  try {
    await opts.dispatchStep(SOFIA_DOC_STEP_KEY, vars);
    opts.updates.__inline_sent = true;
    console.log(
      `[${opts.logPrefix || "sofia-post-bill"}] conta→documento direto (sem simulação a3) name=${vars["{{nome}}"]}`,
    );
    return true;
  } catch (e) {
    console.warn(`[sofia-post-bill] dispatch ${SOFIA_DOC_STEP_KEY} falhou:`, (e as Error).message);
    return false;
  }
}

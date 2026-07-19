/**
 * Sofia Multicanal (Grupo A): após OCR da conta → documento direto.
 * Sem re-explicar economia (a3) nem pedir cadastrar de novo.
 */

import { isSofiaMulticanalCustomer } from "./cadastro-fixes.ts";
import { safeFirstNameForAddress } from "../customer-display-name.ts";

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

/**
 * Conta OCR ok → confirma automaticamente e despacha a7 (documento).
 * Retorna true se aplicou (Sofia A/C); false = caller segue fluxo legado.
 */
/**
 * DESATIVADO (2026-07-18): o cliente pediu que a confirmação dos dados
 * da conta seja SEMPRE feita pela pessoa (igual Fluxo D), nunca pelo bot.
 * Retornar `false` faz o caller cair no fluxo padrão `confirmando_dados_conta`
 * que envia botões SIM / NÃO / EDITAR ao lead e só avança quando ele responde
 * → simulação → "Quero me cadastrar" → documento → Portal → OTP → link facial.
 *
 * Mantido como no-op para preservar as importações existentes.
 */
export async function advanceSofiaToDocumentAfterBill(_opts: {
  customer: { flow_variant?: string | null; conversation_step?: string | null; name?: string | null };
  updates: Record<string, unknown>;
  dispatchStep: (stepKey: string, vars: Record<string, string>) => Promise<unknown>;
  logPrefix?: string;
}): Promise<boolean> {
  return false;
}

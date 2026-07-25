/**
 * Espelho edge de `src/lib/crmVsLeadAnalysis.ts`.
 * CRM cadastro em análise ≠ lead em conversa ≠ Meta em análise.
 * Cadência A/B/C NÃO deve outreach quem já submeteu cadastro / está pós-portal.
 */

export const CRM_CADASTRO_EM_ANALISE_STEPS = [
  "cadastro_em_analise",
  "portal_submitting",
  "finalizando",
  "finalizando_cadastro",
  "aguardando_otp",
  "validando_otp",
  "aguardando_facial",
  "aguardando_assinatura",
  "complete",
  "portal_submitted",
  "registered_igreen",
] as const;

export type CustomerAnalysisSignals = {
  conversation_step?: string | null;
  portal_submitted_at?: string | null;
  status?: string | null;
  do_not_contact?: boolean | null;
  paused_reason?: string | null;
};

const CRM_STEP_SET = new Set<string>(CRM_CADASTRO_EM_ANALISE_STEPS);

export function normalizeConversationStep(step: string | null | undefined): string {
  return String(step || "").trim().toLowerCase();
}

/** Já na esteira iGreen (cadastro enviado / OTP / facial / assinatura). */
export function isCrmCadastroEmAnalise(c: CustomerAnalysisSignals): boolean {
  if (c.portal_submitted_at) return true;
  const step = normalizeConversationStep(c.conversation_step);
  if (CRM_STEP_SET.has(step)) return true;
  return false;
}

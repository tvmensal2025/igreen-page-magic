/**
 * Regra canônica: NUNCA misturar estes três "em análise".
 *
 * 1) LEAD EM CONVERSA (Grupo A / pizza A)
 *    — lead novo falando no WhatsApp, ainda coletando dados.
 *    — sinais: cadence NEW | GREETED | AI_QUALIFYING | PAUSED(A)
 *    — NÃO tem portal enviado / cadastro na iGreen.
 *
 * 2) CRM ATIVO — CADASTRO EM ANÁLISE
 *    — já submeteu o cadastro; aguarda iGreen (24–48h), facial, assinatura.
 *    — sinais: conversation_step pós-portal OU portal_submitted_at.
 *    — mora no Kanban CRM (finalizando) / pós-venda — NÃO na pizza A.
 *
 * 3) META — CAMPANHA EM ANÁLISE
 *    — anúncio pending_review na Meta. Zero relação com customer/lead.
 *
 * `customers.status = pending` É AMBÍGUO (serve para 1 e 2).
 * Nunca use só `status` para decidir o bucket.
 */

/** Steps do bot/portal = cadastro já na esteira iGreen (CRM ativo). */
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
] as const;

export type CrmCadastroEmAnaliseStep = (typeof CRM_CADASTRO_EM_ANALISE_STEPS)[number];

const CRM_STEP_SET = new Set<string>(CRM_CADASTRO_EM_ANALISE_STEPS);

/** Estágios de cadência = lead ainda em conversa / pré-onda (Grupo A). */
export const LEAD_EM_CONVERSA_CADENCE_STAGES = [
  "NEW",
  "GREETED",
  "AI_QUALIFYING",
] as const;

export type LeadVsCrmBucket =
  | "lead_em_conversa"
  | "crm_cadastro_em_analise"
  | "meta_campanha_em_analise"
  | "outro";

export type CustomerAnalysisSignals = {
  conversation_step?: string | null;
  portal_submitted_at?: string | null;
  status?: string | null;
  /** Bloqueio “nunca mais contatar” (Não Perturbe). */
  do_not_contact?: boolean | null;
  /** Motivo da pausa na cadência — ex.: dnc. */
  paused_reason?: string | null;
  /** Só para documentação / UI Meta — não vem de customers. */
  meta_campaign_status?: string | null;
};

/**
 * Nunca mais contatar (Não Perturbe).
 * Evite a sigla DNC na UI — use “bloqueado” / “nunca mais contatar”.
 */
export function isNuncaMaisContatar(c: CustomerAnalysisSignals): boolean {
  if (c.do_not_contact === true) return true;
  const reason = String(c.paused_reason || "").trim().toLowerCase();
  return reason === "dnc" || reason === "opt_out" || reason.startsWith("dnc:");
}

/** Normaliza step (aceita `flow:uuid` prefixo só se for legado puro). */
export function normalizeConversationStep(step: string | null | undefined): string {
  return String(step || "").trim().toLowerCase();
}

/**
 * Cliente já está no CRM ativo “em análise” (cadastro enviado / pós-portal).
 * Prioridade máxima sobre AI_QUALIFYING residual.
 */
export function isCrmCadastroEmAnalise(c: CustomerAnalysisSignals): boolean {
  if (c.portal_submitted_at) return true;
  const step = normalizeConversationStep(c.conversation_step);
  if (CRM_STEP_SET.has(step)) return true;
  return false;
}

/** Campanha Meta em revisão — nunca misturar com customer. */
export function isMetaCampanhaEmAnalise(
  metaStatus: string | null | undefined,
): boolean {
  const s = String(metaStatus || "").toLowerCase();
  return s === "pending_review" || s === "in_process" || s === "in_review";
}

/**
 * Elegível à pizza A / ciclo de lead novo?
 * Exige: não CRM em análise; não bloqueado (nunca mais contatar).
 * Demais filtros (origem, status funil) ficam no caller.
 */
export function isLeadCycleEligibleNotCrmAnalysis(c: CustomerAnalysisSignals): boolean {
  if (isNuncaMaisContatar(c)) return false;
  return !isCrmCadastroEmAnalise(c);
}

/** Classifica o bucket sem olhar cadence stage (só sinais de customer/Meta). */
export function classifyAnalysisBucket(c: CustomerAnalysisSignals): LeadVsCrmBucket {
  if (isMetaCampanhaEmAnalise(c.meta_campaign_status)) return "meta_campanha_em_analise";
  if (isCrmCadastroEmAnalise(c)) return "crm_cadastro_em_analise";
  return "outro";
}

export const ANALYSIS_BUCKET_LABEL: Record<LeadVsCrmBucket, string> = {
  lead_em_conversa: "Lead em conversa (validar no chat)",
  crm_cadastro_em_analise: "CRM — cadastro em análise (iGreen)",
  meta_campanha_em_analise: "Meta — campanha em análise",
  outro: "Outro",
};

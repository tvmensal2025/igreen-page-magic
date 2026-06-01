/**
 * Cadastro step registry — materializes `cadastro-steps-audit.md`.
 *
 * Spec: `bot-engine-channel-unification` (Requisitos 3.4, 3.5, 3.6).
 *
 * Source of truth:
 *   `.kiro/specs/bot-engine-channel-unification/cadastro-steps-audit.md`
 *
 * Distribution (as decided by SuperAdmin in single QA round):
 *   - 42 `cadastro-only`
 *   -  6 `híbrido`
 *   - 48 total
 *
 * The unified engine consults `classifyStep(stepKey)` to decide
 * how to dispatch a step:
 *
 *   - `pipeline`         → delegate directly to `PipelineCadastroHook`
 *                          (cadastro-only steps; ignore `bot_flow_steps.transitions`).
 *   - `transition_first` → try `matchTransition` against `bot_flow_steps.transitions`
 *                          first; fall back to `PipelineCadastroHook` only when
 *                          `matchTransition` returns null.
 *
 * `transition_first` covers two cases:
 *   1. Steps explicitly classified as `híbrido` in the audit (6 steps).
 *   2. Steps not declared in this registry at all (purely conversational
 *      steps read from `bot_flow_steps`).
 *
 * Note: `editing_doc_pai` and `editing_doc_mae` are kept here as
 * `cadastro-only` per the audit — they are declared in `CADASTRO_STEPS`
 * but have zero call sites in either `bot-flow.ts`. They will be removed
 * during the cleanup phase (Requisito 3.8 + 11.6).
 */

export type CadastroStepCategory = "cadastro-only" | "híbrido";
export type StepClassification = "pipeline" | "transition_first";

export const CADASTRO_STEP_REGISTRY: Record<string, CadastroStepCategory> = {
  // ─── 42 cadastro-only ────────────────────────────────────────────────────

  // OCR conta (3)
  aguardando_conta: "cadastro-only",
  processando_ocr_conta: "cadastro-only",
  confirmando_dados_conta: "cadastro-only",

  // OCR documento (6)
  ask_tipo_documento: "cadastro-only",
  aguardando_doc_auto: "cadastro-only",
  aguardando_doc_frente: "cadastro-only",
  aguardando_doc_verso: "cadastro-only",
  confirmando_dados_doc: "cadastro-only",
  confirmar_titularidade: "cadastro-only",

  // Coleta de dados pessoais e endereço (12)
  ask_name: "cadastro-only",
  ask_cpf: "cadastro-only",
  ask_rg: "cadastro-only",
  ask_birth_date: "cadastro-only",
  ask_phone_confirm: "cadastro-only",
  ask_phone: "cadastro-only",
  ask_email: "cadastro-only",
  ask_cep: "cadastro-only",
  ask_number: "cadastro-only",
  ask_complement: "cadastro-only",
  ask_installation_number: "cadastro-only",
  ask_distribuidora: "cadastro-only",
  ask_bill_value: "cadastro-only",

  // Portal + OTP + facial + assinatura + fechamento (7)
  portal_submitting: "cadastro-only",
  aguardando_otp: "cadastro-only",
  validando_otp: "cadastro-only",
  aguardando_facial: "cadastro-only",
  aguardando_assinatura: "cadastro-only",
  cadastro_em_analise: "cadastro-only",
  complete: "cadastro-only",

  // Edição pós-OCR conta (7)
  editing_conta_menu: "cadastro-only",
  editing_conta_nome: "cadastro-only",
  editing_conta_endereco: "cadastro-only",
  editing_conta_cep: "cadastro-only",
  editing_conta_distribuidora: "cadastro-only",
  editing_conta_instalacao: "cadastro-only",
  editing_conta_valor: "cadastro-only",

  // Edição pós-OCR documento (7 — `editing_doc_pai`/`_mae` órfãos serão
  // removidos na fase cleanup, ver Requisito 3.8)
  editing_doc_menu: "cadastro-only",
  editing_doc_nome: "cadastro-only",
  editing_doc_cpf: "cadastro-only",
  editing_doc_rg: "cadastro-only",
  editing_doc_nascimento: "cadastro-only",
  editing_doc_pai: "cadastro-only",
  editing_doc_mae: "cadastro-only",

  // ─── 6 híbrido ───────────────────────────────────────────────────────────
  // Cada um destes pode ser resolvido por uma transition em
  // `bot_flow_steps.transitions`; se nenhuma casar, o pipeline-cadastro
  // assume.
  ask_doc_frente_manual: "híbrido",
  ask_doc_verso_manual: "híbrido",
  ask_quero_cadastrar: "híbrido",
  ask_finalizar: "híbrido",
  finalizando: "híbrido",
  aguardando_humano: "híbrido",
};

/**
 * Pure classification of a step key into the dispatch lane the unified
 * engine should take.
 *
 * Contract:
 *   - `null` step key      → `transition_first` (cold start / unknown).
 *   - declared cadastro-only → `pipeline`.
 *   - declared híbrido       → `transition_first`.
 *   - not declared            → `transition_first` (conversational step).
 */
export function classifyStep(stepKey: string | null): StepClassification {
  if (stepKey === null) return "transition_first";
  const category = CADASTRO_STEP_REGISTRY[stepKey];
  if (category === "cadastro-only") return "pipeline";
  // `híbrido` OR step_key not in the registry → try transitions first.
  return "transition_first";
}

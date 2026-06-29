/**
 * Guard de retomada do cadastro.
 *
 * Motivação (bug 2026-06-28, lead JONATAS 5511971254913):
 * Quando o `conversation_step` é resetado para `welcome`/`null`/`d_welcome`
 * (re-welcome rule, step-mismatch-cure, fluxo-B bypass, routeEngineV2 reset,
 * etc.) por qualquer motivo, o bot reiniciava o fluxo do zero e pedia a foto
 * da conta de novo — mesmo quando `customers` já tinha conta+doc+CPF+e-mail
 * confirmados. O cliente perdia toda a percepção de progresso e travava o
 * portal2.
 *
 * Este helper detecta esse cenário (step de abertura + cadastro avançado já
 * preenchido) e devolve o próximo passo PENDENTE do cadastro, calculado por
 * `getNextMissingStep` (fonte de verdade já compartilhada por whapi e
 * evolution). Os dois webhooks aplicam o guard ANTES de qualquer engine,
 * forçando o roteamento para o pipeline determinístico de cadastro
 * (`bot-flow.ts`) — que sabe avançar dali sem pedir nada que já temos.
 *
 * Sem efeitos colaterais: não escreve no banco aqui, não envia mensagens.
 * Quem chama decide o que persistir (update + transition log).
 */

import { getNextMissingStep, hasBillData } from "../conversation-helpers.ts";

// Steps que indicam "fluxo voltou para a abertura" e portanto candidatos a
// pular para o cadastro se o lead já tem dados. NÃO inclui passos do meio do
// cadastro determinístico (ask_*, aguardando_*) nem passos pós-cadastro
// (aguardando_otp, validando_otp, cadastro_em_analise, complete, etc.).
const OPENING_STEPS = new Set<string>([
  "",
  "welcome",
  "menu_inicial",
  "d_welcome",
  "novo_lead",
  "apresentacao",
  "qualificacao",
]);

// Status finalizados/pós-cadastro: nunca retomar — o lead já passou do
// portal e não pode ser jogado de volta no pipeline de coleta.
const TERMINAL_OR_POST_STATUSES = new Set<string>([
  "registered_igreen",
  "cadastro_concluido",
  "awaiting_signature",
  "awaiting_facial",
  "active",
  "approved",
  "complete",
  "pending_portal2",
  "portal_submitting",
  "needs_human",
  "needs_review",
]);

// Steps "avançados" do cadastro determinístico. Se `getNextMissingStep`
// devolve algum deles, é porque o lead JÁ está fundo no funil — tirar do
// welcome e seguir.
const ADVANCED_PENDING_STEPS = new Set<string>([
  "ask_rg",
  "ask_birth_date",
  "ask_phone_confirm",
  "ask_email",
  "ask_cep",
  "ask_number",
  "ask_complement",
  "ask_distribuidora",
  "ask_installation_number",
  "ask_bill_value",
  "ask_doc_frente_manual",
  "ask_doc_verso_manual",
  "ask_finalizar",
  "finalizando",
]);

export type ResumeDecision = {
  nextStep: string;
  reason: string;
};

/**
 * Decide se o `conversation_step` atual deve ser substituído pelo próximo
 * passo pendente do cadastro. Retorna `null` quando não há nada a fazer.
 *
 * @param customer Linha de `customers` (precisa dos campos de identidade,
 *                 endereço, documentos e conta de luz).
 * @param opts.currentStep Passo cru (já pode ter sido normalizado para
 *                 "welcome" por outro código). Se omitido usa
 *                 `customer.conversation_step`.
 * @param opts.consultorEmail Para impedir que o e-mail do consultor seja
 *                 aceito como e-mail do lead (mesma regra do
 *                 `getNextMissingStep`).
 */
export function shouldResumeCadastro(
  // deno-lint-ignore no-explicit-any
  customer: any,
  opts: {
    currentStep?: string | null | undefined;
    consultorEmail?: string | null;
  } = {},
): ResumeDecision | null {
  if (!customer) return null;

  const status = String(customer.status || "").toLowerCase();
  if (TERMINAL_OR_POST_STATUSES.has(status)) return null;

  const step = String(
    opts.currentStep ?? customer.conversation_step ?? "",
  )
    .replace(/^flow:/, "")
    .trim()
    .toLowerCase();

  if (!OPENING_STEPS.has(step)) return null;

  // Sanity: precisa ter pelo menos NOME + (CPF ou conta REAL — não
  // estimativa da rápida) para considerar "lead avançado". Lead 100% novo
  // não dispara o guard.
  const hasName = !!String(customer.name || "").trim();
  const hasCpf = !!String(customer.cpf || "").trim();
  const hasBillReal = hasBillData(customer);
  if (!hasName) return null;
  if (!hasCpf && !hasBillReal) return null;

  let next: string;
  try {
    next = getNextMissingStep(customer, {
      consultorEmail: opts.consultorEmail ?? null,
    });
  } catch (_) {
    return null;
  }

  // `ask_name` significa cadastro vazio — não retoma (deixa o welcome rolar).
  if (!next || next === "ask_name" || next === "ask_cpf") return null;

  // Se o helper devolveu algo do cadastro avançado, vale a pena retomar.
  if (!ADVANCED_PENDING_STEPS.has(next)) return null;

  return {
    nextStep: next,
    reason: `resume_cadastro:opening_step→${next}`,
  };
}

/**
 * Mensagem curta para acompanhar a retomada (opcional — quem chama decide
 * se envia). Não inclui detalhes do step para não vazar prompts internos.
 */
export function resumeAcknowledgement(customer: any): string {
  const first = String(customer?.name || "").trim().split(/\s+/)[0] || "";
  const voc = first ? `${first}, ` : "";
  return `📋 *Voltando ao seu cadastro:* ${voc}já tenho seus dados aqui. Vou continuar de onde paramos 👍`;
}

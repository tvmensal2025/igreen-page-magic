// Step namespace helper.
//
// FONTE ÚNICA (unificação webhooks): este arquivo é a fonte canônica.
// `whapi-webhook/handlers/step-namespace.ts` e
// `evolution-webhook/handlers/step-namespace.ts` apenas reexportam daqui
// (eram cópias idênticas — confirmado por diff = 0).
//
// Estratégia minimalista: APENAS passos do FlowBuilder ganham prefixo "flow:".
// Passos canônicos do bot-flow.ts (welcome, qualificacao, aguardando_conta, etc.)
// continuam como nomes crus para manter compat com as outras 11 edge functions
// (worker-callback, recover-stuck-otp, ai-followup-cron, bot-stuck-recovery, etc.).
//
// Bug que isso resolve: customer.conversation_step gravado como UUID (id do
// bot_flow_steps) ou "passo_<ts>" colide com os nomes hardcoded do bot-flow.ts.
// Sem prefixo, o orchestrator não consegue rotear corretamente e o conversational
// handler não acha o step na primeira lookup, entrando em loop "unknown step → restart".

export type Engine = "sys" | "flow";

const FLOW_PREFIX = "flow:";

export function isFlowStep(raw: string | null | undefined): boolean {
  return !!raw && raw.startsWith(FLOW_PREFIX);
}

/** Strip prefixo para uso interno dos engines (que esperam o nome cru). */
export function stripPrefix(raw: string | null | undefined): string {
  if (!raw) return "welcome";
  if (raw.startsWith(FLOW_PREFIX)) return raw.slice(FLOW_PREFIX.length);
  return raw;
}

/**
 * Decide qual engine deve processar este step.
 * - Tem prefixo "flow:" → motor conversacional DB-driven
 * - Qualquer outra coisa (nome canônico cru) → motor determinístico bot-flow.ts
 *
 * Heurística de compat reversa: se o valor parecer UUID ou "passo_xxx" mesmo
 * sem prefixo (legacy), também rota para flow.
 */
export function routeEngine(raw: string | null | undefined): Engine {
  if (!raw) return "sys";
  if (raw.startsWith(FLOW_PREFIX)) return "flow";
  // Compat: customers antigos com UUID ou "passo_xxx" salvo direto sem prefixo
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return "flow";
  if (raw.startsWith("passo_")) return "flow";
  return "sys";
}

/**
 * Garante prefixo correto na escrita.
 * - sys engine: grava nome cru (sem prefixo) — compat com workers/cron/OTP.
 * - flow engine: prefixa "flow:" APENAS quando o valor parecer id de step
 *   dinâmico (UUID ou "passo_xxx"). Se o conversational devolveu um nome
 *   canônico do cadastro (ex.: "aguardando_conta" via stepTypeToCadastro),
 *   mantém cru — assim a próxima mensagem é roteada pro sys engine.
 */
export function normalizeOutgoing(raw: string | null | undefined, engine: Engine): string | null {
  if (!raw) return null;
  if (engine === "sys") return stripPrefix(raw);
  // engine === "flow"
  if (raw.startsWith(FLOW_PREFIX)) return raw;
  const looksLikeFlowId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ||
    raw.startsWith("passo_");
  return looksLikeFlowId ? FLOW_PREFIX + raw : raw;
}

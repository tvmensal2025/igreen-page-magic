// Flow router — utilitários compartilhados que decidem (i) qual motor de
// conversa atende o cliente, (ii) qual transição de step casa com o input
// recebido, e (iii) se há intenção forte de migrar para outro fluxo (ex.
// PJ, Licenciada).
//
// Este módulo é pura função: zero efeito colateral além da leitura de
// `flow_router_rules` em `detectFlowSwitch`. As funções `routeEngine` e
// `matchTransition` são determinísticas e podem ser chamadas a quente
// pelos webhooks.
//
// Bugfix: ver `whatsapp-flow-reliability-fix` tasks 18 (2.12) e 20 (2.15).

// ─── 1) Engine routing (cláusula 2.12) ─────────────────────────────────

/**
 * Steps que pertencem ao pipeline de cadastro determinístico (`bot-flow.ts`
 * legado). Duplicado a partir de
 * `evolution-webhook/handlers/conversational/index.ts` e
 * `whapi-webhook/handlers/conversational/index.ts` de propósito: o
 * `_shared` não pode importar dos handlers (dependência inversa).
 *
 * Manter a lista sincronizada com os handlers — o teste co-localizado
 * verifica que todos os steps esperados estão presentes.
 */
export const CADASTRO_STEPS: ReadonlySet<string> = new Set([
  "aguardando_conta",
  "processando_ocr_conta",
  "confirmando_dados_conta",
  "ask_tipo_documento",
  "aguardando_doc_auto",
  "aguardando_doc_frente",
  "aguardando_doc_verso",
  "confirmando_dados_doc",
  "confirmar_titularidade",
  "ask_name",
  "ask_cpf",
  "ask_rg",
  "ask_birth_date",
  "ask_phone_confirm",
  "ask_phone",
  "ask_email",
  "ask_cep",
  "ask_number",
  "ask_complement",
  "ask_installation_number",
  "ask_bill_value",
  "ask_doc_frente_manual",
  "ask_doc_verso_manual",
  // CTA pós-simulação (gate entre "confirmar conta" e "pedir documento").
  // Sem isso o router troca pro engine flow e o state-machine legado dispara
  // ENTER_CADASTRO (pede conta de novo) em vez de cair no handler
  // ask_quero_cadastrar do bot-flow.ts que despacha capture_documento.
  "ask_quero_cadastrar",
  "ask_finalizar",
  "finalizando",
  "portal_submitting",
  // Loop de correção Portal 2 (portal2-ocr-feedback-loop): steps que pedem o
  // dado rejeitado ao cliente. Precisam ficar no engine sys (determinístico),
  // espelhando portal_submitting — senão o router trocaria pro engine flow.
  "corrigir_celular_portal",
  "corrigir_email_portal",
  "corrigir_instalacao_portal",
  "aguardando_otp",
  "validando_otp",
  "aguardando_facial",
  "aguardando_assinatura",
  "cadastro_em_analise",
  "complete",
  "aguardando_humano",
  // Edição pós-OCR (conta de luz)
  "editing_conta_menu",
  "editing_conta_nome",
  "editing_conta_endereco",
  "editing_conta_cep",
  "editing_conta_distribuidora",
  "editing_conta_instalacao",
  "editing_conta_valor",
  // Edição pós-OCR (documento)
  "editing_doc_menu",
  "editing_doc_nome",
  "editing_doc_cpf",
  "editing_doc_rg",
  "editing_doc_nascimento",
  "editing_doc_pai",
  "editing_doc_mae",
]);

export type Engine = "sys" | "flow";

const FLOW_PREFIX = "flow:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove o prefixo `flow:` quando presente. Retorna `welcome` para nulo/vazio. */
export function stripPrefix(raw: string | null | undefined): string {
  if (!raw) return "welcome";
  if (raw.startsWith(FLOW_PREFIX)) return raw.slice(FLOW_PREFIX.length);
  return raw;
}

export interface RouteEngineInput {
  /** Valor cru de `customers.conversation_step` (com ou sem prefixo). */
  currentStep: string | null | undefined;
  /** `consultants.conversational_flow_enabled` para o consultor dono do customer. */
  conversationalFlowEnabled: boolean;
  /**
   * `customers.conversational_flow_enabled` — override por cliente.
   * `false` força engine `sys`; `null`/`undefined`/`true` segue o flag do consultor.
   */
  customerOverride?: boolean | null;
}

export interface RouteEngineResult {
  engine: Engine;
  /** Step normalizado (sem prefixo). `null` quando o customer foi mandado para reset. */
  step: string | null;
}

/**
 * Decide qual motor processa este turno.
 *
 * Invariante crítica (2.12): se o customer está em um passo do pipeline
 * de cadastro (`CADASTRO_STEPS`), o resultado é sempre
 * `{ engine: 'sys', step: currentStep }`, **independente** do valor de
 * `conversationalFlowEnabled` ou `customerOverride`. Sem essa proteção,
 * um toggle de flag durante a conversa zera o `conversation_step` e o
 * cliente recomeça o cadastro do zero.
 *
 * Para os demais steps:
 * - Prefixo `flow:`, UUID ou `passo_*` → engine `flow`.
 * - Caso contrário → engine `sys`.
 * - Quando engine inferida é `flow` mas o flag está desligado (consultor
 *   ou customer), reset para `{ engine: 'sys', step: 'welcome' }`.
 */
export function routeEngine(input: RouteEngineInput): RouteEngineResult {
  const raw = input.currentStep ?? null;
  const stripped = stripPrefix(raw);

  // 2.12 — preserva passo de cadastro mesmo se a flag mudou.
  if (raw && CADASTRO_STEPS.has(stripped)) {
    return { engine: "sys", step: stripped };
  }

  // Inferência de engine pela forma do step.
  let engine: Engine = "sys";
  if (raw) {
    if (raw.startsWith(FLOW_PREFIX)) engine = "flow";
    else if (UUID_RE.test(raw)) engine = "flow";
    else if (raw.startsWith("passo_")) engine = "flow";
  }

  const flagOff = !input.conversationalFlowEnabled || input.customerOverride === false;

  // Engine seria flow, mas a flag está desligada → reseta para welcome em sys.
  if (engine === "flow" && flagOff) {
    return { engine: "sys", step: "welcome" };
  }

  // Quando não há step (cliente novo), o engine padrão é sys com step null.
  if (!raw) {
    return { engine: "sys", step: null };
  }

  return { engine, step: stripped };
}

// ─── 2) Transition matching com buttonId (cláusula 2.15) ───────────────

export interface FlowTransition {
  trigger_intent?: string | null;
  trigger_phrases?: string[] | null;
  goto_step_id?: string | null;
  goto_special?: string | null;
}

/**
 * Valores reconhecidos como `goto_special` em `bot_flow_steps.transitions`.
 * Mantido em lower-case; comparação faz `toLowerCase().trim()` em ambos os
 * lados para tolerar maiúsculas vindas do FlowBuilder.
 */
export const SPECIAL_GOTO_VALUES: ReadonlySet<string> = new Set([
  "cadastro",
  "humano",
  "menu",
  "repeat",
  "ai",
]);

export interface MatchTransitionInput {
  transitions: FlowTransition[] | null | undefined;
  /** ID do botão clicado pelo cliente (vazio quando o input foi texto livre). */
  buttonId?: string | null;
  /** Texto livre do cliente (mantido como fallback de matching). */
  messageText?: string | null;
  /** Botões visíveis no passo atual, na mesma ordem em que foram enviados. */
  buttons?: Array<{ id?: string | null; title?: string | null }> | null;
  /** Intents derivadas do classificador / regex; opcionais. */
  intents?: string[];
}

function _norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

/**
 * Casa o input do cliente contra as `transitions` configuradas no step.
 *
 * Ordem de prioridade (2.15):
 *   (a) `buttonId` casa com algum item de `transition.trigger_phrases`
 *       (case-insensitive, trim);
 *   (b) `buttonId` é igual a um `goto_special` reconhecido (ex.
 *       `cadastro`, `humano`, `menu`);
 *   (c) match por intent (`trigger_intent`);
 *   (d) `messageText` contém alguma `trigger_phrase` (legacy).
 *
 * O passo (a)+(b) ocorre apenas quando `buttonId` está presente, evitando
 * que mensagens textuais que coincidam com nomes de botões disparem
 * transições inesperadas.
 */
export function matchTransition(input: MatchTransitionInput): FlowTransition | null {
  const transitions = Array.isArray(input.transitions) ? input.transitions : [];
  if (!transitions.length) return null;

  const buttonId = _norm(input.buttonId);
  const messageText = _norm(input.messageText);
  const visibleButtons = Array.isArray(input.buttons) ? input.buttons : [];
  const intents = input.intents ?? [];

  let resolvedButtonId = buttonId;
  if (!resolvedButtonId && messageText && visibleButtons.length) {
    const n = Number((messageText.match(/^([1-9])(?:\D|$)/) || [])[1] || 0);
    const btn = n > 0 ? visibleButtons[n - 1] : null;
    if (btn?.id) resolvedButtonId = _norm(btn.id);
  }

  // (a) buttonId em trigger_phrases.
  if (resolvedButtonId) {
    for (const t of transitions) {
      const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
      for (const p of phrases) {
        if (_norm(p) === resolvedButtonId) return t;
      }
    }

    // (b) buttonId em goto_special.
    for (const t of transitions) {
      const sp = _norm(t.goto_special);
      if (!sp) continue;
      if (sp === resolvedButtonId && SPECIAL_GOTO_VALUES.has(sp)) return t;
    }
  }

  // (c) intent match.
  if (intents.length) {
    for (const t of transitions) {
      const intent = (t.trigger_intent || "").trim();
      if (!intent || intent === "default" || intent === "palavra_chave") continue;
      if (intents.includes(intent)) return t;
    }
  }

  // (d) messageText fallback.
  if (messageText) {
    for (const t of transitions) {
      const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
      for (const p of phrases) {
        const needle = _norm(p);
        if (needle && messageText.includes(needle)) return t;
      }
    }
  }

  return null;
}

// ─── 3) Detecção de troca de fluxo (PJ, Licenciada, …) ─────────────────

export interface FlowRouterRule {
  id: string;
  consultant_id: string | null;
  trigger_keywords: string[];
  target_flow_key: string;
  target_flow_label: string;
  priority: number;
  is_active: boolean;
}

export interface FlowSwitchCandidate {
  rule_id: string;
  target_flow_key: string;
  target_flow_label: string;
  matched_keyword: string;
}

const CACHE_TTL_MS = 60_000;
let cacheAt = 0;
let cache: FlowRouterRule[] = [];

async function loadRules(supabase: any): Promise<FlowRouterRule[]> {
  const now = Date.now();
  if (cache.length && now - cacheAt < CACHE_TTL_MS) return cache;
  try {
    const { data } = await supabase
      .from("flow_router_rules")
      .select("id, consultant_id, trigger_keywords, target_flow_key, target_flow_label, priority, is_active")
      .eq("is_active", true)
      .order("priority", { ascending: false });
    cache = (data as FlowRouterRule[]) || [];
    cacheAt = now;
  } catch (e) {
    console.warn("[flow-router] load rules falhou:", (e as Error).message);
  }
  return cache;
}

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export async function detectFlowSwitch(
  supabase: any,
  consultantId: string | null,
  text: string,
  currentFlowKey: string | null,
): Promise<FlowSwitchCandidate | null> {
  if (!text || text.length < 2) return null;
  const rules = await loadRules(supabase);
  if (!rules.length) return null;
  const t = normalizeText(text);

  const applicable = rules.filter(r => r.consultant_id === null || r.consultant_id === consultantId);

  for (const r of applicable) {
    for (const kw of r.trigger_keywords || []) {
      const k = normalizeText(kw);
      if (!k) continue;
      // Word-boundary match: evita "pj" disparar dentro de "pjotinha"
      const rx = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (rx.test(t)) {
        if (currentFlowKey && currentFlowKey === r.target_flow_key) return null; // já está nesse fluxo
        return {
          rule_id: r.id,
          target_flow_key: r.target_flow_key,
          target_flow_label: r.target_flow_label,
          matched_keyword: kw,
        };
      }
    }
  }
  return null;
}

export function clearFlowRouterCache() {
  cache = [];
  cacheAt = 0;
}

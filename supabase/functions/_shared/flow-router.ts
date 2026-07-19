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
  "ask_distribuidora",
  "ask_bill_value",
  "ask_doc_frente_manual",
  "ask_doc_verso_manual",
  // CTA pós-simulação (gate entre "confirmar conta" e "pedir documento").
  // Sem isso o router troca pro engine flow e o state-machine legado dispara
  // ENTER_CADASTRO (pede conta de novo) em vez de cair no handler
  // ask_quero_cadastrar do bot-flow.ts que despacha capture_documento.
  "ask_quero_cadastrar",
  "ask_contaunica",
  "ask_transferir_titularidade",
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
  // Lowercase + trim + strip diacritics (NFD) para que "rápida" == "rapida".
  // Sem isso, botões com acento (`💡 Simulação rápida`) não casam com
  // phrases cadastradas sem acento (e vice-versa) e o lead cai no fallback
  // default — bug que jogava leads em `d_como_funciona` no passo
  // `d_escolher_simulacao`.
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Stopwords curtas/ambíguas que nunca devem disparar uma transição sozinhas
 * via fallback de texto livre. "ok", "sim", "nao" casariam em quase qualquer
 * frase do lead. Buttons exatos continuam funcionando — esta lista só corta
 * o passo (d) `messageText.includes`.
 */
const TEXT_FALLBACK_STOPWORDS: ReadonlySet<string> = new Set([
  "nao", "sim", "ok", "oi", "ola", "eai", "opa",
  "e", "a", "o", "de", "da", "do",
]);

/** Compara qualquer phrase contra o texto do lead com limite de palavra para
 *  termos curtos (≤4 chars) e substring para frases mais longas. Isso evita
 *  que "conta" case dentro de "encontrar" e que "2" case em "2025". */
function _phraseMatchesText(needle: string, hay: string): boolean {
  if (!needle || !hay) return false;
  if (TEXT_FALLBACK_STOPWORDS.has(needle)) return false;
  if (hay === needle) return true;
  const isShort = needle.length <= 4 || !needle.includes(" ");
  if (isShort) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return rx.test(hay);
  }
  return hay.includes(needle);
}

/** Tamanho da maior `trigger_phrase` normalizada da transition (0 se vazia). */
function _maxPhraseLen(t: FlowTransition): number {
  const phrases = Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [];
  let max = 0;
  for (const p of phrases) {
    const n = _norm(p).length;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Casa o input do cliente contra as `transitions` configuradas no step.
 *
 * Ordem de prioridade (2.15):
 *   (a) `buttonId` casa com algum item de `transition.trigger_phrases`
 *       (case-insensitive, trim) — exata;
 *   (b) `buttonId` é igual a um `goto_special` reconhecido (ex.
 *       `cadastro`, `humano`, `menu`);
 *   (c) match por intent (`trigger_intent`);
 *   (d) `messageText` casa contra alguma `trigger_phrase` — preferindo
 *       a frase MAIS LONGA disponível (mais específica). Word boundary
 *       para tokens curtos.
 *
 * Ambiguidade entre dois passos com gatilhos parecidos (ex.:
 * "Como Funciona 1" e "Como Funciona 2") era resolvida pelo "primeiro que
 * casar", não-determinístico do ponto de vista do super admin. Agora:
 *   - phrases dentro da transition: ordenadas por tamanho desc;
 *   - transitions entre si (passo d): ordenadas pelo tamanho da MAIOR phrase desc;
 *   - empate: a transition com `goto_step_id` vence a que tem só `goto_special`.
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
    // Digitar o título do botão (Evolution sem botão nativo) = clique
    if (!resolvedButtonId) {
      for (const b of visibleButtons) {
        const t = _norm(b.title);
        if (!t) continue;
        if (messageText === t || (t.length >= 4 && (messageText.includes(t) || t.includes(messageText)))) {
          if (b.id) {
            resolvedButtonId = _norm(b.id);
            break;
          }
        }
      }
    }
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

  // (d) messageText fallback — longest-match wins (determinístico).
  if (messageText) {
    // Ordena por (maior phrase desc, depois quem tem goto_step_id desc).
    const ranked = transitions
      .map((t, i) => ({
        t,
        i,
        maxLen: _maxPhraseLen(t),
        hasGotoStep: t.goto_step_id ? 1 : 0,
      }))
      .sort((a, b) => {
        if (b.maxLen !== a.maxLen) return b.maxLen - a.maxLen;
        if (b.hasGotoStep !== a.hasGotoStep) return b.hasGotoStep - a.hasGotoStep;
        return a.i - b.i; // estável
      });

    let best: { t: FlowTransition; len: number; hasGotoStep: number } | null = null;
    for (const { t, hasGotoStep } of ranked) {
      const phrases = (Array.isArray(t.trigger_phrases) ? t.trigger_phrases : [])
        .map(_norm)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
      for (const needle of phrases) {
        if (_phraseMatchesText(needle, messageText)) {
          // mantém a melhor entre todas as transitions
          if (!best || needle.length > best.len ||
              (needle.length === best.len && hasGotoStep > best.hasGotoStep)) {
            best = { t, len: needle.length, hasGotoStep };
          }
          break; // próxima transition (a melhor phrase dela já casou)
        }
      }
    }
    if (best) return best.t;
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

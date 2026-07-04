// Flow Templates — tipos canônicos.
//
// Um *template* é uma receita declarativa que monta um fluxo completo
// (steps + transitions + fallbacks + slot_keys) consistente. O consultor
// escolhe um template no admin e a Edge Function `flow-from-template`
// faz o INSERT em massa em `bot_flows` + `bot_flow_steps`.
//
// Princípios:
//   1. **Consistência por construção**: nenhum goto_step_id pode ficar
//      órfão porque os IDs são gerados juntos no mesmo INSERT batch.
//   2. **Composição**: blocos padrão (pedir_conta_ocr, pedir_documento,
//      etc.) podem ser plugados em qualquer template.
//   3. **Configuração leve**: consultor escolhe estilo (botões/texto),
//      provedor de IA (Gemini/GPT) e quais blocos quer.
//   4. **Sem migration por consultor**: tudo roda nos dados existentes
//      (bot_flows, bot_flow_steps).

export type RenderStyle = "buttons" | "text-numbered" | "list-interactive";
export type AiProviderPref = "google" | "openai" | "none";

/**
 * Bloco padrão = sub-fluxo reutilizável que cumpre uma função específica.
 * Cada bloco gera 1 ou mais steps e cuida das transições entre eles.
 */
export type StandardBlockId =
  | "pedir_conta_ocr"          // capture_conta + OCR + confirmação
  | "pedir_documento_ocr"      // capture_documento + OCR + confirmação
  | "confirmar_email"          // texto livre com regex de email
  | "confirmar_telefone"       // botões "Sim, é esse / Quero outro"
  | "duvidas_ia"               // handler IA com fallback humano
  | "finalizar_cadastro";      // step finalizar_cadastro (envia ao portal)

export interface FlowTemplateBlock {
  id: StandardBlockId;
  enabled: boolean;
  /** Override de texto/mídia para este bloco específico. */
  overrides?: Record<string, string>;
}

export interface FlowTemplateConfig {
  /** Nome amigável do fluxo gerado. */
  flowName: string;
  /** Variante (A/B/C/D) onde o fluxo será criado. */
  variant: "A" | "B" | "C" | "D" | "M";
  /** Estilo de renderização das opções. */
  renderStyle: RenderStyle;
  /** Provedor de IA preferido (afeta button_intent + duvidas_ia). */
  aiProvider: AiProviderPref;
  /** Blocos a incluir. Ordem importa: vira a sequência do fluxo. */
  blocks: FlowTemplateBlock[];
  /** Boas-vindas (passo 1) — opcional, default aplica template. */
  welcomeText?: string;
  /** Pergunta principal de qualificação (passo 2) — opcional. */
  qualifyText?: string;
}

/**
 * Step plano (resultado do template após geração).
 * Mapeia 1:1 para INSERT em bot_flow_steps.
 */
export interface GeneratedStep {
  step_key: string;
  step_type: string;
  position: number;
  is_active: boolean;
  message_text: string | null;
  slot_key: string | null;
  wait_for: "reply" | "none";
  text_delay_ms: number;
  captures: any[] | null;
  transitions: any[] | null;
  fallback: Record<string, any> | null;
}

/**
 * Resultado da geração: lista de steps prontos para INSERT.
 * O caller resolve `flow_id` e gera UUIDs em DB (default).
 */
export interface GeneratedFlow {
  flowName: string;
  variant: "A" | "B" | "C" | "D";
  steps: GeneratedStep[];
  /** Resumo de mídias que precisam ser carregadas (slot_key → descrição). */
  mediaRequirements: Array<{ slot_key: string; description: string }>;
  /** Avisos (ex: bloco X requer mídia Y, fluxo botões precisa Whapi). */
  warnings: string[];
}

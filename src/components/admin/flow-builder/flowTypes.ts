// Tipos e helpers compartilhados entre o editor antigo (FluxoCamila) e o novo
// editor (FlowBuilder). Mantém a forma de dados idêntica para preservar
// compatibilidade total com o engine de runtime (whapi-webhook).

export type IconKey = "msg" | "video" | "sparkle" | "user" | "file";

// Variantes de fluxo — ilimitadas até Z. D continua reservado para o padrão Camila.
export type Variant =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M"
  | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z";
export const ALL_VARIANTS: Variant[] = (
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") as Variant[]
);

export type Transition = {
  trigger_intent: string;
  trigger_phrases: string[];
  goto_step_id: string | null;
  // Mantemos "ai" como valor legado tolerado pela tipagem para preservar
  // compatibilidade com fluxos antigos persistidos em banco. O runtime atual
  // (evolution/whapi handlers) reconhece apenas {"cadastro","humano","repeat"};
  // o renderer do Modo_Diagrama trata "ai" como destino inválido (Aresta_Erro).
  goto_special: "cadastro" | "humano" | "repeat" | "ai" | null;
};

/**
 * Conjunto fechado de valores de `goto_special` reconhecidos pelo runtime de
 * conversational (evolution-webhook e whapi-webhook). Usado pelo Modo_Diagrama
 * (`useDiagramData`) para decidir entre Aresta_Solida (destino para
 * No_Terminal) e Aresta_Erro ("goto_special inválido").
 *
 * Importante: o tipo `Transition.goto_special` ainda lista `"ai"` por
 * compatibilidade com dados legados; este conjunto é a fonte de verdade
 * para validação em runtime de mapping.
 */
export const VALID_GOTO_SPECIAL = ["cadastro", "humano", "repeat"] as const;
export type GotoSpecial = (typeof VALID_GOTO_SPECIAL)[number];

/**
 * Conjunto de `trigger_intent` que o runtime trata como Trigger_Determinístico
 * (sem invocar IA). Qualquer valor fora deste conjunto e fora de string vazia
 * é considerado Trigger_Semantico e renderizado como Aresta_IA no diagrama.
 *
 * Mantém paridade com o comportamento de `flow-router.ts` e dos handlers
 * conversational nos webhooks.
 */
export const DETERMINISTIC_INTENTS: ReadonlySet<string> = new Set([
  "default",
  "palavra_chave",
  "media_received",
]);

/**
 * Retorna `true` quando o `trigger_intent` é determinístico no runtime.
 *
 * - `null`/`undefined`/string vazia → `true` (caso "casa por trigger_phrases
 *   literal", sem classificação semântica).
 * - Valores em `DETERMINISTIC_INTENTS` → `true`.
 * - Qualquer outro valor → `false` (Trigger_Semantico, resolvido por IA).
 */
export function isDeterministicIntent(
  intent: string | null | undefined,
): boolean {
  if (!intent) return true;
  return DETERMINISTIC_INTENTS.has(intent);
}

/**
 * Coordenada de layout persistida em `bot_flow_steps.layout` (jsonb). Cosmética
 * para o Modo_Diagrama — o engine de runtime ignora completamente esta coluna.
 */
export type StepLayout = { x: number; y: number };

export type CaptureField =
  | "name"
  | "electricity_bill_value"
  | "phone_whatsapp"
  | "cpf"
  | "_buttons";

export type Capture = {
  field: CaptureField;
  enabled: boolean;
  value?: { id: string; title: string }[]; // _buttons usa value
};

export type FallbackMode = "repeat" | "goto" | "ai" | "ai_limit";

export type Fallback = {
  mode: FallbackMode;
  goto_step_id?: string | null;
  ai_prompt?: string;
  /** "ai_limit": após N perguntas sem clique, dispara `then` */
  max_questions?: number;
  then?: "humano" | "next" | "repeat";
};


export type Step = {
  id: string;
  flow_id: string;
  position: number;
  step_type: string;
  step_key: string | null;
  title: string;
  summary: string | null;
  icon: IconKey;
  message_text: string | null;
  text_delay_ms: number | null;
  slot_key: string | null;
  transitions: Transition[];
  captures: Capture[];
  fallback: Fallback;
  is_active: boolean;
  auto_detect_doc_type?: boolean;
  /**
   * Ordem/seleção dos tipos de mídia do passo (ex.: ["audio","text"]). Lista de
   * kinds em minúsculas que o runtime usa para decidir QUAIS mídias enviar e em
   * que ordem. Espelha `bot_flow_steps.media_order` (jsonb). Vazio/ausente =
   * comportamento padrão do runtime.
   */
  media_order?: string[] | null;
  /**
   * Coordenadas manuais do passo no Modo_Diagrama. `null`/`undefined` indica
   * que o passo nunca foi posicionado manualmente — o `useDiagramLayout`
   * aplica auto-layout (dagre) para esses casos. Coluna jsonb adicionada por
   * migration; engine de runtime ignora.
   */
  layout?: StepLayout | null;
};

export const STEP_TYPE_OPTIONS: { value: string; label: string; emoji: string; hint: string }[] = [
  { value: "message", emoji: "💬", label: "Mensagem comum", hint: "Texto + mídia + regras (padrão)." },
  { value: "capture_name", emoji: "🙋", label: "Pedir o nome", hint: "Pergunta o nome do cliente (texto)." },
  { value: "capture_conta", emoji: "📸", label: "Captar conta de luz", hint: "Pede a conta, faz OCR e confirma." },
  { value: "capture_documento", emoji: "🪪", label: "Captar documento", hint: "RG/CNH com auto-detecção." },
  { value: "capture_email", emoji: "📧", label: "Captar e-mail", hint: "Pede e-mail e confirma antes de seguir." },
  { value: "confirm_phone", emoji: "📱", label: "Confirmar telefone", hint: "Usa este WhatsApp ou outro?" },
  { value: "finalizar_cadastro", emoji: "🎉", label: "Finalizar cadastro", hint: "Envia ao portal, trata OTP e parabeniza." },
];

// ─── Catálogo da Iris construtora, organizado por INTENÇÃO ───────────────────
// Em vez de pedir o `step_type` técnico, a Iris pergunta a INTENÇÃO ("falar"
// vs "pedir informação") e deduz o tipo correto deterministicamente. Esta
// tabela é a fonte de verdade desse mapeamento e foi validada contra o runtime
// (manual-step-send/KNOWN_TYPES + whapi-webhook/ask_name…) e o useFlowValidation
// (VAR_PRODUCERS) — ver .tmp/map-guided-intents.py.
export type GuidedIntent = "falar" | "pedir";

/** O que a Iris pode PEDIR ao cliente. Cada opção vira um step_type real. */
export interface GuidedCaptureOption {
  /** Chave de UI (não vai pro banco). */
  key: string;
  /** step_type real persistido (reconhecido pelo runtime). */
  stepType: string;
  emoji: string;
  /** Rótulo em linguagem do consultor (sem jargão). */
  label: string;
  /** Frase curta explicando o que acontece. */
  hint: string;
  /** Variável canônica que o passo produz (para o validador). */
  produces: string;
  /** `true` quando pedir esse dado é opcional no fluxo (ex.: nome). */
  optional?: boolean;
}

export const GUIDED_CAPTURE_OPTIONS: GuidedCaptureOption[] = [
  {
    key: "nome",
    stepType: "capture_name",
    emoji: "🙋",
    label: "O nome do cliente",
    hint: "Opcional. Se você não pedir, eu pego o nome depois pela conta ou documento. No começo da conversa uso só o primeiro nome pra falar mais próximo.",
    produces: "nome",
    optional: true,
  },
  {
    key: "valor_conta",
    stepType: "capture_conta",
    emoji: "📸",
    label: "A conta de luz (foto)",
    hint: "Peço a foto ou PDF da conta e leio o valor automaticamente.",
    produces: "valor_conta",
  },
  {
    key: "documento",
    stepType: "capture_documento",
    emoji: "🪪",
    label: "O documento (RG ou CNH)",
    hint: "Peço a foto do documento e leio nome e CPF sozinho.",
    produces: "nome",
  },
  {
    key: "email",
    stepType: "capture_email",
    emoji: "📧",
    label: "O e-mail",
    hint: "Peço o melhor e-mail e confirmo antes de seguir.",
    produces: "email",
  },
  {
    key: "telefone",
    stepType: "confirm_phone",
    emoji: "📱",
    label: "Confirmar o WhatsApp",
    hint: "Pergunto se é neste número ou em outro.",
    produces: "telefone",
  },
];

const VARIANT_LABEL_OVERRIDES: Partial<Record<Variant, string>> = {
  A: "Fluxo A (com áudio)",
  B: "Fluxo B (IA livre)",
  C: "Fluxo C (vídeo inicial)",
  D: "Fluxo D (padrão Camila)",
  E: "Fluxo E (personalizado)",
};
export const VARIANT_LABEL: Record<Variant, string> = ALL_VARIANTS.reduce(
  (acc, v) => {
    acc[v] = VARIANT_LABEL_OVERRIDES[v] ?? `Fluxo ${v}`;
    return acc;
  },
  {} as Record<Variant, string>,
);


// Presets de botões prontos para arrastar/clicar
export const BUTTON_PRESETS: { id: string; title: string; emoji: string }[] = [
  { id: "simular", title: "Quero simular", emoji: "📸" },
  { id: "como", title: "Como funciona", emoji: "🤔" },
  { id: "sim", title: "Sim", emoji: "✅" },
  { id: "nao", title: "Não", emoji: "❌" },
  { id: "duvida", title: "Tenho dúvida", emoji: "🤔" },
  { id: "cadastrar", title: "Cadastrar agora", emoji: "📝" },
  { id: "humano", title: "Falar com humano", emoji: "👤" },
];

export function parseTransitions(raw: unknown): Transition[] {
  if (!Array.isArray(raw)) return [];
  return (raw as any[])
    .filter((t) => String(t?.trigger_intent ?? "") !== "default")
    .map((t) => ({
      trigger_intent: String(t?.trigger_intent ?? "afirmacao"),
      trigger_phrases: Array.isArray(t?.trigger_phrases) ? t.trigger_phrases.map(String) : [],
      goto_step_id: t?.goto_step_id ?? null,
      goto_special: (t?.goto_special as Transition["goto_special"]) ?? null,
    }));
}

export function parseCaptures(raw: unknown): Capture[] {
  if (!Array.isArray(raw)) return [];
  return (raw as any[])
    .filter((c) => c && typeof c.field === "string")
    .map((c) => {
      const base: any = { field: c.field, enabled: c.enabled !== false };
      if (c.field === "_buttons" && Array.isArray(c.value)) base.value = c.value;
      return base as Capture;
    });
}

export function parseFallback(raw: unknown, transitions: unknown): Fallback {
  if (raw && typeof raw === "object") {
    const r = raw as any;
    if (r.mode === "goto" || r.mode === "ai" || r.mode === "repeat") {
      return {
        mode: r.mode,
        goto_step_id: r.goto_step_id ?? null,
        ai_prompt: typeof r.ai_prompt === "string" ? r.ai_prompt : "",
      };
    }
  }
  if (Array.isArray(transitions)) {
    const def = (transitions as any[]).find((t) => t?.trigger_intent === "default");
    if (def) {
      if (def.goto_special === "repeat" || (!def.goto_step_id && !def.goto_special)) {
        return { mode: "repeat" };
      }
      if (def.goto_step_id) return { mode: "goto", goto_step_id: def.goto_step_id };
    }
  }
  return { mode: "repeat" };
}

/** Retorna os botões definidos em captures._buttons (se houver). */
export function getButtons(step: Step): { id: string; title: string }[] {
  const c = step.captures.find((x) => x.field === "_buttons");
  return Array.isArray(c?.value) ? c!.value! : [];
}

/** Detecta se o passo dispara OCR (foto da conta de luz ou documento). */
export function isOcrStep(step: Step): "conta" | "documento" | null {
  if (isAiAnswerStep(step)) return null;
  const key = (step.step_key ?? "").toLowerCase();
  const type = (step.step_type ?? "").toLowerCase();
  if (type === "capture_conta" || /conta|fatura|luz/.test(key)) {
    if (/document|rg|cnh/.test(key)) return "documento";
    if (/conta|fatura|luz/.test(key)) return "conta";
  }
  if (type === "capture_documento" || /document|rg|cnh/.test(key)) return "documento";
  return null;
}

/** Detecta se o passo é "IA livre" (responde dúvidas com Gemini em loop). */
export function isAiAnswerStep(step: Step): boolean {
  const slot = (step.slot_key ?? "").toLowerCase();
  const key = (step.step_key ?? "").toLowerCase();
  if (slot === "esclarecer_duvidas") return true;
  if (slot && slot.includes("duvid") && slot !== "duvidas_pos_club") return true;
  if (key && key.includes("duvid") && key !== "duvidas_pos_club") return true;
  return false;
}




/** Resolve o título de um passo destino para exibir no preview/inspector. */
export function resolveGotoLabel(
  steps: Step[],
  t: Transition,
): { label: string; missing: boolean } {
  if (t.goto_special === "humano") return { label: "👤 Falar com humano", missing: false };
  if (t.goto_special === "cadastro") return { label: "📝 Pular para cadastro", missing: false };
  if (t.goto_special === "repeat") return { label: "🔁 Repetir passo", missing: false };
  if (t.goto_step_id) {
    const s = steps.find((x) => x.id === t.goto_step_id);
    if (!s) return { label: "⚠ Passo removido", missing: true };
    if (!s.is_active) return { label: `⚠ ${s.title} (inativo)`, missing: true };
    return { label: s.title, missing: false };
  }
  return { label: "⚠ Sem destino", missing: true };
}

/** Substitui variáveis padrão por exemplos pro preview.
 *  `consultantName` permite renderizar `{{representante}}` com o nome real
 *  do consultor logado em vez do placeholder "Rafael". */
export function renderVarsPreview(
  text: string | null | undefined,
  consultantName?: string,
): string {
  if (!text) return "";
  const rep = (consultantName && consultantName.trim().split(/\s+/)[0]) || "seu consultor";
  return text
    .replace(/\{\{nome\}\}/gi, "João")
    .replace(/\{\{valor_conta\}\}/gi, "450,00")
    .replace(/\{\{economia_range\}\}/gi, "R$ 80 a R$ 90")
    // Derivadas do valor da conta (20%): mantêm o mesmo cálculo do runtime
    // (render-vars.ts) para o preview bater com o que o cliente recebe.
    .replace(/\{\{economia_mensal\}\}/gi, "90,00")
    .replace(/\{\{economia_anual\}\}/gi, "1.080,00")
    .replace(/\{\{telefone\}\}/gi, "(11) 99999-8888")
    .replace(/\{\{cpf\}\}/gi, "123.456.789-00")
    .replace(/\{\{representante\}\}/gi, rep)
    .replace(/\{\{consultor\}\}/gi, rep)
    .replace(/\{\{email\}\}/gi, "joao@email.com");
}

/**
 * Persona fictícia ÚNICA usada no preview do construtor. Os valores são
 * coerentes com `renderVarsPreview` (mesmo "João", mesmo telefone/valor), para
 * que a conversa simulada bata com as variáveis renderizadas nas bolhas do bot.
 */
export const PREVIEW_PERSONA = {
  nome: "João Silva",
  primeiroNome: "João",
  telefone: "(11) 99999-8888",
  email: "joao@email.com",
  cpf: "123.456.789-00",
  valorConta: "450,00",
} as const;

/** Tipo da resposta simulada do cliente fictício no preview. */
export type SimulatedReply =
  | { kind: "text"; text: string }
  | { kind: "media"; label: string }
  | null;

/**
 * Dada a etapa, devolve a RESPOSTA que o cliente fictício daria — para o
 * preview mostrar o vai-e-vem (bot pede → cliente responde com dado fictício).
 * Determinístico e puro. Retorna `null` quando o passo não espera resposta do
 * cliente (ex.: mensagem informativa sem botões).
 */
export function simulatedClientReply(step: Step): SimulatedReply {
  const type = (step.step_type ?? "").toLowerCase();
  switch (type) {
    case "capture_name":
      return { kind: "text", text: PREVIEW_PERSONA.nome };
    case "capture_email":
      return { kind: "text", text: PREVIEW_PERSONA.email };
    case "confirm_phone":
      return { kind: "text", text: PREVIEW_PERSONA.telefone };
    case "capture_conta":
      return { kind: "media", label: "📷 Foto da conta de luz" };
    case "capture_documento":
    case "capture_doc":
      return { kind: "media", label: "📷 Foto do documento" };
    default:
      // Passo com botões: o cliente "clica" no primeiro botão.
      if (getButtons(step).length > 0) {
        return { kind: "text", text: getButtons(step)[0].title };
      }
      return null;
  }
}

/** Bolha de confirmação que o bot manda APÓS ler um dado (ex.: OCR da conta). */
export function botConfirmationAfter(step: Step): string | null {
  const type = (step.step_type ?? "").toLowerCase();
  if (type === "capture_conta") return "Li aqui: conta de R$ 450,00 ✅";
  if (type === "capture_documento" || type === "capture_doc") return "Documento confirmado: João Silva ✅";
  return null;
}

/**
 * Marcos que um fluxo precisa ter para LEVAR O LEAD ATÉ O CADASTRO COMPLETO no
 * portal iGreen. Não é o conjunto de campos do portal (PORTAL_FIELDS, no shared)
 * — é a tradução desses campos em "passos que o consultor precisa colocar":
 *   • conta de luz  → preenche valor, distribuidora, instalação, endereço (OCR);
 *   • documento     → preenche nome, CPF, RG, nascimento (OCR);
 *   • e-mail        → campo e-mail;
 *   • telefone      → confirma WhatsApp;
 *   • finalizar     → dispara o envio ao portal.
 * Nome é OPCIONAL (vem do documento). Esta lista guia o painel "Cadastro 100%".
 */
export interface FlowMilestone {
  key: string;
  label: string;
  /** step_types que satisfazem este marco. */
  satisfiedBy: string[];
  required: boolean;
  /** Dica curta do que esse marco resolve. */
  hint: string;
}

export const FLOW_MILESTONES: FlowMilestone[] = [
  { key: "conta", label: "Conta de luz", satisfiedBy: ["capture_conta"], required: true, hint: "Valor, distribuidora, instalação e endereço (lê sozinho)." },
  { key: "documento", label: "Documento", satisfiedBy: ["capture_documento", "capture_doc"], required: true, hint: "Nome, CPF, RG e nascimento (lê sozinho)." },
  { key: "email", label: "E-mail", satisfiedBy: ["capture_email"], required: true, hint: "Necessário para o cadastro no portal." },
  { key: "telefone", label: "WhatsApp confirmado", satisfiedBy: ["confirm_phone"], required: true, hint: "Confirma o número do cliente." },
  { key: "finalizar", label: "Finalizar cadastro", satisfiedBy: ["finalizar_cadastro"], required: true, hint: "Envia tudo ao portal iGreen e trata o código (OTP)." },
];

export interface FlowCoverage {
  milestones: { milestone: FlowMilestone; done: boolean }[];
  doneCount: number;
  requiredCount: number;
  /** Percentual 0..100 considerando só os marcos obrigatórios. */
  percent: number;
  /** Próximo marco obrigatório que falta (para sugerir ao consultor). */
  next: FlowMilestone | null;
  complete: boolean;
}

/** Avalia a cobertura do cadastro a partir dos passos ativos do fluxo. */
export function computeFlowCoverage(steps: Step[]): FlowCoverage {
  const types = new Set(
    steps.filter((s) => s.is_active !== false).map((s) => (s.step_type ?? "").toLowerCase()),
  );
  const milestones = FLOW_MILESTONES.map((m) => ({
    milestone: m,
    done: m.satisfiedBy.some((t) => types.has(t)),
  }));
  const required = milestones.filter((x) => x.milestone.required);
  const doneCount = required.filter((x) => x.done).length;
  const requiredCount = required.length;
  const next = required.find((x) => !x.done)?.milestone ?? null;
  return {
    milestones,
    doneCount,
    requiredCount,
    percent: requiredCount === 0 ? 100 : Math.round((doneCount / requiredCount) * 100),
    next,
    complete: doneCount === requiredCount,
  };
}

/**
 * Texto PADRÃO que o bot envia quando o consultor não escreve mensagem própria
 * num passo de captura. Espelha `getReplyForStep` do runtime (Evolution/whapi),
 * para o preview mostrar exatamente o que o cliente receberia por tipo.
 */
export function defaultPromptForType(stepType: string): string {
  switch ((stepType ?? "").toLowerCase()) {
    case "capture_name":
      return "Qual é o seu *nome completo*?";
    case "capture_conta":
      return "Me manda a *foto* (ou PDF) da sua conta de luz aqui pelo WhatsApp 📄";
    case "capture_documento":
    case "capture_doc":
      return "Agora me envia uma *foto do seu documento* (RG ou CNH, frente e verso) 📷";
    case "capture_email":
      return "📧 *Qual o seu melhor e-mail?*";
    case "confirm_phone":
      return "É neste mesmo número de WhatsApp que falo com você?";
    case "finalizar_cadastro":
      return "Tô finalizando seu cadastro, só um instante… ⏳";
    default:
      return "";
  }
}

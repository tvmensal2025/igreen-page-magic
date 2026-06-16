// Flow Templates — engine que compõe blocos em um fluxo coerente.
//
// Recebe um `FlowTemplateConfig` (escolha do consultor no admin) e
// retorna `GeneratedFlow` pronto para INSERT em massa em
// `bot_flows` + `bot_flow_steps`.
//
// Garantias:
//   1. Todo `goto_step_id` aponta para um step que VAI SER inserido
//      (resolve em duas passadas: gera step_keys → resolve refs).
//   2. Welcome (passo 1) sempre existe e é o `firstActive`.
//   3. Bloco final sempre é `finalizar_cadastro` (portal).
//   4. Bloco `duvidas_ia` é alcançável de qualquer step principal
//      via botão "Tenho dúvida".

import type {
  FlowTemplateConfig,
  GeneratedFlow,
  GeneratedStep,
  RenderStyle,
} from "./types.ts";
import { BLOCK_RENDERERS } from "./blocks.ts";

const TXT_BUTTONS = (label: string, opts: Array<{ id: string; title: string }>): string => {
  const list = opts.map((o, i) => `*${i + 1}.* ${o.title}`).join("\n");
  return `${label}\n\n${list}`;
};

function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultWelcome(name: string, useButtons: boolean): { text: string; opts: any[] } {
  const opts = [
    { id: "simular", title: "🚀 Quero simular" },
    { id: "como", title: "🤔 Como funciona" },
    { id: "humano", title: "👤 Falar com consultor" },
  ];
  const baseTxt =
    "Olá! 👋 Sou a assistente virtual do(a) *{{representante}}*.\n\n" +
    "Posso te ajudar a *economizar até 20% na conta de luz* todo mês — sem obra, sem instalação, sem fidelidade.\n\n" +
    "Como prefere começar?";
  return {
    text: useButtons ? baseTxt : TXT_BUTTONS(baseTxt, opts),
    opts,
  };
}

function defaultQualifyText(): string {
  return "Pra eu já te chamar pelo nome, *como você se chama*? 😊";
}

/**
 * Gera o fluxo completo a partir do config.
 */
export function generateFlowFromTemplate(config: FlowTemplateConfig): GeneratedFlow {
  const suffix = uniqueSuffix();
  const useButtons = config.renderStyle === "buttons" || config.renderStyle === "list-interactive";
  const warnings: string[] = [];
  const mediaRequirements: Array<{ slot_key: string; description: string }> = [];

  if (config.renderStyle === "list-interactive" && config.variant !== "D") {
    warnings.push("Lista interativa só funciona no Whapi (variante D). Em variantes A/B/C vai cair em texto numerado.");
  }
  if (!config.blocks.some((b) => b.enabled && b.id === "finalizar_cadastro")) {
    warnings.push("Bloco 'finalizar_cadastro' não foi marcado — adicionando automaticamente no fim.");
  }

  // ── Pré-passada: assigna step_keys provisórios para cada bloco ──
  // (precisamos saber o key do "próximo" antes de gerar transitions)
  const enabledBlocks = config.blocks.filter((b) => b.enabled);
  if (!enabledBlocks.find((b) => b.id === "finalizar_cadastro")) {
    enabledBlocks.push({ id: "finalizar_cadastro", enabled: true });
  }

  // Steps base (welcome + qualify) sempre existem.
  const welcomeKey = `welcome_${suffix}`;
  const qualifyKey = `qualify_${suffix}`;

  // Reserva keys "preditivos" pra cada bloco (serve só pra resolver refs)
  const blockPredictedKeys: Array<{ blockId: string; firstStepKey: string }> = [];
  const usedSuffixes = new Set<string>();
  for (const b of enabledBlocks) {
    let s = uniqueSuffix();
    while (usedSuffixes.has(s)) s = uniqueSuffix();
    usedSuffixes.add(s);
    // Mapeia para o primeiro step_key que cada bloco vai gerar
    const map: Record<string, string> = {
      pedir_conta_ocr: `pedir_conta_${s}`,
      pedir_documento_ocr: `pedir_documento_${s}`,
      confirmar_email: `pedir_email_${s}`,
      confirmar_telefone: `confirmar_telefone_${s}`,
      duvidas_ia: `duvidas_${s}`,
      finalizar_cadastro: `finalizar_${s}`,
    };
    blockPredictedKeys.push({ blockId: b.id, firstStepKey: map[b.id] });
  }

  const duvidasBlock = blockPredictedKeys.find((b) => b.blockId === "duvidas_ia");
  const duvidasKey = duvidasBlock?.firstStepKey ?? null;

  // ── Geração: welcome + qualify ──
  const steps: GeneratedStep[] = [];
  let pos = 1;

  const wd = defaultWelcome(config.welcomeText || "", useButtons);
  const welcomeOpts = useButtons
    ? wd.opts
    : [
        { id: "simular", title: "Quero simular" },
        { id: "como", title: "Como funciona" },
        { id: "humano", title: "Falar com consultor" },
      ];

  const firstBlockKey = blockPredictedKeys[0]?.firstStepKey ?? null;

  steps.push({
    step_key: welcomeKey,
    step_type: "message",
    position: pos++,
    is_active: true,
    message_text: config.welcomeText || wd.text,
    slot_key: null,
    wait_for: "none",
    text_delay_ms: 1500,
    captures: useButtons
      ? [{ field: "_buttons", value: welcomeOpts, enabled: true }]
      : [],
    transitions: [
      {
        goto_step_id: null, // resolvido na pós-passada (vai para qualify)
        goto_step_key: qualifyKey,
        trigger_intent: "palavra_chave",
        trigger_phrases: ["simular", "Quero simular", "1", "ok", "vamos"],
      },
      {
        goto_step_id: null,
        goto_step_key: duvidasKey || qualifyKey,
        trigger_intent: "palavra_chave",
        trigger_phrases: ["como", "Como funciona", "2", "explica"],
      },
      {
        goto_special: "humano",
        trigger_intent: "palavra_chave",
        trigger_phrases: ["humano", "Falar", "consultor", "3", "atendente"],
      },
    ],
    fallback: {
      mode: "goto",
      goto_step_key: qualifyKey,
    },
  });

  steps.push({
    step_key: qualifyKey,
    step_type: "message",
    position: pos++,
    is_active: true,
    message_text: config.qualifyText || defaultQualifyText(),
    slot_key: null,
    wait_for: "reply",
    text_delay_ms: 1500,
    captures: [{ field: "name", enabled: true }],
    transitions: [
      {
        goto_step_id: null,
        goto_step_key: firstBlockKey,
        trigger_intent: "default",
        trigger_phrases: [],
      },
    ],
    fallback: {
      mode: "goto",
      goto_step_key: firstBlockKey,
    },
  });

  // ── Geração: blocos em sequência ──
  for (let i = 0; i < enabledBlocks.length; i++) {
    const b = enabledBlocks[i];
    const renderer = BLOCK_RENDERERS[b.id];
    if (!renderer) {
      warnings.push(`Bloco '${b.id}' desconhecido — pulando.`);
      continue;
    }
    const next = blockPredictedKeys[i + 1]?.firstStepKey ?? null;
    const blockSuffix = blockPredictedKeys[i].firstStepKey.split("_").slice(-1)[0];
    const result = renderer(
      {
        startPosition: pos,
        nextStepId: null, // usaremos goto_step_key e resolveremos depois
        humanStepId: null,
        duvidasStepId: duvidasKey,
        renderStyle: config.renderStyle,
        uniqueSuffix: blockSuffix,
      },
      b,
    );
    // Substitui qualquer transição com goto_step_id=null por goto_step_key=next
    for (const s of result.steps) {
      if (s.transitions) {
        for (const t of s.transitions) {
          if (t.goto_step_id === null && !t.goto_special && !t.goto_step_key) {
            t.goto_step_key = next;
          }
        }
      }
      if (s.fallback && s.fallback.mode === "goto" && !s.fallback.goto_step_id && !s.fallback.goto_step_key) {
        s.fallback.goto_step_key = next;
      }
      steps.push({ ...s, position: pos++ } as GeneratedStep);
    }
    mediaRequirements.push(...result.mediaSlots);
  }

  // ── Pós-passada: resolve goto_step_key → goto_step_id ──
  // (no INSERT, o goto_step_id vai ser preenchido pelos UUIDs gerados)
  // Aqui mantemos goto_step_key como hint; a Edge Function que faz o
  // INSERT resolve para o id real após os steps serem persistidos.
  return {
    flowName: config.flowName,
    variant: config.variant,
    steps,
    mediaRequirements,
    warnings,
  };
}

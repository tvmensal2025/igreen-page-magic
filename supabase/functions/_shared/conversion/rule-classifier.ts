/**
 * Classificador determinístico de leads (0 tokens).
 * Usado antes da IA lite/full em lead-temperature-classifier.
 */

import {
  getPhraseByShortcut,
  type LeadTemperature,
  type PhraseEntry,
} from "./phrase-catalog.ts";

export interface ClassifyMessage {
  message_direction: string;
  message_text: string | null;
  message_type: string | null;
  created_at: string;
}

export interface LeadSignals {
  sent_bill: boolean;
  mentioned_value: boolean;
  asked_price: boolean;
  mentioned_scam_fear: boolean;
  asked_how_it_works: boolean;
  said_no: boolean;
  we_ghosted_them: boolean;
}

export interface RuleClassifyInput {
  messages: ClassifyMessage[];
  conversationStep: string | null;
  hoursStuck: number | null;
  billValue: number | null;
  customerName: string | null;
}

export interface RuleClassifyResult {
  confidence: number;
  temperature: LeadTemperature;
  shortcut: string;
  next_action: string;
  conversion_chance: number;
  loss_reason: string | null;
  main_doubt: string | null;
  main_objection: string | null;
  summary: string;
  signals: LeadSignals;
}

const STEP_SHORTCUTS: Record<string, string> = {
  aguardando_conta: "/step_aguardando_conta",
  aguardando_foto_conta: "/step_aguardando_foto_conta",
  coleta_conta: "/step_aguardando_conta",
  confirmando_dados: "/step_confirmando_dados",
  confirmando_dados_conta: "/step_confirmando_dados",
  aguardando_doc: "/step_aguardando_doc",
  aguardando_documento: "/step_aguardando_doc",
  coleta_doc: "/step_aguardando_doc",
  aguardando_facial: "/step_aguardando_facial",
  portal_submitting: "/step_portal",
  cadastro_portal: "/step_portal",
  aguardando_humano: "/step_aguardando_humano",
};

const OBJECTION_RULES: Array<{
  shortcut: string;
  keywords: string[];
  objection: string;
  loss: string;
}> = [
  { shortcut: "/golpe", keywords: ["golpe", "fraude", "furada", "enganação", "enganacao", "scam"], objection: "Medo de golpe", loss: "desconfiança" },
  { shortcut: "/fidelidade", keywords: ["fidelidade", "multa", "preso", "amarrado"], objection: "Medo de fidelidade", loss: "fidelidade" },
  { shortcut: "/preco", keywords: ["caro", "preço", "preco", "grátis", "gratis", "pago", "custo", "cara demais", "ta cara", "tá cara", "conta cara", "muito cara"], objection: "Dúvida sobre preço", loss: "preço" },
  { shortcut: "/comofunciona", keywords: ["como funciona", "funciona como", "explica"], objection: "Não entende como funciona", loss: "dúvida_técnica" },
  { shortcut: "/depois", keywords: ["depois", "pensar", "amanhã", "amanha", "semana que vem"], objection: "Quer decidir depois", loss: "adiamento" },
  { shortcut: "/jadesconto", keywords: ["já tenho desconto", "ja tenho desconto"], objection: "Já tem desconto", loss: "concorrência" },
  { shortcut: "/medo", keywords: ["medo", "mexer", "instalação", "instalacao", "obra"], objection: "Medo de obra/mudança", loss: "medo_técnico" },
  { shortcut: "/quemsomos", keywords: ["quem são", "quem sao", "quem é vocês", "quem e voce"], objection: "Não conhece a empresa", loss: "desconfiança" },
  { shortcut: "/problema", keywords: ["problema", "errado", "deu ruim"], objection: "Medo de dar problema", loss: "risco_percebido" },
];

const DEAD_KEYWORDS = ["não quero", "nao quero", "para de", "não me chama", "nao me chama", "sair", "encerrar"];

function norm(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function allInboundText(messages: ClassifyMessage[]): string {
  return messages
    .filter((m) => m.message_direction === "inbound")
    .map((m) => norm(m.message_text))
    .join(" ");
}

function stripStepPrefix(step: string | null): string {
  if (!step) return "";
  return step.startsWith("flow:") ? step.slice(5) : step;
}

export function detectSignals(messages: ClassifyMessage[]): LeadSignals {
  const inbound = messages.filter((m) => m.message_direction === "inbound");
  const text = allInboundText(messages);
  const last = messages[messages.length - 1];
  const lastInboundAt = [...messages].reverse().find((m) => m.message_direction === "inbound")?.created_at;
  let lastOutboundAfterInbound = false;
  if (lastInboundAt) {
    lastOutboundAfterInbound = messages.some(
      (m) => m.message_direction === "outbound" && m.created_at > lastInboundAt,
    );
  }

  // sent_bill exige mídia (foto/PDF da conta). Texto que apenas menciona
  // "conta"/"fatura" NÃO conta — evita falso positivo "minha conta é cara".
  const sentBill = inbound.some((m) => {
    const type = (m.message_type ?? "text").toLowerCase();
    return type !== "text" &&
      (type.includes("image") || type.includes("document") || type.includes("pdf"));
  });

  return {
    sent_bill: sentBill,
    mentioned_value: /\br\s?\$|\bvalor\b|\bconta de luz\b/.test(text),
    asked_price: /preco|preço|desconto|economia|quanto/.test(text),
    mentioned_scam_fear: /golpe|fraude|furada|enganacao|enganação|scam/.test(text),
    asked_how_it_works: /como funciona|funciona como/.test(text),
    said_no: DEAD_KEYWORDS.some((k) => text.includes(norm(k))),
    we_ghosted_them: last?.message_direction === "inbound" && !lastOutboundAfterInbound,
  };
}

function phraseMeta(shortcut: string): PhraseEntry {
  return getPhraseByShortcut(shortcut)!;
}

function buildResult(
  shortcut: string,
  confidence: number,
  signals: LeadSignals,
  input: RuleClassifyInput,
  extras?: { main_objection?: string | null; main_doubt?: string | null; loss_reason?: string | null; summary?: string },
): RuleClassifyResult {
  const entry = phraseMeta(shortcut);
  const stepLabel = stripStepPrefix(input.conversationStep) || "início";
  return {
    confidence,
    temperature: entry.temperature ?? "cold",
    shortcut: entry.shortcut,
    next_action: entry.next_action,
    conversion_chance: entry.conversion_chance,
    loss_reason: extras?.loss_reason ?? null,
    main_doubt: extras?.main_doubt ?? null,
    main_objection: extras?.main_objection ?? null,
    summary: extras?.summary ?? `Lead em ${stepLabel}. ${entry.next_action}.`,
    signals,
  };
}

function matchFollowUp(hours: number | null): string {
  if (hours == null) return "/oi1";
  if (hours >= 168) return "/fup7d";
  if (hours >= 72) return "/fup72h";
  if (hours >= 24) return "/fup24h";
  if (hours >= 1) return "/fup1h";
  return "/oi1";
}

export function classifyByRules(input: RuleClassifyInput): RuleClassifyResult {
  const signals = detectSignals(input.messages);
  const text = allInboundText(input.messages);
  const step = stripStepPrefix(input.conversationStep);
  const inboundCount = input.messages.filter((m) => m.message_direction === "inbound").length;

  if (signals.said_no) {
    return buildResult("/dead_soft", 0.92, signals, input, {
      main_objection: "Lead recusou continuar",
      loss_reason: "recusa_explicita",
      summary: "Lead pediu para parar ou disse que não quer.",
    });
  }

  for (const rule of OBJECTION_RULES) {
    if (rule.keywords.some((k) => text.includes(norm(k)))) {
      return buildResult(rule.shortcut, 0.9, signals, input, {
        main_objection: rule.objection,
        loss_reason: rule.loss,
        summary: `Objeção: ${rule.objection}.`,
      });
    }
  }

  const lastInbound = [...input.messages].reverse().find((m) => m.message_direction === "inbound");
  const lastInboundText = norm(lastInbound?.message_text);
  const lastInboundSubstantive = !!lastInbound && (
    (lastInbound.message_type ?? "text") !== "text"
    || lastInboundText.length > 18
    || lastInboundText.includes("?")
    || /conta|doc|cadastr|valor|preco|preço/.test(lastInboundText)
  );

  if (
    signals.we_ghosted_them
    && (input.hoursStuck ?? 0) >= 2
    && (input.hoursStuck ?? 0) < 24
    && lastInboundSubstantive
  ) {
    return buildResult("/rescue_ghosted", 0.88, signals, input, {
      loss_reason: "sem_resposta_nossa",
      summary: "Lead mandou mensagem e ficou sem resposta nossa.",
    });
  }

  if (signals.sent_bill || (input.billValue != null && input.billValue > 0)) {
    return buildResult("/hot_pedir_doc", 0.92, signals, input, {
      summary: "Lead enviou conta ou valor — pronto pra avançar.",
    });
  }

  if (step === "portal_submitting" || step === "cadastro_portal") {
    return buildResult("/step_portal", 0.9, signals, input, { summary: "Lead no portal — acompanhar fechamento." });
  }

  if (step && STEP_SHORTCUTS[step]) {
    // Etapa conhecida do funil é determinística: a frase correta é a da etapa,
    // independente do tempo. Confiança alta evita chamar a IA à toa.
    const conf = (input.hoursStuck ?? 0) >= 24 ? 0.9 : 0.86;
    return buildResult(STEP_SHORTCUTS[step], conf, signals, input, {
      summary: `Lead parado na etapa ${step}.`,
      loss_reason: (input.hoursStuck ?? 0) >= 48 ? "silêncio_do_lead" : null,
    });
  }

  if (inboundCount >= 3 && (signals.mentioned_value || signals.asked_price) && !signals.sent_bill) {
    return buildResult("/warm_pedir_conta", 0.86, signals, input, {
      main_doubt: "Quer saber economia antes de mandar conta",
      summary: "Lead engajado pedindo valor/desconto — falta conta.",
    });
  }

  // Follow-up por tempo parado é puramente determinístico (só depende das
  // horas). Confiança alta — não há nada que a IA acrescente aqui.
  const fup = matchFollowUp(input.hoursStuck);
  if ((input.hoursStuck ?? 0) >= 1) {
    return buildResult(fup, 0.9, signals, input, {
      loss_reason: "silêncio_do_lead",
      summary: `Lead parado há ${Math.round(input.hoursStuck ?? 0)}h — follow-up automático.`,
    });
  }

  // Boas-vindas / conversa inicial também é determinístico: pedir o valor da
  // conta é sempre o próximo passo certo, independente da IA.
  if (inboundCount <= 1) {
    return buildResult("/oi1", 0.88, signals, input, {
      summary: "Conversa inicial — pedir valor da conta.",
    });
  }

  return buildResult("/oi2", 0.86, signals, input, {
    summary: "Lead com pouco engajamento — retomar com benefício.",
  });
}

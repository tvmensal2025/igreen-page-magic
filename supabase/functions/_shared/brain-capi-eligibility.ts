/**
 * FASE 13 — elegibilidade de resultado comercial para a Conversions API.
 *
 * NÃO envia nada. A infraestrutura de envio já existe e continua sendo a única:
 * fila `facebook_capi_outbox` + `facebook-capi-dispatch` + `_shared/capi-event.ts`
 * (chave estável, hash de PII, leitura de erro). Aqui só respondemos: este fato
 * comercial PODE virar evento, e com qual nome?
 *
 * O motivo de existir: mandar "cliente aprovado" para uma campanha
 * Click-to-WhatsApp não faz a Meta otimizar para cliente aprovado. Campanha de
 * mensagem otimiza conversa iniciada; o evento tardio serve para MEDIR, e só
 * vira sinal de otimização em objetivo compatível. Tratar os dois como a mesma
 * coisa é o erro que faz alguém trocar o objetivo da campanha e perder volume.
 *
 * Puro: sem I/O, sem rede.
 */
import {
  buildCapiEventKey,
  buildCapiEventPayload,
  type CapiEventName,
} from "./capi-event.ts";
import {
  type AttributableCustomer,
  classifyAttribution,
} from "./brain-attribution.ts";

/** Estágios comerciais que o Cérebro sabe reconhecer. */
export type CommercialMilestone =
  | "lead_identificado"
  | "lead_qualificado"
  | "cadastro_concluido"
  | "cliente_aprovado"
  | "cliente_ativo";

/** Objetivo da campanha na Meta, no recorte que importa aqui. */
export type CampaignObjective =
  | "messages_ctwa"
  | "leads"
  | "conversions"
  | "unknown";

export const MILESTONE_EVENT_NAME: Record<CommercialMilestone, CapiEventName> = {
  lead_identificado: "Lead",
  lead_qualificado: "Contact",
  cadastro_concluido: "SubmitApplication",
  cliente_aprovado: "CompleteRegistration",
  cliente_ativo: "Purchase",
};

/**
 * Uso pretendido do evento.
 * `measurement` = entra no relatório/dataset. `optimization` = a Meta pode
 * usar como sinal de otimização do objetivo atual.
 */
export type EventUse = "optimization" | "measurement" | "blocked";

export type EligibilityVerdict = {
  eligible: boolean;
  use: EventUse;
  eventName: CapiEventName | null;
  /** Chave estável reaproveitada da infra existente (dedupe da Meta). */
  eventKey: string | null;
  reasons: string[];
  /** Identificadores presentes — qualidade de correspondência. */
  matchSignals: string[];
  requiresReview: boolean;
};

/**
 * Objetivos em que o evento pode servir de sinal de otimização.
 *
 * CTWA fica de fora de propósito: o leilão dessas campanhas é fechado em
 * conversa iniciada, não em cliente aprovado.
 */
const OPTIMIZATION_OBJECTIVES: ReadonlySet<CampaignObjective> = new Set([
  "leads",
  "conversions",
]);

/** Marcos tardios só otimizam em objetivo de conversão. */
const LATE_MILESTONES: ReadonlySet<CommercialMilestone> = new Set([
  "cadastro_concluido",
  "cliente_aprovado",
  "cliente_ativo",
]);

export type EligibilityInput = {
  customer: AttributableCustomer & {
    phone?: string | null;
    email?: string | null;
  };
  milestone: CommercialMilestone;
  consultantId: string;
  objective: CampaignObjective;
  /** Existe base para tratar dados do lead (ele iniciou a conversa)? */
  hasConsentBasis: boolean;
  /** Envio real liberado pela configuração? Default: não. */
  dispatchEnabled?: boolean;
};

export function evaluateCapiEligibility(
  input: EligibilityInput,
): EligibilityVerdict {
  const reasons: string[] = [];
  const matchSignals: string[] = [];
  const eventName = MILESTONE_EVENT_NAME[input.milestone];

  const attribution = classifyAttribution(input.customer);
  if (
    attribution.confidence === "unattributed" || attribution.confidence === "low"
  ) {
    reasons.push(
      `atribuição ${attribution.confidence} — evento distorceria o aprendizado`,
    );
    return {
      eligible: false,
      use: "blocked",
      eventName: null,
      eventKey: null,
      reasons,
      matchSignals,
      requiresReview: false,
    };
  }
  matchSignals.push(`atribuicao_${attribution.confidence}`);

  if (!input.hasConsentBasis) {
    reasons.push("sem base de consentimento registrada para o lead");
    return {
      eligible: false,
      use: "blocked",
      eventName: null,
      eventKey: null,
      reasons,
      matchSignals,
      requiresReview: true,
    };
  }

  if (input.customer.phone) matchSignals.push("telefone");
  if (input.customer.email) matchSignals.push("email");
  if (input.customer.ctwa_clid || input.customer.source_ctwa_clid) {
    matchSignals.push("ctwa_clid");
  }
  const hasIdentifier = Boolean(input.customer.phone || input.customer.email);
  if (!hasIdentifier) {
    reasons.push("sem telefone nem e-mail — correspondência impossível");
    return {
      eligible: false,
      use: "blocked",
      eventName: null,
      eventKey: null,
      reasons,
      matchSignals,
      requiresReview: false,
    };
  }

  const eventKey = buildCapiEventKey({
    eventName,
    consultantId: input.consultantId,
    customerId: input.customer.id,
  });

  let use: EventUse = "measurement";
  if (
    OPTIMIZATION_OBJECTIVES.has(input.objective) &&
    (!LATE_MILESTONES.has(input.milestone) || input.objective === "conversions")
  ) {
    use = "optimization";
    reasons.push(`objetivo ${input.objective} aceita ${eventName} como sinal`);
  } else if (input.objective === "messages_ctwa") {
    reasons.push(
      "campanha Click-to-WhatsApp otimiza conversa iniciada — evento serve para medir, não para otimizar",
    );
  } else {
    reasons.push("objetivo sem compatibilidade confirmada — apenas medição");
  }

  // Enquanto o envio real não for revisado e liberado, o veredito é preparo.
  const dispatchEnabled = input.dispatchEnabled === true;
  if (!dispatchEnabled) {
    reasons.push("envio real desligado — payload preparado, nada enviado");
  }

  return {
    eligible: dispatchEnabled,
    use,
    eventName,
    eventKey,
    reasons,
    matchSignals,
    requiresReview: !dispatchEnabled,
  };
}

/**
 * Payload de teste, montado com a mesma função do despachante real.
 *
 * Serve para revisão humana e para o Events Manager em ambiente de teste. Não
 * enfileira: quem enfileira é a trigger/`fb_emit_capi` existente.
 */
export function buildCapiPreviewPayload(input: {
  verdict: EligibilityVerdict;
  hashedUserData: Record<string, unknown>;
  valueCents?: number | null;
  eventTimeSeconds?: number;
}): Record<string, unknown> | null {
  if (!input.verdict.eventName || !input.verdict.eventKey) return null;
  return buildCapiEventPayload({
    eventName: input.verdict.eventName,
    eventId: input.verdict.eventKey,
    userData: input.hashedUserData,
    // Marco comercial tardio acontece fora do site: a Meta espera origem
    // offline nesse caso.
    offline: input.verdict.use === "measurement",
    value: input.valueCents != null ? input.valueCents / 100 : null,
    currency: "BRL",
    eventTimeSeconds: input.eventTimeSeconds,
  });
}

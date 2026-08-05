/**
 * Cota diária de disparo — por consultor, com teto de plataforma por cima.
 *
 * Por que existe (preparação multi-consultor, 2026-08-05): até aqui o motor
 * lia UM limite só e contava os envios do dia inteiro sem separar por dono.
 * Com dois consultores, quem o tick processasse primeiro consumia os 200
 * envios e o outro ficava adiado para o dia seguinte — o segundo cliente
 * pagaria por um serviço que não dispara.
 *
 * São duas travas diferentes e as duas precisam existir:
 *
 *  - Cota do consultor: a fatia garantida de cada um (B, C e soma). É o que
 *    torna a divisão justa.
 *  - Teto de plataforma: limite físico do NÚMERO de WhatsApp. Enquanto vários
 *    consultores saem pelo mesmo chip, é ele que segura o banimento — cota por
 *    consultor não cria capacidade nova no chip. Quando cada consultor tiver o
 *    próprio número, este teto pode subir.
 *
 * Nunca descarta: quem bate a cota é adiado para a manhã seguinte.
 */

export interface CapValues {
  capB: number;
  capC: number;
  capGlobal: number;
}

export interface OutreachUsage {
  b: number;
  c: number;
}

export type OutreachGroup = "A" | "B" | "C";

export type CapVerdict =
  | { allowed: true }
  | { allowed: false; blockedBy: "platform" | "consultant"; group: "B" | "C" };

export const DEFAULT_CAPS: CapValues = { capB: 150, capC: 50, capGlobal: 200 };

/** Lê caps de uma linha de `daily_reheat_settings`, caindo no fallback. */
export function resolveCapValues(
  row: { cap_b?: unknown; cap_c?: unknown; cap_global_outreach?: unknown } | null | undefined,
  fallback: CapValues = DEFAULT_CAPS,
): CapValues {
  const pick = (raw: unknown, alt: number): number => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : alt;
  };
  return {
    capB: pick(row?.cap_b, fallback.capB),
    capC: pick(row?.cap_c, fallback.capC),
    capGlobal: pick(row?.cap_global_outreach, fallback.capGlobal),
  };
}

/**
 * Grupo A (inbound quente) tem bypass total e não conta em nenhuma trava —
 * regra antiga do projeto, mantida.
 */
export function decideOutreachCap(input: {
  group: OutreachGroup;
  consultantUsage: OutreachUsage;
  consultantCaps: CapValues;
  platformUsage: OutreachUsage;
  platformCaps: CapValues;
}): CapVerdict {
  if (input.group === "A") return { allowed: true };
  const group = input.group;

  // O chip vem primeiro: estourar o teto do número é o que gera ban.
  const platformTotal = input.platformUsage.b + input.platformUsage.c;
  if (platformTotal >= input.platformCaps.capGlobal) {
    return { allowed: false, blockedBy: "platform", group };
  }

  const usadoGrupo = group === "B" ? input.consultantUsage.b : input.consultantUsage.c;
  const capGrupo = group === "B" ? input.consultantCaps.capB : input.consultantCaps.capC;
  if (usadoGrupo >= capGrupo) {
    return { allowed: false, blockedBy: "consultant", group };
  }

  const consultantTotal = input.consultantUsage.b + input.consultantUsage.c;
  if (consultantTotal >= input.consultantCaps.capGlobal) {
    return { allowed: false, blockedBy: "consultant", group };
  }

  return { allowed: true };
}

/** Chave do balde de uso: envio sem dono conhecido cai num balde próprio. */
export function usageBucketKey(consultantId: string | null | undefined): string {
  const id = String(consultantId || "").trim();
  return id || "__sem_consultor__";
}

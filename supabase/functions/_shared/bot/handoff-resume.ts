// Volta do handoff humano — regra única para webhook e cadence-tick.
//
// O BURACO QUE ISSO FECHA (caso Robinho, 2026-08-05)
// --------------------------------------------------
// Quando o consultor responde pelo WhatsApp do celular, o webhook marca
// `humano_assumiu` e grava `paused_reason='handoff_humano'` com
// `next_action_at = null`. O `cadence-tick` já tinha uma expiração de 48h
// (`blockedCustomers`), mas ela só é avaliada em linhas que o claim seleciona
// — e o claim exige `next_action_at <= now`. Com `null`, o lead nunca mais é
// selecionado: a expiração jamais roda e o lead fica parado para sempre.
//
// Foi o que aconteceu com o lead do parceiro José: mandou a frase do QR às
// 15:46, o robô pediu o nome, ele não respondeu, o consultor mandou dois
// áudios às 16:46 e a conversa morreu ali — sem robô e sem humano.
//
// Agora o handoff agenda uma volta (`handoffResumeAtIso`) e o motor decide na
// data (`decideHandoffResume`). Pausa definitiva (pedido do cliente, DNC,
// bulk) continua sem volta.

/** Silêncio total (ninguém falou nada) antes do robô reassumir. */
export const HANDOFF_RESUME_HOURS = 48;

/**
 * Pausas que NUNCA expiram por tempo. Espelha a lista do `cadence-tick`:
 * pedido explícito do cliente e disparo em massa não voltam sozinhos.
 */
export const HANDOFF_PERMANENT_REASONS = new Set([
  "requested",
  "opt_out",
  "complaint",
  "blocked",
  "bulk_pro",
]);

/** Quando o motor deve reavaliar este handoff. */
export function handoffResumeAtIso(
  from: Date = new Date(),
  hours: number = HANDOFF_RESUME_HOURS,
): string {
  return new Date(from.getTime() + Math.max(1, hours) * 3_600_000).toISOString();
}

export type HandoffCustomerState = {
  do_not_contact?: boolean | null;
  bot_paused?: boolean | null;
  bot_paused_reason?: string | null;
  bot_paused_until?: string | null;
  assigned_human_id?: string | null;
};

export type HandoffResumeDecision =
  /** Robô reassume: limpar as flags do customer e retomar a cadência. */
  | { resume: true }
  /** Continua com o humano; `retryAtIso` é quando olhar de novo. */
  | { resume: false; reason: string; retryAtIso: string };

/**
 * `lastInteractionAt` = mensagem mais recente da conversa (qualquer direção).
 * Usamos a conversa, não `customers.updated_at`: qualquer rotina que toca a
 * linha empurraria o prazo para frente e o lead nunca voltaria.
 */
export function decideHandoffResume(
  customer: HandoffCustomerState | null | undefined,
  lastInteractionAt: Date | null,
  now: Date = new Date(),
  hours: number = HANDOFF_RESUME_HOURS,
): HandoffResumeDecision {
  const janela = Math.max(1, hours) * 3_600_000;

  if (!customer) return { resume: true };

  if (customer.do_not_contact) {
    // Bloqueio de verdade: nunca volta. Data longe só para não ficar em loop.
    return {
      resume: false,
      reason: "do_not_contact",
      retryAtIso: new Date(now.getTime() + 30 * 24 * 3_600_000).toISOString(),
    };
  }

  const reason = String(customer.bot_paused_reason || "").toLowerCase();
  if (HANDOFF_PERMANENT_REASONS.has(reason)) {
    return {
      resume: false,
      reason,
      retryAtIso: new Date(now.getTime() + 30 * 24 * 3_600_000).toISOString(),
    };
  }

  if (customer.bot_paused_until) {
    const until = new Date(customer.bot_paused_until);
    if (Number.isFinite(until.getTime()) && until > now) {
      return { resume: false, reason: "bot_paused_until", retryAtIso: until.toISOString() };
    }
  }

  if (lastInteractionAt && Number.isFinite(lastInteractionAt.getTime())) {
    const silencio = now.getTime() - lastInteractionAt.getTime();
    if (silencio < janela) {
      return {
        resume: false,
        reason: "conversa_recente",
        retryAtIso: new Date(lastInteractionAt.getTime() + janela).toISOString(),
      };
    }
  }

  return { resume: true };
}

/** Campos que o customer precisa perder para o robô voltar a falar. */
export const HANDOFF_RELEASE_PATCH = {
  bot_paused: false,
  bot_paused_reason: null,
  bot_paused_until: null,
  assigned_human_id: null,
} as const;

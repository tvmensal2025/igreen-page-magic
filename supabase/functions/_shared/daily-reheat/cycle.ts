/**
 * Máquina de estados do ciclo diário (Fila A novo / Fila B frio).
 * Alinha com as pizzas do Dashboard — um passo por tick quando due.
 */

import type { PlannedAction } from "./plan.ts";

export type CycleQueue = "A" | "B";

export type CycleStepDef = {
  id: string;
  actions: PlannedAction[];
  /** Próximo passo; null = concluir (status done). */
  next: string | null;
  /** Minutos até o próximo passo ficar due (após sucesso deste). */
  delayMin: number;
  would_consume_whapi: boolean;
  would_call: boolean;
  would_sms: boolean;
};

/** Fila A — lead novo (espera 5 min já filtrada no planner). */
export const NOVO_CYCLE: CycleStepDef[] = [
  {
    id: "open",
    actions: ["open_attendance", "send_audio"],
    next: "flow",
    delayMin: 0,
    would_consume_whapi: true,
    would_call: false,
    would_sms: false,
  },
  {
    id: "flow",
    actions: ["start_flow"],
    next: "wait2h",
    delayMin: 0,
    would_consume_whapi: false,
    would_call: false,
    would_sms: false,
  },
  {
    id: "wait2h",
    actions: ["wait"],
    next: "call1",
    delayMin: 0, // delay real aplicado ao entrar neste passo (silence hours)
    would_consume_whapi: false,
    would_call: false,
    would_sms: false,
  },
  {
    id: "call1",
    actions: ["call"],
    next: "retry",
    delayMin: 20,
    would_consume_whapi: false,
    would_call: true,
    would_sms: false,
  },
  {
    id: "retry",
    actions: ["call"],
    next: "sms",
    delayMin: 15,
    would_consume_whapi: false,
    would_call: true,
    would_sms: false,
  },
  {
    id: "sms",
    actions: ["sms"],
    next: "close",
    delayMin: 0,
    would_consume_whapi: false,
    would_call: false,
    would_sms: true,
  },
  {
    id: "close",
    actions: ["close_rating"],
    next: null,
    delayMin: 0,
    would_consume_whapi: true,
    would_call: false,
    would_sms: false,
  },
];

/** Fila B — lead frio */
export const FRIO_CYCLE: CycleStepDef[] = [
  {
    id: "call1",
    actions: ["call"],
    next: "open",
    delayMin: 0,
    would_consume_whapi: false,
    would_call: true,
    would_sms: false,
  },
  {
    id: "open",
    actions: ["open_attendance", "send_audio"],
    next: "retry",
    delayMin: 20,
    would_consume_whapi: true,
    would_call: false,
    would_sms: false,
  },
  {
    id: "retry",
    actions: ["call"],
    next: "sms",
    delayMin: 15,
    would_consume_whapi: false,
    would_call: true,
    would_sms: false,
  },
  {
    id: "sms",
    actions: ["sms"],
    next: "wait",
    delayMin: 0,
    would_consume_whapi: false,
    would_call: false,
    would_sms: true,
  },
  {
    id: "wait",
    actions: ["start_flow"],
    next: "close",
    delayMin: 0,
    would_consume_whapi: false,
    would_call: false,
    would_sms: false,
  },
  {
    id: "close",
    actions: ["close_rating"],
    next: null,
    delayMin: 0,
    would_consume_whapi: true,
    would_call: false,
    would_sms: false,
  },
];

export function cycleFor(queue: CycleQueue): CycleStepDef[] {
  return queue === "A" ? NOVO_CYCLE : FRIO_CYCLE;
}

export function stepDef(queue: CycleQueue, stepId: string): CycleStepDef | null {
  return cycleFor(queue).find((s) => s.id === stepId) ?? null;
}

export function firstStep(queue: CycleQueue): CycleStepDef {
  return cycleFor(queue)[0];
}

/** Ao entrar em wait2h (novo), agenda call1 após silenceHours. */
export function delayMinutesForTransition(
  queue: CycleQueue,
  fromStepId: string,
  toStepId: string | null,
  silenceHours: number,
): number {
  if (!toStepId) return 0;
  const from = stepDef(queue, fromStepId);
  if (!from) return 0;
  // Entrando no wait2h: congela até silêncio (horas do settings)
  if (toStepId === "wait2h") {
    return Math.max(1, Math.round(silenceHours * 60));
  }
  // Saindo do wait2h via noop: próximo já está due (delay do from)
  if (fromStepId === "wait2h") return 0;
  return Math.max(0, from.delayMin);
}

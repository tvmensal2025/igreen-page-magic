/**
 * Botões por estágio do motor de cadência (Grupos B e C).
 * Espelha `src/lib/multichannelCadenceTexts.ts` — fonte runtime do cadence-tick.
 */

import type { Stage } from "./cadence-engine.ts";

export type CadenceButton = { id: string; title: string };

export const BILL_RANGE_BUTTONS: CadenceButton[] = [
  { id: "bill_low", title: "Até R$300" },
  { id: "bill_mid", title: "R$300 a R$700" },
  { id: "bill_high", title: "Acima de R$700" },
];

export const ANALYZE_OR_CALL_BUTTONS: CadenceButton[] = [
  { id: "analyze", title: "Quero analisar" },
  { id: "call_me", title: "Pode me ligar" },
  { id: "send_photo", title: "Enviar conta" },
];

export const NEXT_ACTION_BUTTONS: CadenceButton[] = [
  { id: "send_photo", title: "Enviar foto" },
  { id: "call_me", title: "Pode me ligar" },
  { id: "stop", title: "Encerrar" },
];

/** Estágios WhatsApp com botões (B + recalls C). */
export const STAGE_BUTTONS: Partial<Record<Stage, CadenceButton[]>> = {
  COLD_1: BILL_RANGE_BUTTONS,
  COLD_2: BILL_RANGE_BUTTONS,
  COLD_3: BILL_RANGE_BUTTONS,
  COLD_4: [
    { id: "analyze", title: "Quero analisar" },
    { id: "call_me", title: "Pode me ligar" },
    { id: "stop", title: "Encerrar" },
  ],
  RECALL_60D: BILL_RANGE_BUTTONS,
  RECALL_90D: BILL_RANGE_BUTTONS,
  RECALL_5M: BILL_RANGE_BUTTONS,
  RECALL_8M: BILL_RANGE_BUTTONS,
  RECALL_12M: BILL_RANGE_BUTTONS,
  RECALL_YEARLY: BILL_RANGE_BUTTONS,
};

export function buttonsForStage(stage: string): CadenceButton[] {
  return STAGE_BUTTONS[stage as Stage] ?? [];
}

export function stageHasButtons(stage: string): boolean {
  return buttonsForStage(stage).length > 0;
}

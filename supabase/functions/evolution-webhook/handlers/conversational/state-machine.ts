// Re-export shim — fonte única em _shared/bot/conversational-state-machine.ts
// (era cópia idêntica à do whapi-webhook; unificado para manutenção única).
// Para reverter: restaurar este arquivo via `git checkout HEAD -- <path>`.
export { CONVERSATIONAL_STEPS, decideTransition } from "../../../_shared/bot/conversational-state-machine.ts";
export type { ConversationalStep, Intent, Action, Transition } from "../../../_shared/bot/conversational-state-machine.ts";

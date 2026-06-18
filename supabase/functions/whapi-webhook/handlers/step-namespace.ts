// Re-export shim — fonte única em _shared/bot/step-namespace.ts
// (era cópia idêntica à do evolution-webhook; unificado para manutenção única).
// Para reverter: restaurar este arquivo via `git checkout HEAD -- <path>`.
export { isFlowStep, stripPrefix, routeEngine, normalizeOutgoing } from "../../_shared/bot/step-namespace.ts";
export type { Engine } from "../../_shared/bot/step-namespace.ts";

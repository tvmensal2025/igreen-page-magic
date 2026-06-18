// Re-export shim — fonte única em _shared/bot/intent-classifier.ts
// Injeta channel="whapi" para logAiDecision sem alterar conversational/index.ts.
// Para reverter só Etapa 2: bash scripts/revert-webhook-unify-stage2.sh
export {
  __test,
  type ClassifyAction,
  type ClassifyResult,
} from "../../../_shared/bot/intent-classifier.ts";

import { classifyIntent as classifyIntentBase } from "../../../_shared/bot/intent-classifier.ts";

export async function classifyIntent(
  text: string,
  currentStep: string,
  geminiApiKey: string,
  ctx?: { customerId?: string | null; consultantId?: string | null; traceId?: string | null },
) {
  return classifyIntentBase(text, currentStep, geminiApiKey, {
    customerId: ctx?.customerId,
    consultantId: ctx?.consultantId,
    traceId: ctx?.traceId,
    channel: "whapi",
  });
}

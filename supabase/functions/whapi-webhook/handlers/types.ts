// Re-export shim — fonte única em _shared/bot/handler-types.ts
// (era cópia quase idêntica à do evolution-webhook; unificado Etapa 2).
// Para reverter só Etapa 2: bash scripts/revert-webhook-unify-stage2.sh
export {
  type SupabaseClient,
  type BotContext,
  type BotResult,
} from "../../_shared/bot/handler-types.ts";
export type { ChannelSender as EvolutionSender } from "../../_shared/bot/handler-types.ts";

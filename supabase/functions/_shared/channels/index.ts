// Channel factory (Phase A da spec whatsapp-flow-architecture-v3, Task 7).
//
// Único ponto de entrada para obter um `ChannelAdapter`. Webhook nunca
// instancia adapter direto — chama `getAdapter(channel, config)`.
//
// Exporta também os tipos canônicos para callers em outros módulos.

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelKind,
  MediaPayload,
  OutboundChoice,
  ParsedMessage,
  SendContext,
  SendResult,
} from "./types.ts";
import { createEvolutionAdapter, type CreateEvolutionAdapterInput } from "./evolution.ts";
import { createWhapiAdapter, type CreateWhapiAdapterInput } from "./whapi.ts";
import { createWameAdapter, type CreateWameAdapterInput } from "./wame.ts";

export type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelKind,
  MediaPayload,
  OutboundChoice,
  ParsedMessage,
  SendContext,
  SendResult,
};

export type AdapterConfig =
  | { kind: "evolution"; input: CreateEvolutionAdapterInput }
  | { kind: "whapi"; input: CreateWhapiAdapterInput }
  | { kind: "wame"; input: CreateWameAdapterInput };

/**
 * Retorna um adapter para o canal solicitado. NÃO faz cache global porque
 * cada Edge Function tem seu próprio escopo de instância (instanceName,
 * connectedPhone, apiToken). Caller cria uma vez por request.
 *
 * O default continua Whapi — callers antigos que passam kinds fora do union
 * mantêm exatamente o comportamento anterior.
 */
export function getAdapter(config: AdapterConfig): ChannelAdapter {
  if (config.kind === "evolution") {
    return createEvolutionAdapter(config.input);
  }
  if (config.kind === "wame") {
    return createWameAdapter(config.input);
  }
  return createWhapiAdapter(config.input);
}

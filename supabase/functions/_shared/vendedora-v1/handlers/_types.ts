// Contrato compartilhado dos handlers da Vendedora v2.

import type { ChatMsg } from "./gateway.ts";
import type { Etapa, FluxoBState, PerfilOutput, SupabaseClient } from "./types.ts";

export interface HandlerCtx {
  supabase: SupabaseClient;
  customerId: string;
  customer: any;
  consultant: any;
  state: FluxoBState;
  perfil: PerfilOutput | null;       // null em etapas mecânicas
  inboundText: string;
  historyMsgs: ChatMsg[];
  historyText: string;
  memoryText: string;
  ragText: string;                   // "" em etapas mecânicas
  representante: string;
  nomeLead: string | null;
}

export interface HandlerResult {
  reply: string;
  updates: Record<string, any>;            // colunas pra UPDATE em customers
  stateUpdates: Partial<FluxoBState>;      // ex: { simulacao_apresentada: true }
  nextEtapa?: Etapa;
  toolsApplied: string[];
  handoff?: { reason: string };
  closerHint?: boolean;
  modelUsed?: string;
}

export type Handler = (ctx: HandlerCtx) => Promise<HandlerResult>;

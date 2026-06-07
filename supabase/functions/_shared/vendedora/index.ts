// Vendedora — ponto de entrada único.
//
// Arquitetura (V2, state-machine determinística):
//   extractors → state-machine (decideEtapa) → micro-writer + RAG → crítico
//   → travas determinísticas (anti-foto-cedo, anti-repetição, coerência de tema)
//   → tools/state/memory → closer (finalize-capture).
//
// Histórico: a versão antiga (V1, baseada em Planner+Writer livres) foi
// aposentada e removida. `runVendedoraV2` é a única vendedora em produção.
// O nome da função permanece `runVendedoraV2` para não quebrar o caller
// (fluxo-b-ai.ts) — é apenas um nome, não há "V1" mais.

import type { SupabaseClient } from "./types.ts";

export { runVendedoraV2 } from "./orchestrator.ts";

export interface VendedoraInput {
  supabase: SupabaseClient;
  customerId: string;
  inboundText: string;
  customer?: any;
  consultant?: any;
}

export interface VendedoraResult {
  reply: string;
  toolsApplied: string[];
  conversationStepUpdate: string | null;
  shouldHandoff: boolean;
  modelUsed: string;
  latencyMs: number;
  customerUpdates: Record<string, any>;
  debug?: {
    perfil: any;
    plano: any;
    ragChunks: number;
    criticoAprovado: boolean;
    criticoProblemas: string[];
    stateBefore: any;
    stateAfter: any;
    checklist?: any;
    closer?: any;
  };
}

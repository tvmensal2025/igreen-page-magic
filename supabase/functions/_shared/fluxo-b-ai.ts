// Fluxo B — IA livre conversacional.
//
// Este módulo é APENAS um wrapper fino para `runVendedoraV2`. Todo o
// caminho legacy (nudge manual, FLUXO_B_TOOLS, callWithTools, system prompt
// próprio, fallback profissional, sanitizeReply local) foi REMOVIDO porque
// estava causando duplicação e mistura com o V3 step engine.
//
// Regras:
// - Variant B = Vendedora V2. Sem exceção, sem fallback para o V3.
// - Nudge interno do worker `process-followups`: vira mensagem sintética
//   prefixada `[nudge_interno]` no inboundText. A Vendedora a trata como
//   turno novo (sem mensagem do lead) e decide como reaquecer.
// - Memória, RAG, fallback determinístico, sanitizer: tudo já vive dentro
//   da Vendedora V2.

import { runVendedoraV2 } from "./vendedora/index.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface FluxoBRunInput {
  supabase: SupabaseClient;
  customerId: string;
  inboundText: string;
  // deno-lint-ignore no-explicit-any
  customer?: any;
  // deno-lint-ignore no-explicit-any
  consultant?: any;
  // Nudge interno do worker de follow-up. Vira marcador no inboundText.
  nudgeHook?: string | null;
}

export interface FluxoBRunResult {
  reply: string;
  toolsApplied: string[];
  conversationStepUpdate: string | null;
  shouldHandoff: boolean;
  modelUsed: string;
  latencyMs: number;
  // deno-lint-ignore no-explicit-any
  customerUpdates: Record<string, any>;
  variantId?: string | null;
  // deno-lint-ignore no-explicit-any
  debug?: any;
}

export async function runFluxoBAI(input: FluxoBRunInput): Promise<FluxoBRunResult> {
  const { supabase, customerId } = input;

  // Recarrega customer (precisamos do conversation_summary fresco).
  let customer = input.customer;
  if (customerId && customerId !== "00000000-0000-0000-0000-000000000000") {
    const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
    if (data) customer = data;
  }
  if (!customer) throw new Error(`[fluxo-b-ai] customer ${customerId} not found`);

  // Nudge interno: marca o inboundText para a Vendedora reconhecer.
  const hook = (input.nudgeHook || "").trim();
  const inboundText = hook
    ? `[nudge_interno hook="${hook.slice(0, 200)}"] (sem mensagem nova do lead — reaqueça)`
    : input.inboundText;

  const v = await runVendedoraV2({
    supabase,
    customerId,
    inboundText,
    customer,
    consultant: input.consultant,
  });

  return {
    reply: v.reply,
    toolsApplied: v.toolsApplied,
    conversationStepUpdate: v.conversationStepUpdate,
    shouldHandoff: v.shouldHandoff,
    modelUsed: v.modelUsed,
    latencyMs: v.latencyMs,
    customerUpdates: v.customerUpdates,
    variantId: hook ? "b.v2.nudge" : "b.v2",
    debug: v.debug,
  };
}

// Vendedora APAGADA — este arquivo é um stub de compatibilidade.
//
// O caminho conversacional agora é 100% Cérebro IA (ver
// `_shared/cerebro/resposta-hook.ts` no whapi/evolution webhooks). Este
// `runFluxoBAI` só é invocado em 3 situações remanescentes:
//
//   1. `whapi-webhook/handlers/bot-flow.ts` / `evolution-webhook/handlers/bot-flow.ts`
//      — fallback quando o Cérebro NÃO assumiu o turno (cérebro respondeu
//      false). Como `cerebro_ativo='on'` é o default global, isso só ocorre
//      se o Cérebro tiver erro de runtime, e o webhook já tem fail-soft.
//   2. `process-followups` — nudge interno de reaquecimento.
//   3. `fluxo-b-ai/index.ts` edge (painel admin "Testar com lead simulado").
//
// Em todos os casos devolvemos uma resposta determinística curta e segura.
// Quando a Onda B portar nudge + tester pro Cérebro, este arquivo e seus
// callers podem ser removidos.

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

const NAME_FROM_HOOK = (hook?: string | null) => (hook || "").trim().slice(0, 60);

export async function runFluxoBAI(input: FluxoBRunInput): Promise<FluxoBRunResult> {
  const started = Date.now();
  const hook = NAME_FROM_HOOK(input.nudgeHook);
  const isNudge = hook.length > 0;

  // Mensagem segura, curta, com CTA — sem promessas. O Cérebro é a fonte
  // de verdade do diálogo; aqui só seguramos o turno sem quebrar a UX.
  const reply = isNudge
    ? "Oi! Voltando aqui pra continuar nosso papo — ainda quer simular sua economia de luz?"
    : "Recebi sua mensagem. Pode me confirmar rapidinho como posso te ajudar?";

  return {
    reply,
    toolsApplied: [],
    conversationStepUpdate: null,
    shouldHandoff: false,
    modelUsed: "stub.vendedora-retired",
    latencyMs: Date.now() - started,
    customerUpdates: {},
    variantId: isNudge ? "stub.nudge" : "stub.reply",
    debug: { reason: "vendedora_apagada", hook },
  };
}

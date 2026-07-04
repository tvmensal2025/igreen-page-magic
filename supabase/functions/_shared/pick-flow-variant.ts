// pickFlowVariant — decide a variante (A ou D) de um lead NOVO conforme o
// modo de A/B test configurado em `settings.flow_ab_mode`.
//
// Valores aceitos de settings.flow_ab_mode:
//   "split"  → 50/50 aleatório por lead (default quando ausente)
//   "only_A" → todo lead novo entra no Fluxo A
//   "only_D" → todo lead novo entra no Fluxo D
//
// O painel (/admin/fluxos) grava esse flag. Desligar um lado = manda todo
// mundo pro outro, sem precisar despublicar fluxo.
//
// IMPORTANTE: só decide para LEADS NOVOS. Lead existente mantém sua variante
// (o split é por lead, definido uma única vez na criação).

export type FlowVariant = "A" | "D" | "M";
export type FlowAbMode = "split" | "only_A" | "only_D";

export async function getFlowAbMode(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<FlowAbMode> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "flow_ab_mode")
      .maybeSingle();
    const v = String(data?.value || "").trim().toLowerCase();
    if (v === "only_a") return "only_A";
    if (v === "only_d") return "only_D";
    if (v === "split") return "split";
  } catch (_e) { /* fail-open para split */ }
  return "split";
}

// Split aleatório 50/50 por lead. Usamos Math.random() — cada lead novo
// é sorteado de forma independente (decisão do produto: split por lead,
// não determinístico por telefone).
export function rollVariant(mode: FlowAbMode): FlowVariant {
  if (mode === "only_A") return "A";
  if (mode === "only_D") return "D";
  return Math.random() < 0.5 ? "A" : "D";
}

// Conveniência: lê o modo e sorteia em uma chamada.
export async function pickFlowVariant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<FlowVariant> {
  const mode = await getFlowAbMode(supabase);
  return rollVariant(mode);
}

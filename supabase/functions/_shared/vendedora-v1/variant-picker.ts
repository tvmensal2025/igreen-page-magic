// Sorteio genérico de variantes por fluxo. Lê flow_variants do banco,
// aplica overrides do consultor e faz weighted random.
//
// Decisão é cacheada no customer (customers.variant_id) — uma vez sorteado,
// o lead nunca troca de variante (evita estatística contaminada).

import type { SupabaseClient } from "./types.ts";

export interface VariantRow {
  id: string;
  fluxo: string;
  nome: string;
  weight: number;
  is_active: boolean;
  consultant_overrides: Record<string, { weight?: number; is_active?: boolean }>;
}

const cache = { rows: null as VariantRow[] | null, ts: 0 };
const TTL_MS = 30_000;

async function loadVariants(supabase: SupabaseClient): Promise<VariantRow[]> {
  const now = Date.now();
  if (cache.rows && now - cache.ts < TTL_MS) return cache.rows;
  const { data } = await supabase.from("flow_variants").select("id, fluxo, nome, weight, is_active, consultant_overrides");
  cache.rows = (data || []) as VariantRow[];
  cache.ts = now;
  return cache.rows;
}

export interface PickInput {
  supabase: SupabaseClient;
  fluxo: string; // "A" | "B" | "C" | "D"
  consultantId?: string | null;
}

export async function pickVariant(input: PickInput): Promise<string | null> {
  const all = await loadVariants(input.supabase);
  const fluxoUpper = String(input.fluxo || "").toUpperCase();
  const eligible = all
    .filter((v) => String(v.fluxo || "").toUpperCase() === fluxoUpper)
    .map((v) => {
      const ov = (input.consultantId && v.consultant_overrides?.[input.consultantId]) || {};
      const weight = typeof ov.weight === "number" ? ov.weight : v.weight;
      const active = typeof ov.is_active === "boolean" ? ov.is_active : v.is_active;
      return { id: v.id, weight: Math.max(0, weight), active };
    })
    .filter((v) => v.active && v.weight > 0);

  if (!eligible.length) return null;
  const total = eligible.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of eligible) {
    if ((r -= v.weight) <= 0) return v.id;
  }
  return eligible[eligible.length - 1].id;
}

export function invalidateVariantsCache(): void {
  cache.rows = null;
  cache.ts = 0;
}

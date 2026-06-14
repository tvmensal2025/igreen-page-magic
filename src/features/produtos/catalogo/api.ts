// =============================================================================
// Catálogo de Produtos — API
// =============================================================================
// Acesso à tabela `products`. Mapeia o shape cru (snake_case) para o modelo
// da aplicação (camelCase) com regras tipadas. Toda leitura/escrita do
// catálogo passa por aqui — nunca consultar a tabela direto no componente.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type {
  CommissionRule,
  Product,
  ProductFamily,
  ProductLandingContent,
  ProductRow,
  ScoringRule,
} from "./types";

const SELECT_COLUMNS =
  "id, slug, name, brand_name, family, is_active, sort_order, scoring_rule, commission_rule, landing_content, created_at, updated_at";

function asScoringRule(value: unknown): ScoringRule {
  if (value && typeof value === "object" && "mode" in value) {
    return value as ScoringRule;
  }
  return { mode: "none" };
}

function asCommissionRule(value: unknown): CommissionRule {
  if (value && typeof value === "object" && "type" in value) {
    return value as CommissionRule;
  }
  return { type: "none" };
}

function asLandingContent(value: unknown): ProductLandingContent {
  if (value && typeof value === "object") {
    return value as ProductLandingContent;
  }
  return {};
}

/** Normaliza a linha do banco para o modelo da aplicação. */
export function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brandName: row.brand_name,
    family: row.family,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    scoringRule: asScoringRule(row.scoring_rule),
    commissionRule: asCommissionRule(row.commission_rule),
    landingContent: asLandingContent(row.landing_content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lista produtos ativos ordenados por sort_order. */
export async function fetchProducts(options?: {
  family?: ProductFamily;
  includeInactive?: boolean;
}): Promise<Product[]> {
  let query = supabase
    .from("products" as never)
    .select(SELECT_COLUMNS)
    .order("sort_order", { ascending: true });

  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }
  if (options?.family) {
    query = query.eq("family", options.family);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as unknown as ProductRow[]) || []).map(mapProductRow);
}

/** Busca um produto pelo slug público (usado nas landing pages). */
export async function fetchProductBySlug(slug: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from("products" as never)
    .select(SELECT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data ? mapProductRow(data as unknown as ProductRow) : null;
}

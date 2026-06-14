// =============================================================================
// Catálogo de Produtos — Hooks (React Query)
// =============================================================================
// Camada de consumo do catálogo na UI. Segue o padrão do projeto:
// dados sempre via React Query, nunca fetch solto em componente.
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import { fetchProductBySlug, fetchProducts } from "./api";
import type { Product, ProductFamily } from "./types";

const PRODUCTS_KEY = "products";

/** Lista produtos do catálogo (ativos por padrão). */
export function useProducts(options?: {
  family?: ProductFamily;
  includeInactive?: boolean;
}) {
  return useQuery<Product[]>({
    queryKey: [PRODUCTS_KEY, options?.family ?? "all", options?.includeInactive ?? false],
    queryFn: () => fetchProducts(options),
    staleTime: 5 * 60 * 1000,
  });
}

/** Busca um produto pelo slug público (landing pages). */
export function useProduct(slug: string | undefined) {
  return useQuery<Product | null>({
    queryKey: [PRODUCTS_KEY, "slug", slug],
    queryFn: () => fetchProductBySlug(slug as string),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

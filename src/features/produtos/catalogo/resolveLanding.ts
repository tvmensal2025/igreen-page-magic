// =============================================================================
// Catálogo de Produtos — Resolver de conteúdo de landing
// =============================================================================
// Durante a migração, a coluna products.landing_content pode estar vazia
// (o seed SQL não duplica o conteúdo extenso). Este resolver garante que a
// landing sempre tenha conteúdo: usa o do banco quando presente, senão cai
// no catálogo estático src/data/conexaoProducts.ts (fonte legada) — somente
// se o produto existir no banco e estiver ativo.
//
// Produto inativo (is_active=false) ou ausente (ex.: RLS) NÃO revive o
// fallback estático — a LP deve retornar 404.
// =============================================================================

import { conexaoProducts } from "@/data/conexaoProducts";
import type { Product, ProductLandingContent } from "./types";

/** Conteúdo de landing pronto para render, com todos os campos garantidos. */
export interface ResolvedLanding {
  name: string;
  brandName: string;
  slug: string;
  heroTitle: string;
  heroSubtitle: string;
  heroVideoId: string;
  heroAutoplay: boolean;
  gradient: string;
  whatsappMessage: string;
  ctaLabel: string;
  sections: NonNullable<ProductLandingContent["sections"]>;
}

const DEFAULT_GRADIENT = "linear-gradient(rgb(14, 128, 40) 0%, rgb(8, 28, 3) 100%)";

function hasContent(content: ProductLandingContent | undefined): boolean {
  return !!content && Array.isArray(content.sections) && content.sections.length > 0;
}

/**
 * Resolve o conteúdo de landing por slug.
 * @param product Produto vindo do banco (pode ter landingContent vazio).
 * @param slug Slug usado para localizar o fallback estático de conteúdo.
 */
export function resolveLanding(
  product: Product | null | undefined,
  slug: string,
): ResolvedLanding | null {
  // Sem produto no banco (RLS / inexistente) ou inativo → não servir LP.
  if (!product || product.isActive === false) return null;

  const dbContent = product.landingContent;
  const fallback = conexaoProducts.find((p) => p.slug === slug);

  const name = product.name || fallback?.name || "";
  const brandName = product.brandName || fallback?.brandName || "iGreen Energy";

  if (hasContent(dbContent)) {
    return {
      name,
      brandName,
      slug,
      heroTitle: dbContent!.heroTitle ?? fallback?.heroTitle ?? "",
      heroSubtitle: dbContent!.heroSubtitle ?? fallback?.heroSubtitle ?? "",
      heroVideoId: dbContent!.heroVideoId ?? fallback?.heroVideoId ?? "",
      heroAutoplay: dbContent!.heroAutoplay ?? fallback?.heroAutoplay ?? true,
      gradient: dbContent!.gradient ?? fallback?.gradient ?? DEFAULT_GRADIENT,
      whatsappMessage: dbContent!.whatsappMessage ?? fallback?.whatsappMessage ?? "",
      ctaLabel: dbContent!.ctaLabel ?? fallback?.ctaLabel ?? "QUERO SABER MAIS",
      sections: dbContent!.sections!,
    };
  }

  // Conteúdo ainda não migrado: usa estático só para campos, produto ativo no DB.
  if (!fallback) return null;
  return {
    name,
    brandName,
    slug,
    heroTitle: fallback.heroTitle,
    heroSubtitle: fallback.heroSubtitle,
    heroVideoId: fallback.heroVideoId,
    heroAutoplay: fallback.heroAutoplay,
    gradient: fallback.gradient,
    whatsappMessage: fallback.whatsappMessage,
    ctaLabel: fallback.ctaLabel,
    sections: fallback.sections,
  };
}

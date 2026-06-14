// =============================================================================
// Catálogo de Produtos — Types
// =============================================================================
// Tipos canônicos do módulo multiproduto. A fonte de verdade é a tabela
// `products` (migration 20260614090000_products_catalog.sql). O conteúdo de
// landing (hero + seções) é compartilhado com src/data/conexaoProducts.ts.
// =============================================================================

export type ProductFamily =
  | "energia"
  | "placas"
  | "telecom"
  | "seguros"
  | "club"
  | "expansao";

export const PRODUCT_FAMILY_LABEL: Record<ProductFamily, string> = {
  energia: "Energia",
  placas: "Placas Solares",
  telecom: "Telecom",
  seguros: "Seguros",
  club: "Clube de Benefícios",
  expansao: "Oportunidade",
};

// ---------------------------------------------------------------------------
// Regra de pontuação (kWh-equivalente para o plano de carreira).
// Discriminada por `mode` para cálculo type-safe no Bloco D.
// ---------------------------------------------------------------------------
export type ScoringRule =
  | { mode: "contracted_kwh"; multiplier: number }
  | { mode: "proposal_kwh"; multiplier: number; validity_months?: number }
  | { mode: "fixed_per_unit"; kwh_per_unit: number; only_portability?: boolean }
  | { mode: "none" };

// ---------------------------------------------------------------------------
// Regra de comissão (espelha os manuais iGreen). Flexível por produto.
// ---------------------------------------------------------------------------
export type CommissionRule =
  | { type: "recurring_percent"; max_percent: number }
  | { type: "royalties_percent"; max_percent: number }
  | {
      type: "fixed";
      own: number;
      indirect?: number;
      chip_activation?: number;
      chip_activation_from_unit?: number;
    }
  | { type: "per_policy" }
  | { type: "recruitment"; direct_bonus: number }
  | { type: "none" };

// ---------------------------------------------------------------------------
// Conteúdo da landing (idêntico ao shape de conexaoProducts.ts para
// permitir migração sem refatorar a renderização).
// ---------------------------------------------------------------------------
export interface ProductSection {
  type: "about" | "video" | "plans" | "benefits" | "gallery" | "faq" | "advantages";
  title: string;
  subtitle?: string;
  videoId?: string;
  items?: string[];
  images?: string[];
  faq?: { question: string; answer: string }[];
}

export interface ProductLandingContent {
  heroTitle?: string;
  heroSubtitle?: string;
  heroVideoId?: string;
  heroAutoplay?: boolean;
  gradient?: string;
  whatsappMessage?: string;
  ctaLabel?: string;
  sections?: ProductSection[];
}

// ---------------------------------------------------------------------------
// Linha da tabela `products` já normalizada para a aplicação.
// ---------------------------------------------------------------------------
export interface Product {
  id: string;
  slug: string;
  name: string;
  brandName: string;
  family: ProductFamily;
  isActive: boolean;
  sortOrder: number;
  scoringRule: ScoringRule;
  commissionRule: CommissionRule;
  landingContent: ProductLandingContent;
  createdAt: string;
  updatedAt: string;
}

// Shape cru vindo do Supabase (snake_case).
export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  brand_name: string;
  family: ProductFamily;
  is_active: boolean;
  sort_order: number;
  scoring_rule: unknown;
  commission_rule: unknown;
  landing_content: unknown;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Cross-sell — config compartilhada (mensagem + filtros)
// =============================================================================
// Persistido em consultant_message_templates (template_key = cross_sell_hint):
//   text_content = mensagem WA
//   variables    = { stages, products, placeholders }
// Sem disparo automático — só alimenta o card manual.
// =============================================================================

export const CROSS_SELL_TEMPLATE_KEY = "cross_sell_hint";

export const CROSS_SELL_STAGES = ["aprovado", "d30", "d60", "d90", "d120", "d150", "d180", "d210"] as const;
export type CrossSellStage = (typeof CROSS_SELL_STAGES)[number];

export const CROSS_SELL_PRODUCTS = ["telecom", "seguros"] as const;
export type CrossSellProduct = (typeof CROSS_SELL_PRODUCTS)[number];

export interface CrossSellPrefs {
  stages: CrossSellStage[];
  products: CrossSellProduct[];
}

export const DEFAULT_CROSS_SELL_PREFS: CrossSellPrefs = {
  stages: [...CROSS_SELL_STAGES],
  products: [...CROSS_SELL_PRODUCTS],
};

export const DEFAULT_CROSS_SELL_MESSAGE =
  "Oi {{nome}}! Além da economia de energia, temos também {{produto}} com valores exclusivos para clientes iGreen. Quer que eu te mostre?";

const STAGE_SET = new Set<string>(CROSS_SELL_STAGES);
const PRODUCT_SET = new Set<string>(CROSS_SELL_PRODUCTS);

export function parseCrossSellVariables(raw: unknown): CrossSellPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      stages: [...DEFAULT_CROSS_SELL_PREFS.stages],
      products: [...DEFAULT_CROSS_SELL_PREFS.products],
    };
  }
  const obj = raw as Record<string, unknown>;
  const stagesRaw = Array.isArray(obj.stages) ? obj.stages : DEFAULT_CROSS_SELL_PREFS.stages;
  const productsRaw = Array.isArray(obj.products) ? obj.products : DEFAULT_CROSS_SELL_PREFS.products;
  const stages = stagesRaw
    .map((s) => String(s))
    .filter((s): s is CrossSellStage => STAGE_SET.has(s));
  const products = productsRaw
    .map((p) => String(p))
    .filter((p): p is CrossSellProduct => PRODUCT_SET.has(p));
  return {
    stages: stages.length > 0 ? stages : [...DEFAULT_CROSS_SELL_PREFS.stages],
    products: products.length > 0 ? products : [...DEFAULT_CROSS_SELL_PREFS.products],
  };
}

export function buildCrossSellVariables(prefs: CrossSellPrefs): Record<string, unknown> {
  return {
    placeholders: ["nome", "produto"],
    stages: prefs.stages,
    products: prefs.products,
  };
}

/** Rótulo de produto conforme gaps do lead. */
export function produtoLabelForGaps(gaps: { telecom: boolean; seguros: boolean }): string {
  if (gaps.telecom && gaps.seguros) return "Telecom e Seguro Auto";
  if (gaps.telecom) return "Telecom";
  if (gaps.seguros) return "Seguro Auto";
  return "Telecom e Seguro Auto";
}

/**
 * Aplica {{nome}} e {{produto}}, colapsa espaços duplos e faz trim.
 * {{nome}} sem valor some sem deixar espaço sobrando.
 */
export function applyCrossSellTemplate(
  template: string,
  opts: { fullName?: string | null; produto?: string },
): string {
  const first = String(opts.fullName || "").trim().split(/\s+/)[0] || "";
  const produto = String(opts.produto || "").trim();
  let out = template
    .replace(/\{\{\s*nome\s*\}\}/gi, first)
    .replace(/\{\{\s*produto\s*\}\}/gi, produto);
  // Remove espaço antes de pontuação quando o placeholder ficou vazio.
  out = out.replace(/ +([!?,.;:])/g, "$1");
  out = out.replace(/[ \t]{2,}/g, " ").replace(/ ?\n ?/g, "\n").trim();
  return out;
}

/** @deprecated use applyCrossSellTemplate */
export function applyCrossSellNome(template: string, fullName?: string | null): string {
  return applyCrossSellTemplate(template, { fullName });
}

/** Chaves de telefone para match (com/sem DDI 55). Evita usar só 8 dígitos (colisões). */
export function phoneMatchKeys(raw?: string | null): string[] {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length < 10) return [];
  const keys = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) {
    keys.add(d.slice(2)); // sem DDI
    d = d.slice(2);
  }
  if (d.length >= 11) keys.add(d.slice(-11));
  if (d.length === 10 || d.length === 11) keys.add(d);
  return [...keys];
}

export function buildPhoneKeySet(phones: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const p of phones) {
    for (const k of phoneMatchKeys(p)) set.add(k);
  }
  return set;
}

export function phoneInSet(set: Set<string>, phone?: string | null): boolean {
  return phoneMatchKeys(phone).some((k) => set.has(k));
}

export function normName(n?: string | null): string {
  return String(n || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

/**
 * Match: telefone primeiro; se não houver telefone no lado produto, cai no nome.
 */
export function hasProductMatch(opts: {
  leadPhone?: string | null;
  leadName?: string | null;
  productPhones: Set<string>;
  productNames: Set<string>;
}): boolean {
  if (opts.productPhones.size > 0 && phoneInSet(opts.productPhones, opts.leadPhone)) {
    return true;
  }
  const name = normName(opts.leadName);
  return !!(name && opts.productNames.has(name));
}

export const STAGE_LABELS: Record<CrossSellStage, string> = {
  aprovado: "Aprovado",
  d30: "30 dias",
  d60: "60 dias",
  d90: "90 dias",
  d120: "120 dias",
  d150: "150 dias",
  d180: "180 dias",
  d210: "210 dias",
};

export const PRODUCT_LABELS: Record<CrossSellProduct, string> = {
  telecom: "Telecom",
  seguros: "Seguros",
};

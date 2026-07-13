// =============================================================================
// Cross-sell bot — avaliação (modo sombra por padrão)
// =============================================================================
// Quando cross_sell_bot=true no consultor, sugere telecom/seguros para cliente
// só de energia. NÃO envia mensagem sozinho: o decisor decide se injeta texto.
// Em sombra (CROSS_SELL_SHADOW!=='false'), só retorna sugestão para audit log.
// =============================================================================

export type CrossSellGap = "telecom" | "seguros";

export interface CrossSellEvalInput {
  crossSellBotEnabled: boolean;
  hasEnergia: boolean;
  hasTelecom: boolean;
  hasSeguros: boolean;
  /** Já sugeriu nesta conversa. */
  alreadySuggested?: boolean;
}

export interface CrossSellEvalResult {
  suggest: boolean;
  gaps: CrossSellGap[];
  shadow: boolean;
  /** Texto curto opcional (só usado se shadow=false). */
  hint?: string;
}

export function isCrossSellShadowMode(): boolean {
  const env = (typeof Deno !== "undefined" ? Deno.env.get("CROSS_SELL_SHADOW") : undefined) ?? "true";
  return env !== "false";
}

export function avaliarCrossSell(input: CrossSellEvalInput): CrossSellEvalResult {
  const shadow = isCrossSellShadowMode();
  if (!input.crossSellBotEnabled || input.alreadySuggested || !input.hasEnergia) {
    return { suggest: false, gaps: [], shadow };
  }
  const gaps: CrossSellGap[] = [];
  if (!input.hasTelecom) gaps.push("telecom");
  if (!input.hasSeguros) gaps.push("seguros");
  if (gaps.length === 0) return { suggest: false, gaps: [], shadow };

  const labels = gaps.map((g) => (g === "telecom" ? "Telefonia" : "Seguro Auto"));
  return {
    suggest: true,
    gaps,
    shadow,
    hint: shadow
      ? undefined
      : `Além da energia, você também pode ter ${labels.join(" e ")} com condições especiais iGreen. Quer que eu te mostre?`,
  };
}

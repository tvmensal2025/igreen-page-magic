// =============================================================================
// Produtos & Vendas — Theme (Sage & Cream / Magazine 7+5)
// =============================================================================
// Tokens travados e injeção das fontes editoriais (DM Serif Display + Fira Sans)
// usadas no redesign do módulo. Aplicado localmente — não toca no design system
// global do app (admin continua com tema escuro nas demais áreas).
// =============================================================================

import { useEffect } from "react";

// Tokens da paleta. Os valores reais ficam em CSS (index.css: --pv-*), e estas
// constantes apontam para essas variáveis — fonte única, sem hex duplicado.
// Use as classes Tailwind (bg-pv-accent, text-pv-ink...) sempre que possível;
// estas constantes servem para casos que precisam de cor inline (SVG/style).
export const PV = {
  bg: "hsl(var(--pv-bg))",
  surface: "hsl(var(--pv-surface))",
  mid: "hsl(var(--pv-mid))",
  accent: "hsl(var(--pv-accent))",
  ink: "hsl(var(--pv-ink))",
  gold: "hsl(var(--pv-gold))",
  white: "#ffffff",
} as const;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Fira+Sans:wght@300;400;500;600&display=swap";

const FONT_LINK_ID = "pv-fonts";

/** Carrega as fontes uma única vez (idempotente). */
export function usePvFonts() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.appendChild(link);
  }, []);
}

/** Classe utilitária com fontes do módulo. */
export const pvBody = "font-[Fira_Sans,system-ui,sans-serif]";
export const pvSerif = "font-[DM_Serif_Display,Georgia,serif]";

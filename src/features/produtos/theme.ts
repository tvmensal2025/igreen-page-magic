// =============================================================================
// Produtos & Vendas — Theme (Sage & Cream / Magazine 7+5)
// =============================================================================
// Tokens travados e injeção das fontes editoriais (DM Serif Display + Fira Sans)
// usadas no redesign do módulo. Aplicado localmente — não toca no design system
// global do app (admin continua com tema escuro nas demais áreas).
// =============================================================================

import { useEffect } from "react";

export const PV = {
  bg: "#f5f0e8",
  surface: "#dce5d4",
  mid: "#a8c0a0",
  accent: "#7d9b76",
  ink: "#1a2e1f",
  gold: "#c9a84c",
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

/**
 * Tema da Academy — fonte única de cores e tipografia.
 *
 * Segue o tema global (light | dark) via `useAC()`. Paletas alinhadas ao
 * painel-elite / tokens iGreen — sem misturar Netflix preso no light.
 */

import { useTheme } from "@/contexts/ThemeContext";

export type AcademyColors = {
  bg: string;
  surface: string;
  surface2: string;
  primary: string;
  primaryDeep: string;
  primarySoft: string;
  text: string;
  textDim: string;
  textMute: string;
  border: string;
  borderHi: string;
  danger: string;
  dangerBg: string;
};

/** Cinematográfico — alinhado a html.dark / --background #111 */
export const AC_DARK: AcademyColors = {
  bg: "#111111",
  surface: "#1A1A1A",
  surface2: "#222222",
  primary: "#00A859",
  primaryDeep: "#007A3D",
  primarySoft: "rgba(0,168,89,0.14)",
  text: "#FFFFFF",
  textDim: "rgba(255,255,255,0.66)",
  textMute: "rgba(255,255,255,0.42)",
  border: "rgba(255,255,255,0.10)",
  borderHi: "rgba(0,168,89,0.55)",
  danger: "#DC2626",
  dangerBg: "rgba(220,38,38,0.14)",
};

/** Claro — alinhado a painel-elite light */
export const AC_LIGHT: AcademyColors = {
  bg: "#F6F8F7",
  surface: "#FFFFFF",
  surface2: "#EEF2F0",
  primary: "#00A859",
  primaryDeep: "#007A3D",
  primarySoft: "rgba(0,168,89,0.10)",
  text: "#0A1F1A",
  textDim: "rgba(10,31,26,0.66)",
  textMute: "rgba(10,31,26,0.42)",
  border: "rgba(10,31,26,0.10)",
  borderHi: "rgba(0,122,61,0.45)",
  danger: "#DC2626",
  dangerBg: "rgba(220,38,38,0.10)",
};

/** @deprecated Prefira `useAC()` — default dark só para scripts/legado. */
export const AC = AC_DARK;

export function useAC(): AcademyColors {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? AC_DARK : AC_LIGHT;
}

export const AC_FONT_DISPLAY = "'Outfit', system-ui, sans-serif";
export const AC_FONT_BODY = "'Figtree', system-ui, sans-serif";

/**
 * Tema da Academy — fonte única de cores e tipografia.
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 * Antes, a paleta "Esmeralda Premium" (emerald + dourado) estava cravada e
 * DUPLICADA em AcademyTab, AcademyCatalog, AcademyPlayer e AcademyQuizModal,
 * totalmente fora da identidade iGreen. Centralizar aqui
 * garante que a Academy fique 100% alinhada à marca e que qualquer ajuste
 * futuro aconteça em um só lugar.
 *
 * PALETA: valores oficiais iGreen do MODO ESCURO (ver src/index.css `.dark`).
 * O verde da marca (#00A859) substitui tanto o antigo emerald quanto o dourado.
 * A experiência continua cinematográfica (dark, estilo "streaming"), mas dentro
 * da identidade iGreen — sem dourado, sem fontes de terceiros.
 */

export const AC = {
  /** Fundo cinematográfico — --background (dark) #111111 */
  bg: "#111111",
  /** Superfície de card — --card (dark) #1A1A1A */
  surface: "#1A1A1A",
  /** Superfície elevada (hover/realce) */
  surface2: "#222222",

  /** Verde iGreen — --primary #00A859 (acento único da Academy) */
  primary: "#00A859",
  /** Verde profundo — --primary-text deep #007A3D */
  primaryDeep: "#007A3D",
  /** Verde com baixa opacidade para fundos de realce */
  primarySoft: "rgba(0,168,89,0.14)",

  /** Texto principal — --foreground (dark) branco */
  text: "#FFFFFF",
  /** Texto secundário (~ --muted-foreground claro) */
  textDim: "rgba(255,255,255,0.66)",
  /** Texto terciário/legenda */
  textMute: "rgba(255,255,255,0.42)",

  /** Borda padrão — --border (dark) #2A2A2A em rgba para sobrepor imagem */
  border: "rgba(255,255,255,0.10)",
  /** Borda de realce (verde) */
  borderHi: "rgba(0,168,89,0.55)",

  /** Erro — --destructive #DC2626 */
  danger: "#DC2626",
  dangerBg: "rgba(220,38,38,0.14)",
} as const;

/**
 * Tipografia única do admin (igual ao painel-elite e à Central de Anúncios):
 * Outfit para títulos/display e Figtree para corpo. Mantém a Academy dentro
 * da mesma identidade visual do restante do painel.
 */
export const AC_FONT_DISPLAY = "'Outfit', system-ui, sans-serif";
export const AC_FONT_BODY = "'Figtree', system-ui, sans-serif";

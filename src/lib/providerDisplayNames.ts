/**
 * Rótulos públicos dos canais — NÃO usar nomes de fornecedores na UI.
 * Internamente o código continua com whapi / velip / evolution.
 */
export const PROVIDER_UI = {
  /** Canal WhatsApp principal (Whapi). */
  chat: "iGreen Chat",
  /** Canal WhatsApp legado (Evolution). */
  link: "iGreen Link",
  /** Ligação / SMS / discador (Velip). */
  fone: "iGreen Fone",
} as const;

export type ProviderUiKey = keyof typeof PROVIDER_UI;

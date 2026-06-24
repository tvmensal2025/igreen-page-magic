/** Clientes da carteira iGreen (sync XLSX, worker ou extensão) — distintos de leads WhatsApp. */
export function isIgreenWalletOrigin(origin: string | null | undefined): boolean {
  return origin === "igreen_sync" || origin === "igreen_extension";
}

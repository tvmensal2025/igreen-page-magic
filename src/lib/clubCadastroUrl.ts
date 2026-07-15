/** Link oficial Conexão Club / iGreen Club (SPA club.igreenenergy.com.br). */
export function buildClubCadastroUrl(igreenId: string | number | null | undefined): string {
  const id = String(igreenId ?? "").replace(/\D/g, "");
  return id ? `https://club.igreenenergy.com.br/?id=${id}` : "";
}

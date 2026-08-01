/**
 * Mapa aba Admin → slug do guia em HELP_CATALOG.
 * Usado pelo ? do topbar e pelo FAB flutuante (“Ajuda desta tela”).
 */
export const TAB_GUIDE_SLUG: Record<string, string> = {
  dashboard: "painel",
  crm: "clientes-interessados",
  "crm-clientes": "clientes-ativos",
  "crm-analise": "clientes-interessados",
  conversao: "conversao",
  clientes: "base-clientes",
  financeiro: "financeiro",
  produtos: "produtos",
  captacao: "captacao",
  parceiros: "parceiros",
  whatsapp: "whatsapp-conectar",
  agendamentos: "agendamentos",
  "central-anuncios": "central-anuncios",
  links: "links",
  materiais: "materiais",
  "audio-studio": "audio-studio",
  voz: "ligacao",
  academy: "academy",
  "venda-plataforma": "inicio",
  "lucro-plataforma": "financeiro",
};

/** Guia do WhatsApp conforme a sub-aba. */
export function resolveWhatsAppGuideSlug(section: string | null | undefined): string {
  switch (section) {
    case "templates":
      return "whatsapp-templates";
    case "conversas":
    case "agente":
      return "whatsapp-atendimento";
    case "envio_massa":
    case "agendamentos":
      return "agendamentos";
    default:
      return "whatsapp-conectar";
  }
}

/** Resolve o guia da rota atual (Admin / Ajuda). Nunca retorna null dentro do Admin. */
export function resolveGuideSlugFromLocation(pathname: string, search = ""): string {
  if (pathname === "/ajuda" || pathname.startsWith("/ajuda/")) return "suporte";
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return "inicio";

  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const tab = params.get("tab");
    const section = params.get("section");
    if (tab === "whatsapp") return resolveWhatsAppGuideSlug(section);

    if (tab && TAB_GUIDE_SLUG[tab]) return TAB_GUIDE_SLUG[tab];

    const stored = typeof window !== "undefined" ? window.localStorage.getItem("igreen_admin_active_tab_v1") : null;
    if (stored === "whatsapp") return resolveWhatsAppGuideSlug(section);
    if (stored && TAB_GUIDE_SLUG[stored]) return TAB_GUIDE_SLUG[stored];
  } catch {
    /* ignore */
  }
  return "painel";
}

// Catálogo de mídias usadas nas páginas públicas (Cliente + Licenciada).
// Centralizado aqui pra reusar na aba Materiais do admin (download + envio WhatsApp).

export type MaterialType = "video" | "image";

export type MaterialSection =
  | "noticias"
  | "depoimentos"
  | "cashback"
  | "como_funciona"
  | "hero_cliente"
  | "usina"
  | "club"
  | "licenciada"
  | "conta_energia"
  | "lei_14300";

export interface MaterialItem {
  id: string;
  title: string;
  section: MaterialSection;
  type: MaterialType;
  url: string;
}

export const SECTION_LABEL: Record<MaterialSection, string> = {
  noticias: "Notícias",
  depoimentos: "Depoimentos",
  cashback: "Cashback",
  como_funciona: "Como funciona",
  hero_cliente: "Hero Cliente",
  usina: "Usina",
  club: "iGreen Club",
  licenciada: "Licenciada",
  conta_energia: "Conta de Energia",
  lei_14300: "Lei 14.300",
};

const SB = "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen";

function abs(path: string): string {
  if (path.startsWith("http")) return path;
  if (typeof window !== "undefined") return window.location.origin + path;
  return path;
}

const raw: Omit<MaterialItem, "url"> & { url: string }[] = [
  // ── Notícias ──
  ...[1, 2, 3, 4, 5, 6].map((n) => ({
    id: `noticia-${n}`,
    title: `Reportagem ${n}`,
    section: "noticias" as const,
    type: "video" as const,
    url: `${SB}/noticia${n}.mp4`,
  })),
  { id: "noticia-9", title: "Reportagem 9", section: "noticias", type: "video", url: `${SB}/noticaia9.mp4` },

  // ── Depoimentos ──
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `depoimento-${n}`,
    title: `Depoimento ${n}`,
    section: "depoimentos" as const,
    type: "video" as const,
    url: `/videos/depoimento-${n}.mp4`,
  })),

  // ── Cashback ──
  { id: "cashback", title: "Cashback iGreen", section: "cashback", type: "video", url: `${SB}/cash-back-igreen.mp4` },

  // ── Como funciona ──
  { id: "casa-sustentavel", title: "Casa Sustentável", section: "como_funciona", type: "video", url: `${SB}/casasustentavel.mp4` },

  // ── Hero cliente ──
  { id: "green-energy", title: "Green Energy (Hero)", section: "hero_cliente", type: "video", url: `/videos/Green_Energy.mp4` },

  // ── Usina ──
  { id: "usina-helio", title: "Usina Helio Valgas", section: "usina", type: "video", url: `/videos/usina-helio-valgas.mp4` },

  // ── Club ──
  { id: "club-video-1", title: "Club de Benefícios", section: "club", type: "video", url: `${SB}/club-de-beneficios.mp4` },
  { id: "club-video-2", title: "iGreen Club", section: "club", type: "video", url: `${SB}/igreen_club_3.mp4` },
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({
    id: `club-banner-${n}`,
    title: `Banner Club ${n}`,
    section: "club" as const,
    type: "image" as const,
    url: `/images/club-banner-${n}.png`,
  })),
  { id: "lojas-parceiras", title: "Lojas Parceiras", section: "club", type: "image", url: `/images/lojas-parceiras.png` },

  // ── Licenciada ──
  { id: "lic-hero", title: "Imagine ser Licenciado", section: "licenciada", type: "video", url: `${SB}/imagine-licenciado.mp4` },
  { id: "lic-why", title: "Licenciado iGreen", section: "licenciada", type: "video", url: `${SB}/Licenciadao-1.mp4` },
  { id: "lic-livre", title: "Conexão Livre", section: "licenciada", type: "image", url: `/images/conexao-livre.webp` },
  { id: "lic-green", title: "Conexão Green", section: "licenciada", type: "image", url: `/images/conexao-green.webp` },
  { id: "lic-expansao", title: "Conexão Expansão", section: "licenciada", type: "image", url: `/images/conexao-expansao.webp` },
  { id: "lic-club", title: "Conexão Club", section: "licenciada", type: "image", url: `/images/conexao-club.webp` },
  { id: "lic-solar", title: "Conexão Solar", section: "licenciada", type: "image", url: `/images/conexao-solar.webp` },
  { id: "lic-telecom", title: "Conexão Telecom", section: "licenciada", type: "image", url: `/images/conexao-telecom.webp` },
  { id: "lic-kit", title: "Kit Licenciado", section: "licenciada", type: "image", url: `/images/kit-licenciado-igreen.png` },
  { id: "lic-pj", title: "Assinatura Empresarial", section: "licenciada", type: "image", url: `/images/assinatura-empresarial.png` },
  { id: "lic-planos-telecom", title: "Planos iGreen Telecom", section: "licenciada", type: "image", url: `/images/planos-igreen-telecom.png` },
  { id: "lic-qualificacoes", title: "Plano de Qualificações", section: "licenciada", type: "image", url: `/images/qualificacoes-igreen.png` },

  // ── Conta de energia / Assistente ──
  { id: "conta-video", title: "Como ler a conta de energia", section: "conta_energia", type: "video", url: `${SB}/conta-de-energia.mp4` },

  // ── Lei 14.300 ──
  { id: "lei-mutirao", title: "Mutirão Lei 14.300", section: "lei_14300", type: "image", url: `/images/mutirao-lei-14300.jpg` },
  { id: "lei-banner", title: "Banner Lei 14.300", section: "lei_14300", type: "image", url: `/images/banner-lei-14300-base.jpg` },
];

export const MATERIALS: MaterialItem[] = raw.map((m) => ({ ...m, url: abs(m.url) }));

export const MATERIALS_BY_SECTION: Record<MaterialSection, MaterialItem[]> = MATERIALS.reduce(
  (acc, m) => {
    (acc[m.section] ||= []).push(m);
    return acc;
  },
  {} as Record<MaterialSection, MaterialItem[]>,
);

export const SECTIONS_IN_ORDER: MaterialSection[] = [
  "noticias",
  "depoimentos",
  "cashback",
  "como_funciona",
  "hero_cliente",
  "usina",
  "club",
  "licenciada",
  "conta_energia",
  "lei_14300",
];

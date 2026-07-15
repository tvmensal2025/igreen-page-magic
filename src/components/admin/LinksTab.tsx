import { useState, useEffect, useMemo } from "react";
import { Copy, QrCode, FileText, LinkIcon, ExternalLink, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { LinksDashboard } from "./LinksDashboard";
import { useProducts } from "@/features/produtos/catalogo";

interface LinksTabProps {
  slug: string;
  baseUrl: string;
  onCopy: (url: string) => void;
  onQrOpen: (url: string, label: string) => void;
  onPanfletoOpen?: () => void;
}

// ─── Redes sociais para rastreamento ───
const SOCIAL_SOURCES = [
  { source: "whatsapp", label: "WhatsApp", icon: "💬" },
  { source: "instagram", label: "Instagram", icon: "📸" },
  { source: "facebook", label: "Facebook", icon: "📘" },
  { source: "tiktok", label: "TikTok", icon: "🎵" },
  { source: "youtube", label: "YouTube", icon: "🎬" },
  { source: "google", label: "Google", icon: "🔍" },
];

/** Slug em `products` para filtrar por is_active; null = sempre visível no menu. */
const PAGE_PRODUCT_SLUG: Record<string, string | null> = {
  green: null,
  expansao: null,
  cadastro: null,
  telecom: "conexao-telecom",
  seguros: "conexao-seguros",
  solar: "conexao-solar",
  placas: "conexao-placas",
  livre: "conexao-livre",
  club: "conexao-club",
  "club-pj": "conexao-club-pj",
};

// ─── Páginas (sem duplicatas: Green=cliente, Expansão=licenciado) ───
function getAllPages(slug: string) {
  return [
    { id: "green", emoji: "🌱", label: "Conexão Green", sublabel: "Desconto na conta de luz", path: slug },
    { id: "expansao", emoji: "🚀", label: "Conexão Expansão", sublabel: "Oportunidade para consultores", path: `licenciado/${slug}` },
    { id: "cadastro", emoji: "📱", label: "Cadastro Rápido", sublabel: "QR Code + WhatsApp (3 min)", path: `cadastro/${slug}` },
    { id: "telecom", emoji: "📶", label: "Conexão Telecom", sublabel: "Internet 5G mais rápida", path: `conexao-telecom/${slug}` },
    { id: "seguros", emoji: "🛡️", label: "Conexão Seguros", sublabel: "Proteção veicular acessível", path: `conexao-seguros/${slug}` },
    { id: "solar", emoji: "☀️", label: "Conexão Solar", sublabel: "Placas sem investimento", path: `conexao-solar/${slug}` },
    { id: "placas", emoji: "🔋", label: "Conexão Placas", sublabel: "Instale e economize 95%", path: `conexao-placas/${slug}` },
    { id: "livre", emoji: "⚡", label: "Conexão Livre", sublabel: "Mercado livre de energia", path: `conexao-livre/${slug}` },
    { id: "club", emoji: "🛍️", label: "Conexão Club", sublabel: "30 mil lojas com desconto", path: `conexao-club/${slug}` },
    { id: "club-pj", emoji: "🏢", label: "Conexão Club PJ", sublabel: "Benefícios para empresas", path: `conexao-club-pj/${slug}` },
  ];
}

export function LinksTab({ slug, baseUrl, onCopy, onQrOpen, onPanfletoOpen }: LinksTabProps) {
  const [tab, setTab] = useState<"dashboard" | "links">("dashboard");
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [consultantId, setConsultantId] = useState<string>();
  const [clubCadastroUrl, setClubCadastroUrl] = useState<string>("");
  const { data: activeProducts } = useProducts();

  useEffect(() => {
    supabase
      .from("consultants_public" as any)
      .select("id, club_cadastro_url, igreen_id")
      .eq("license", slug)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const row = data as { id?: string; club_cadastro_url?: string | null; igreen_id?: string | null };
        if (row.id) setConsultantId(row.id);
        const club = (row.club_cadastro_url || "").trim()
          || (row.igreen_id ? `https://club.igreenenergy.com.br/?id=${String(row.igreen_id).replace(/\D/g, "")}` : "");
        setClubCadastroUrl(club);
      });
  }, [slug]);

  const pages = useMemo(() => {
    const all = getAllPages(slug);
    // Enquanto o catálogo não carrega, lista completa; depois filtra is_active.
    if (!activeProducts) return all;
    const activeSlugs = new Set(activeProducts.map((p) => p.slug));
    return all.filter((page) => {
      const productSlug = PAGE_PRODUCT_SLUG[page.id];
      if (productSlug == null) return true;
      return activeSlugs.has(productSlug);
    });
  }, [slug, activeProducts]);

  return (
    <div className="space-y-6">
      {/* Abas internas */}
      <div className="flex gap-2 border-b border-border">
        <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")} icon={<BarChart3 className="w-4 h-4" />} label="Resultados" />
        <TabButton active={tab === "links"} onClick={() => setTab("links")} icon={<LinkIcon className="w-4 h-4" />} label="Meus Links" />
      </div>

      {tab === "dashboard" ? (
        <LinksDashboard consultantId={consultantId} />
      ) : (
        <div className="space-y-4">
          {/* Panfleto */}
          {onPanfletoOpen && (
            <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl border border-primary/20 p-4 flex items-center gap-3">
              <span className="text-2xl">📄</span>
              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-foreground text-sm">Panfleto pra Gráfica</p>
                <p className="text-[11px] text-muted-foreground">A5 com QR do seu WhatsApp. Imprima quantos quiser.</p>
              </div>
              <Button size="sm" onClick={onPanfletoOpen} className="gap-1.5 shrink-0">
                <FileText className="w-3.5 h-3.5" /> Gerar
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Toque em um produto para ver os links de cada rede social (Instagram, WhatsApp, etc)
          </p>

          {clubCadastroUrl && (
            <div className="bg-card rounded-2xl border border-primary/30 overflow-hidden shadow-sm p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl shrink-0 ring-1 ring-primary/20">
                🛍️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-heading font-bold text-sm text-foreground">iGreen Club (cadastro oficial)</p>
                <p className="text-[11px] text-muted-foreground truncate font-mono">{clubCadastroUrl}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Copiar" onClick={() => onCopy(clubCadastroUrl)}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="QR Code" onClick={() => onQrOpen(clubCadastroUrl, "iGreen Club")}>
                  <QrCode className="w-3.5 h-3.5" />
                </Button>
                <a href={clubCadastroUrl} target="_blank" rel="noopener noreferrer" title="Abrir" className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted transition-colors">
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
              </div>
            </div>
          )}

          {pages.map((page) => {
            const fullUrl = `https://${baseUrl}/${page.path}`;
            const isExpanded = expandedPage === page.id;

            return (
              <div key={page.id} className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <button
                  type="button"
                  onClick={() => setExpandedPage(isExpanded ? null : page.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/20 transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl shrink-0 ring-1 ring-primary/20">
                    {page.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-sm text-foreground">{page.label}</p>
                    <p className="text-[11px] text-muted-foreground">{page.sublabel}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Copiar link" onClick={(e) => { e.stopPropagation(); onCopy(fullUrl); }}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="QR Code" onClick={(e) => { e.stopPropagation(); onQrOpen(fullUrl, page.label); }}>
                      <QrCode className="w-3.5 h-3.5" />
                    </Button>
                    <a href={fullUrl} target="_blank" rel="noopener noreferrer" title="Abrir" onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted transition-colors">
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </a>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-primary shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/10 px-4 pb-4 pt-3">
                    <p className="text-xs font-heading font-bold text-muted-foreground mb-2">📲 Compartilhe por rede social:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {SOCIAL_SOURCES.map((s) => {
                        const trackedUrl = `${fullUrl}?utm_source=${s.source}`;
                        return (
                          <div key={s.source} className="flex items-center gap-2 bg-card rounded-xl border border-border p-3 hover:border-primary/30 transition-colors">
                            <span className="text-xl shrink-0">{s.icon}</span>
                            <p className="text-xs font-bold text-foreground flex-1">{s.label}</p>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" title="QR Code" onClick={() => onQrOpen(trackedUrl, `${s.label} — ${page.label}`)}>
                              <QrCode className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] shrink-0 rounded-lg" onClick={() => onCopy(trackedUrl)}>
                              <Copy className="w-3 h-3 mr-1" /> Copiar
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {icon} {label}
    </button>
  );
}

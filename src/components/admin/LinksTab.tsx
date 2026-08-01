import { useState, useEffect, useMemo } from "react";
import { Copy, QrCode, FileText, LinkIcon, ExternalLink, ChevronDown, ChevronUp, BarChart3, Sparkles } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { LinksDashboard } from "./LinksDashboard";
import { useProducts } from "@/features/produtos/catalogo";
import { resolvePublicConsultant } from "@/lib/resolvePublicConsultant";

interface LinksTabProps {
  slug: string;
  baseUrl: string;
  /** ID do consultor logado — obrigatório para o painel ler page_views (RLS). */
  consultantId?: string;
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
//
// `path`        → landing atual (link normal).
// `premiumPath` → versão premium da MESMA página, em paralelo.
//
// As duas são públicas e funcionam ao mesmo tempo. Nada foi substituído.
function getAllPages(slug: string) {
  return [
    { id: "green", emoji: "🌱", label: "Conexão Green", sublabel: "Desconto na conta de luz", path: slug, premiumPath: `premium/${slug}` },
    { id: "expansao", emoji: "🚀", label: "Conexão Expansão", sublabel: "Oportunidade para consultores", path: `licenciado/${slug}`, premiumPath: `premium/expansao/${slug}` },
    // Cadastro Rápido é um formulário, não uma landing — não tem versão premium.
    { id: "cadastro", emoji: "📱", label: "Cadastro Rápido", sublabel: "QR Code + WhatsApp (3 min)", path: `cadastro/${slug}`, premiumPath: null },
    { id: "telecom", emoji: "📶", label: "Conexão Telecom", sublabel: "Internet 5G mais rápida", path: `conexao-telecom/${slug}`, premiumPath: `premium/conexao-telecom/${slug}` },
    { id: "seguros", emoji: "🛡️", label: "Conexão Seguros", sublabel: "Proteção veicular acessível", path: `conexao-seguros/${slug}`, premiumPath: `premium/conexao-seguros/${slug}` },
    { id: "solar", emoji: "☀️", label: "Conexão Solar", sublabel: "Placas sem investimento", path: `conexao-solar/${slug}`, premiumPath: `premium/conexao-solar/${slug}` },
    { id: "placas", emoji: "🔋", label: "Conexão Placas", sublabel: "Instale e economize 95%", path: `conexao-placas/${slug}`, premiumPath: `premium/conexao-placas/${slug}` },
    { id: "livre", emoji: "⚡", label: "Conexão Livre", sublabel: "Mercado livre de energia", path: `conexao-livre/${slug}`, premiumPath: `premium/conexao-livre/${slug}` },
    { id: "club", emoji: "🛍️", label: "Conexão Club", sublabel: "30 mil lojas com desconto", path: `conexao-club/${slug}`, premiumPath: `premium/conexao-club/${slug}` },
    { id: "club-pj", emoji: "🏢", label: "Conexão Club PJ", sublabel: "Benefícios para empresas", path: `conexao-club-pj/${slug}`, premiumPath: `premium/conexao-club-pj/${slug}` },
  ];
}

export function LinksTab({ slug, baseUrl, consultantId: consultantIdProp, onCopy, onQrOpen, onPanfletoOpen }: LinksTabProps) {
  const [tab, setTab] = useState<"dashboard" | "links">("dashboard");
  /** Dentro de Meus Links: só normais OU só premium — nunca misturados. */
  const [linkVersion, setLinkVersion] = useState<"normal" | "premium">("normal");
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [consultantIdResolved, setConsultantIdResolved] = useState<string>();
  const [clubCadastroUrl, setClubCadastroUrl] = useState<string>("");
  const { data: activeProducts } = useProducts();

  // Preferência: ID do login (Admin). Fallback: resolve pela license pública.
  const consultantId = consultantIdProp || consultantIdResolved;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolvePublicConsultant(slug);
        if (cancelled || !resolved) return;
        if (!consultantIdProp) setConsultantIdResolved(resolved.consultant.id);
        const row = resolved.consultant;
        const club = (row.club_cadastro_url || "").trim()
          || (row.igreen_id ? `https://club.igreenenergy.com.br/?id=${String(row.igreen_id).replace(/\D/g, "")}` : "");
        setClubCadastroUrl(club);
      } catch (e) {
        console.warn("[LinksTab] resolvePublicConsultant", e);
        if (!cancelled) {
          toast.error("Não foi possível carregar os links do consultor.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [slug, consultantIdProp]);

  // Ao trocar Normal ↔ Premium, fecha o accordion aberto.
  useEffect(() => {
    setExpandedPage(null);
  }, [linkVersion]);

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

  const pagesDaVersao = useMemo(() => {
    if (linkVersion === "normal") return pages;
    return pages.filter((p) => !!p.premiumPath);
  }, [pages, linkVersion]);

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

          {/* Dois botões claros: Normal OU Premium — nunca misturados no mesmo card */}
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/20 p-1.5">
            <VersionTab
              active={linkVersion === "normal"}
              onClick={() => setLinkVersion("normal")}
              icon={<LinkIcon className="w-4 h-4" />}
              label="Links normais"
              hint="Landing que você já divulga"
            />
            <VersionTab
              active={linkVersion === "premium"}
              onClick={() => setLinkVersion("premium")}
              icon={<Sparkles className="w-4 h-4" />}
              label="Links premium"
              hint="Layout novo, vídeo automático"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {linkVersion === "normal" ? (
              <>
                Mostrando só os <strong className="text-foreground">links normais</strong>. Todas as
                páginas são públicas — qualquer pessoa abre sem login.
              </>
            ) : (
              <>
                Mostrando só os <strong className="text-foreground">links premium</strong>. Também
                são 100% públicos e rodam em paralelo aos normais.
              </>
            )}
          </p>

          {clubCadastroUrl && linkVersion === "normal" && (
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

          {pagesDaVersao.map((page) => {
            const pathDaVersao = linkVersion === "premium" ? page.premiumPath! : page.path;
            const fullUrl = `https://${baseUrl}/${pathDaVersao}`;
            const isExpanded = expandedPage === page.id;
            const labelQr =
              linkVersion === "premium" ? `${page.label} — Premium` : page.label;

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
                    <p className="font-heading font-bold text-sm text-foreground flex items-center gap-1.5 flex-wrap">
                      {page.label}
                      {linkVersion === "premium" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-primary">
                          <Sparkles className="w-2.5 h-2.5" /> Premium
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{page.sublabel}</p>
                  </div>
                  <span className="hidden sm:inline text-[10px] text-muted-foreground shrink-0">
                    {isExpanded ? "fechar" : "links por rede"}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-primary shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {/* Um link só — o da versão escolhida no botão acima */}
                <div className="border-t border-border bg-muted/10 px-4 py-3">
                  <LinkRow
                    titulo={linkVersion === "premium" ? "Link premium" : "Link normal"}
                    descricao={
                      linkVersion === "premium"
                        ? "Layout novo, vídeo automático, mais rápida no celular"
                        : "A página que você já divulga"
                    }
                    url={fullUrl}
                    destaque={linkVersion === "premium"}
                    onCopy={onCopy}
                    onQrOpen={() => onQrOpen(fullUrl, labelQr)}
                  />
                </div>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/10 px-4 pb-4 pt-3">
                    <p className="text-xs font-heading font-bold text-muted-foreground mb-2">
                      📲 Compartilhe por rede social ({linkVersion === "premium" ? "premium" : "normal"}):
                    </p>
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

/**
 * Linha de um link com a URL visível e as ações de copiar, QR e abrir.
 *
 * A URL aparece por extenso (e não escondida atrás de um botão) porque o
 * consultor costuma conferir o endereço antes de mandar para o cliente.
 */
function LinkRow({
  titulo,
  descricao,
  url,
  destaque = false,
  onCopy,
  onQrOpen,
}: {
  titulo: string;
  descricao: string;
  url: string;
  destaque?: boolean;
  onCopy: (url: string) => void;
  onQrOpen: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
        destaque ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          {destaque && <Sparkles className="w-3 h-3 text-primary shrink-0" />}
          {titulo}
        </p>
        <p className="text-[10px] text-muted-foreground">{descricao}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{url}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Copiar link" onClick={() => onCopy(url)}>
          <Copy className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="QR Code" onClick={onQrOpen}>
          <QrCode className="w-3.5 h-3.5" />
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
        >
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
        </a>
      </div>
    </div>
  );
}

/** Botão grande Normal | Premium no topo de Meus Links. */
function VersionTab({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
        active
          ? "bg-card text-foreground shadow-sm ring-1 ring-primary/30"
          : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
      }`}
    >
      <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${active ? "text-primary" : ""}`}>
        {icon}
        {label}
      </span>
      <span className="text-[10px] leading-snug opacity-80">{hint}</span>
    </button>
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

import { useState, useEffect, useMemo } from "react";
import {
  Copy,
  QrCode,
  FileText,
  LinkIcon,
  ExternalLink,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
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

const SOCIAL_SOURCES = [
  { source: "whatsapp", label: "WhatsApp" },
  { source: "instagram", label: "Instagram" },
  { source: "facebook", label: "Facebook" },
  { source: "tiktok", label: "TikTok" },
  { source: "youtube", label: "YouTube" },
  { source: "google", label: "Google" },
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

// `path` → landing padrão · `premiumPath` → versão premium em paralelo.
function getAllPages(slug: string) {
  return [
    { id: "green", label: "Conexão Green", sublabel: "Desconto na conta de luz", path: slug, premiumPath: `premium/${slug}` },
    { id: "expansao", label: "Conexão Expansão", sublabel: "Oportunidade para consultores", path: `licenciado/${slug}`, premiumPath: `premium/expansao/${slug}` },
    { id: "cadastro", label: "Cadastro Rápido", sublabel: "QR Code + WhatsApp (3 min)", path: `cadastro/${slug}`, premiumPath: null as string | null },
    { id: "telecom", label: "Conexão Telecom", sublabel: "Internet 5G mais rápida", path: `conexao-telecom/${slug}`, premiumPath: `premium/conexao-telecom/${slug}` },
    { id: "seguros", label: "Conexão Seguros", sublabel: "Proteção veicular acessível", path: `conexao-seguros/${slug}`, premiumPath: `premium/conexao-seguros/${slug}` },
    { id: "solar", label: "Conexão Solar", sublabel: "Placas sem investimento", path: `conexao-solar/${slug}`, premiumPath: `premium/conexao-solar/${slug}` },
    { id: "placas", label: "Conexão Placas", sublabel: "Instale e economize 95%", path: `conexao-placas/${slug}`, premiumPath: `premium/conexao-placas/${slug}` },
    { id: "livre", label: "Conexão Livre", sublabel: "Mercado livre de energia", path: `conexao-livre/${slug}`, premiumPath: `premium/conexao-livre/${slug}` },
    { id: "club", label: "Conexão Club", sublabel: "30 mil lojas com desconto", path: `conexao-club/${slug}`, premiumPath: `premium/conexao-club/${slug}` },
    { id: "club-pj", label: "Conexão Club PJ", sublabel: "Benefícios para empresas", path: `conexao-club-pj/${slug}`, premiumPath: `premium/conexao-club-pj/${slug}` },
  ];
}

export function LinksTab({
  slug,
  baseUrl,
  consultantId: consultantIdProp,
  onCopy,
  onQrOpen,
  onPanfletoOpen,
}: LinksTabProps) {
  const [linkVersion, setLinkVersion] = useState<"normal" | "premium">("normal");
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [consultantIdResolved, setConsultantIdResolved] = useState<string>();
  const [clubCadastroUrl, setClubCadastroUrl] = useState("");
  const { data: activeProducts } = useProducts();

  const consultantId = consultantIdProp || consultantIdResolved;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolvePublicConsultant(slug);
        if (cancelled || !resolved) return;
        if (!consultantIdProp) setConsultantIdResolved(resolved.consultant.id);
        const row = resolved.consultant;
        const club =
          (row.club_cadastro_url || "").trim() ||
          (row.igreen_id
            ? `https://club.igreenenergy.com.br/?id=${String(row.igreen_id).replace(/\D/g, "")}`
            : "");
        setClubCadastroUrl(club);
      } catch (e) {
        console.warn("[LinksTab] resolvePublicConsultant", e);
        if (!cancelled) {
          toast.error("Não foi possível carregar os links do consultor.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, consultantIdProp]);

  useEffect(() => {
    setExpandedPage(null);
  }, [linkVersion]);

  const pages = useMemo(() => {
    const all = getAllPages(slug);
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

  const isPremium = linkVersion === "premium";

  return (
    <div className="space-y-8">
      {/* ─── Cabeçalho ─── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" data-tour="links-meus">
        <div className="min-w-0 space-y-1">
          <h2 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Seus links
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Copie o link da página e divulgue. Os números de visitas ficam mais abaixo, quando quiser ver.
          </p>
        </div>
        {onPanfletoOpen && (
          <div
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shrink-0"
            data-tour="links-panfleto"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Panfleto A5</p>
              <p className="text-[11px] text-muted-foreground">QR do WhatsApp pra gráfica</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onPanfletoOpen}
              className="h-8 gap-1.5 shrink-0"
              data-tour="links-panfleto-gerar"
            >
              <FileText className="w-3.5 h-3.5" />
              Gerar
            </Button>
          </div>
        )}
      </header>

      {/* ─── Toggle padrão × premium ─── */}
      <section className="space-y-2">
        <div className="inline-flex w-full max-w-md rounded-xl border border-border bg-muted/30 p-1">
          <VersionToggle
            active={!isPremium}
            onClick={() => setLinkVersion("normal")}
            icon={<LinkIcon className="w-3.5 h-3.5" />}
            label="Página padrão"
          />
          <VersionToggle
            active={isPremium}
            onClick={() => setLinkVersion("premium")}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label="Página premium"
          />
        </div>
        <p className="text-xs text-muted-foreground max-w-2xl">
          {isPremium ? (
            <>
              Links da <span className="font-medium text-foreground">página premium</span> (layout novo
              com vídeo). As duas versões existem ao mesmo tempo — este botão só muda quais links você
              copia agora.
            </>
          ) : (
            <>
              Links da <span className="font-medium text-foreground">página padrão</span> (a que você já
              divulga). As duas versões existem ao mesmo tempo — este botão só muda quais links você
              copia agora.
            </>
          )}
        </p>
      </section>

      {/* ─── Grade de produtos ─── */}
      <section className="space-y-3">
        {clubCadastroUrl && !isPremium && (
          <ProductLinkCard
            title="iGreen Club (cadastro oficial)"
            subtitle="Link oficial do Club"
            url={clubCadastroUrl}
            premium={false}
            expanded={false}
            onToggleExpand={undefined}
            onCopy={onCopy}
            onQrOpen={() => onQrOpen(clubCadastroUrl, "iGreen Club")}
            socialUrls={null}
          />
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pagesDaVersao.map((page) => {
            const pathDaVersao = isPremium ? page.premiumPath! : page.path;
            const fullUrl = `https://${baseUrl}/${pathDaVersao}`;
            const isExpanded = expandedPage === page.id;
            const labelQr = isPremium ? `${page.label} — Premium` : page.label;

            return (
              <ProductLinkCard
                key={page.id}
                title={page.label}
                subtitle={page.sublabel}
                url={fullUrl}
                premium={isPremium}
                expanded={isExpanded}
                onToggleExpand={(next) => setExpandedPage(next ? page.id : null)}
                onCopy={onCopy}
                onQrOpen={() => onQrOpen(fullUrl, labelQr)}
                socialUrls={SOCIAL_SOURCES.map((s) => ({
                  ...s,
                  url: `${fullUrl}?utm_source=${s.source}`,
                  qrLabel: `${s.label} — ${page.label}`,
                }))}
                onQrSocial={(url, label) => onQrOpen(url, label)}
              />
            );
          })}
        </div>
      </section>

      {/* ─── Resultados (secundário) ─── */}
      <LinksDashboard consultantId={consultantId} embedded />
    </div>
  );
}

function VersionToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-card text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn(active && "text-primary")}>{icon}</span>
      {label}
    </button>
  );
}

function ProductLinkCard({
  title,
  subtitle,
  url,
  premium,
  expanded,
  onToggleExpand,
  onCopy,
  onQrOpen,
  socialUrls,
  onQrSocial,
}: {
  title: string;
  subtitle: string;
  url: string;
  premium: boolean;
  expanded: boolean;
  onToggleExpand?: (next: boolean) => void;
  onCopy: (url: string) => void;
  onQrOpen: () => void;
  socialUrls: { source: string; label: string; url: string; qrLabel: string }[] | null;
  onQrSocial?: (url: string, label: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-heading text-sm font-bold text-foreground">{title}</p>
            {premium && (
              <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                <Sparkles className="w-2.5 h-2.5" />
                Premium
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground/90" title={url}>
            {url}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => onCopy(url)}
            data-tour="links-copiar"
          >
            <Copy className="w-3.5 h-3.5" />
            Copiar
          </Button>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="QR Code" onClick={onQrOpen}>
            <QrCode className="w-3.5 h-3.5" />
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {onToggleExpand && socialUrls && (
        <Collapsible open={expanded} onOpenChange={onToggleExpand}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            >
              <span>Compartilhar por rede (com rastreio)</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border bg-muted/10 px-4 py-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {socialUrls.map((s) => (
                  <div
                    key={s.source}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <p className="flex-1 text-xs font-medium text-foreground">{s.label}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      title="QR Code"
                      onClick={() => onQrSocial?.(s.url, s.qrLabel)}
                    >
                      <QrCode className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => onCopy(s.url)}
                      data-tour="links-copiar"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copiar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

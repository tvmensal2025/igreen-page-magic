/**
 * Super Admin — Portais & Atalhos
 * Página com todos os dashboards / consoles / health dos produtos usados.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  ArrowLeft,
  BookOpen,
  Copy,
  ExternalLink,
  HeartPulse,
  KeyRound,
  LayoutGrid,
  Link2,
  Loader2,
  LogOut,
  Receipt,
  Search,
  Server,
  Shield,
  Sparkles,
} from "lucide-react";
import {
  SUPER_ADMIN_PORTALS,
  countPortalLinks,
  featuredPortals,
  portalsByCategory,
  type PortalLink,
  type PortalPriority,
  type PortalProduct,
} from "@/lib/superAdminPortals";

const PRIORITY_LABEL: Record<PortalPriority, string> = {
  critico: "Crítico",
  operacional: "Operacional",
  dev: "Dev",
  legado: "Legado",
};

const PRIORITY_CLASS: Record<PortalPriority, string> = {
  critico: "bg-primary/10 text-primary border-primary/20",
  operacional: "bg-info/10 text-info border-info/20",
  dev: "bg-muted text-muted-foreground border-border",
  legado: "bg-warning/10 text-warning border-warning/20",
};

const KIND_ICON: Record<NonNullable<PortalLink["kind"]>, typeof ExternalLink> = {
  dashboard: LayoutGrid,
  docs: BookOpen,
  health: HeartPulse,
  api: Server,
  billing: Receipt,
};

function LinkChip({ link }: { link: PortalLink }) {
  const Icon = KIND_ICON[link.kind ?? "dashboard"] ?? ExternalLink;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/80 px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-colors group"
      title={link.url}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
      <span className="truncate max-w-[200px] sm:max-w-[280px]">{link.label}</span>
      <ExternalLink className="w-3 h-3 shrink-0 opacity-40 group-hover:opacity-80" />
    </a>
  );
}

function ProductCard({ product }: { product: PortalProduct }) {
  const { toast } = useToast();
  const copyAll = async () => {
    const text = product.links.map((l) => `${l.label}\t${l.url}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Links copiados", description: product.name });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  };

  return (
    <div
      className={`premium-card !p-4 sm:!p-5 space-y-3 border ${
        product.featured ? "border-primary/25 ring-1 ring-primary/10" : "border-border/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold font-heading text-foreground truncate">
              {product.name}
            </h3>
            {product.featured && (
              <Badge className="bg-primary text-primary-foreground text-[10px] gap-1">
                <Sparkles className="w-3 h-3" /> Destaque
              </Badge>
            )}
            <Badge variant="outline" className={`text-[10px] ${PRIORITY_CLASS[product.priority]}`}>
              {PRIORITY_LABEL[product.priority]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{product.description}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8 text-muted-foreground"
          onClick={copyAll}
          title="Copiar todos os links"
        >
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {product.links.map((link) => (
          <LinkChip key={`${product.id}-${link.url}-${link.label}`} link={link} />
        ))}
      </div>

      {product.envHints && product.envHints.length > 0 && (
        <div className="pt-1 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
            <KeyRound className="w-3 h-3" /> Secrets / env
          </p>
          <div className="flex flex-wrap gap-1">
            {product.envHints.map((env) => (
              <code
                key={env}
                className="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground font-mono"
              >
                {env}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SuperAdminPortais = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [search, setSearch] = useState("");
  const deniedRef = useRef(false);
  const { isSuperAdmin, loading: roleLoading } = useUserRole(userId);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) {
        setUserId(null);
        setAuthLoading(false);
        navigate("/auth", { replace: true });
        return;
      }
      setUserId(session.user.id);
      setAuthLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setUserId(null);
        setAuthLoading(false);
        navigate("/auth", { replace: true });
        return;
      }
      setUserId(session.user.id);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (authLoading || roleLoading || !userId) return;
    if (!isSuperAdmin) {
      if (!deniedRef.current) {
        deniedRef.current = true;
        toast({
          title: "Acesso negado",
          description: "Você não tem permissão de super administrador.",
          variant: "destructive",
        });
      }
      navigate("/admin", { replace: true });
    }
  }, [authLoading, isSuperAdmin, roleLoading, userId, navigate, toast]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return SUPER_ADMIN_PORTALS;
    return SUPER_ADMIN_PORTALS.filter((p) => {
      const hay = [
        p.name,
        p.description,
        p.category,
        ...(p.envHints ?? []),
        ...p.links.map((l) => `${l.label} ${l.url}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [q]);

  const featured = useMemo(
    () => featuredPortals().filter((p) => filtered.some((f) => f.id === p.id)),
    [filtered],
  );

  const byCat = useMemo(() => {
    const map = portalsByCategory();
    const out = new Map<string, PortalProduct[]>();
    for (const [cat, list] of map) {
      const keep = list.filter((p) => filtered.some((f) => f.id === p.id) && !p.featured);
      if (keep.length) out.set(cat, keep);
    }
    // Featured already shown on top — also show non-featured from same categories
    // Re-include featured in category sections? Better: featured only on top, rest below without featured
    return out;
  }, [filtered]);

  // When searching, show all matches flat; otherwise featured + categories
  const showFlatSearch = Boolean(q);

  if (authLoading || roleLoading || (!isSuperAdmin && userId)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center animate-pulse">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-primary absolute -bottom-1 -right-1" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">Verificando permissões...</p>
      </div>
    );
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const totalLinks = countPortalLinks();

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[40%] -right-[20%] w-[60%] h-[60%] rounded-full bg-primary/[0.02] blur-3xl" />
        <div className="absolute -bottom-[30%] -left-[15%] w-[50%] h-[50%] rounded-full bg-primary/[0.02] blur-3xl" />
      </div>

      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/super-admin")}
              className="shrink-0"
              title="Voltar ao Super Admin"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
              <Link2 className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold font-heading text-foreground truncate">
                  Portais & Atalhos
                </h1>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-medium">
                  {SUPER_ADMIN_PORTALS.length} produtos · {totalLinks} links
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Dashboards, consoles e health de tudo que a plataforma usa
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="relative max-w-[1760px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-6 space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-0 max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto, URL, secret…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 bg-card/50 border-border/50 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
          </div>
          <Badge variant="outline" className="text-xs py-1.5 px-3 border-border/50">
            {filtered.length} resultado(s)
          </Badge>
        </div>

        {showFlatSearch ? (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Resultados
            </h2>
            {filtered.length === 0 ? (
              <div className="premium-card text-center py-12">
                <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">Nenhum portal encontrado</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">
                  Principais (Lovable · Gemini · GPT · Velip · EasyPanel · Whapi)
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {featured.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>

            {[...byCat.entries()].map(([cat, list]) => (
              <section key={cat} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {cat}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
};

export default SuperAdminPortais;

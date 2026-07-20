import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Bot, CircleHelp, ExternalLink, MessageCircle, Play, Search, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTour } from "@/features/onboarding/useTour";
import type { TourArticle } from "@/features/onboarding/types";
import { HELP_CATEGORIES, mergeHelpArticles, searchHelpCatalog, type HelpArticle } from "@/features/help/helpCatalog";

export default function AjudaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<TourArticle[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<HelpArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { start, steps } = useTour();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.from("tour_articles" as never).select("*").eq("is_active", true).order("order_index");
      setRows((data as unknown as TourArticle[]) || []);
      setLoadError(!!error);
      setLoading(false);
    };
    void load();
  }, []);

  useEffect(() => {
    if (params.get("suporte") === "1") window.setTimeout(() => window.dispatchEvent(new CustomEvent("open-support-chat")), 150);
  }, [params]);

  const catalog = useMemo(() => mergeHelpArticles(rows, steps), [rows, steps]);
  const results = useMemo(() => searchHelpCatalog(query, category, catalog), [catalog, category, query]);
  const featured = catalog.filter((item) => item.featured).slice(0, 4);
  const categories = HELP_CATEGORIES.map((name) => ({ name, count: catalog.filter((item) => item.category === name).length })).filter(({ count }) => count > 0);

  const openDestination = (href: string) => href.startsWith("http") ? window.open(href, "_blank", "noopener,noreferrer") : navigate(href);
  const startRelatedTour = (article: HelpArticle) => article.related_tour_step_id ? void start({ stepId: article.related_tour_step_id }) : void start();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 min-w-0">
          <Link to="/admin"><Button variant="ghost" size="icon" aria-label="Voltar ao painel" className="shrink-0"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <BookOpen className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold sm:text-xl truncate">Central de ajuda</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Encontre um guia, abra a tela certa ou peça ajuda à IA.</p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => void start()}><Play className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Conhecer a plataforma</span><span className="sm:hidden">Tour</span></Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-8">
        <section className="rounded-2xl border bg-card px-5 py-7 sm:px-8 sm:py-10">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-3"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Ajuda guiada</Badge>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">O que você quer fazer?</h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">Busque por uma tarefa ou problema. Cada guia mostra os passos e leva você até a página correta.</p>
            <div className="relative mt-5">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: conectar WhatsApp, campanha reprovada ou comissão" className="h-12 bg-background pl-12 text-base" aria-label="Buscar na Central de ajuda" />
            </div>
          </div>
        </section>

        <section aria-labelledby="quick-help-heading">
          <div className="mb-3 flex items-center justify-between"><h2 id="quick-help-heading" className="text-lg font-semibold">Ajuda rápida</h2></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelected(item)} className="group rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <CircleHelp className="mb-3 h-5 w-5 text-primary" /><h3 className="font-semibold leading-snug">{item.title}</h3><p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p><span className="mt-3 inline-flex items-center text-xs font-medium text-primary">Ver passos<ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="all-guides-heading" className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside><h2 id="all-guides-heading" className="mb-3 text-sm font-semibold">Assuntos</h2><div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            <Button size="sm" variant={category === "all" ? "default" : "ghost"} className="shrink-0 justify-between lg:w-full" onClick={() => setCategory("all")}>Todos <span className="ml-2 opacity-70">{catalog.length}</span></Button>
            {categories.map(({ name, count }) => <Button key={name} size="sm" variant={category === name ? "default" : "ghost"} className="shrink-0 justify-between lg:w-full" onClick={() => setCategory(name)}>{name}<span className="ml-2 opacity-70">{count}</span></Button>)}
          </div></aside>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">{query ? `Resultados para “${query}”` : category === "all" ? "Todos os guias" : category}</h2><p className="text-xs text-muted-foreground">{results.length} {results.length === 1 ? "guia encontrado" : "guias encontrados"}</p></div></div>
            {loadError && <div className="mb-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Os guias essenciais continuam disponíveis. O conteúdo atualizado pelo administrador não pôde ser carregado agora.</div>}
            {loading ? <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 w-full" />)}</div> : results.length === 0 ? (
              <Card className="p-8 text-center"><Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">Nenhum guia encontrado</h3><p className="mt-1 text-sm text-muted-foreground">Tente palavras mais simples ou pergunte ao suporte com IA.</p><Button className="mt-4" variant="outline" onClick={() => window.dispatchEvent(new CustomEvent("open-support-chat"))}><MessageCircle className="mr-2 h-4 w-4" />Perguntar à IA</Button></Card>
            ) : <div className="divide-y rounded-xl border bg-card">{results.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelected(item)} className="group flex w-full items-start gap-4 p-4 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5">
                <div className="mt-0.5 hidden rounded-lg bg-primary/10 p-2 text-primary sm:block"><BookOpen className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.title}</h3><Badge variant="outline" className="text-[10px]">{item.category}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.summary}</p><span className="mt-2 inline-flex items-center text-xs font-medium text-primary">Abrir passo a passo<ArrowRight className="ml-1 h-3.5 w-3.5" /></span></div>
              </button>
            ))}</div>}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border bg-muted/30 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Bot className="mt-0.5 h-6 w-6 shrink-0 text-primary" /><div><h2 className="font-semibold">Ainda precisa de ajuda?</h2><p className="text-sm text-muted-foreground">A assistência com IA consulta os guias e os dados atuais da sua operação.</p></div></div><Button onClick={() => window.dispatchEvent(new CustomEvent("open-support-chat"))}><MessageCircle className="mr-2 h-4 w-4" />Perguntar ao suporte</Button></section>
      </main>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl w-[calc(100%-2rem)] overflow-y-auto sm:rounded-2xl">
          {selected && <>
            <DialogHeader className="pr-8"><div className="mb-2"><Badge variant="secondary">{selected.category}</Badge></div><DialogTitle className="text-xl sm:text-2xl">{selected.title}</DialogTitle><DialogDescription>{selected.summary}</DialogDescription></DialogHeader>
            {selected.video_url && <div className="aspect-video overflow-hidden rounded-xl border bg-muted"><iframe src={selected.video_url} title={`Vídeo: ${selected.title}`} className="h-full w-full" allowFullScreen /></div>}
            <ol className="space-y-4 py-2">{selected.steps.map((step, itemIndex) => <li key={`${selected.id}-${itemIndex}`} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{itemIndex + 1}</span><p className="pt-0.5 text-sm leading-relaxed sm:text-base">{step}</p></li>)}</ol>
            <DialogFooter className="gap-2 border-t pt-4 sm:justify-between">
              {selected.related_tour_step_id && <Button variant="outline" onClick={() => { setSelected(null); startRelatedTour(selected); }}><Play className="mr-2 h-4 w-4" />Mostrar na tela</Button>}
              <Button className="sm:ml-auto" onClick={() => openDestination(selected.href)}>Abrir página<ExternalLink className="ml-2 h-4 w-4" /></Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

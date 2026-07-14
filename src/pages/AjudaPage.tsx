import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Play, ArrowLeft, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useTour } from "@/features/onboarding/useTour";
import { ARTICLE_CATEGORIES, type TourArticle } from "@/features/onboarding/types";

export default function AjudaPage() {
  const [articles, setArticles] = useState<TourArticle[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const { start, steps } = useTour();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tour_articles" as never)
        .select("*")
        .eq("is_active", true)
        .order("order_index");
      setArticles((data as unknown as TourArticle[]) || []);
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return articles.filter((a) => {
      if (cat !== "all" && a.category !== cat) return false;
      if (!term) return true;
      return `${a.title} ${a.body}`.toLowerCase().includes(term);
    });
  }, [articles, q, cat]);

  const startTourAt = (stepId: string | null) => {
    if (!stepId) return start();
    const idx = steps.findIndex((s) => s.id === stepId);
    start({ from: idx >= 0 ? idx : 0 });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Central de Ajuda</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => start()}>
              <Play className="h-4 w-4 mr-2" /> Fazer tour completo
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por palavra-chave (ex: WhatsApp, campanha, kanban)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={cat === "all" ? "default" : "outline"} onClick={() => setCat("all")}>
            Todas ({articles.length})
          </Button>
          {ARTICLE_CATEGORIES.map((c) => {
            const n = articles.filter((a) => a.category === c).length;
            if (n === 0) return null;
            return (
              <Button key={c} size="sm" variant={cat === c ? "default" : "outline"} onClick={() => setCat(c)}>
                {c} ({n})
              </Button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            {articles.length === 0
              ? "Nenhum artigo publicado ainda. Peça ao administrador para gerar o conteúdo em /admin/ajuda/editor."
              : "Nenhum artigo encontrado com esse filtro."}
          </Card>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((a) => (
            <Card key={a.id} className="p-4 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge variant="secondary" className="text-xs">{a.category}</Badge>
              </div>
              <h3 className="font-semibold mb-2">{a.title}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-4 mb-3">{a.body}</p>
              {a.related_tour_step_id && (
                <Button size="sm" variant="outline" onClick={() => startTourAt(a.related_tour_step_id)}>
                  <Play className="h-3.5 w-3.5 mr-2" /> Fazer o tour desta função
                </Button>
              )}
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

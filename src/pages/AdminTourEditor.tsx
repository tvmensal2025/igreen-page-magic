import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Save, Sparkles, Play, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTour } from "@/features/onboarding/useTour";
import { ARTICLE_CATEGORIES, type TourStep, type TourArticle } from "@/features/onboarding/types";

export default function AdminTourEditor() {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [articles, setArticles] = useState<TourArticle[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<TourStep>>>({});
  const [artDrafts, setArtDrafts] = useState<Record<string, Partial<TourArticle>>>({});
  const { start } = useTour();

  const load = async () => {
    const [s, a] = await Promise.all([
      supabase.from("tour_steps" as never).select("*").order("order_index"),
      supabase.from("tour_articles" as never).select("*").order("category").order("order_index"),
    ]);
    setSteps((s.data as unknown as TourStep[]) || []);
    setArticles((a.data as unknown as TourArticle[]) || []);
    setDrafts({});
    setArtDrafts({});
  };

  useEffect(() => { void load(); }, []);

  const patchStep = (id: string, patch: Partial<TourStep>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));

  const saveStep = async (row: TourStep) => {
    const patch = drafts[row.id];
    if (!patch) return;
    setSaving(row.id);
    const { error } = await supabase.from("tour_steps" as never).update(patch as never).eq("id", row.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Passo salvo");
    await load();
  };

  const regenerateAll = async () => {
    setGenerating(true);
    const { data, error } = await supabase.functions.invoke("generate-tour-content", {
      body: { mode: "all" },
    });
    setGenerating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Gerados ${data?.updated ?? 0} passos + ${data?.articles ?? 0} artigos`);
    await load();
  };

  const regenerateStep = async (order_index: number) => {
    setSaving(`gen-${order_index}`);
    const { error } = await supabase.functions.invoke("generate-tour-content", {
      body: { mode: "step", order_index },
    });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Passo regenerado");
    await load();
  };

  const patchArticle = (id: string, patch: Partial<TourArticle>) =>
    setArtDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));

  const saveArticle = async (row: TourArticle) => {
    const patch = artDrafts[row.id];
    if (!patch) return;
    setSaving(row.id);
    const { error } = await supabase.from("tour_articles" as never).update(patch as never).eq("id", row.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Artigo salvo");
    await load();
  };

  const addArticle = async () => {
    const { error } = await supabase.from("tour_articles" as never).insert({
      category: "WhatsApp",
      title: "Novo artigo",
      body: "",
      order_index: articles.length,
    } as never);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  const deleteArticle = async (id: string) => {
    if (!confirm("Remover este artigo?")) return;
    const { error } = await supabase.from("tour_articles" as never).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/admin"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold">Editor de Ajuda & Tour</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => start()}>
              <Play className="h-4 w-4 mr-2" /> Prévia do tour
            </Button>
            <Button size="sm" onClick={regenerateAll} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Regenerar tudo com IA
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs defaultValue="steps">
          <TabsList>
            <TabsTrigger value="steps">Tour ({steps.length} passos)</TabsTrigger>
            <TabsTrigger value="articles">Artigos ({articles.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="space-y-3 mt-4">
            {steps.map((s) => {
              const d = drafts[s.id] || {};
              const cur = { ...s, ...d };
              const dirty = Object.keys(d).length > 0;
              return (
                <Card key={s.id} className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge>Passo {s.order_index}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">{s.route}</Badge>
                    {s.selector && <Badge variant="secondary" className="font-mono text-[10px]">{s.selector}</Badge>}
                    {dirty && <Badge variant="secondary" className="ml-auto">não salvo</Badge>}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input placeholder="Título" value={cur.title} onChange={(e) => patchStep(s.id, { title: e.target.value })} />
                    <Input placeholder="Texto do link (opcional)" value={cur.cta_label || ""} onChange={(e) => patchStep(s.id, { cta_label: e.target.value })} />
                    <Input placeholder="Rota exata (ex.: /admin?tab=whatsapp)" value={cur.route} onChange={(e) => patchStep(s.id, { route: e.target.value })} />
                    <Input placeholder='Seletor visual (ex.: [data-tour="whatsapp"])' value={cur.selector || ""} onChange={(e) => patchStep(s.id, { selector: e.target.value || null })} />
                  </div>
                  <Textarea rows={3} placeholder="Texto do balão" value={cur.body} onChange={(e) => patchStep(s.id, { body: e.target.value })} />
                  <Input placeholder="Link do botão (ex.: /admin/motor)" value={cur.cta_href || ""} onChange={(e) => patchStep(s.id, { cta_href: e.target.value })} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => regenerateStep(s.order_index)} disabled={saving === `gen-${s.order_index}`}>
                      {saving === `gen-${s.order_index}` ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
                      Regenerar com IA
                    </Button>
                    <Button size="sm" onClick={() => saveStep(s)} disabled={!dirty || saving === s.id}>
                      <Save className="h-3.5 w-3.5 mr-2" /> {saving === s.id ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="articles" className="space-y-3 mt-4">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={addArticle}>
                <Plus className="h-4 w-4 mr-2" /> Novo artigo
              </Button>
            </div>
            {articles.map((a) => {
              const d = artDrafts[a.id] || {};
              const cur = { ...a, ...d };
              const dirty = Object.keys(d).length > 0;
              return (
                <Card key={a.id} className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <select
                      className="border rounded-md px-2 py-1 text-xs bg-background"
                      value={cur.category}
                      onChange={(e) => patchArticle(a.id, { category: e.target.value })}
                    >
                      {ARTICLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select
                      className="border rounded-md px-2 py-1 text-xs bg-background"
                      value={cur.related_tour_step_id || ""}
                      onChange={(e) => patchArticle(a.id, { related_tour_step_id: e.target.value || null })}
                    >
                      <option value="">— sem tour vinculado —</option>
                      {steps.map((s) => <option key={s.id} value={s.id}>Passo {s.order_index}: {s.title}</option>)}
                    </select>
                    {dirty && <Badge variant="secondary">não salvo</Badge>}
                    <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" onClick={() => deleteArticle(a.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input placeholder="Título" value={cur.title} onChange={(e) => patchArticle(a.id, { title: e.target.value })} />
                  <Textarea rows={6} placeholder="Passo a passo do artigo. Use uma etapa por linha." value={cur.body} onChange={(e) => patchArticle(a.id, { body: e.target.value })} />
                  <Input placeholder="URL do vídeo (opcional)" value={cur.video_url || ""} onChange={(e) => patchArticle(a.id, { video_url: e.target.value || null })} />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => saveArticle(a)} disabled={!dirty || saving === a.id}>
                      <Save className="h-3.5 w-3.5 mr-2" /> {saving === a.id ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

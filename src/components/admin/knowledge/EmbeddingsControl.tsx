import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Stats {
  total: number;
  comEmbedding: number;
  semEmbedding: number;
  ultimaAtualizacao: string | null;
}

export default function EmbeddingsControl() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function loadStats() {
    setLoading(true);
    const { count: total } = await supabase
      .from("ai_knowledge_sections")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    const { count: com } = await supabase
      .from("ai_knowledge_sections")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .not("embedding", "is", null);
    const { data: latest } = await supabase
      .from("ai_knowledge_sections")
      .select("embedding_updated_at")
      .eq("is_active", true)
      .not("embedding_updated_at", "is", null)
      .order("embedding_updated_at", { ascending: false })
      .limit(1);
    setStats({
      total: total ?? 0,
      comEmbedding: com ?? 0,
      semEmbedding: (total ?? 0) - (com ?? 0),
      ultimaAtualizacao: latest?.[0]?.embedding_updated_at ?? null,
    });
    setLoading(false);
  }

  useEffect(() => { void loadStats(); }, []);

  async function regenerarTodos() {
    setProcessing(true);
    try {
      let processados = 0;
      // chama em lotes — a edge processa 50 por chamada
      for (let i = 0; i < 20; i++) {
        const { data, error } = await supabase.functions.invoke("embed-knowledge", { body: {} });
        if (error) throw error;
        const n = Number((data as any)?.processed || 0);
        processados += n;
        if (n === 0) break;
      }
      toast({ title: "Embeddings gerados", description: `${processados} seção(ões) processadas.` });
      await loadStats();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao gerar embeddings", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  }

  const pct = stats && stats.total > 0 ? Math.round((stats.comEmbedding / stats.total) * 100) : 0;
  const allGood = stats && stats.semEmbedding === 0 && stats.total > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2">
            {allGood ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : stats && stats.semEmbedding > 0 ? (
              <AlertCircle className="h-4 w-4 text-warning" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <h3 className="text-sm font-semibold">Busca semântica da IA</h3>
            {stats && (
              <Badge variant={allGood ? "default" : "secondary"} className="ml-1">
                {pct}% indexado
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            A Vendedora v1 usa esses embeddings para buscar a resposta certa na sua base. Seções novas são indexadas automaticamente.
            {stats && stats.semEmbedding > 0 && (
              <> <strong className="text-warning">{stats.semEmbedding} pendente(s).</strong></>
            )}
          </p>
          {stats?.ultimaAtualizacao && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Última indexação: {new Date(stats.ultimaAtualizacao).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadStats} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={regenerarTodos} disabled={processing || (stats?.semEmbedding === 0)}>
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {processing ? "Processando…" : "Indexar pendentes"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Brain, ChevronRight, RefreshCw, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { KpisRow } from "./KpisRow";
import { ActionDrillDialog } from "./ActionDrillDialog";

interface Diag {
  kpis: any;
  bottlenecks: any[];
  winners: any[];
  actions: any[];
  summary: string | null;
  sample_size: number;
  model_used: string | null;
  computed_at: string;
}

const severityColor: Record<string, string> = {
  high: "text-destructive border-destructive/30 bg-destructive/10",
  medium: "text-warning border-warning/30 bg-warning/10",
  low: "text-info border-info/30 bg-info/10",
};

export function IntelDiagnostic() {
  const { toast } = useToast();
  const [diag, setDiag] = useState<Diag | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeAction, setActiveAction] = useState<any | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("capture_diagnostics" as any)
      .select("kpis, bottlenecks, winners, actions, summary, sample_size, model_used, computed_at")
      .eq("scope", "global")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDiag(data as any);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function run() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("captacao-intel", { body: {} });
      if (error) throw error;
      toast({ title: "✅ Diagnóstico atualizado" });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black font-heading text-foreground flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Inteligência de Captação
          </h2>
          {diag && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {diag.sample_size} sinais analisados · atualizado {formatDistanceToNow(new Date(diag.computed_at), { locale: ptBR, addSuffix: true })}
              {diag.model_used && <span> · {diag.model_used}</span>}
            </p>
          )}
        </div>
        <Button size="sm" onClick={run} disabled={running} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Analisando funil..." : "Rodar IA agora"}
        </Button>
      </div>

      <KpisRow kpis={diag?.kpis} />

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando diagnóstico...</p>
      ) : !diag ? (
        <div className="rounded-xl border border-border/40 bg-card/40 p-8 text-center">
          <Brain className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground mb-1">Nenhum diagnóstico ainda</p>
          <p className="text-xs text-muted-foreground mb-4">Clique em "Rodar IA agora" para analisar funil, criativos e concorrentes.</p>
        </div>
      ) : (
        <>
          {diag.summary && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">💡 {diag.summary}</p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {/* Gargalos */}
            <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <TrendingDown className="w-4 h-4 text-destructive" />
                Onde está perdendo
              </h3>
              {diag.bottlenecks?.length ? (
                <ul className="space-y-2">
                  {diag.bottlenecks.map((b: any, i: number) => (
                    <li key={i} className={`rounded-lg border p-3 ${severityColor[b.severity] || severityColor.low}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-bold text-foreground">{b.title}</p>
                        {b.metric && <Badge variant="outline" className="text-[10px] shrink-0">{b.metric}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{b.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nenhum gargalo crítico detectado.</p>
              )}
            </div>

            {/* Vencedores */}
            <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" />
                O que está funcionando
              </h3>
              {diag.winners?.length ? (
                <ul className="space-y-2">
                  {diag.winners.map((w: any, i: number) => (
                    <li key={i} className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                      <p className="text-xs font-bold text-foreground">{w.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{w.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">Dados insuficientes ainda.</p>
              )}
            </div>
          </div>

          {/* Ações */}
          {diag.actions?.length > 0 && (
            <div className="rounded-xl border border-primary/30 bg-card/60 backdrop-blur p-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-primary" />
                Ações recomendadas
              </h3>
              <div className="grid sm:grid-cols-2 gap-2">
                {diag.actions.map((a: any, i: number) => (
                  <button
                    key={i}
                    onClick={() => setActiveAction(a)}
                    className="text-left rounded-lg border border-border/40 bg-background/40 p-3 hover:border-primary/60 hover:bg-background/60 transition group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs font-bold text-foreground flex items-center gap-1">
                        {a.label}
                        <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                      </p>
                      <Badge variant={a.impact === "high" ? "default" : "outline"} className="text-[10px] shrink-0">
                        {a.impact === "high" ? "🔥" : a.impact === "medium" ? "⚡" : "·"} {a.impact}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground italic mt-2">Clique numa ação para abrir os dados e executar.</p>
            </div>
          )}

        </>
      )}

      <ActionDrillDialog
        open={!!activeAction}
        onOpenChange={(o) => !o && setActiveAction(null)}
        action={activeAction}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Brain, RefreshCw, TrendingUp, TrendingDown, Lightbulb, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Insight {
  winning_patterns: any;
  losing_patterns: any;
  summary: string | null;
  sample_size: number;
  best_ctr_bps: number;
  best_cpa_cents: number | null;
  updated_at: string;
}

interface Props { consultantId: string }

function patternsToList(p: any): string[] {
  if (!Array.isArray(p)) return [];
  return p.map(x => typeof x === "string" ? x : (x?.pattern || x?.text || JSON.stringify(x))).filter(Boolean).slice(0, 6);
}

export function InsightsPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [freqAlert, setFreqAlert] = useState<{ avg: number; max: number; days: number } | null>(null);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [{ data }, { data: evidenceRows }, { data: freqRows }] = await Promise.all([
      supabase
        .from("ad_creative_insights")
        .select("winning_patterns, losing_patterns, summary, sample_size, best_ctr_bps, best_cpa_cents, updated_at")
        .eq("consultant_id", consultantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("ad_creative_performance")
        .select("is_winner, is_loser")
        .eq("consultant_id", consultantId)
        .or("is_winner.eq.true,is_loser.eq.true")
        .limit(1000),
      supabase
        .from("facebook_metrics_daily")
        .select("frequency_x100, facebook_campaigns!inner(consultant_id)")
        .eq("facebook_campaigns.consultant_id", consultantId)
        .gte("date", since),
    ]);
    setInsight(data as Insight | null);
    setEvidenceCount((evidenceRows || []).length);
    if (freqRows && freqRows.length > 0) {
      const freqs = freqRows.map((r: any) => (r.frequency_x100 || 0) / 100).filter(f => f > 0);
      if (freqs.length > 0) {
        const avg = freqs.reduce((a, b) => a + b, 0) / freqs.length;
        const max = Math.max(...freqs);
        setFreqAlert({ avg, max, days: freqs.length });
      } else {
        setFreqAlert(null);
      }
    } else {
      setFreqAlert(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [consultantId]);

  async function run() {
    setRunning(true);
    try {
      // 1) Puxa copy real dos anúncios do Meta (headline/primary_text/formato)
      const { error: syncErr } = await supabase.functions.invoke("facebook-sync-ad-creatives", {
        body: { consultant_id: consultantId },
      });
      if (syncErr) console.warn("[insights] sync-creatives falhou:", syncErr);
      // 2) Roda o aprendizado com a copy real já populada
      const { error } = await supabase.functions.invoke("ad-creative-learner", { body: {} });
      if (error) throw error;
      toast({ title: "Análise concluída", description: "Criativos sincronizados e insights atualizados." });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  const winners = patternsToList(insight?.winning_patterns);
  const losers = patternsToList(insight?.losing_patterns);
  const confidence = evidenceCount >= 10 ? "Alta" : evidenceCount >= 4 ? "Média" : "Baixa";

  return (
    <Card className="p-5 bg-card/50 backdrop-blur border-border/60">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Insights da IA (sua performance)
          </h3>
          {insight && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {insight.sample_size} anúncios com dados granulares · atualizado {formatDistanceToNow(new Date(insight.updated_at), { locale: ptBR, addSuffix: true })}
              </p>
              <Badge variant="outline" className="text-[10px] h-5">Confiança {confidence.toLowerCase()} · {evidenceCount} classificados</Badge>
            </div>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Analisando..." : "Atualizar agora"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>
      ) : !insight ? (
        <div className="text-center py-6 space-y-2">
          <Lightbulb className="w-8 h-8 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">Sem insights ainda.</p>
          <p className="text-xs text-muted-foreground">Use “Atualizar agora” depois que houver métricas granulares por anúncio. Nenhuma agenda automática é presumida aqui.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {insight.summary && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
              <p className="text-sm text-foreground font-medium">💡 {insight.summary}</p>
            </div>
          )}
          {freqAlert && freqAlert.max >= 3 && (
            <div className={`p-3 rounded-lg border flex gap-2 items-start ${freqAlert.max >= 4 ? "bg-destructive/10 border-destructive/40" : "bg-warning/10 border-warning/40"}`}>
              <AlertTriangle className={`w-4 h-4 mt-0.5 ${freqAlert.max >= 4 ? "text-destructive" : "text-warning"}`} />
              <div className="text-xs">
                <p className="font-semibold text-foreground">
                  {freqAlert.max >= 4 ? "Audiência saturada" : "Frequência alta"} — pico de {freqAlert.max.toFixed(1)}x, média {freqAlert.avg.toFixed(1)}x (7 dias)
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {freqAlert.max >= 4
                    ? "A repetição elevada pode indicar fadiga. Revise criativo e público sem pausar automaticamente."
                    : "Acompanhe a tendência e planeje uma nova variação se a frequência continuar subindo."}
                </p>
              </div>
            </div>
          )}


          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs font-semibold text-primary flex items-center gap-1 mb-2">
                <TrendingUp className="w-3.5 h-3.5" /> O que funciona
              </h4>
              {winners.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Sem dados suficientes</p>
              ) : (
                <ul className="space-y-1">
                  {winners.map((w, i) => <li key={i} className="text-xs text-foreground flex gap-1.5"><span className="text-primary">▸</span>{w}</li>)}
                </ul>
              )}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-destructive flex items-center gap-1 mb-2">
                <TrendingDown className="w-3.5 h-3.5" /> O que evitar
              </h4>
              {losers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Sem dados suficientes</p>
              ) : (
                <ul className="space-y-1">
                  {losers.map((w, i) => <li key={i} className="text-xs text-foreground flex gap-1.5"><span className="text-destructive">▸</span>{w}</li>)}
                </ul>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Melhor CTR</p>
              <p className="text-base font-bold text-foreground tabular-nums">{(insight.best_ctr_bps / 100).toFixed(2)}%</p>
            </div>
            {insight.best_cpa_cents != null && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Melhor CPA</p>
                <p className="text-base font-bold text-foreground tabular-nums">R$ {(insight.best_cpa_cents / 100).toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

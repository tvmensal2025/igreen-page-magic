/**
 * LearningHealthPanel — visão geral da saúde do ciclo de aprendizado da IA.
 *
 * Mostra:
 * - Padrões aprendidos por intent (ai_learned_patterns)
 * - Quantos exemplos bons/ruins foram coletados
 * - Uso recente de cada intent (últimos 7 dias)
 * - Botão para forçar ciclo de aprendizado
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Cpu, RefreshCw, CheckCircle2, XCircle, BookOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PatternSummary {
  intent: string;
  sample_count: number;
  good_count: number;
  bad_count: number;
  recent_uses_7d: number;
  updated_at: string;
}

interface Props {
  consultantId: string;
}

const INTENT_LABELS: Record<string, string> = {
  cadastrar: "Cadastrar",
  humano: "Pedir humano",
  desistir: "Desistir",
  objecao_confianca: "Objeção: confiança",
  objecao_contrato: "Objeção: contrato",
  objecao_custo: "Objeção: custo",
  interesse_valor: "Interesse: valor",
  informacao: "Pediu informação",
  default: "Padrão",
};

export function LearningHealthPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [patterns, setPatterns] = useState<PatternSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("v_ai_learned_patterns_summary")
      .select("*")
      .eq("consultant_id", consultantId)
      .order("recent_uses_7d", { ascending: false });
    setPatterns((data || []) as PatternSummary[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [consultantId]);

  async function runLearner() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("ai-learn-feedback", { body: {} });
      if (error) throw error;
      toast({
        title: "Ciclo de aprendizado concluído",
        description: "Padrões atualizados com os feedbacks mais recentes.",
      });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  const totalGood = patterns.reduce((s, p) => s + p.good_count, 0);
  const totalBad = patterns.reduce((s, p) => s + p.bad_count, 0);
  const totalUses = patterns.reduce((s, p) => s + p.recent_uses_7d, 0);

  return (
    <Card className="p-5 bg-card/50 border-border/60">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            Padrões aprendidos pela IA
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {patterns.length} intenções · {totalGood} exemplos bons · {totalBad} a evitar · {totalUses} usos em 7 dias
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={runLearner}
          disabled={running}
          className="gap-1.5 h-8"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Treinando..." : "Treinar agora"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Carregando padrões...</p>
      ) : patterns.length === 0 ? (
        <div className="py-6 text-center space-y-2">
          <BookOpen className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhum padrão aprendido ainda.</p>
          <p className="text-xs text-muted-foreground">
            Avalie respostas da IA com 👍/👎 na aba "Feedback" e clique em "Treinar agora".
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {patterns.map(p => (
            <div
              key={p.intent}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/20 border border-border/30"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {INTENT_LABELS[p.intent] || p.intent}
                  </span>
                  {p.recent_uses_7d > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                      {p.recent_uses_7d}× esta semana
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Atualizado {formatDistanceToNow(new Date(p.updated_at), { locale: ptBR, addSuffix: true })}
                  {" · "}{p.sample_count} amostras totais
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1 text-primary">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium tabular-nums">{p.good_count}</span>
                </div>
                <div className="flex items-center gap-1 text-destructive">
                  <XCircle className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium tabular-nums">{p.bad_count}</span>
                </div>
              </div>

              {/* Barra de qualidade */}
              <div className="w-16 shrink-0">
                <div className="h-1.5 bg-secondary/50 rounded-full overflow-hidden">
                  {p.good_count + p.bad_count > 0 && (
                    <div
                      className="h-full bg-primary/100 rounded-full"
                      style={{
                        width: `${Math.round(100 * p.good_count / (p.good_count + p.bad_count))}%`,
                      }}
                    />
                  )}
                </div>
                <p className="text-[9px] text-muted-foreground text-center mt-0.5">
                  {p.good_count + p.bad_count > 0
                    ? `${Math.round(100 * p.good_count / (p.good_count + p.bad_count))}% bom`
                    : "sem dados"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

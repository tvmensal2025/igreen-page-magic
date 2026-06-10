/**
 * AiFeedbackPanel — painel para o consultor avaliar respostas recentes da IA (👍/👎).
 *
 * Alimenta diretamente a tabela `ai_decisions.feedback`, que é consumida pelo
 * cron `ai-learn-feedback` para gerar `ai_learned_patterns` por intent.
 * Sem esse feedback, o few-shot learning do ai-sales-agent fica vazio.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ThumbsUp, ThumbsDown, MessageSquare, RefreshCw, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Decision {
  id: string;
  user_input: string | null;
  reply_sent: string | null;
  intent_detected: string | null;
  tool_called: string | null;
  phase: string | null;
  latency_ms: number | null;
  created_at: string;
  feedback: { rating: "up" | "down"; source?: string } | null;
}

interface LearningStats {
  total_decisions_30d: number;
  decisions_with_feedback: number;
  feedback_rate_pct: number;
  thumbs_up: number;
  thumbs_down: number;
  auto_handoff_downs: number;
  distinct_intents: number;
  avg_latency_ms: number;
  handoff_rate_pct: number;
  last_decision_at: string | null;
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
  informacao: "Pediu info",
};

const PHASE_COLORS: Record<string, string> = {
  abertura: "bg-info/20 text-info",
  descoberta: "bg-primary/20 text-primary",
  pitch: "bg-warning/20 text-warning",
  objecao: "bg-warning/20 text-warning",
  fechamento: "bg-primary/20 text-primary",
  perdido: "bg-destructive/20 text-destructive",
};

export function AiFeedbackPanel({ consultantId }: Props) {
  const { toast } = useToast();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | "pending" | "rated">("pending");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Carrega decisões recentes com reply_sent (respostas visíveis ao lead)
      const query = supabase
        .from("ai_decisions")
        .select("id, user_input, reply_sent, intent_detected, tool_called, phase, latency_ms, created_at, feedback")
        .eq("consultant_id", consultantId)
        .not("reply_sent", "is", null)
        .not("user_input", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);

      if (filter === "pending") {
        query.is("feedback", null);
      } else if (filter === "rated") {
        query.not("feedback", "is", null);
      }

      const { data } = await query;
      setDecisions((data || []) as Decision[]);

      // Carrega estatísticas de saúde do aprendizado
      const { data: statsData } = await (supabase as any)
        .from("v_ai_learning_health")
        .select("*")
        .eq("consultant_id", consultantId)
        .maybeSingle();
      setStats(statsData as LearningStats | null);
    } finally {
      setLoading(false);
    }
  }, [consultantId, filter]);

  useEffect(() => { load(); }, [load]);

  async function vote(decisionId: string, rating: "up" | "down") {
    setVoting(v => ({ ...v, [decisionId]: true }));
    try {
      const { error } = await supabase
        .from("ai_decisions")
        .update({ feedback: { rating, source: "consultant_manual", rated_at: new Date().toISOString() } })
        .eq("id", decisionId)
        .eq("consultant_id", consultantId); // segurança: só o dono vota

      if (error) throw error;

      // Atualiza localmente sem recarregar tudo
      setDecisions(prev =>
        prev.map(d => d.id === decisionId
          ? { ...d, feedback: { rating, source: "consultant_manual" } }
          : d
        )
      );

      toast({
        title: rating === "up" ? "👍 Marcado como bom exemplo" : "👎 Marcado para evitar",
        description: "A IA vai aprender com esse feedback no próximo ciclo.",
      });
    } catch (e) {
      toast({ title: "Erro ao salvar feedback", description: String(e), variant: "destructive" });
    } finally {
      setVoting(v => ({ ...v, [decisionId]: false }));
    }
  }

  async function runLearner() {
    try {
      const { error } = await supabase.functions.invoke("ai-learn-feedback", { body: {} });
      if (error) throw error;
      toast({ title: "Ciclo de aprendizado executado", description: "Padrões atualizados com os feedbacks." });
      await load();
    } catch (e) {
      toast({ title: "Erro", description: String(e), variant: "destructive" });
    }
  }

  const pendingCount = decisions.filter(d => !d.feedback).length;
  const ratedCount = decisions.filter(d => d.feedback).length;

  return (
    <div className="space-y-4">
      {/* Stats de saúde do aprendizado */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3 bg-card/50 border-border/60">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Taxa de feedback</p>
            <p className="text-xl font-bold text-foreground tabular-nums mt-0.5">
              {stats.feedback_rate_pct ?? 0}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.decisions_with_feedback} de {stats.total_decisions_30d} decisões
            </p>
          </Card>
          <Card className="p-3 bg-card/50 border-border/60">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Aprovações / Reprovações</p>
            <p className="text-xl font-bold text-foreground tabular-nums mt-0.5">
              <span className="text-primary">{stats.thumbs_up}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-destructive">{stats.thumbs_down}</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.auto_handoff_downs} reprovações automáticas (handoff)
            </p>
          </Card>
          <Card className="p-3 bg-card/50 border-border/60">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Taxa de handoff</p>
            <p className={`text-xl font-bold tabular-nums mt-0.5 ${(stats.handoff_rate_pct ?? 0) > 20 ? "text-warning" : "text-foreground"}`}>
              {stats.handoff_rate_pct ?? 0}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {(stats.handoff_rate_pct ?? 0) > 20 ? "⚠️ Acima do ideal (< 20%)" : "✅ Dentro do esperado"}
            </p>
          </Card>
          <Card className="p-3 bg-card/50 border-border/60">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Latência média</p>
            <p className="text-xl font-bold text-foreground tabular-nums mt-0.5">
              {stats.avg_latency_ms ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {stats.distinct_intents} intenções distintas detectadas
            </p>
          </Card>
        </div>
      )}

      {/* Cabeçalho + filtros */}
      <Card className="p-4 bg-card/50 border-border/60">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Avalie as respostas da IA
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seu feedback treina a IA para responder melhor nas próximas conversas.
              {pendingCount > 0 && (
                <span className="ml-1 text-warning font-medium">{pendingCount} aguardando avaliação.</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} className="gap-1.5 h-8">
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </Button>
            <Button size="sm" variant="outline" onClick={runLearner} className="gap-1.5 h-8 text-primary border-primary/40">
              <Zap className="w-3.5 h-3.5" /> Treinar agora
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-1 mb-4">
          {(["pending", "all", "rated"] as const).map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              onClick={() => setFilter(f)}
              className="h-7 text-xs"
            >
              {f === "pending" ? `Pendentes${pendingCount > 0 ? ` (${pendingCount})` : ""}` : f === "all" ? "Todas" : `Avaliadas${ratedCount > 0 ? ` (${ratedCount})` : ""}`}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando decisões...</div>
        ) : decisions.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <MessageSquare className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {filter === "pending"
                ? "Nenhuma resposta pendente de avaliação."
                : "Nenhuma decisão encontrada."}
            </p>
            {filter === "pending" && ratedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Você já avaliou {ratedCount} respostas. Clique em "Todas" para ver o histórico.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {decisions.map(d => (
              <DecisionCard
                key={d.id}
                decision={d}
                voting={!!voting[d.id]}
                onVote={(rating) => vote(d.id, rating)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DecisionCard({
  decision: d,
  voting,
  onVote,
}: {
  decision: Decision;
  voting: boolean;
  onVote: (rating: "up" | "down") => void;
}) {
  const hasRating = !!d.feedback?.rating;
  const isUp = d.feedback?.rating === "up";
  const isDown = d.feedback?.rating === "down";
  const isAuto = d.feedback?.source === "auto_handoff";

  return (
    <div className={`rounded-lg border p-3 transition-colors ${
      hasRating
        ? isUp
          ? "border-primary/30 bg-primary/5"
          : "border-destructive/30 bg-destructive/5"
        : "border-border/50 bg-secondary/20"
    }`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Lead disse */}
          {d.user_input && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Cliente interessado disse</p>
              <p className="text-xs text-foreground/80 italic">"{d.user_input.slice(0, 200)}"</p>
            </div>
          )}

          {/* IA respondeu */}
          {d.reply_sent && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">IA respondeu</p>
              <p className="text-xs text-foreground">{d.reply_sent.slice(0, 300)}</p>
            </div>
          )}

          {/* Metadados */}
          <div className="flex items-center gap-2 flex-wrap">
            {d.phase && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PHASE_COLORS[d.phase] || "bg-secondary text-muted-foreground"}`}>
                {d.phase}
              </span>
            )}
            {d.intent_detected && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                {INTENT_LABELS[d.intent_detected] || d.intent_detected}
              </Badge>
            )}
            {d.tool_called && d.tool_called !== "reply" && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {d.tool_called}
              </Badge>
            )}
            {d.latency_ms && (
              <span className="text-[10px] text-muted-foreground">
                {(d.latency_ms / 1000).toFixed(1)}s
              </span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {formatDistanceToNow(new Date(d.created_at), { locale: ptBR, addSuffix: true })}
            </span>
          </div>
        </div>

        {/* Botões de voto */}
        <div className="flex flex-col gap-1.5 shrink-0">
          {isAuto && (
            <span className="text-[9px] text-muted-foreground text-center">auto</span>
          )}
          <Button
            size="icon"
            variant={isUp ? "default" : "outline"}
            className={`h-8 w-8 ${isUp ? "bg-primary hover:bg-primary border-primary" : "hover:border-primary/60 hover:text-primary"}`}
            disabled={voting || isAuto}
            onClick={() => onVote("up")}
            title="Boa resposta — usar como exemplo"
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={isDown ? "default" : "outline"}
            className={`h-8 w-8 ${isDown ? "bg-destructive hover:bg-destructive border-destructive" : "hover:border-destructive/60 hover:text-destructive"}`}
            disabled={voting || isAuto}
            onClick={() => onVote("down")}
            title="Resposta ruim — evitar no futuro"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

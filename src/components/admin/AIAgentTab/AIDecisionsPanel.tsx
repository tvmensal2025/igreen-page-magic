import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brain, Clock, ArrowRight, AlertCircle, CheckCircle2, Loader2, MessageSquare, ThumbsUp, ThumbsDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { aiOutputText } from "@/lib/aiDecisionOutput";

interface Decision {
  id: string;
  customer_id: string | null;
  phase: string;
  tool_called: string;
  reasoning: string | null;
  user_input: string | null;
  ai_output: any;
  latency_ms: number | null;
  created_at: string;
  feedback?: { rating?: "up" | "down"; note?: string } | null;
  customer_name?: string | null;
}

const TOOL_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  send_text: { label: "Resposta", color: "text-blue-400 bg-blue-500/10", icon: MessageSquare },
  send_media: { label: "Mídia", color: "text-purple-400 bg-purple-500/10", icon: ArrowRight },
  request_handoff: { label: "Chamou humano", color: "text-orange-400 bg-orange-500/10", icon: AlertCircle },
  schedule_followup: { label: "Follow-up", color: "text-yellow-400 bg-yellow-500/10", icon: Clock },
  advance_to_closing: { label: "Avançou p/ fechar", color: "text-emerald-400 bg-emerald-500/10", icon: CheckCircle2 },
  mark_lost: { label: "Marcou perdido", color: "text-red-400 bg-red-500/10", icon: AlertCircle },
};

export function AIDecisionsPanel({ userId }: { userId: string }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  async function rate(d: Decision, rating: "up" | "down") {
    const next = { rating, at: new Date().toISOString() };
    const { error } = await supabase
      .from("ai_decisions" as any)
      .update({ feedback: next })
      .eq("id", d.id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setDecisions((prev) => prev.map((x) => (x.id === d.id ? { ...x, feedback: next as any } : x)));
    toast({ title: rating === "up" ? "👍 IA aprendeu" : "👎 Anotado", description: rating === "up" ? "Vai usar como exemplo." : "Vai evitar esse padrão." });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ai_decisions" as any)
        .select("id, customer_id, phase, tool_called, reasoning, user_input, ai_output, latency_ms, created_at, feedback")
        .eq("consultant_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      const rows = (data as any[]) || [];
      const ids = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean)));
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: cs } = await supabase
          .from("customers")
          .select("id, name, phone_whatsapp")
          .in("id", ids as string[]);
        for (const c of cs || []) names[c.id] = c.name || c.phone_whatsapp || "Lead";
      }
      if (!cancelled) {
        setDecisions(rows.map((r) => ({ ...r, customer_name: names[r.customer_id || ""] || "Lead" })));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando decisões…
      </div>
    );
  }

  if (!decisions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground gap-2 border border-dashed border-border rounded-xl">
        <Brain className="w-8 h-8 opacity-50" />
        <p className="text-sm">Nenhuma decisão da IA ainda.</p>
        <p className="text-xs">Ative o agente de vendas em "Agente & Mídias" para começar.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto h-full pr-1">
      {decisions.map((d) => {
        const meta = TOOL_LABELS[d.tool_called] || { label: d.tool_called, color: "text-muted-foreground bg-muted", icon: Brain };
        const Icon = meta.icon;
        return (
          <div key={d.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-3 hover:border-primary/40 transition-colors">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${meta.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground truncate">{d.customer_name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground">fase: {d.phase}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(d.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                {d.user_input && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    <span className="text-foreground/60">Lead:</span> "{d.user_input}"
                  </p>
                )}
                {d.reasoning && (
                  <p className="text-xs text-foreground/80 mt-1 italic">
                    💭 {d.reasoning}
                  </p>
                )}
                {(() => {
                  const outText = aiOutputText(d.ai_output);
                  return outText ? (
                    <p className="text-xs text-foreground mt-1 bg-primary/5 border-l-2 border-primary/40 pl-2 py-1 rounded-r">
                      {outText}
                    </p>
                  ) : null;
                })()}
                <div className="flex items-center gap-2 mt-1.5">
                  {d.latency_ms != null && (
                    <span className="text-[10px] text-muted-foreground">⚡ {d.latency_ms}ms</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => rate(d, "up")}
                      className={`p-1 rounded hover:bg-emerald-500/10 transition-colors ${d.feedback?.rating === "up" ? "text-emerald-400" : "text-muted-foreground hover:text-emerald-400"}`}
                      title="Foi perfeito — IA usa como exemplo"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => rate(d, "down")}
                      className={`p-1 rounded hover:bg-red-500/10 transition-colors ${d.feedback?.rating === "down" ? "text-red-400" : "text-muted-foreground hover:text-red-400"}`}
                      title="Não era hora — IA evita esse padrão"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

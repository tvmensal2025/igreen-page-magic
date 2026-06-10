import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, RefreshCw, ThumbsUp, ThumbsDown, Play } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface PatternRow {
  id: string;
  consultant_id: string;
  intent: string;
  good_examples: Array<{ input?: string; output?: string }> | null;
  bad_examples: Array<{ input?: string; output?: string }> | null;
  sample_count: number;
  updated_at: string;
}

export function LearnedPatternsPanel() {
  const [rows, setRows] = useState<PatternRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_learned_patterns")
      .select("id,consultant_id,intent,good_examples,bad_examples,sample_count,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    setRows((data ?? []) as PatternRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("ai-learn-feedback", { body: {} });
      if (error) throw error;
      toast.success("Agregação executada");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao executar");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border/50 bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="size-5 text-primary" />
          <h2 className="text-base font-semibold">Padrões Aprendidos (feedback 👍/👎)</h2>
          <Badge variant="outline" className="text-xs">{rows.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            <span className="ml-1 text-xs">Rodar agora</span>
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Cron diário <code className="text-[10px]">ai-learn-feedback-daily</code> (04:15 UTC) agrega últimas 30 dias de
        decisões com 👍/👎 dos consultores e atualiza esta tabela por (consultor, intenção).
      </p>

      {rows.length === 0 && !loading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Nenhum padrão ainda. Marque decisões com 👍/👎 na auditoria pra alimentar.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <th className="px-2 py-1.5 text-left">Intent</th>
                <th className="px-2 py-1.5 text-left">Consultor</th>
                <th className="px-2 py-1.5 text-right">👍</th>
                <th className="px-2 py-1.5 text-right">👎</th>
                <th className="px-2 py-1.5 text-right">Total</th>
                <th className="px-2 py-1.5 text-right">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const good = r.good_examples?.length ?? 0;
                const bad = r.bad_examples?.length ?? 0;
                const isOpen = expanded === r.id;
                return (
                  <>
                    <tr
                      key={r.id}
                      className="cursor-pointer border-b border-border/20 hover:bg-muted/30"
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                    >
                      <td className="px-2 py-1.5 font-mono text-[11px]">{r.intent}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                        {r.consultant_id.slice(0, 8)}…
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-primary tabular-nums">{good}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-destructive tabular-nums">{bad}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.sample_count}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground">
                        {formatDistanceToNow(new Date(r.updated_at), { locale: ptBR, addSuffix: true })}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-detail`} className="bg-muted/20">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="grid gap-2 md:grid-cols-2">
                            <div>
                              <div className="mb-1 flex items-center gap-1 text-[10px] text-primary">
                                <ThumbsUp className="size-3" /> Bons exemplos
                              </div>
                              {good === 0 ? (
                                <p className="text-[10px] text-muted-foreground">—</p>
                              ) : (
                                <ul className="space-y-1">
                                  {r.good_examples!.map((ex, i) => (
                                    <li key={i} className="rounded border border-primary/20 bg-primary/5 p-1.5 text-[10px]">
                                      <div className="text-muted-foreground">in: {ex.input}</div>
                                      <div>out: {ex.output}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <div className="mb-1 flex items-center gap-1 text-[10px] text-destructive">
                                <ThumbsDown className="size-3" /> Maus exemplos
                              </div>
                              {bad === 0 ? (
                                <p className="text-[10px] text-muted-foreground">—</p>
                              ) : (
                                <ul className="space-y-1">
                                  {r.bad_examples!.map((ex, i) => (
                                    <li key={i} className="rounded border border-destructive/20 bg-destructive/5 p-1.5 text-[10px]">
                                      <div className="text-muted-foreground">in: {ex.input}</div>
                                      <div>out: {ex.output}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Painel "Cérebro IA" — últimas decisões do orquestrador + custos diários.
// Aparece em /admin/saude-bot abaixo do BotHealthIntel.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, DollarSign, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiOutputText, type AiDecisionOutput } from "@/lib/aiDecisionOutput";

type Decision = {
  id: string;
  created_at: string;
  phase: string;
  tool_called: string | null;
  model: string;
  user_input: string | null;
  ai_output: AiDecisionOutput;
  intent_detected: string | null;
  confidence: number | null;
  latency_ms: number | null;
  reply_sent: boolean | null;
  reasoning: string | null;
};

type CostRow = {
  day: string;
  model: string;
  phase: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  usd_est: number;
};

function fmtUsd(n: number) { return `$${n.toFixed(4)}`; }
function fmtDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AIBrainPanel({ consultantId }: { consultantId: string }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [onlyLowConf, setOnlyLowConf] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [d, c] = await Promise.all([
        supabase.from("ai_decisions")
          .select("id, created_at, phase, tool_called, model, user_input, ai_output, intent_detected, confidence, latency_ms, reply_sent, reasoning")
          .eq("consultant_id", consultantId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("ai_costs")
          .select("day, model, phase, calls, input_tokens, output_tokens, usd_est")
          .eq("consultant_id", consultantId)
          .gte("day", new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10))
          .order("day", { ascending: false }),
      ]);
      if (cancel) return;
      setDecisions((d.data as any) || []);
      setCosts((c.data as any) || []);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [consultantId]);

  const filtered = onlyLowConf
    ? decisions.filter(d => (d.confidence ?? 1) < 0.6)
    : decisions;

  const totalUsd = costs.reduce((s, r) => s + Number(r.usd_est || 0), 0);
  const totalCalls = costs.reduce((s, r) => s + Number(r.calls || 0), 0);

  // Agrupado por dia para a barra
  const byDay = costs.reduce<Record<string, number>>((acc, r) => {
    acc[r.day] = (acc[r.day] || 0) + Number(r.usd_est || 0);
    return acc;
  }, {});
  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const maxDay = Math.max(0.0001, ...days.map(([, v]) => v));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Cérebro da IA (orquestrador)
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <DollarSign className="h-3 w-3" /> {fmtUsd(totalUsd)} · {totalCalls} chamadas (7d)
          </span>
          <Button
            size="sm" variant={onlyLowConf ? "default" : "outline"}
            onClick={() => setOnlyLowConf(v => !v)}
          >
            Só baixa confiança (&lt;60%)
          </Button>
        </div>
      </div>

      {/* Custos por dia */}
      {days.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">Custo estimado por dia (USD)</div>
          <div className="space-y-1">
            {days.map(([day, usd]) => (
              <div key={day} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-muted-foreground tabular-nums">{day.slice(5)}</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div className="h-full bg-emerald-500/60" style={{ width: `${(usd / maxDay) * 100}%` }} />
                </div>
                <span className="w-16 text-right tabular-nums">{fmtUsd(usd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decisões */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">
          Últimas {filtered.length} decisões {loading && "(carregando...)"}
        </div>
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma decisão registrada ainda.</div>
        ) : (
          <ul className="space-y-1.5 max-h-[420px] overflow-auto">
            {filtered.map((d) => {
              const conf = d.confidence ?? 0;
              const low = conf < 0.6;
              const isOpen = expanded === d.id;
              return (
                <li key={d.id} className={`border rounded-lg text-xs ${low ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/30"}`}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : d.id)}
                    className="w-full text-left p-2 flex items-center gap-2 flex-wrap"
                  >
                    <Badge variant="outline" className="text-[10px]">{d.phase}</Badge>
                    {d.tool_called && <Badge variant="secondary" className="text-[10px]">{d.tool_called}</Badge>}
                    <span className="text-muted-foreground tabular-nums">{fmtDate(d.created_at)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{(d.model ?? "—").replace(/^.*\//, "")}</span>
                    <span className={`tabular-nums ${low ? "text-amber-600" : "text-emerald-600"}`}>
                      {(conf * 100).toFixed(0)}%
                    </span>
                    {d.latency_ms != null && (
                      <span className="text-muted-foreground tabular-nums">{d.latency_ms}ms</span>
                    )}
                    {d.reply_sent && <Badge className="text-[10px]">respondeu</Badge>}
                    <span className="flex-1 truncate text-foreground/80">"{d.user_input?.slice(0, 80) || ""}"</span>
                    {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-border/40">
                      {d.intent_detected && (
                        <div><span className="text-muted-foreground">Intenção:</span> {d.intent_detected}</div>
                      )}
                      {d.reasoning && (
                        <div><span className="text-muted-foreground">Raciocínio:</span> {d.reasoning}</div>
                      )}
                      {d.user_input && (
                        <div><span className="text-muted-foreground">Lead:</span> "{d.user_input}"</div>
                      )}
                      {(() => {
                        const outText = aiOutputText(d.ai_output);
                        return outText ? (
                          <div><span className="text-muted-foreground">IA:</span> "{outText}"</div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

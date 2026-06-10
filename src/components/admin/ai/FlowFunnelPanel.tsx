/**
 * FlowFunnelPanel — funil de abandono por step do fluxo de conversa.
 *
 * Consome a view `v_flow_step_funnel` para mostrar quais passos têm
 * maior taxa de abandono, tempo médio e confiança da IA.
 * Permite ao consultor identificar gargalos e agir.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, AlertTriangle, Clock, TrendingDown } from "lucide-react";

interface StepFunnel {
  step_key: string;
  entries: number;
  exits_without_advance: number;
  abandonment_rate_pct: number;
  avg_duration_ms: number | null;
  avg_confidence: number | null;
  last_seen_at: string;
}

interface Props {
  consultantId: string;
}

function severityColor(rate: number, confidence: number | null): string {
  if (rate >= 60 || (confidence !== null && confidence < 0.4)) return "text-destructive bg-destructive/10 border-destructive/30";
  if (rate >= 35 || (confidence !== null && confidence < 0.6)) return "text-warning bg-warning/10 border-warning/30";
  return "text-primary bg-primary/10 border-primary/30";
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  return `${Math.round(ms / 3_600_000)}h`;
}

const STEP_LABELS: Record<string, string> = {
  welcome: "Boas-vindas",
  aguardando_conta: "Aguardando conta de luz",
  processando_ocr_conta: "Processando OCR",
  confirmando_dados_conta: "Confirmando dados",
  ask_tipo_documento: "Tipo de documento",
  aguardando_doc_frente: "Frente do documento",
  aguardando_doc_verso: "Verso do documento",
  confirmando_dados_doc: "Confirmando documento",
  ask_name: "Nome",
  ask_cpf: "CPF",
  ask_email: "E-mail",
  ask_cep: "CEP",
  ask_bill_value: "Valor da conta",
  ask_finalizar: "Finalizar",
  finalizando: "Finalizando",
  aguardando_otp: "OTP",
  aguardando_facial: "Facial",
  aguardando_assinatura: "Assinatura",
  complete: "Completo",
  aguardando_humano: "Aguardando humano",
};

export function FlowFunnelPanel({ consultantId }: Props) {
  const [steps, setSteps] = useState<StepFunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"abandonment" | "entries">("abandonment");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("v_flow_step_funnel")
        .select("*")
        .eq("consultant_id", consultantId)
        .gt("entries", 2); // filtra steps com amostra mínima

      const sorted = (data || []).sort((a: any, b: any) =>
        sortBy === "abandonment"
          ? (b.abandonment_rate_pct ?? 0) - (a.abandonment_rate_pct ?? 0)
          : (b.entries ?? 0) - (a.entries ?? 0)
      );
      setSteps(sorted as StepFunnel[]);
      setLoading(false);
    })();
  }, [consultantId, sortBy]);

  const criticalSteps = steps.filter(s => s.abandonment_rate_pct >= 60);
  const totalEntries = steps.reduce((sum, s) => sum + s.entries, 0);

  return (
    <Card className="p-5 bg-card/50 border-border/60">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            Funil de abandono por passo
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Últimos 30 dias · {totalEntries.toLocaleString("pt-BR")} entradas totais
            {criticalSteps.length > 0 && (
              <span className="ml-2 text-destructive font-medium">
                ⚠️ {criticalSteps.length} passo{criticalSteps.length > 1 ? "s" : ""} crítico{criticalSteps.length > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSortBy("abandonment")}
            className={`text-xs px-2 py-1 rounded transition-colors ${sortBy === "abandonment" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Por abandono
          </button>
          <button
            onClick={() => setSortBy("entries")}
            className={`text-xs px-2 py-1 rounded transition-colors ${sortBy === "entries" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Por volume
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Carregando funil...</p>
      ) : steps.length === 0 ? (
        <div className="py-6 text-center space-y-1">
          <GitBranch className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">Sem dados de transição ainda.</p>
          <p className="text-xs text-muted-foreground">Os dados aparecem após clientes interessados passarem pelo fluxo.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {steps.map(s => {
            const color = severityColor(s.abandonment_rate_pct, s.avg_confidence);
            const label = STEP_LABELS[s.step_key] || s.step_key;
            const barWidth = Math.min(100, s.abandonment_rate_pct);

            return (
              <div key={s.step_key} className={`rounded-lg border p-3 ${color}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      <code className="text-[10px] text-muted-foreground bg-secondary/50 px-1 rounded">
                        {s.step_key}
                      </code>
                      {s.abandonment_rate_pct >= 60 && (
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold tabular-nums leading-none">
                      {s.abandonment_rate_pct}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">abandono</p>
                  </div>
                </div>

                {/* Barra de abandono */}
                <div className="h-1.5 bg-secondary/50 rounded-full mb-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      s.abandonment_rate_pct >= 60 ? "bg-destructive/100" :
                      s.abandonment_rate_pct >= 35 ? "bg-warning/100" : "bg-primary/100"
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    {s.entries} entradas · {s.exits_without_advance} saíram
                  </span>
                  {s.avg_duration_ms && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(s.avg_duration_ms)} médio
                    </span>
                  )}
                  {s.avg_confidence !== null && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 px-1.5 ${
                        s.avg_confidence < 0.5 ? "border-destructive/40 text-destructive" :
                        s.avg_confidence < 0.7 ? "border-warning/40 text-warning" :
                        "border-primary/40 text-primary"
                      }`}
                    >
                      IA: {(s.avg_confidence * 100).toFixed(0)}% confiança
                    </Badge>
                  )}
                </div>

                {/* Dica de ação */}
                {s.abandonment_rate_pct >= 60 && (
                  <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/30">
                    💡 {s.avg_confidence !== null && s.avg_confidence < 0.5
                      ? "IA com baixa confiança neste passo — revise o texto do step ou adicione mais exemplos de FAQ."
                      : s.avg_duration_ms && s.avg_duration_ms > 3_600_000
                        ? "Clientes interessados ficam mais de 1h aqui — considere enviar um lembrete automático."
                        : "Alto abandono — revise a mensagem deste passo ou adicione mídia de apoio."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

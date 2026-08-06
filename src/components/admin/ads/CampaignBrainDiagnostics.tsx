/**
 * Diagnóstico do Cérebro — card dentro do painel existente (não é outro painel).
 *
 * Mostra o que a tela antiga não mostrava: por que o Cérebro decidiu, com quais
 * dados, com quanta confiança e o que está bloqueando. Um score verde único
 * escondia justamente isso — aqui as três saúdes ficam separadas.
 *
 * Consome `campaign-brain-shadow` em modo `analyze`: essa função nunca chama a
 * Meta e não altera nada.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";

type DecisionRow = {
  campaign_id: string;
  campaign_name: string;
  saude_dados: string;
  saude_meta: string;
  saude_comercial: string;
  conversas: number;
  leads_identificados: number;
  cadastros: number;
  clientes_aprovados: number;
  amostra: string;
  confianca: string;
  decisao: string;
  motivo: string;
  orcamento_atual_cents: number;
  orcamento_proposto_cents: number | null;
  degrau_pct: number;
  bloqueios: string[];
  proxima_avaliacao: string;
  execucao_automatica: string;
  runway_dias: number;
};

type Payload = {
  janela: { inicio: string; fim: string; dias: number };
  qualidade_dados: {
    estado: string;
    descricao: string;
    ultima_sincronizacao: string | null;
    completude_pct: number;
    campanhas: number;
    duplicatas_ignoradas: number;
    lacunas: number;
    libera_acao_financeira: boolean;
  };
  politica: {
    targetCplCents: number;
    minHoursBetweenExecutions: number;
    defaultStepPct: number;
    maxStepPct: number;
    minRunwayDays: number;
    maxMetricsAgeHours: number;
  };
  decisoes: DecisionRow[];
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Verde só quando é verde de verdade; o resto fica visível, não escondido. */
function healthTone(label: string): string {
  switch (label) {
    case "excelente":
    case "boa":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
    case "razoável":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700";
    case "ruim":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "insuficiente":
      return "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
    default:
      return "border-muted-foreground/20 bg-muted/20 text-muted-foreground";
  }
}

const DECISION_LABEL: Record<string, string> = {
  hold: "manter",
  increase_budget: "aumentar orçamento",
  reduce_budget: "reduzir orçamento",
  pause_waste: "pausar por desperdício",
  recommend_creative_review: "revisar criativo",
};

export default function CampaignBrainDiagnostics(
  { consultantId }: { consultantId: string },
) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!consultantId) return;
    setLoading(true);
    setErro(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const { data: res, error } = await supabase.functions.invoke(
        "campaign-brain-shadow",
        {
          body: { consultant_id: consultantId, mode: "analyze", window_days: 2 },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (error) throw error;
      if (res?.error) throw new Error(String(res.error));
      setData(res as Payload);
    } catch (e) {
      setErro("Não foi possível carregar o diagnóstico agora.");
      console.error("[brain-diagnostics]", e);
    } finally {
      setLoading(false);
    }
  }, [consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-primary" />
          Diagnóstico do Cérebro
        </h3>
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {erro && <p className="text-xs text-destructive">{erro}</p>}

      {data && (
        <>
          <div className="rounded-lg border border-border bg-muted/30 p-3 mb-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={data.qualidade_dados.libera_acao_financeira
                  ? "border-emerald-500/40 text-emerald-700"
                  : "border-amber-500/40 text-amber-700"}
              >
                {data.qualidade_dados.libera_acao_financeira
                  ? <ShieldCheck className="w-3 h-3 mr-1" />
                  : <AlertTriangle className="w-3 h-3 mr-1" />}
                {data.qualidade_dados.descricao}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                Janela {data.janela.inicio} → {data.janela.fim}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Alvo por conversa {brl(data.politica.targetCplCents)} · degrau padrão{" "}
              {data.politica.defaultStepPct}% (máx {data.politica.maxStepPct}%) · uma
              execução a cada {data.politica.minHoursBetweenExecutions}h · runway mínimo{" "}
              {data.politica.minRunwayDays} dias
            </p>
            {!data.qualidade_dados.libera_acao_financeira && (
              <p className="text-[11px] text-amber-700">
                Ação financeira bloqueada enquanto os dados não estiverem atuais e completos.
              </p>
            )}
          </div>

          {data.decisoes.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma campanha ativa na janela.
            </p>
          )}

          <div className="space-y-2">
            {data.decisoes.map((d) => (
              <div
                key={d.campaign_id}
                className="rounded-lg border border-border p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{d.campaign_name}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {DECISION_LABEL[d.decisao] ?? d.decisao}
                    {d.orcamento_proposto_cents != null &&
                      ` · ${brl(d.orcamento_atual_cents)} → ${brl(d.orcamento_proposto_cents)}`}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className={`text-[10px] ${healthTone(d.saude_dados)}`}>
                    dados: {d.saude_dados}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${healthTone(d.saude_meta)}`}>
                    Meta: {d.saude_meta}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${healthTone(d.saude_comercial)}`}
                  >
                    comercial: {d.saude_comercial}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    amostra: {d.amostra} · confiança: {d.confianca}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Conversas</div>
                    <div className="font-medium tabular-nums">{d.conversas}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Leads identificados</div>
                    <div className="font-medium tabular-nums">{d.leads_identificados}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Cadastros</div>
                    <div className="font-medium tabular-nums">{d.cadastros}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Clientes aprovados</div>
                    <div className="font-medium tabular-nums">{d.clientes_aprovados}</div>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">{d.motivo}</p>

                {d.bloqueios.length > 0 && (
                  <div className="space-y-0.5">
                    {d.bloqueios.map((b) => (
                      <p key={b} className="text-[11px] text-amber-700">• {b}</p>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Próxima avaliação: {d.proxima_avaliacao} · execução automática:{" "}
                  <span
                    className={d.execucao_automatica === "liberada"
                      ? "text-amber-700 font-medium"
                      : "text-muted-foreground"}
                  >
                    {d.execucao_automatica}
                  </span>{" "}
                  · runway {d.runway_dias} dias
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// Painel IA "Análise Gemini" no topo de /admin/saude-bot.
// Cruza últimos 7d de WhatsApp (texto/áudio/vídeo/imagem) + transições + handoffs + A/B/C
// e gera diagnóstico acionável via edge function bot-health-intel.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, RefreshCw, AlertTriangle, Trophy, TrendingDown, Mic, Beaker, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Diag = {
  id: string;
  computed_at: string;
  summary: string | null;
  kpis: any;
  bottlenecks: any[];
  winners: any[];
  actions: any[];
  model_used: string | null;
  sample_size: number | null;
};

const severityClass = (s?: string) =>
  s === "high" ? "bg-destructive/15 text-destructive border-destructive/30"
  : s === "medium" ? "bg-warning/15 text-warning border-warning/30"
  : "bg-primary/15 text-primary border-primary/30";

const impactClass = (s?: string) =>
  s === "high" ? "bg-primary/15 text-primary border-primary/30"
  : s === "medium" ? "bg-info/15 text-info border-info/30"
  : "bg-muted text-muted-foreground";

function actionLink(type?: string): string | null {
  switch (type) {
    case "tune_flow":
    case "fix_handoff":
    case "change_media":
    case "adjust_copy":
      return "/admin/fluxos";
    case "pause_variant":
    case "expand_variant":
      return "/admin/fluxos";
    case "reactivate_leads":
      return "/admin/crm";
    default:
      return null;
  }
}

export default function BotHealthIntel({ consultantId }: { consultantId: string }) {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function loadLatest() {
    setLoading(true);
    const { data } = await supabase
      .from("capture_diagnostics")
      .select("id, computed_at, summary, kpis, bottlenecks, winners, actions, model_used, sample_size")
      .eq("scope", "bot_health")
      .eq("consultant_id", consultantId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDiag((data as any) || null);
    setLoading(false);
  }

  async function runAnalysis() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("bot-health-intel", {
        body: { consultant_id: consultantId },
      });
      if (error) throw error;
      toast.success("Análise IA atualizada");
      await loadLatest();
    } catch (e: any) {
      toast.error("Erro na análise: " + (e?.message || e));
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { if (consultantId) loadLatest(); }, [consultantId]);

  const score = diag?.kpis?.health_score ?? null;
  const scoreColor =
    score == null ? "text-muted-foreground"
    : score >= 75 ? "text-primary"
    : score >= 50 ? "text-warning"
    : "text-destructive";
  const ageH = diag ? Math.floor((Date.now() - new Date(diag.computed_at).getTime()) / 3600_000) : null;
  const stale = ageH != null && ageH >= 24;

  const mediaInsights = (diag?.bottlenecks as any[] || []).filter((b) => b.type) // backwards
    .concat((diag as any)?.media_insights || []);
  // media insights come back from edge inside `actions`/extra — but we persisted only main fields.
  // So we render bottlenecks/winners/actions; lead_drops & media live inside kpis if needed.

  return (
    <Card className="p-5 border-primary/30 bg-gradient-to-br from-background to-primary/5 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="flex items-start justify-between gap-3 mb-4 relative">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg leading-tight">Análise IA — últimos 7 dias</h2>
            <p className="text-xs text-muted-foreground">
              {diag
                ? `Atualizada ${ageH === 0 ? "agora" : `há ${ageH}h`} · ${diag.sample_size || 0} mensagens analisadas · ${diag.model_used || "—"}`
                : "Cruzamento de texto, áudio, vídeo, imagem, handoffs e A/B/C"}
            </p>
          </div>
        </div>
        <Button size="sm" variant={stale || !diag ? "default" : "outline"} onClick={runAnalysis} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {diag ? "Atualizar análise" : "Gerar análise"}
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : !diag ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          Nenhuma análise ainda. Clique em <strong>Gerar análise</strong> para a IA examinar seus últimos 7 dias.
        </div>
      ) : (
        <>
          {/* Score + Summary */}
          <div className="flex items-center gap-4 mb-4">
            {score != null && (
              <div className="flex flex-col items-center justify-center min-w-[80px] p-3 rounded-xl bg-background/60 border">
                <div className={`text-3xl font-bold tabular-nums ${scoreColor}`}>{score}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">saúde</div>
              </div>
            )}
            <p className="text-base leading-snug font-medium flex-1">{diag.summary || "Sem resumo."}</p>
          </div>

          {/* KPI strip */}
          {diag.kpis && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
              {"leads_7d" in (diag.kpis || {}) && (
                <Kpi label="Clientes interessados 7d" value={diag.kpis.leads_7d} />
              )}
              {"conversations" in (diag.kpis || {}) && (
                <Kpi label="Mensagens 7d" value={diag.kpis.conversations} />
              )}
              {"handoffs" in (diag.kpis || {}) && (
                <Kpi label="Handoffs" value={diag.kpis.handoffs} warn={diag.kpis.handoffs > 5} />
              )}
              {diag.kpis.variants && (
                <Kpi label="Melhor variante" value={bestVariant(diag.kpis.variants)} />
              )}
            </div>
          )}

          <Tabs defaultValue="actions" className="w-full">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="actions"><Zap className="h-3.5 w-3.5 mr-1" />Ações</TabsTrigger>
              <TabsTrigger value="bottlenecks"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Gargalos</TabsTrigger>
              <TabsTrigger value="winners"><Trophy className="h-3.5 w-3.5 mr-1" />Vencedores</TabsTrigger>
              <TabsTrigger value="ab"><Beaker className="h-3.5 w-3.5 mr-1" />A/B/C</TabsTrigger>
            </TabsList>

            <TabsContent value="actions" className="mt-3 space-y-2">
              {(diag.actions || []).length === 0 ? <Empty /> :
                diag.actions.map((a: any, i: number) => {
                  const href = actionLink(a.type);
                  const content = (
                    <div className="border rounded-lg p-3 hover:bg-muted/40 transition flex items-start gap-3">
                      <Badge variant="outline" className={impactClass(a.impact)}>{a.impact || "—"}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{a.label}</div>
                        <div className="text-xs text-muted-foreground">{a.detail}</div>
                      </div>
                    </div>
                  );
                  return href
                    ? <Link key={i} to={href} className="block">{content}</Link>
                    : <div key={i}>{content}</div>;
                })
              }
            </TabsContent>

            <TabsContent value="bottlenecks" className="mt-3 space-y-2">
              {(diag.bottlenecks || []).length === 0 ? <Empty /> :
                diag.bottlenecks.map((b: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 flex items-start gap-3">
                    <Badge variant="outline" className={severityClass(b.severity)}>{b.severity || "—"}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{b.title}</div>
                      <div className="text-xs text-muted-foreground">{b.detail}</div>
                      {b.step && <div className="text-[10px] mt-1 text-muted-foreground">Passo: <code>{b.step}</code></div>}
                    </div>
                  </div>
                ))
              }
            </TabsContent>

            <TabsContent value="winners" className="mt-3 space-y-2">
              {(diag.winners || []).length === 0 ? <Empty /> :
                diag.winners.map((w: any, i: number) => (
                  <div key={i} className="border rounded-lg p-3 flex items-start gap-3 bg-primary/5">
                    <Trophy className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{w.title}</div>
                      <div className="text-xs text-muted-foreground">{w.detail}</div>
                    </div>
                  </div>
                ))
              }
            </TabsContent>

            <TabsContent value="ab" className="mt-3">
              {!diag.kpis?.variants ? <Empty /> : (() => {
                const variantData = diag.kpis.variants as Record<string, { total: number; approved: number }>;
                const labels: Record<string, string> = {
                  A: "Áudio", B: "Sem áudio", C: "Vídeo", D: "Botões/auto", E: "Custom",
                };
                // Mostra apenas variantes que têm dados, em ordem A→E.
                const present = (["A", "B", "C", "D", "E"] as const).filter(
                  (v) => variantData[v] && variantData[v].total > 0,
                );
                const shown = present.length > 0 ? present : (["A", "B", "C"] as const);
                const cols = shown.length <= 3 ? "grid-cols-3" : shown.length === 4 ? "grid-cols-4" : "grid-cols-5";
                return (
                  <div className={`grid ${cols} gap-2`}>
                    {shown.map((v) => {
                      const x = variantData[v] || { total: 0, approved: 0 };
                      const rate = x.total ? Math.round((x.approved / x.total) * 1000) / 10 : 0;
                      return (
                        <div key={v} className="border rounded-lg p-3 text-center">
                          <div className="text-[10px] uppercase text-muted-foreground">{labels[v] || v}</div>
                          <div className="text-xl font-bold">{rate}%</div>
                          <div className="text-[10px] text-muted-foreground">{x.approved}/{x.total}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>

          {stale && (
            <p className="text-[11px] text-warning mt-3">Análise tem +24h — clique em "Atualizar análise" para refazer.</p>
          )}
        </>
      )}
    </Card>
  );
}

function Kpi({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className="rounded-lg border bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${warn ? "text-warning" : ""}`}>{value ?? "—"}</div>
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-muted-foreground py-4 text-center">Nada por aqui ainda.</div>;
}

function bestVariant(v: Record<string, { total: number; approved: number }>): string {
  let best = "—", bestRate = -1;
  for (const k of Object.keys(v || {})) {
    const x = v[k]; if (!x?.total) continue;
    const r = x.approved / x.total;
    if (r > bestRate) { bestRate = r; best = k; }
  }
  return best;
}

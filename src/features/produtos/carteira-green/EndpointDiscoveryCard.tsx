// =============================================================================
// EndpointDiscoveryCard — mostra o resultado do último `probe-all` contra a
// API do escritório iGreen. Cada linha vira um semáforo: verde (ok), amarelo
// (denied/bad_request), vermelho (error/missing/unknown). Botão "Rodar probe"
// dispara a Edge Function `igreen-endpoint-probe` e recarrega a tabela.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Row = {
  method: string;
  path: string;
  category: string | null;
  status: number | null;
  bytes: number | null;
  ms: number | null;
  bucket: string | null;
  is_alive: boolean;
  notes: string | null;
  sample_body: string | null;
  checked_at: string;
};

const BUCKET_STYLE: Record<string, string> = {
  ok:          "bg-emerald-500/15 text-emerald-700 border-emerald-500/40",
  denied:      "bg-amber-500/15 text-amber-700 border-amber-500/40",
  bad_request: "bg-amber-500/15 text-amber-700 border-amber-500/40",
  missing:     "bg-rose-500/15 text-rose-700 border-rose-500/40",
  error_5xx:   "bg-rose-500/15 text-rose-700 border-rose-500/40",
  unknown:     "bg-muted/40 text-muted-foreground border-border/60",
};

export function EndpointDiscoveryCard({ consultantId }: { consultantId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [probingDetail, setProbingDetail] = useState(false);
  const [sampleId, setSampleId] = useState("1117549");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["igreen-endpoint-discovery"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("igreen_endpoint_discovery")
        .select("method,path,category,status,bytes,ms,bucket,is_alive,notes,sample_body,checked_at")
        .order("category", { ascending: true })
        .order("path", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const summary = useMemo(() => {
    const acc: Record<string, number> = {};
    rows.forEach((r) => { const k = r.bucket || "unknown"; acc[k] = (acc[k] || 0) + 1; });
    return acc;
  }, [rows]);

  const grouped = useMemo(() => {
    const g: Record<string, Row[]> = {};
    rows.forEach((r) => { const k = r.category || "outros"; (g[k] ||= []).push(r); });
    return g;
  }, [rows]);

  const runProbe = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("igreen-endpoint-probe", {
        body: { consultant_id: consultantId },
      });
      if (error) throw error;
      const d = data as { ok: boolean; total?: number; persisted?: number; error?: string };
      if (!d?.ok) throw new Error(d?.error || "falha desconhecida");
      toast({
        title: "Probe concluído",
        description: `${d.persisted ?? 0}/${d.total ?? 0} endpoints atualizados.`,
      });
      qc.invalidateQueries({ queryKey: ["igreen-endpoint-discovery"] });
    } catch (e) {
      toast({
        title: "Erro no probe",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const runDetailProbe = async () => {
    setProbingDetail(true);
    try {
      const { data, error } = await supabase.functions.invoke("probe-igreen-detail", {
        body: { consultant_id: consultantId, sample_idcliente: sampleId || undefined },
      });
      if (error) throw error;
      const d = data as { ok: boolean; winners?: string[]; sample_idcliente?: string; error?: string };
      if (!d?.ok) throw new Error(d?.error || "falha desconhecida");
      toast({
        title: d.winners?.length ? `${d.winners.length} endpoint(s) vencedor(es)!` : "Probe concluído (nenhum 200)",
        description: d.winners?.length
          ? d.winners.join(", ")
          : `Amostra: ${d.sample_idcliente}. Veja categoria "customer_detail".`,
      });
      qc.invalidateQueries({ queryKey: ["igreen-endpoint-discovery"] });
    } catch (e) {
      toast({
        title: "Erro no probe de detalhe",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setProbingDetail(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">Diagnóstico de Endpoints iGreen</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Mapa vivo de quais rotas da API do escritório respondem para este consultor.
            Verde = 2xx, amarelo = auth/validação, vermelho = 404/5xx.
          </p>
        </div>
        <Button size="sm" onClick={runProbe} disabled={running}>
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {running ? "Rodando..." : "Rodar probe geral"}
        </Button>
      </div>

      <div className="rounded-lg border border-dashed border-border/60 bg-background/40 p-3 flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <div className="text-xs font-medium mb-1">Descobrir endpoint de detalhe do cliente</div>
          <div className="text-[10px] text-muted-foreground">
            Testa 12 rotas candidatas contra o cliente informado. Resultado aparece na categoria "customer_detail".
          </div>
        </div>
        <Input
          value={sampleId}
          onChange={(e) => setSampleId(e.target.value)}
          placeholder="idcliente ex: 1117549"
          className="h-8 w-40 text-xs"
        />
        <Button size="sm" variant="secondary" onClick={runDetailProbe} disabled={probingDetail}>
          {probingDetail ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
          {probingDetail ? "Probing..." : "Probe detalhe"}
        </Button>
      </div>


      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(summary).map(([k, v]) => (
            <span
              key={k}
              className={`px-2 py-0.5 rounded-full border ${BUCKET_STYLE[k] ?? BUCKET_STYLE.unknown}`}
            >
              {k}: {v}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Carregando…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
          Nenhum probe rodado ainda. Clique em "Rodar probe" para mapear a API.
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([cat, list]) => (
            <details key={cat} className="rounded-lg border border-border/60 bg-background/40 open:bg-background/60">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium flex items-center justify-between">
                <span className="capitalize">{cat}</span>
                <span className="text-xs text-muted-foreground">
                  {list.filter((r) => r.is_alive).length}/{list.length} ativos
                </span>
              </summary>
              <div className="divide-y divide-border/40">
                {list.map((r) => (
                  <div key={`${r.method}-${r.path}`} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono truncate">{r.method} {r.path}</div>
                      {r.notes && <div className="text-[10px] text-muted-foreground truncate">{r.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground">{r.bytes ?? 0}B · {r.ms ?? 0}ms</span>
                      <span className={`px-2 py-0.5 rounded-full border ${BUCKET_STYLE[r.bucket || "unknown"]}`}>
                        {r.status ?? "—"} · {r.bucket ?? "?"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

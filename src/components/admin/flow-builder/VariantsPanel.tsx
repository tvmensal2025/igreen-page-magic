import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Save, RefreshCw, Pause, Crown } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface Variant {
  id: string;
  fluxo: string;
  nome: string;
  descricao: string | null;
  weight: number;
  is_active: boolean;
}

interface VariantMetrics {
  variant_id: string;
  leads: number;
  finalizando: number;
  doc: number;
  conta: number;
  pausados: number;
}

interface DecisionMetrics {
  variant: string;
  turnos: number;
  latency_avg: number;
  custo_total: number;
}

const PERIOD_OPTIONS = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

const STEP_BUCKETS = {
  conta: ["aguardando_conta", "aguardando_documento", "aguardando_email", "cadastro_finalizando", "portal_submitting"],
  doc: ["aguardando_documento", "aguardando_email", "cadastro_finalizando", "portal_submitting"],
  finalizando: ["cadastro_finalizando", "portal_submitting", "awaiting_otp", "validating_otp", "registered_igreen", "cadastro_concluido"],
};

export default function VariantsPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [periodH, setPeriodH] = useState(24 * 7);
  const [metrics, setMetrics] = useState<Record<string, VariantMetrics & Partial<DecisionMetrics>>>({});

  async function load() {
    setLoading(true);
    try {
      const { data: vars } = await supabase.from("flow_variants").select("*").order("fluxo").order("id");
      setVariants((vars || []) as Variant[]);
      await loadMetrics((vars || []) as Variant[]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMetrics(vars: Variant[]) {
    const since = new Date(Date.now() - periodH * 3600_000).toISOString();
    const result: Record<string, VariantMetrics & Partial<DecisionMetrics>> = {};

    // Métricas por variant_id (customers)
    for (const v of vars) {
      const { count: leads } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("variant_id", v.id)
        .gte("updated_at", since);

      const { count: finalizou } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("variant_id", v.id)
        .gte("updated_at", since)
        .in("conversation_step", STEP_BUCKETS.finalizando);

      const { count: chegouDoc } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("variant_id", v.id)
        .gte("updated_at", since)
        .in("conversation_step", STEP_BUCKETS.doc);

      const { count: chegouConta } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("variant_id", v.id)
        .gte("updated_at", since)
        .in("conversation_step", STEP_BUCKETS.conta);

      const { count: pausados } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("variant_id", v.id)
        .gte("updated_at", since)
        .eq("bot_paused", true);

      result[v.id] = {
        variant_id: v.id,
        leads: leads ?? 0,
        finalizando: finalizou ?? 0,
        doc: chegouDoc ?? 0,
        conta: chegouConta ?? 0,
        pausados: pausados ?? 0,
      };
    }

    // Latência média via ai_decisions
    const { data: latencyRows } = await supabase
      .from("ai_decisions")
      .select("source, latency_ms")
      .gte("created_at", since)
      .limit(5000);
    const buckets: Record<string, { sum: number; n: number }> = {};
    for (const r of (latencyRows || []) as any[]) {
      const src = String(r.source || "");
      const id = src === "vendedora_v1" ? "b.v1" : src === "fluxo_b" || src === "fluxo-b" ? "b.legacy" : src;
      if (!buckets[id]) buckets[id] = { sum: 0, n: 0 };
      buckets[id].sum += Number(r.latency_ms || 0);
      buckets[id].n += 1;
    }
    for (const id of Object.keys(buckets)) {
      const m = result[id];
      if (m) {
        m.latency_avg = Math.round(buckets[id].sum / Math.max(1, buckets[id].n));
        m.turnos = buckets[id].n;
      }
    }

    setMetrics(result);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (!loading) void loadMetrics(variants); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [periodH]);

  async function saveVariant(v: Variant, patch: Partial<Variant>) {
    setSaving(true);
    const { error } = await supabase.from("flow_variants").update(patch).eq("id", v.id);
    setSaving(false);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Salvo" });
      setVariants(prev => prev.map(p => p.id === v.id ? { ...p, ...patch } : p));
    }
  }

  async function forcar100(v: Variant) {
    // zera o weight das outras variantes do mesmo fluxo
    setSaving(true);
    const others = variants.filter(x => x.fluxo === v.fluxo && x.id !== v.id);
    for (const o of others) {
      await supabase.from("flow_variants").update({ weight: 0 }).eq("id", o.id);
    }
    await supabase.from("flow_variants").update({ weight: 100, is_active: true }).eq("id", v.id);
    setSaving(false);
    await load();
    toast({ title: "Variante forçada", description: `${v.nome} agora recebe 100% do tráfego do fluxo ${v.fluxo}.` });
  }

  const byFluxo = useMemo(() => {
    const g: Record<string, Variant[]> = {};
    for (const v of variants) (g[v.fluxo] ||= []).push(v);
    return g;
  }, [variants]);

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" /></div>;
  }

  function pct(n: number, total: number): string {
    if (!total) return "—";
    return `${Math.round((n / total) * 100)}%`;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Variantes (A/B/N por fluxo)</CardTitle>
              <p className="text-xs text-muted-foreground">Cada fluxo (A/B/C/D) pode ter N variantes. O sorteio é ponderado e a decisão fica fixa por cliente interessado (uma vez sorteado, não troca).</p>
            </div>
            <div className="flex gap-1">
              {PERIOD_OPTIONS.map(p => (
                <Button key={p.label} variant={periodH === p.hours ? "default" : "outline"} size="sm" onClick={() => setPeriodH(p.hours)}>
                  {p.label}
                </Button>
              ))}
              <Button variant="ghost" size="icon" onClick={load} aria-label="Atualizar métricas" title="Atualizar métricas"><RefreshCw className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {Object.entries(byFluxo).map(([fluxo, vars]) => (
        <Card key={fluxo}>
          <CardHeader>
            <CardTitle className="text-base">Fluxo {fluxo}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-2">Variante</th>
                  <th className="py-2 px-2">Peso</th>
                  <th className="py-2 px-2">Ativa</th>
                  <th className="py-2 px-2">Clientes interessados</th>
                  <th className="py-2 px-2">→ conta</th>
                  <th className="py-2 px-2">→ doc</th>
                  <th className="py-2 px-2">→ fim</th>
                  <th className="py-2 px-2">Pausados</th>
                  <th className="py-2 px-2">Turnos</th>
                  <th className="py-2 px-2">Latência</th>
                  <th className="py-2 pl-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {vars.map(v => {
                  const m = metrics[v.id];
                  return (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <div className="flex flex-col">
                          <div className="font-medium flex items-center gap-2">
                            {v.nome}
                            <Badge variant="outline" className="text-[10px]">{v.id}</Badge>
                          </div>
                          {v.descricao && <div className="text-xs text-muted-foreground">{v.descricao}</div>}
                        </div>
                      </td>
                      <td className="py-2 px-2 w-20">
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          defaultValue={v.weight}
                          className="h-8 text-xs"
                          onBlur={(e) => {
                            const w = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                            if (w !== v.weight) saveVariant(v, { weight: w });
                          }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <Switch checked={v.is_active} onCheckedChange={(c) => saveVariant(v, { is_active: c })} />
                      </td>
                      <td className="py-2 px-2 font-medium">{m?.leads ?? 0}</td>
                      <td className="py-2 px-2 text-xs">{pct(m?.conta ?? 0, m?.leads ?? 0)}</td>
                      <td className="py-2 px-2 text-xs">{pct(m?.doc ?? 0, m?.leads ?? 0)}</td>
                      <td className="py-2 px-2 text-xs font-semibold text-primary">{pct(m?.finalizando ?? 0, m?.leads ?? 0)}</td>
                      <td className="py-2 px-2 text-xs text-warning">{pct(m?.pausados ?? 0, m?.leads ?? 0)}</td>
                      <td className="py-2 px-2 text-xs">{m?.turnos ?? 0}</td>
                      <td className="py-2 px-2 text-xs">{m?.latency_avg ? `${m.latency_avg}ms` : "—"}</td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => saveVariant(v, { weight: 0 })} disabled={v.weight === 0}>
                          <Pause className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => forcar100(v)} title="Forçar 100% do tráfego deste fluxo">
                          <Crown className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!vars.length && <p className="text-xs text-muted-foreground py-4">Nenhuma variante configurada para o fluxo {fluxo}.</p>}
          </CardContent>
        </Card>
      ))}

      {saving && (
        <div className="fixed bottom-4 right-4 bg-background border rounded-md px-3 py-2 text-xs shadow flex items-center gap-2">
          <Save className="h-3 w-3 animate-pulse" /> salvando…
        </div>
      )}
    </div>
  );
}

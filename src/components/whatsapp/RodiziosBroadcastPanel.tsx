import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Bell, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";

interface PoolRow {
  id: string;
  label: string;
  campaign_id: string | null;
  campaign_name: string | null;
  metrics_broadcast_interval_minutes: number;
  members: number;
}

interface Props {
  consultantId: string;
}

/**
 * Painel de configuração de disparos de métricas de rodízio.
 * Espelha o seletor do CampaignRodizioLeadsDialog para que o consultor/admin
 * possa mudar o intervalo (30min / 1h / 2h / 3h / 4h / 6h / 12h / 1x dia / off) de
 * cada pool ativa direto da Central de Agendamentos.
 */
export function RodiziosBroadcastPanel({ consultantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase
        .from("rodizio_pools")
        .select("id, label, campaign_id, metrics_broadcast_interval_minutes")
        .eq("is_active", true)
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`)
        .order("created_at", { ascending: false });

      const list = (rows || []) as any[];
      const campaignIds = list.map((r) => r.campaign_id).filter(Boolean);
      const campaignNames: Record<string, string> = {};
      if (campaignIds.length) {
        const { data: camps } = await supabase
          .from("facebook_campaigns")
          .select("id, name")
          .in("id", campaignIds);
        for (const c of (camps || []) as any[]) campaignNames[c.id] = c.name;
      }

      // Contagem de membros por pool (rápida)
      const counts: Record<string, number> = {};
      if (list.length) {
        const { data: mem } = await supabase
          .from("rodizio_pool_members")
          .select("pool_id")
          .in("pool_id", list.map((r) => r.id));
        for (const m of (mem || []) as any[]) counts[m.pool_id] = (counts[m.pool_id] || 0) + 1;
      }

      setPools(
        list.map((r) => ({
          id: r.id,
          label: r.label || "Rodízio",
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_id ? campaignNames[r.campaign_id] ?? null : null,
          metrics_broadcast_interval_minutes: Number(r.metrics_broadcast_interval_minutes ?? 60),
          members: counts[r.id] || 0,
        })),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultantId]);

  const changeInterval = async (poolId: string, value: string) => {
    const n = Number(value);
    setSavingId(poolId);
    // update otimista
    setPools((prev) => prev.map((p) => (p.id === poolId ? { ...p, metrics_broadcast_interval_minutes: n } : p)));
    try {
      const { error } = await supabase
        .from("rodizio_pools")
        .update({ metrics_broadcast_interval_minutes: n } as any)
        .eq("id", poolId);
      if (error) throw error;
      toast.success(
        n === 0 ? "Atualizações desligadas" : `Atualizações a cada ${n < 60 ? `${n} min` : `${n / 60}h`}`,
      );
    } catch (e) {
      toast.error("Falha ao salvar: " + (e as Error).message);
      load();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-bold">Métricas para parceiros de rodízio</p>
          <p className="text-[11px] text-muted-foreground">
            Enviamos automaticamente no WhatsApp de cada parceiro: gasto, alcance, conversas e leads da campanha.
            Escolha de quanto em quanto tempo quer que saia.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} title="Atualizar">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : pools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhum rodízio ativo. Crie um rodízio dentro de uma campanha para começar.
        </div>
      ) : (
        <div className="space-y-2">
          {pools.map((p) => {
            const on = p.metrics_broadcast_interval_minutes > 0;
            return (
              <div key={p.id} className="rounded-xl border border-border/50 bg-card/50 p-3 flex items-center gap-3 flex-wrap">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Bell className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold truncate">{p.campaign_name || p.label}</p>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${on ? "border-primary/40 text-primary" : "border-muted-foreground/30 text-muted-foreground"}`}
                    >
                      {on ? "Ligado" : "Desligado"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" /> {p.members} parceiro{p.members === 1 ? "" : "s"} recebendo
                  </p>
                </div>
                <Select
                  value={String(p.metrics_broadcast_interval_minutes)}
                  onValueChange={(v) => changeInterval(p.id, v)}
                  disabled={savingId === p.id}
                >
                  <SelectTrigger className="w-[150px] h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Desligado</SelectItem>
                    <SelectItem value="30">A cada 30 min</SelectItem>
                    <SelectItem value="60">A cada 1 hora</SelectItem>
                    <SelectItem value="120">A cada 2 horas</SelectItem>
                    <SelectItem value="180">A cada 3 horas</SelectItem>
                    <SelectItem value="240">A cada 4 horas</SelectItem>
                    <SelectItem value="360">A cada 6 horas</SelectItem>
                    <SelectItem value="720">A cada 12 horas</SelectItem>
                    <SelectItem value="1440">1 vez ao dia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

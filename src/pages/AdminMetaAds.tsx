import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, Download, Plus, RefreshCw, AlertCircle, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { CampaignDetailDialog } from "@/components/admin/meta-ads/CampaignDetailDialog";
import { CampaignFormDialog } from "@/components/admin/meta-ads/CampaignFormDialog";

interface CampaignMetric {
  campaign_id: string;
  name: string;
  status: string;
  leads_received: number;
  leads_converted: number;
  conversion_rate: number;
  cac_cents: number | null;
  total_cost_cents: number;
}

const PRESETS: { id: string; label: string; days: number }[] = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "90d", label: "90 dias", days: 90 },
];

function formatBRL(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AdminMetaAds() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [metrics, setMetrics] = useState<CampaignMetric[]>([]);
  const [preset, setPreset] = useState<string>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) { navigate("/auth"); return; }
      if (!alive) return;
      setUserId(uid);
      await loadMetrics(uid, preset);
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function presetRange(p: string): { from: Date; to: Date } {
    const to = new Date();
    const days = PRESETS.find((x) => x.id === p)?.days || 30;
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  async function loadMetrics(uid: string, p: string) {
    setLoading(true);
    let from: Date;
    let to: Date;

    if (p === "custom") {
      if (!customFrom || !customTo) {
        toast.error("Selecione data inicial e final");
        setLoading(false);
        return;
      }
      from = new Date(customFrom);
      to = new Date(customTo);
      if (from > to) {
        toast.error("Data inicial deve ser anterior à final");
        setLoading(false);
        return;
      }
      const days = (to.getTime() - from.getTime()) / (24 * 3600 * 1000);
      if (days > 365) {
        toast.error("Intervalo máximo: 365 dias");
        setLoading(false);
        return;
      }
    } else {
      const r = presetRange(p);
      from = r.from;
      to = r.to;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Sessão expirada");
        setLoading(false);
        return;
      }

      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
      const url = `${supabaseUrl}/functions/v1/meta-ads-metrics?from=${dateString(from)}&to=${dateString(to)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Erro: " + (data.error || res.statusText));
      } else {
        setMetrics(data.by_campaign || []);
      }
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  }

  async function handleImport() {
    if (!userId) return;
    setImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Sessão expirada");
        return;
      }
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
      const res = await fetch(`${supabaseUrl}/functions/v1/meta-ads-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || res.status === 412) {
          toast.error("Reconecte sua conta Meta em /admin/ads");
        } else {
          toast.error("Erro: " + (data.error || res.statusText));
        }
        return;
      }
      toast.success(
        `Importação ok: ${data.inserted} novas, ${data.updated} atualizadas`,
      );
      if (data.new_campaigns_need_message?.length > 0) {
        toast.info(
          `${data.new_campaigns_need_message.length} campanha(s) sem initial_message — preencha pra habilitar match`,
        );
      }
      await loadMetrics(userId, preset);
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(false);
    }
  }

  const totals = useMemo(() => {
    const totalLeads = metrics.reduce((sum, m) => sum + m.leads_received, 0);
    const totalConverted = metrics.reduce((sum, m) => sum + m.leads_converted, 0);
    const totalCost = metrics.reduce((sum, m) => sum + m.total_cost_cents, 0);
    const conv = totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(2) : "0.00";
    const cac = totalConverted > 0 ? totalCost / totalConverted : null;
    return { totalLeads, totalConverted, totalCost, conv, cac };
  }, [metrics]);

  if (loading && metrics.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-base font-semibold">📊 Tracking Meta Ads</h1>
            <p className="text-xs text-muted-foreground">
              Métricas por campanha: clientes interessados recebidos, conversões, CAC.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
            Importar do Meta
          </Button>
          <Button size="sm" onClick={() => { setEditingCampaign(null); setFormOpen(true); }}>
            <Plus className="mr-1 h-3 w-3" />
            Nova campanha
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  Últimos {p.label}
                </SelectItem>
              ))}
              <SelectItem value="custom">Período customizado</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-[160px]"
              />
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-[160px]"
              />
            </>
          )}
          {userId && (
            <Button variant="outline" size="sm" onClick={() => loadMetrics(userId, preset)}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Atualizar
            </Button>
          )}
        </div>

        {/* Totais */}
        <div className="grid gap-3 md:grid-cols-4">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Clientes interessados recebidos</p>
            <p className="text-2xl font-bold">{totals.totalLeads}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Convertidos</p>
            <p className="text-2xl font-bold">{totals.totalConverted}</p>
            <p className="text-[10px] text-muted-foreground">{totals.conv}% conversão</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Custo total</p>
            <p className="text-2xl font-bold">{formatBRL(totals.totalCost)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">CAC</p>
            <p className="text-2xl font-bold">{formatBRL(totals.cac)}</p>
          </Card>
        </div>

        {/* Tabela */}
        {metrics.length === 0 ? (
          <Card className="p-12 text-center">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="mb-2 text-sm text-muted-foreground">
              Nenhuma campanha encontrada no período.
            </p>
            <p className="text-xs text-muted-foreground">
              Importe do Meta acima ou crie uma campanha manual.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Campanha</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Clientes interessados</th>
                    <th className="px-3 py-2 text-right">Convertidos</th>
                    <th className="px-3 py-2 text-right">Conv %</th>
                    <th className="px-3 py-2 text-right">Custo</th>
                    <th className="px-3 py-2 text-right">CAC</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr
                      key={m.campaign_id}
                      className="cursor-pointer border-t hover:bg-primary/5"
                      onClick={() => setSelectedCampaignId(m.campaign_id)}
                    >
                      <td className="px-3 py-2 font-medium">{m.name}</td>
                      <td className="px-3 py-2">
                        <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-[10px]">
                          {m.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">{m.leads_received}</td>
                      <td className="px-3 py-2 text-right">{m.leads_converted}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={m.conversion_rate >= 5 ? "text-primary" : ""}>
                          {m.conversion_rate.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{formatBRL(m.total_cost_cents)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatBRL(m.cac_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>

      {selectedCampaignId && userId && (
        <CampaignDetailDialog
          open={!!selectedCampaignId}
          onOpenChange={(o) => { if (!o) setSelectedCampaignId(null); }}
          campaignId={selectedCampaignId}
          consultantId={userId}
          fromDate={preset === "custom" ? customFrom : dateString(presetRange(preset).from)}
          toDate={preset === "custom" ? customTo : dateString(presetRange(preset).to)}
        />
      )}

      {formOpen && userId && (
        <CampaignFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          consultantId={userId}
          campaign={editingCampaign}
          onSaved={() => loadMetrics(userId, preset)}
        />
      )}
    </div>
  );
}

/**
 * /admin/saude-producao — Dashboard de produção (Super Admin only)
 * Mostra: funil 24h por variante, origem dos leads, saúde técnica,
 * leads travados e checklist de go-live.
 */
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle, Users, Megaphone, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Snapshot = {
  id: string;
  consultant_id: string;
  captured_at: string;
  instance_status: string;
  pixel_ok: boolean;
  capi_ok: boolean;
  flows_ok: boolean;
  flows_missing: string[];
  active_variants: string[];
  notification_phone_ok: boolean;
  last_lead_at: string | null;
  leads_24h: number;
};

type Consultant = { id: string; name: string };

type FunnelRow = { variant: string; lead: number; conta: number; ocr: number; pitch: number; club: number; aprovado: number };

type StuckLead = { id: string; name: string | null; phone_whatsapp: string; conversation_step: string; flow_variant: string | null; updated_at: string };

export default function SaudeProducao() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [origins, setOrigins] = useState<{ source: string; count: number }[]>([]);
  const [stuck, setStuck] = useState<StuckLead[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth"); return; }
      const { data } = await supabase.rpc("is_super_admin", { _user_id: user.id });
      setIsSuperAdmin(!!data);
      if (!data) { setLoading(false); return; }
      await loadAll();
      setLoading(false);
    })();
  }, []);

  async function loadAll() {
    setRefreshing(true);
    try {
      // Latest snapshot per consultant
      const { data: snaps } = await supabase
        .from("production_health_snapshot")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(500);
      const latestByConsultant = new Map<string, Snapshot>();
      for (const s of (snaps || []) as Snapshot[]) {
        if (!latestByConsultant.has(s.consultant_id)) latestByConsultant.set(s.consultant_id, s);
      }
      setSnapshots(Array.from(latestByConsultant.values()));

      const { data: cs } = await supabase.from("consultants").select("id, name");
      setConsultants(((cs || []) as any[]) as Consultant[]);

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: cust24 } = await supabase
        .from("customers")
        .select("flow_variant, conversation_step, lead_source, status")
        .gte("created_at", since24h);

      // Funil
      const byVar: Record<string, FunnelRow> = {};
      for (const v of ["A", "B", "D"]) byVar[v] = { variant: v, lead: 0, conta: 0, ocr: 0, pitch: 0, club: 0, aprovado: 0 };
      for (const c of (cust24 || []) as any[]) {
        const v = (c.flow_variant || "A").toUpperCase();
        if (!byVar[v]) byVar[v] = { variant: v, lead: 0, conta: 0, ocr: 0, pitch: 0, club: 0, aprovado: 0 };
        byVar[v].lead++;
        const step = String(c.conversation_step || "").toLowerCase();
        if (/aguardando_conta|capture_conta|ocr|conta_recebida|conta_validada|pitch|club|complete|aprovado|registered/.test(step)) byVar[v].conta++;
        if (/ocr|conta_validada|pitch|club|complete|aprovado|registered/.test(step)) byVar[v].ocr++;
        if (/pitch|club|complete|aprovado|registered/.test(step)) byVar[v].pitch++;
        if (/club|complete|aprovado|registered/.test(step)) byVar[v].club++;
        if (c.status === "approved" || c.status === "active" || c.status === "registered_igreen" || c.status === "complete") byVar[v].aprovado++;
      }
      setFunnel(Object.values(byVar));

      // Origens
      const originMap = new Map<string, number>();
      for (const c of (cust24 || []) as any[]) {
        const src = c.lead_source || "orgânico";
        originMap.set(src, (originMap.get(src) || 0) + 1);
      }
      setOrigins(Array.from(originMap.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count));

      // Travados (>2h em capture_*)
      const since2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: st } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, conversation_step, flow_variant, updated_at")
        .like("conversation_step", "capture_%")
        .lt("updated_at", since2h)
        .order("updated_at", { ascending: true })
        .limit(50);
      setStuck((st || []) as StuckLead[]);
    } finally {
      setRefreshing(false);
    }
  }

  const checklist = useMemo(() => {
    const total = snapshots.length || 1;
    const pixelOk = snapshots.filter((s) => s.pixel_ok).length;
    const capiOk = snapshots.filter((s) => s.capi_ok).length;
    const connected = snapshots.filter((s) => s.instance_status === "connected").length;
    const flowsOk = snapshots.filter((s) => s.flows_ok).length;
    const notifOk = snapshots.filter((s) => s.notification_phone_ok).length;
    return [
      { label: "Pixel configurado", ok: pixelOk, total, ready: pixelOk === total },
      { label: "Integração de anúncios ativa", ok: capiOk, total, ready: capiOk === total },
      { label: "Instância WhatsApp conectada", ok: connected, total, ready: connected === total },
      { label: "Fluxos por variante ativos", ok: flowsOk, total, ready: flowsOk === total },
      { label: "Notification phone configurado", ok: notifOk, total, ready: notifOk === total },
    ];
  }, [snapshots]);

  if (loading) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  if (isSuperAdmin === false) return <div className="p-8 text-destructive">Acesso restrito ao Super Admin.</div>;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Saúde de Produção</h1>
          <p className="text-sm text-muted-foreground">Visão em tempo real do funil, origens, infraestrutura e clientes interessados travados.</p>
        </div>
        <Button onClick={loadAll} disabled={refreshing} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </header>

      {/* Checklist go-live */}
      <Card className="p-4 md:p-6 mb-6 border-primary/20">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" /> Checklist Go-Live</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {checklist.map((c) => (
            <div key={c.label} className={`p-3 rounded-lg border ${c.ready ? "border-primary/30 bg-primary/5" : "border-warning/30 bg-warning/5"}`}>
              <div className="flex items-center gap-2">
                {c.ready ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                <span className="text-xs font-medium">{c.label}</span>
              </div>
              <div className="text-lg font-bold mt-1">{c.ok}/{c.total}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {checklist.every((c) => c.ready) ? "✅ Todos os consultores prontos para produção." : "⚠️ Alguns consultores ainda precisam de ajustes."}
          </div>
          <Badge variant={checklist.every((c) => c.ready) ? "default" : "secondary"}>
            {checklist.every((c) => c.ready) ? "🚀 Modo Produção OK" : "Pendente"}
          </Badge>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Funil */}
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /> Funil 24h por variante</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left p-2">Variação</th><th className="p-2">Clientes interessados</th><th className="p-2">Conta</th><th className="p-2">Leitura</th><th className="p-2">Apresentação</th><th className="p-2">Club</th><th className="p-2">Aprovado</th></tr>
              </thead>
              <tbody>
                {funnel.map((r) => (
                  <tr key={r.variant} className="border-t border-border/30">
                    <td className="p-2 font-bold">{r.variant}</td>
                    <td className="text-center p-2">{r.lead}</td>
                    <td className="text-center p-2">{r.conta}{r.lead > 0 && <span className="text-xs text-muted-foreground ml-1">({Math.round(r.conta / r.lead * 100)}%)</span>}</td>
                    <td className="text-center p-2">{r.ocr}</td>
                    <td className="text-center p-2">{r.pitch}</td>
                    <td className="text-center p-2">{r.club}</td>
                    <td className="text-center p-2 font-semibold text-primary">{r.aprovado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Origens */}
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> Origem dos clientes interessados 24h</h2>
          {origins.length === 0 ? <p className="text-sm text-muted-foreground">Sem clientes interessados nas últimas 24h.</p> : (
            <div className="space-y-2">
              {origins.map((o) => (
                <div key={o.source} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                  <span className="text-sm capitalize">{o.source.replace(/_/g, " ")}</span>
                  <Badge>{o.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Saúde técnica */}
        <Card className="p-4 md:p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Zap className="h-5 w-5 text-primary" /> Saúde por consultor</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="text-left p-2">Consultor</th><th className="p-2">Instância</th><th className="p-2">Pixel</th><th className="p-2">CAPI</th><th className="p-2">Fluxos</th><th className="p-2">Variantes</th><th className="p-2">Notif</th><th className="p-2">Clientes interessados 24h</th></tr>
              </thead>
              <tbody>
                {snapshots.map((s) => {
                  const c = consultants.find((x) => x.id === s.consultant_id);
                  return (
                    <tr key={s.id} className="border-t border-border/30">
                      <td className="p-2 font-medium">{c?.name || s.consultant_id.slice(0, 8)}</td>
                      <td className="text-center p-2">{s.instance_status === "connected" ? <CheckCircle2 className="h-4 w-4 text-primary inline" /> : <span title={s.instance_status}><XCircle className="h-4 w-4 text-destructive inline" /></span>}</td>
                      <td className="text-center p-2">{s.pixel_ok ? "✅" : "—"}</td>
                      <td className="text-center p-2">{s.capi_ok ? "✅" : "—"}</td>
                      <td className="text-center p-2">{s.flows_ok ? "✅" : <span className="text-warning text-xs">faltam {s.flows_missing.join(",")}</span>}</td>
                      <td className="text-center p-2 text-xs">{(s.active_variants || []).join("/")}</td>
                      <td className="text-center p-2">{s.notification_phone_ok ? "✅" : "—"}</td>
                      <td className="text-center p-2 font-semibold">{s.leads_24h}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Travados */}
        <Card className="p-4 md:p-6 lg:col-span-2 border-warning/20">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Users className="h-5 w-5 text-warning" /> Clientes interessados travados (&gt;2h em capture_*)</h2>
          {stuck.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum cliente interessado travado 🎉</p> : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {stuck.map((l) => (
                <div key={l.id} className="flex items-center justify-between p-2 rounded bg-warning/5 border border-warning/20">
                  <div className="text-sm">
                    <span className="font-medium">{l.name || l.phone_whatsapp}</span>
                    <span className="text-xs text-muted-foreground ml-2">{l.conversation_step} · Var {l.flow_variant || "?"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(l.updated_at).toLocaleString("pt-BR")}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

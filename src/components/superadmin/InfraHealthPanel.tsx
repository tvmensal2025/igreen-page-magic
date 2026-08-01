// Lote 3 — Painel de saúde de infraestrutura.
// Mostra última leitura do minio-quota-check (alive, used_bytes, pct) e
// permite ao super_admin configurar o telefone/instância de alertas e o
// limiar de uso do MinIO.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Database, HardDrive, Loader2, RefreshCw, Save } from "lucide-react";
import { OpsAlertsModal } from "@/components/superadmin/OpsAlertsModal";

interface MinioReading {
  created_at: string;
  value_num: number | null;
  meta: {
    alive?: boolean;
    bucket?: string;
    used_bytes?: number;
    total_bytes?: number | null;
    object_count?: number;
    truncated?: boolean;
    ok?: boolean;
    error?: string | null;
  };
}

function fmtGB(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function severity(pct: number | null, alive: boolean | undefined, threshold: number) {
  if (!alive) return { tone: "destructive" as const, label: "OFFLINE" };
  if (pct === null) return { tone: "secondary" as const, label: "OK" };
  if (pct >= 95) return { tone: "destructive" as const, label: "CRÍTICO" };
  if (pct >= threshold) return { tone: "default" as const, label: "ATENÇÃO" };
  if (pct >= 70) return { tone: "secondary" as const, label: "ALTO" };
  return { tone: "secondary" as const, label: "OK" };
}

export function InfraHealthPanel() {
  const { toast } = useToast();
  const [latest, setLatest] = useState<MinioReading | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const [adminPhone, setAdminPhone] = useState("");
  const [adminInstance, setAdminInstance] = useState("");
  const [threshold, setThreshold] = useState(85);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: m }, { data: s }] = await Promise.all([
      supabase
        .from("infra_metrics" as any)
        .select("created_at, value_num, meta")
        .eq("metric_key", "minio_health")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("app_settings")
        .select("super_admin_phone, super_admin_instance_name, minio_alert_threshold_pct")
        .eq("id", "global")
        .maybeSingle(),
    ]);
    setLatest((m as any) || null);
    setAdminPhone((s as any)?.super_admin_phone || "");
    setAdminInstance((s as any)?.super_admin_instance_name || "");
    setThreshold(Number((s as any)?.minio_alert_threshold_pct ?? 85));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function runNow() {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("minio-quota-check");
      if (error) throw error;
      await load();
      toast({ title: "Verificação executada", description: "Última leitura atualizada." });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: row, error } = await supabase
        .from("app_settings")
        .update({
          super_admin_phone: adminPhone.replace(/\D/g, "") || null,
          super_admin_instance_name: adminInstance.trim() || null,
          minio_alert_threshold_pct: Math.max(0, Math.min(100, Math.round(threshold))),
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", "global")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      // RLS nega sem erro (0 linhas) — não pode dizer "salvo" com o telefone
      // de alerta antigo ainda valendo.
      if (!row) throw new Error("Sem permissão para salvar (precisa super_admin).");
      toast({ title: "Configuração salva" });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const pct = latest?.value_num ?? null;
  const alive = latest?.meta?.alive;
  const sev = severity(pct, alive, threshold);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/15 text-primary">
          <HardDrive className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-sm">Infra · MinIO + Alertas</h3>
            <Badge variant={sev.tone} className="text-[10px]">{sev.label}</Badge>
            {latest?.meta?.truncated && (
              <Badge variant="secondary" className="text-[10px]">amostra parcial</Badge>
            )}
            <div className="ml-auto">
              <OpsAlertsModal />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Bucket <span className="font-mono">{latest?.meta?.bucket || "—"}</span>
            {" · "}
            Usado: <span className="font-semibold">{fmtGB(latest?.meta?.used_bytes)}</span>
            {latest?.meta?.total_bytes ? <> / {fmtGB(latest?.meta?.total_bytes)}</> : null}
            {pct !== null && <> ({pct.toFixed(1)}%)</>}
            {" · "}
            {latest?.meta?.object_count ?? 0} objetos
            {latest?.created_at && (
              <> · última checagem <span className="opacity-70">{new Date(latest.created_at).toLocaleString("pt-BR")}</span></>
            )}
          </p>
          {latest?.meta?.error && (
            <p className="text-xs text-destructive mt-1">Erro: {latest.meta.error}</p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => void runNow()} disabled={running || loading} className="shrink-0">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-1.5">Verificar agora</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-border">
        <div>
          <Label className="text-[11px]">Telefone super_admin</Label>
          <Input
            placeholder="5511999998888"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value)}
            className="h-8 text-sm font-mono"
          />
        </div>
        <div>
          <Label className="text-[11px]">Instância p/ enviar alertas</Label>
          <Input
            placeholder="igreen-fulano"
            value={adminInstance}
            onChange={(e) => setAdminInstance(e.target.value)}
            className="h-8 text-sm font-mono"
          />
        </div>
        <div>
          <Label className="text-[11px]">Limiar MinIO (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 0)}
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void saveSettings()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Database className="w-3 h-3" /> Cron <span className="font-mono">minio-quota-check</span> (15min) e <span className="font-mono">super-admin-alerts</span> (5min) gravam histórico em <span className="font-mono">infra_metrics</span>.
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, DollarSign, Wallet, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toUserFacingError } from "@/lib/userFacingError";

type PnL = {
  gross_topped_up_cents: number;
  stripe_fees_cents: number;
  net_received_cents: number;
  refunds_cents: number;
  gross_meta_spend_cents: number;
  charged_to_consultants_cents: number;
  margin_cents: number;
  net_profit_cents: number;
};

type Settings = {
  platform_fee_percent: number;
  iof_compensation_percent: number;
  min_balance_to_create_campaign_cents: number;
  default_auto_pause_at_cents: number;
  campaign_safety_multiplier: number;
  low_balance_alert_cents: number;
};

const fmt = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PlatformPnLCard() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [pnl, setPnl] = useState<PnL | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [{ data: pnlData, error: pnlErr }, { data: sData }] = await Promise.all([
        supabase.rpc("get_platform_pnl", { _from: from, _to: to }),
        supabase.from("platform_settings").select("*").eq("id", true).maybeSingle(),
      ]);
      if (pnlErr) throw pnlErr;
      setPnl(((pnlData as any[]) || [])[0] || null);
      setSettings(sData as any);
    } catch (e) {
      console.error("[PlatformPnLCard] load", e);
      toast({
        title: "Não foi possível carregar o lucro da plataforma",
        description: toUserFacingError(e, "Tente atualizar em alguns segundos."),
        variant: "destructive",
        duration: 14000,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("platform_settings").update({
        platform_fee_percent: settings.platform_fee_percent,
        iof_compensation_percent: settings.iof_compensation_percent,
        min_balance_to_create_campaign_cents: settings.min_balance_to_create_campaign_cents,
        default_auto_pause_at_cents: settings.default_auto_pause_at_cents,
        campaign_safety_multiplier: settings.campaign_safety_multiplier,
        low_balance_alert_cents: settings.low_balance_alert_cents,
      }).eq("id", true);
      if (error) throw error;
      toast({ title: "Configurações salvas" });
    } catch (e) {
      console.error("[PlatformPnLCard] saveSettings", e);
      toast({
        title: "Não foi possível salvar",
        description: toUserFacingError(e),
        variant: "destructive",
        duration: 14000,
      });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* P&L */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Recebido bruto (Stripe)" value={pnl ? fmt(pnl.gross_topped_up_cents) : "—"} icon={Wallet} />
        <Stat label="Taxas Stripe" value={pnl ? `- ${fmt(pnl.stripe_fees_cents)}` : "—"} icon={TrendingDown} negative />
        <Stat label="Líquido recebido" value={pnl ? fmt(pnl.net_received_cents) : "—"} icon={DollarSign} />
        <Stat label="Estornos" value={pnl ? `- ${fmt(pnl.refunds_cents)}` : "—"} icon={TrendingDown} negative />
        <Stat label="Gasto bruto Meta (anúncios)" value={pnl ? `- ${fmt(pnl.gross_meta_spend_cents)}` : "—"} icon={TrendingDown} negative />
        <Stat label="Cobrado dos consultores" value={pnl ? fmt(pnl.charged_to_consultants_cents) : "—"} icon={DollarSign} />
        <Stat label="Margem da plataforma" value={pnl ? fmt(pnl.margin_cents) : "—"} icon={TrendingUp} positive />
        <Stat
          label="Lucro líquido da plataforma"
          value={pnl ? fmt(pnl.net_profit_cents) : "—"}
          icon={TrendingUp}
          positive={pnl ? pnl.net_profit_cents >= 0 : false}
          negative={pnl ? pnl.net_profit_cents < 0 : false}
          highlight
        />
      </div>

      {/* Settings */}
      {settings && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-5 backdrop-blur">
          <h3 className="text-sm font-semibold mb-4">Configurações de monetização</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <NumField label="Margem da plataforma (%)" value={settings.platform_fee_percent}
              onChange={(v) => setSettings({ ...settings, platform_fee_percent: v })} step="0.1" />
            <NumField label="Compensação IOF (%)" value={settings.iof_compensation_percent}
              onChange={(v) => setSettings({ ...settings, iof_compensation_percent: v })} step="0.01" />
            <NumField label="Multiplicador de segurança (campanhas)" value={settings.campaign_safety_multiplier}
              onChange={(v) => setSettings({ ...settings, campaign_safety_multiplier: v })} step="0.05" />
            <NumField label="Saldo mínimo para criar campanha (R$)"
              value={settings.min_balance_to_create_campaign_cents / 100}
              onChange={(v) => setSettings({ ...settings, min_balance_to_create_campaign_cents: Math.round(v * 100) })} step="1" />
            <NumField label="Auto-pause padrão (R$)"
              value={settings.default_auto_pause_at_cents / 100}
              onChange={(v) => setSettings({ ...settings, default_auto_pause_at_cents: Math.round(v * 100) })} step="1" />
            <NumField label="Alerta de saldo baixo (R$)"
              value={settings.low_balance_alert_cents / 100}
              onChange={(v) => setSettings({ ...settings, low_balance_alert_cents: Math.round(v * 100) })} step="1" />
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={saveSettings} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Margem aplicada sobre todo gasto bruto Meta debitado da carteira do consultor. Ex.: 20% = consultor gasta R$ 100 reais Meta, paga R$ 120.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, positive, negative, highlight }: {
  label: string; value: string; icon: any; positive?: boolean; negative?: boolean; highlight?: boolean;
}) {
  const color = positive ? "text-primary" : negative ? "text-destructive" : "text-foreground";
  return (
    <div className={`rounded-xl border p-4 backdrop-blur ${highlight ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/40"}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}